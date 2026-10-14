// The check on finished work: after a specialist hands its work back, Haiku reads the whole record of what it did and
// may leave one note on Clawd's card. register.tsx holds the hooks, the card's state and every `$` call, and hands
// them in as `KnowIo`; the rules are in hooks/know.ts and the write-up in hooks/know-record.ts.
import type { ModelCompleteResult, SessionMessage } from 'claude-code'
import type { KnowNote, KnowState } from '../types'
import {
  BACKOFF0, CARD_NOTES, KNEW_KEEP, SHOWN_KEEP, afterIgnored, afterPrompt, backoffFrom, checkAsk, isRepeat,
  keepLast, listFrom, nextCheck, parseNote, withLog, withNote, withoutFront,
} from './know'
import type { Backoff, KnowLogEntry } from './know'
import { CAP_CHARS, buildRecord } from './know-record'
import type { RecordInput } from './know-record'
import { paneOf } from './panes'
import { side } from './side-ask'

const MODEL = 'haiku'
const MAX_TOKENS = 700
const TIMEOUT_MS = 60_000
/** How many of the person's latest prompts ride along. */
const PROMPTS_KEPT = 2
const KEYS = { shown: 'know:shown', knew: 'know:knew', backoff: 'know:backoff', log: 'know:log' } as const

/** What the check may do, each one a `$` call made in register.tsx. */
export type KnowIo = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<unknown>
  panes: () => Promise<ReadonlyArray<{ id: string; isShown: boolean; isPlaced: boolean }>>
  /** One agent's rows, or why the session will not say. */
  messages: (agentId: string) => Promise<readonly SessionMessage[] | { deny: string }>
  complete: (ask: { model: string; system: string; prompt: string; maxTokens: number; timeoutMs: number }) => Promise<ModelCompleteResult>
  card: () => Promise<KnowState>
  setCard: (fn: (s: KnowState) => KnowState) => Promise<unknown>
}

/** What a hand-back carries that the check reads. */
export type Handback = {
  agentId: string
  reason: RecordInput['ended']
  answer: string
  durationMs?: number
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}

export type KnowActions = { knowMore: () => unknown; knowGotIt: () => unknown; knowKnew: () => unknown; knowDismiss: () => unknown }

/** Someone can see the panel: a session with a surface. */
let isDrawn = false
/** Goes up on /clear, resume and session end: a reply asked for before then is dropped. */
let epoch = 0
let prompts: readonly string[] = []
let lists: { shown: readonly string[]; knew: readonly string[]; backoff: Backoff; log: readonly KnowLogEntry[] } | undefined
/** Each specialist's brief as it was sent, and how many of its rows were already checked. */
const briefs = new Map<string, string>()
const checkedRows = new Map<string, number>()
let notes = 0

/** The brief a specialist was hired with, for a resumed run, whose rows open with the message that started it. */
export function keepBrief(id: string, brief: string) {
  briefs.set(id, brief)
}

/** A save that fails keeps the value in memory, silently: the lists only steer later checks. */
async function save(io: KnowIo, key: string, value: unknown) {
  try {
    await io.set(key, value)
  } catch { /* kept in memory for this session */ }
}

async function loadLists(io: KnowIo) {
  if (lists) return lists
  const got = async (key: string) => { try { return await io.get(key) } catch { return undefined } }
  const [shown, knew, backoff, log] = [await got(KEYS.shown), await got(KEYS.knew), await got(KEYS.backoff), await got(KEYS.log)]
  lists ??= { shown: listFrom(shown, SHOWN_KEEP), knew: listFrom(knew, KNEW_KEEP), backoff: backoffFrom(backoff), log: Array.isArray(log) ? log : [] }
  return lists
}

async function setBackoff(io: KnowIo, backoff: Backoff) {
  lists = { ...(await loadLists(io)), backoff }
  await save(io, KEYS.backoff, backoff)
}

async function addLog(io: KnowIo, entry: KnowLogEntry) {
  const log = withLog((await loadLists(io)).log, entry)
  lists = { ...(await loadLists(io)), log }
  await save(io, KEYS.log, log)
}

/** The Office tab is the one the panel shows. A listing that fails counts as hidden: no check is paid for unseen. */
async function isOfficeShown(io: KnowIo): Promise<boolean> {
  try {
    return (await io.panes()).some(p => p.id === paneOf('office').id && p.isShown && p.isPlaced)
  } catch {
    return false
  }
}

/**
 * A specialist handed its work back: unless the back-off says skip, a check joins the line of side questions. Never
 * waited on by the hand-back and never throws.
 */
