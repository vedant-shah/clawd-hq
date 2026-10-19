// The check on finished work: after a specialist hands its work back, Haiku reads the whole record of what it did and
// may leave one note on Clawd's card. register.tsx holds the hooks, the card's state and every `$` call, and hands
// them in as `KnowIo`; the rules are in hooks/know.ts and the write-up in hooks/know-record.ts.
import type { ModelCompleteResult, SessionMessage } from 'claude-code'
import type { KnowNote, KnowState } from '../types'
import {
  BACKOFF0, KNEW_KEEP, OWN_TURN_TOOLS, SHOWN_KEEP, afterIgnored, afterPrompt, backoffFrom, checkAsk, isRepeat,
  keepLast, listFrom, nextCheck, parseNote, withLog, withNote, withOpened, withoutNote,
} from './know'
import type { Backoff, KnowLogEntry } from './know'
import { CAP_CHARS, buildRecord, turnRows } from './know-record'
import type { LeftOut, RecordInput } from './know-record'
import { PANES } from './panes'
import { side } from './side-ask'
import { inLine } from './state'
import { isStepTool } from './steps'

const MODEL = 'haiku'
const MAX_TOKENS = 700
const TIMEOUT_MS = 60_000
/** How many of the person's latest prompts ride along. */
const PROMPTS_KEPT = 2
/** Store keys, kept per project folder as the payroll and the artifact list are. */
const KEYS = { shown: 'know:shown', knew: 'know:knew', backoff: 'know:backoff', log: 'know:log' } as const
type Key = (typeof KEYS)[keyof typeof KEYS]

/** What the check may do, each one a `$` call made in register.tsx. */
export type KnowIo = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<unknown>
  /** Where the session draws now: the desktop app and phones attach after the session starts. */
  surfaces: () => Promise<readonly string[]>
  panes: () => Promise<ReadonlyArray<{ id: string; isPlaced: boolean }>>
  /** One agent's rows, or why the session will not say; with no id, the main chat's. */
  messages: (agentId?: string) => Promise<readonly SessionMessage[] | { deny: string }>
  complete: (ask: { model: string; system: string; prompt: string; maxTokens: number; timeoutMs: number }) => Promise<ModelCompleteResult>
  card: () => Promise<KnowState>
  /** Puts text after what is in the person's prompt box; never sends it. */
  fillPrompt: (text: string) => Promise<unknown>
  setCard: (fn: (s: KnowState) => KnowState) => Promise<unknown>
}

/** What a hand-back carries that the check reads: a specialist's (`agentId`), or a turn of Clawd's own (`turnText`, its request). */
export type Handback = {
  agentId?: string
  turnText?: string
  reason: RecordInput['ended']
  answer: string
  durationMs?: number
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}

export type KnowActions = { knowMore: () => unknown; knowDiscuss: () => unknown; knowGotIt: () => unknown; knowDismiss: () => unknown }

/** The project folder the session runs in: the lists and the log are its own. */
let folder = ''
const keyOf = (key: Key) => `${key}:${folder}`
/** Goes up on /clear, resume and session end: a reply asked for before then is dropped. */
let epoch = 0
let prompts: readonly string[] = []
type Lists = { shown: readonly string[]; knew: readonly string[]; backoff: Backoff; log: readonly KnowLogEntry[] }
let lists: Lists | undefined
/** Each specialist's brief as it was sent, and how many of its rows were already checked. */
const briefs = new Map<string, string>()
const checkedRows = new Map<string, number>()
let notes = 0
/** A note was shown since the person's last message: no other until the next one, even if that note is gone. */
let isNoteSent = false
/** Clawd's own turn under way: its request, and the tools he has used in it. */
let turn = { text: '', tools: 0 }

/** The brief a specialist was hired with, for a resumed run, whose rows open with the message that started it. */
export function keepBrief(id: string, brief: string) {
  briefs.set(id, brief)
}