export async function checkHandback(io: KnowIo, h: Handback, who: string) {
  try {
    if (!isDrawn || !(await isOfficeShown(io))) return
    const turn = nextCheck((await loadLists(io)).backoff)
    const at = await io.now()
    if (turn.isSkipped) {
      await setBackoff(io, turn.backoff)
      return await addLog(io, { at, who, outcome: 'skipped', reason: 'notes were passed over' })
    }
    const asked = epoch
    side.queue(() => runCheck(io, h, who, asked), () => void addLog(io, { at, who, outcome: 'dropped', reason: 'too many checks waiting' }))
  } catch { /* a check is a nicety: it never stops a hand-back */ }
}

/** The rows of this run: for a resumed specialist, those since its last check. None, with why, when the session will not say. */
async function rowsOf(io: KnowIo, id: string): Promise<{ rows?: RecordInput['rows']; isResumed?: boolean; why?: string }> {
  const all = await io.messages(id)
  if (!Array.isArray(all)) return { why: (all as { deny: string }).deny }
  const from = checkedRows.get(id) ?? 0
  checkedRows.set(id, all.length)
  return { rows: all.slice(from), isResumed: from > 0 }
}

async function runCheck(io: KnowIo, h: Handback, who: string, asked: number) {
  const at = await io.now()
  try {
    const { rows, isResumed, why } = await rowsOf(io, h.agentId)
    if (!rows) return await addLog(io, { at, who, outcome: 'refused', reason: why })
    const u = h.usage
    const tokens = u ? { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens } : undefined
    const record = buildRecord({ who, ended: h.reason, rows, brief: briefs.get(h.agentId), isResumed, report: h.answer, prompts, durationMs: h.durationMs, tokens })
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
  return addLog(io, { ...base, outcome: await showNote(io, { ...said, id: `k${(notes += 1)}`, who, at }) })
}

/** The note joins Clawd's card and the shown list; a card already holding three takes no more. */
async function showNote(io: KnowIo, note: KnowNote): Promise<string> {
  if ((await io.card()).notes.length >= CARD_NOTES) return 'dropped'
  await io.setCard(s => withNote(s, note))
  const shown = keepLast((await loadLists(io)).shown, note.line, SHOWN_KEEP)
  lists = { ...(await loadLists(io)), shown }
  await save(io, KEYS.shown, shown)
  return 'shown'
}

// ---- The person's side: the buttons on the card, and prompts that pass a note over ----

/** Any press on the card: the note changes, and the back-off starts over. */
async function pressed(io: KnowIo, fn: (s: KnowState) => KnowState) {
  await io.setCard(fn)
  await setBackoff(io, BACKOFF0)
}

async function knewIt(io: KnowIo) {
  const front = (await io.card()).notes[0]
  if (front) {
    const knew = keepLast((await loadLists(io)).knew, front.line, KNEW_KEEP)
    lists = { ...(await loadLists(io)), knew }
    await save(io, KEYS.knew, knew)
  }
  await pressed(io, withoutFront)
}

export function knowActions(io: KnowIo): KnowActions {
  return {
    knowMore: () => pressed(io, s => (s.notes.length > 0 ? { ...s, isOpen: true } : s)),
    knowGotIt: () => pressed(io, withoutFront),
    knowKnew: () => knewIt(io),
    knowDismiss: () => pressed(io, withoutFront),
  }
}

/**
 * One prompt of the person's (not a command, not one they did not type): kept to ride along with the next checks,
 * and the second since a note appeared passes it over. Never throws.
 */
export async function knowPrompt(io: KnowIo, e: { text: string; isMeta?: true; command?: unknown }) {
  if (e.isMeta || e.command) return
  prompts = [...prompts, e.text].slice(-PROMPTS_KEPT)
  try {
    const before = await io.card()
    const { state, isIgnored } = afterPrompt(before)
    if (state !== before) await io.setCard(() => state)
    if (isIgnored) await setBackoff(io, afterIgnored((await loadLists(io)).backoff))
  } catch { /* the card stays as it was */ }
}

/** A new conversation, or none: nothing waiting is for it. The lists, kept across sessions, stay. */
export async function forgetKnow(io: KnowIo) {
  epoch += 1
  prompts = []
  briefs.clear()
  checkedRows.clear()
  side.clear()
  if ((await io.card()).notes.length > 0) await io.setCard(withoutAll)
}

const withoutAll = (s: KnowState): KnowState => ({ ...s, notes: [], isOpen: false, promptsSince: 0 })

/** A session starts: checks are made only where someone can see the panel. */
export async function startKnow(io: KnowIo, isSeen: boolean) {
  isDrawn = isSeen
  await forgetKnow(io)
}