/** A save that fails keeps the value in memory, silently: the lists only steer later checks. */
async function save(io: KnowIo, key: Key, value: unknown) {
  try {
    await io.set(keyOf(key), value)
  } catch { /* kept in memory for this session */ }
}

async function loadLists(io: KnowIo) {
  if (lists) return lists
  const got = async (key: Key) => { try { return await io.get(keyOf(key)) } catch { return undefined } }
  const [shown, knew, backoff, log] = [await got(KEYS.shown), await got(KEYS.knew), await got(KEYS.backoff), await got(KEYS.log)]
  lists ??= { shown: listFrom(shown, SHOWN_KEEP), knew: listFrom(knew, KNEW_KEEP), backoff: backoffFrom(backoff), log: Array.isArray(log) ? log : [] }
  return lists
}

/**
 * One change to one list, made on the lists as they stand when its turn comes and saved before the next starts, so
 * changes made at the same moment (several checks ending at once) never overwrite each other.
 */
function change<K extends keyof Lists>(io: KnowIo, field: K, fn: (value: Lists[K]) => Lists[K]) {
  return inLine(async () => {
    const before = (await loadLists(io))[field]
    const value = fn(before)
    // Left as it was: nothing to save.
    if (value === before) return
    lists = { ...(await loadLists(io)), [field]: value }
    await save(io, KEYS[field], value)
  })
}

/** A press always writes its reset, even when this session already holds it: another session may have stored more. */
const setBackoff = (io: KnowIo, backoff: Backoff) => change(io, 'backoff', () => ({ ...backoff }))
const addLog = (io: KnowIo, entry: KnowLogEntry) => change(io, 'log', log => withLog(log, entry))

/**
 * Why nobody can see the office, or nothing when someone can: something is drawn now (read at each ask, since the
 * desktop app attaches after the session starts) and one of its tabs is open (any of the four; a note waits on Clawd's
 * card until the Office tab is in front). A reading that fails counts as nothing drawn or no tab open.
 */
async function whyUnseen(io: KnowIo): Promise<string | undefined> {
  const surfaces = await io.surfaces().catch(() => [])
  if (surfaces.length === 0) return 'nothing is drawn'
  const panes = await io.panes().catch(() => [])
  return panes.some(p => p.isPlaced && PANES.some(one => one.id === p.id)) ? undefined : 'no office tab is open'
}

/** Someone can see the office. Where nobody can, no check is made and Claude Code's own "You should know" is let through. */
export const isWatching = async (io: KnowIo): Promise<boolean> => (await whyUnseen(io)) === undefined

/**
 * Why no note may be left now, or nothing when one may: one is on the card, or one was already shown for the person's
 * latest message (a card the person has cleared does not free it; their next message does).
 */
async function whyHeld(io: KnowIo): Promise<string | undefined> {
  if ((await io.card()).note) return 'a note is already showing'
  return isNoteSent ? 'a note was already shown for this message' : undefined
}

/**
 * A specialist handed its work back: unless a note is held or the back-off says skip, a check joins the line of side
 * questions. Never waited on by the hand-back and never throws.
 */
export async function checkHandback(io: KnowIo, h: Handback, who: string) {
  const at = await io.now().catch(() => 0)
  try {
    const unseen = await whyUnseen(io)
    if (unseen) return await addLog(io, { at, who, outcome: 'skipped', reason: unseen })
    const held = await whyHeld(io)
    if (held) return await addLog(io, { at, who, outcome: 'skipped', reason: held })
    // The rows are taken now: work done after this hand-back belongs to a later check, however long this one waits.
    const taken = await takeRows(io, h)
    if (!taken.rows) return await addLog(io, { at, who, outcome: 'refused', reason: taken.why })
    // A specialist that only talked has no steps to set its report against; Clawd's own turns get here with six or more.
    if (!taken.rows.some(r => r.toolUses.some(use => !isStepTool(use.tool)))) return await addLog(io, { at, who, outcome: 'skipped', reason: 'the run used no tools' })
    let isSkipped = false
    await change(io, 'backoff', b => {
      const turn = nextCheck(b)
      isSkipped = turn.isSkipped
      return turn.backoff
    })
    if (isSkipped) return await addLog(io, { at, who, outcome: 'skipped', reason: 'notes were passed over' })
    const asked = epoch
    const job: Taken = { ...(taken as Taken), asked: prompts }
    side.queue(() => runCheck(io, h, who, asked, job), () => void addLog(io, { at, who, outcome: 'dropped', reason: 'too many checks waiting' }))
  } catch {
    // A check is a nicety: it never stops a hand-back, but the log still says it did not get far.
    await addLog(io, { at, who, outcome: 'failed', reason: 'the check stopped on an error before it started' }).catch(() => undefined)
  }
}

/** The rows a check reads, as they stood at the hand-back, and what was left out before them. */
type Taken = { rows: RecordInput['rows']; isResumed?: boolean; leftOut?: LeftOut; asked: readonly string[] }

/**
 * The rows of this run: for a resumed specialist, those since its last check; for a turn of Clawd's own, the main chat's
 * from the message that opened it. None, with why, when the session will not say.
 */
async function takeRows(io: KnowIo, h: Handback): Promise<Partial<Taken> & { why?: string }> {
  const id = h.agentId
  const all = await io.messages(id)
  if (!Array.isArray(all)) return { why: (all as { deny: string }).deny }
  if (id === undefined) return turnRows(all, h.turnText ?? '')
  const from = checkedRows.get(id) ?? 0
  checkedRows.set(id, all.length)
  return { rows: all.slice(from), isResumed: from > 0, leftOut: from > 0 ? 'earlier-runs' : undefined }
}

async function runCheck(io: KnowIo, h: Handback, who: string, asked: number, { rows, isResumed, leftOut, asked: said }: Taken) {
  const at = await io.now()
  try {
    // A check that waited in the line may start after an earlier one left a note: it is skipped before it is paid for.
    const held = await whyHeld(io)
    if (held) return await addLog(io, { at, who, outcome: 'skipped', reason: held })
    const u = h.usage
    const tokens = u ? { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens } : undefined
    const brief = h.agentId === undefined ? undefined : briefs.get(h.agentId)
    const record = buildRecord({ who, isClawd: h.agentId === undefined, ended: h.reason, rows, brief, isResumed, leftOut, report: h.answer, prompts: said, durationMs: h.durationMs, tokens })
    if (record.chars > 2 * CAP_CHARS) return await addLog(io, { at, who, outcome: 'skipped', recordChars: record.chars, reason: 'the record was too long' })
    await askModel(io, record, who, at, asked)
  } catch {
    await addLog(io, { at, who, outcome: 'failed', reason: 'the check stopped on an error' })
  }
}

async function askModel(io: KnowIo, record: { text: string; chars: number }, who: string, at: number, asked: number) {
  const { shown, knew } = await loadLists(io)
  const ask = checkAsk(record.text, shown, knew)
  const reply = await io.complete({ model: MODEL, system: ask.system, prompt: ask.prompt, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS })
  const base = { at, who, inTokens: reply.usage.input_tokens, outTokens: reply.usage.output_tokens, ms: (await io.now()) - at, recordChars: record.chars }
  // The conversation it was asked for is over: what it says is not this one's.
  if (asked !== epoch) return addLog(io, { ...base, outcome: 'stale' })
  if (!reply.isAnswered) return addLog(io, { ...base, outcome: reply.reason })
  const parsed = parseNote(reply.text)
  if (parsed.kind !== 'note') return addLog(io, { ...base, outcome: parsed.kind, ...(parsed.kind === 'failed' ? { reason: parsed.why } : {}) })
  const now = await loadLists(io)
  if (isRepeat(parsed.line, now.shown, now.knew)) return addLog(io, { ...base, outcome: 'repeat' })
  const { kind: _, ...said } = parsed
  return addLog(io, { ...base, ...(await showNote(io, { ...said, id: `k${(notes += 1)}`, who, at })) })
}

/** The note takes Clawd's card and joins the shown list, unless one is held (checked once more, as the reply was paid for). */
async function showNote(io: KnowIo, note: KnowNote): Promise<{ outcome: string; reason?: string }> {
  const held = await whyHeld(io)
  if (held) return { outcome: 'skipped', reason: held }
  isNoteSent = true
  await io.setCard(s => withNote(s, note))
  await change(io, 'shown', shown => keepLast(shown, note.line, SHOWN_KEEP))
  return { outcome: 'shown' }
}

// ---- The person's side: the buttons on the card, and prompts that pass a note over ----

/** Any press on the card: the note changes, and the back-off starts over. */
async function pressed(io: KnowIo, fn: (s: KnowState) => KnowState) {
  await io.setCard(fn)
  await setBackoff(io, BACKOFF0)
}

/** The person's own opener about the note: its line, its longer version when there is one, and the question to talk over. */
export const discussText = (note: Pick<KnowNote, 'line' | 'explain'>) =>
  [`Clawd raised this: "${note.line}".`, note.explain, "Let's discuss: is this a real concern here, and what should we do about it?"]
    .filter(part => part !== undefined && part !== '').join(' ')

/** Fills the prompt box for the person to send (never sends), then takes the note off like Dismiss. */
async function discuss(io: KnowIo) {
  const { note } = await io.card()
  if (note) await io.fillPrompt(discussText(note))
  await pressed(io, withoutNote)
}

export function knowActions(io: KnowIo): KnowActions {
  return {
    knowMore: () => pressed(io, withOpened),
    knowDiscuss: () => discuss(io),
    knowGotIt: () => pressed(io, withoutNote),
    knowDismiss: () => pressed(io, withoutNote),
  }
}

/**
 * One prompt of the person's (not a command, not one they did not type): kept to ride along with the next checks, it
 * allows a note again, and the second since a note appeared passes it over. Never throws.
 */
export async function knowPrompt(io: KnowIo, e: { text: string; isMeta?: true; command?: unknown }) {
  if (e.isMeta || e.command) return
  prompts = [...prompts, e.text].slice(-PROMPTS_KEPT)
  isNoteSent = false
  try {
    const before = await io.card()
    const { state, isIgnored } = afterPrompt(before)
    if (state !== before) await io.setCard(() => state)
    if (isIgnored) await change(io, 'backoff', afterIgnored)
  } catch { /* the card stays as it was */ }
}

/** A new conversation, or none: nothing waiting is for it. The lists, kept across sessions, stay. */
export async function forgetKnow(io: KnowIo) {
  epoch += 1
  prompts = []
  isNoteSent = false
  briefs.clear()
  checkedRows.clear()
  side.clear()
  if ((await io.card()).note) await io.setCard(withoutNote)
}

/** A session starts: the project's own lists are read afresh. */
export async function startKnow(io: KnowIo, projectFolder: string) {
  folder = projectFolder
  lists = undefined
  await forgetKnow(io)
}

// ---- Clawd's own long turns: counted as they go, checked like a specialist's run at their end ----

/** A turn of Clawd's own starts: its request is kept and its tools are counted afresh. */
export function knowTurnStart(text: string) {
  turn = { text, tools: 0 }
}

/** Clawd used a tool in his own turn. */
export function knowToolUsed() {
  turn = { ...turn, tools: turn.tools + 1 }
}

/** Clawd's own turn ended: one that used six tools or more is checked. Never waited on and never throws. */
export async function checkOwnTurn(io: KnowIo, e: Omit<Handback, 'agentId' | 'turnText'>) {
  const done = turn
  turn = { text: '', tools: 0 }
  if (done.tools >= OWN_TURN_TOOLS) await checkHandback(io, { ...e, turnText: done.text }, 'Clawd')
}
