// "You should know": right after Clawd answers, a fork of his own conversation (cached, so cheap while warm) may leave one note
// on Clawd's card (hooks/know-fork.ts says when); Learn more forks again to explain it; and at each specialist's hand-back a
// code-only guard looks for risky steps the main chat cannot see (hooks/know-guard.ts). register-know.ts holds the hooks and
// every `$` call (register-state.ts the card's state), and hands them in as `KnowIo`; the rules are in hooks/know.ts.
import type { ModelForkResult, SessionMessage } from 'claude-code'
import type { KnowNote, KnowState } from '../types'
import {
  BACKOFF0, KNEW_KEEP, KNOW_VERSION, SHOWN_KEEP, afterIgnored, afterPrompt, backoffFrom, costOf, isRepeat, keepLast, listFrom, nextCheck,
  parseExplanation, parseNote, safeName, tallyFrom, withExplainNote, withExplaining, withExplanation, withLog, withNote, withOpened, withReacted,
  withReaction, withTallied, withoutNote,
} from './know'
import type { Backoff, KnowLogEntry, KnowTally, Reaction } from './know'
import { isWorthChecking, whyNotNow } from './know-fork'
import { guardNote, leadRisk, risksOf } from './know-guard'
import { EXPLAIN_FILE, OBSERVER_FILE, explainPrompt, explainTemplate, observerPrompt } from './know-prompts'
import type { FollowUp } from './know-prompts'
import { PANES } from './panes'
import { side, whenFree } from './side-ask'
import { inLine } from './state'

/** DECIDED: a fork that has not answered in two minutes is let go, so the one side line is free again. */
const FORK_WAIT_MS = 120_000
/** A fork still not ended this long after it was asked for lets the side line go anyway, as a last resort, and the log says so. */
const STUCK_MS = 600_000
export const EXPLAIN_BUSY = 'Another side request is running. Try again in a moment.'
export const EXPLAIN_FAILED = 'No new explanation came back. Try again, or ask Clawd.'
export const EXPLAIN_COMPACTED = "Clawd's chat was just compacted. Try again after his next reply."
/** The check reads Clawd's conversation: its notes are about the main chat, Clawd's. */
const CLAWD = 'Clawd'
/** Store keys, kept per project folder as the payroll and the artifact list are. */
const KEYS = { shown: 'know:shown', knew: 'know:knew', backoff: 'know:backoff', log: 'know:log', tally: 'know:tally' } as const
type Key = (typeof KEYS)[keyof typeof KEYS]

/** What the check may do, each one a `$` call made in register-know.ts. */
export type KnowIo = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<unknown>
  /** Where the session draws now: the desktop app and phones attach after the session starts. */
  surfaces: () => Promise<readonly string[]>
  panes: () => Promise<ReadonlyArray<{ id: string; isPlaced: boolean }>>
  /** One agent's rows, or why the session will not say. */
  messages: (agentId: string) => Promise<readonly SessionMessage[] | { deny: string }>
  /** One message after the main thread's last request, served from its cache; no effort named, so the cache is kept. */
  fork: (prompt: string) => Promise<ModelForkResult>
  /** A file of the plugin's own, by its path in the plugin folder. */
  readPrompt: (file: string) => Promise<string>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  card: () => Promise<KnowState>
  /** Puts text after what is in the person's prompt box; never sends it. */
  fillPrompt: (text: string) => Promise<unknown>
  setCard: (fn: (s: KnowState) => KnowState) => Promise<unknown>
  /** A note was shown about a specialist's run (`agentId`), or Clawd's conversation (none): the history's `note` record, its tag only. */
  noted?: (agentId: string | undefined, tag: string) => Promise<void>
}

export type KnowActions = {
  knowMore: () => unknown; knowSimpler: () => unknown; knowShorter: () => unknown; knowDetail: () => unknown
  knowDiscuss: () => unknown; knowGotIt: () => unknown; knowDismiss: () => unknown
}

/** The project folder the session runs in: the lists and the log are its own. */
let folder = ''
const keyOf = (key: Key) => `${key}:${folder}`
/** Goes up on /clear, resume and session end: a reply asked for before then is dropped. */
let epoch = 0
type Lists = { shown: readonly string[]; knew: readonly string[]; backoff: Backoff; log: readonly KnowLogEntry[]; tally: KnowTally }
let lists: Lists | undefined
/** The prompt files as read this session. */
const prompts = new Map<string, string>()
/** How many of each specialist's rows the guard has read. */
const checkedRows = new Map<string, number>()
let notes = 0
/** A note was shown since the person's last message: no other until the next one, even if that note is gone. */
let isNoteSent = false
/** Hand-backs since the last check, and the tools Clawd has used himself in the turn under way. */
let handbacks = 0
let tools = 0
/** The main chat was compacted and no turn of Clawd's has begun since. */
let isAfterCompact = false

/** A save that fails keeps the value in memory, silently: the lists only steer later checks. */
async function save(io: KnowIo, key: Key, value: unknown) {
  try {
    await io.set(keyOf(key), value)
  } catch { /* kept in memory for this session */ }
}

async function loadLists(io: KnowIo) {
  if (lists) return lists
  const got = async (key: Key) => { try { return await io.get(keyOf(key)) } catch { return undefined } }
  const [shown, knew, backoff, log, tally] = [await got(KEYS.shown), await got(KEYS.knew), await got(KEYS.backoff), await got(KEYS.log), await got(KEYS.tally)]
  lists ??= { shown: listFrom(shown, SHOWN_KEEP), knew: listFrom(knew, KNEW_KEEP), backoff: backoffFrom(backoff), log: Array.isArray(log) ? log : [], tally: tallyFrom(tally) }
  return lists
}

/**
 * One change to one list, made on the lists as they stand when its turn comes and saved before the next starts, so
 * changes made at the same moment never overwrite each other.
 */
function change<K extends keyof Lists>(io: KnowIo, field: K, fn: (value: Lists[K]) => Lists[K]) {
  return inLine(async () => {
    const before = (await loadLists(io))[field]
    const value = fn(before)
    if (value === before) return
    lists = { ...(await loadLists(io)), [field]: value }
    await save(io, KEYS[field], value)
  })
}

/** A press always writes its reset, even when this session already holds it: another session may have stored more. */
const setBackoff = (io: KnowIo, backoff: Backoff) => change(io, 'backoff', () => ({ ...backoff }))
/** A row of the log, marked with the version of the rules, and counted in the project's tally. */
async function addLog(io: KnowIo, entry: KnowLogEntry) {
  const row = { ...entry, version: KNOW_VERSION }
  await change(io, 'log', log => withLog(log, row))
  await change(io, 'tally', t => withTallied(t, row))
}

/** What the person did with a note: on the note's row in the log, and in the tally. */
async function react(io: KnowIo, noteId: string, reaction: Reaction) {
  await change(io, 'log', log => withReaction(log, noteId, reaction))
  await change(io, 'tally', t => withReacted(t, reaction))
}

/**
 * Why nobody can see the office, or nothing when someone can: something is drawn now (read at each ask, since the
 * desktop app attaches after the session starts) and one of its tabs is open. A reading that fails counts as nothing.
 */
async function whyUnseen(io: KnowIo): Promise<string | undefined> {
  const surfaces = await io.surfaces().catch(() => [])
  if (surfaces.length === 0) return 'nothing is drawn'
  const panes = await io.panes().catch(() => [])
  return panes.some(p => p.isPlaced && PANES.some(one => one.id === p.id)) ? undefined : 'no office tab is open'
}

/** Someone can see the office. Where nobody can, no check is made and Claude Code's own "You should know" is let through. */
export const isWatching = async (io: KnowIo): Promise<boolean> => (await whyUnseen(io)) === undefined

/** Why no note may be left now: one is on the card, or one was already shown for the person's latest message. */
async function whyHeld(io: KnowIo): Promise<string | undefined> {
  if ((await io.card()).note) return 'a note is already showing'
  return isNoteSent ? 'a note was already shown for this message' : undefined
}

/** A prompt file, read once a session; none when it cannot be read or is empty. */
async function promptFile(io: KnowIo, file: string): Promise<string | undefined> {
  if (prompts.has(file)) return prompts.get(file)
  const text = await io.readPrompt(file).catch(() => '')
  if (text.trim() === '') return undefined
  prompts.set(file, text)
  return text
}

type Forked = ModelForkResult | { isAnswered: false; reason: 'timed-out' }
/**
 * The fork's reply, or `timed-out` when it has not answered in time (its timer is cancelled when it answers first); and when
 * the fork has really ended. The fork takes no abort signal, so a fork that timed out still runs and is paid for: whoever
 * holds the side line waits for `settled` before letting go, so no second fork starts on top of it. A fork still not ended
 * after ten minutes settles as `stuck`, so the line is never held for good.
 */
function forkFor(io: KnowIo, prompt: string): { reply: Promise<Forked>; settled: Promise<'ended' | 'stuck'> } {
  const asked = io.fork(prompt)
  let timer: { cancel: () => void } | undefined
  let stuckTimer: { cancel: () => void } | undefined
  const late = new Promise<Forked>(resolve => { timer = io.after(FORK_WAIT_MS, () => resolve({ isAnswered: false, reason: 'timed-out' })) })
  const stuck = new Promise<'stuck'>(resolve => { stuckTimer = io.after(STUCK_MS, () => resolve('stuck')) })
  const reply = Promise.race([asked, late]).finally(() => timer?.cancel())
  const ended = asked.then(() => 'ended' as const, () => 'ended' as const).finally(() => stuckTimer?.cancel())
  return { reply, settled: Promise.race([ended, stuck]) }
}

/** Lets the side line go once the fork has ended; a fork that never did is let go after ten minutes, and logged. */
async function untilEnded(io: KnowIo, settled: Promise<'ended' | 'stuck'> | undefined, row: Omit<KnowLogEntry, 'outcome'>) {
  if (settled && (await settled) === 'stuck') await addLog(io, { ...row, outcome: 'released', reason: 'the fork had not ended after 10 minutes' })
}
const usageOf = (r: Forked) => ('usage' in r ? r.usage : undefined)

/** The note takes Clawd's card and joins the shown list, unless one is held (checked once more, as the reply was paid for). */
async function showNote(io: KnowIo, note: KnowNote, agentId?: string): Promise<{ outcome: string; reason?: string; noteId?: string }> {
  const held = await whyHeld(io)
  if (held) return { outcome: 'skipped', reason: held }
  isNoteSent = true
  await io.setCard(s => withNote(s, note))
  await io.noted?.(agentId, note.tag).catch(() => undefined)
  await change(io, 'shown', shown => keepLast(shown, note.line, SHOWN_KEEP))
  return { outcome: 'shown', noteId: note.id }
}

// ---- The check: Clawd's conversation, forked right after he answered ----

/**
 * Clawd's own turn ended. Worth a check when a hand-back came since the last one or he used six tools or more; then every gate
 * (the switches, an answer, no fresh compaction, an office tab, the card, the side line, the back-off) must let it through.
 * Never waited on and never throws.
 */
export async function checkTurnEnd(io: KnowIo, e: { reason: string; answer?: string }, isClawdOn: boolean) {
  const work = { handbacks, tools }
  tools = 0
  if (!isWorthChecking(work)) return
  const at = await io.now().catch(() => 0)
  const skip = (reason: string) => addLog(io, { at, who: CLAWD, stage: 'check', outcome: 'skipped', reason })
  const used = () => { handbacks = Math.max(0, handbacks - work.handbacks) }
  try {
    const stop = whyNotNow({ isAnswer: e.reason === 'answer', isClawdOn, isAfterCompact, unseen: await whyUnseen(io), held: await whyHeld(io), isBusy: side.isBusy() })
    if (stop) {
      if (!stop.isTransient) used()
      return await skip(stop.reason)
    }
    used()
    let isSkipped = false
    await change(io, 'backoff', b => {
      const next = nextCheck(b)
      isSkipped = next.isSkipped
      return next.backoff
    })
    if (isSkipped) return await skip('notes were passed over')
    const asked = epoch
    if (!whenFree(side, () => runCheck(io, e.answer ?? '', at, asked))) {
      handbacks += work.handbacks
      await skip('another side request is running')
    }
  } catch {
    await addLog(io, { at, who: CLAWD, stage: 'check', outcome: 'failed', reason: 'the check stopped on an error before it started' }).catch(() => undefined)
  }
}

async function runCheck(io: KnowIo, answer: string, at: number, asked: number) {
  const row = { at, who: CLAWD, stage: 'check' as const }
  let settled: Promise<'ended' | 'stuck'> | undefined
  try {
    const template = await promptFile(io, OBSERVER_FILE)
    if (template === undefined) return await addLog(io, { ...row, outcome: 'failed', reason: 'the prompt file could not be read' })
    const { shown, knew } = await loadLists(io)
    const started = await io.now()
    const forked = forkFor(io, observerPrompt(template, shown, knew, answer))
    settled = forked.settled
    const reply = await forked.reply
    const base = { ...row, ...costOf('fork', usageOf(reply), (await io.now()) - started) }
    // The conversation it was asked for is over: what it says is not this one's.
    if (asked !== epoch) return await addLog(io, { ...base, outcome: 'stale' })
    if (!reply.isAnswered) return await addLog(io, { ...base, outcome: reply.reason })
    const parsed = parseNote(reply.text)
    if (parsed.kind !== 'note') return await addLog(io, { ...base, outcome: parsed.kind, ...(parsed.kind === 'failed' ? { reason: parsed.why } : {}) })
    const now = await loadLists(io)
    if (isRepeat(parsed.line, now.shown, now.knew)) return await addLog(io, { ...base, outcome: 'repeat' })
    const { kind: _, ...said } = parsed
    // The id holds the time too, so it stays its own across sessions, which count notes from one again.
    await addLog(io, { ...base, ...(await showNote(io, { ...said, id: `k${at}-${(notes += 1)}`, who: CLAWD, at })) })
  } catch {
    await addLog(io, { ...row, outcome: 'failed', reason: 'the check stopped on an error' })
  } finally {
    // The side line is let go only once the fork has really ended, even after a time-out (or, as a last resort, after ten minutes).
    await untilEnded(io, settled, row)
  }
}

// ---- The risky-action guard: each specialist's own steps, at its hand-back ----

/**
 * A specialist handed its work back: it counts towards the next check, and its steps since the last hand-back are read by code
 * for a risky action. Only a find is logged; it keeps the card's rules (an office tab open, one note at a time, one per message)
 * but not the back-off. Never waited on and never throws.
 */
export async function knowHandback(io: KnowIo, agentId: string, label: string) {
  handbacks += 1
  // The label is shown on the card and copied by Discuss: one that looks like a key, an address or a command is not.
  const who = safeName(label)
  const at = await io.now().catch(() => 0)
  try {
    const all = await io.messages(agentId)
    if (!Array.isArray(all)) return
    const rows = all as readonly SessionMessage[]
    const from = checkedRows.get(agentId) ?? 0
    checkedRows.set(agentId, rows.length)
    const risks = risksOf(rows.slice(from))
    const note = guardNote(who, risks)
    if (!note) return
    const base = { at, who, stage: 'guard' as const, ...costOf('code', undefined, (await io.now()) - at), reason: leadRisk(risks)!.kind }
    const unseen = await whyUnseen(io)
    if (unseen) return await addLog(io, { ...base, outcome: 'skipped', reason: unseen })
    await addLog(io, { ...base, ...(await showNote(io, { ...note, id: `k${at}-${(notes += 1)}`, who, at }, agentId)) })
  } catch {
    await addLog(io, { at, who, stage: 'guard', outcome: 'failed', reason: 'the guard stopped on an error' }).catch(() => undefined)
  }
}

// ---- Learn more: the note explained, and again simpler, shorter or in more detail ----

const REACTION: Record<FollowUp, Reaction> = { simpler: 'simpler', shorter: 'shorter', 'more detail': 'more-detail' }

/** The explanation the person last read, as the follow-up text quotes it. */
const previousOf = (note: KnowNote) => (note.explain === undefined ? undefined : note.title ? `**${note.title}**\n${note.explain}` : note.explain)

/**
 * Asks for an explanation of the note on the card, if the side line is free and no compaction came since Clawd's last turn
 * began (the cache would hold the conversation from before it); otherwise says why on the card.
 */
async function explain(io: KnowIo, kind: 'first' | FollowUp) {
  const { note } = await io.card()
  if (!note) return
  if (isAfterCompact) return await io.setCard(s => withExplainNote(s, note.id, EXPLAIN_COMPACTED))
  if (!whenFree(side, () => writeExplanation(io, note, kind, epoch))) await io.setCard(s => withExplainNote(s, note.id, EXPLAIN_BUSY))
}

async function writeExplanation(io: KnowIo, note: KnowNote, kind: 'first' | FollowUp, asked: number) {
  await io.setCard(s => withExplaining(s, note.id, kind))
  const at = await io.now()
  const row = { at, who: note.who, stage: 'explain' as const, reason: kind }
  const failed = async (entry: KnowLogEntry) => {
    await io.setCard(s => withExplainNote(s, note.id, EXPLAIN_FAILED))
    await addLog(io, entry)
  }
  let settled: Promise<'ended' | 'stuck'> | undefined
  try {
    const text = await promptFile(io, EXPLAIN_FILE)
    const template = text === undefined ? undefined : explainTemplate(text)
    if (!template) return await failed({ ...row, outcome: 'failed', reason: 'the prompt file could not be read' })
    const previous = previousOf(note)
    const prompt = explainPrompt(template, note.line, kind === 'first' || previous === undefined ? undefined : { kind, previous })
    const forked = forkFor(io, prompt)
    settled = forked.settled
    const reply = await forked.reply
    const base = { ...row, ...costOf('fork', usageOf(reply), (await io.now()) - at) }
    if (asked !== epoch) return await addLog(io, { ...base, outcome: 'stale' })
    if (!reply.isAnswered) return await failed({ ...base, outcome: reply.reason })
    const parsed = parseExplanation(reply.text)
    if (parsed.kind === 'failed') return await failed({ ...base, outcome: 'failed', reason: `${kind}: ${parsed.why}` })
    await io.setCard(s => withExplanation(s, note.id, parsed))
    await addLog(io, { ...base, outcome: 'explained' })
  } catch {
    await failed({ ...row, outcome: 'failed', reason: `${kind}: the explanation stopped on an error` })
  } finally {
    await untilEnded(io, settled, row)
  }
}

// ---- The person's side: the buttons on the card, and prompts that pass a note over ----

/** Any press on the card: the note changes, the back-off starts over, and the reaction is logged against the note it was about. */
async function pressed(io: KnowIo, reaction: Reaction, fn: (s: KnowState) => KnowState) {
  const { note } = await io.card()
  await io.setCard(fn)
  await setBackoff(io, BACKOFF0)
  if (note) await react(io, note.id, reaction)
}

/** Learn more: the reply's own explanation shows at once; a note that came without one asks the fork for it. */
async function learnMore(io: KnowIo) {
  const { note } = await io.card()
  await pressed(io, 'opened', withOpened)
  if (note && note.explain === undefined) await explain(io, 'first')
}

async function followUp(io: KnowIo, kind: FollowUp) {
  await pressed(io, REACTION[kind], s => s)
  await explain(io, kind)
}

/** Knew this: the note's line joins the knew list, which rides in later questions, then the note goes like Dismiss. */
async function knewThis(io: KnowIo) {
  const { note } = await io.card()
  if (note) await change(io, 'knew', knew => keepLast(knew, note.line, KNEW_KEEP))
  await pressed(io, 'knew-this', withoutNote)
}

/** The person's own opener about the note: its line, its longer version when there is one, and the question to talk over. */
export const discussText = (note: Pick<KnowNote, 'line' | 'explain'>) =>
  [`Clawd raised this: "${note.line}".`, note.explain, "Let's discuss: is this a real concern here, and what should we do about it?"]
    .filter(part => part !== undefined && part !== '').join(' ')

/** Fills the prompt box for the person to send (never sends), then takes the note off like Dismiss. */
async function discuss(io: KnowIo) {
  const { note } = await io.card()
  if (note) await io.fillPrompt(discussText(note))
  await pressed(io, 'discussed', withoutNote)
}

export function knowActions(io: KnowIo): KnowActions {
  return {
    knowMore: () => learnMore(io),
    knowSimpler: () => followUp(io, 'simpler'),
    knowShorter: () => followUp(io, 'shorter'),
    knowDetail: () => followUp(io, 'more detail'),
    knowDiscuss: () => discuss(io),
    // The action keeps its old name: the card's button says Knew this.
    knowGotIt: () => knewThis(io),
    knowDismiss: () => pressed(io, 'dismissed', withoutNote),
  }
}

/** One prompt of the person's (not a command, not one they did not type): it allows a note again, and the second since a note appeared passes it over. Never throws. */
export async function knowPrompt(io: KnowIo, e: { text: string; isMeta?: true; command?: unknown }) {
  if (e.isMeta || e.command) return
  isNoteSent = false
  try {
    const before = await io.card()
    const { state, isIgnored } = afterPrompt(before)
    if (state !== before) await io.setCard(() => state)
    if (isIgnored) {
      await change(io, 'backoff', afterIgnored)
      if (before.note) await react(io, before.note.id, 'passed-over')
    }
  } catch { /* the card stays as it was */ }
}

/** A new conversation, or none: nothing waiting is for it. The lists, kept across sessions, stay. */
export async function forgetKnow(io: KnowIo) {
  epoch += 1
  isNoteSent = false
  handbacks = 0
  tools = 0
  isAfterCompact = false
  checkedRows.clear()
  side.clear()
  if ((await io.card()).note) await io.setCard(withoutNote)
}

/** A session starts: the project's own lists, and the prompt files, are read afresh. */
export async function startKnow(io: KnowIo, projectFolder: string) {
  folder = projectFolder
  lists = undefined
  prompts.clear()
  await forgetKnow(io)
}

// ---- Clawd's own turns: his tools counted as they go; a compaction holds the next check ----

/** A turn of Clawd's own starts: his tools are counted afresh, and a main reply now runs after any compaction. */
export function knowTurnStart() {
  tools = 0
  isAfterCompact = false
}

/** Clawd used a tool in his own turn. */
export function knowToolUsed() {
  tools += 1
}

/** The main chat was compacted: until a turn of Clawd's begins, the cache holds the conversation from before, so no fork. */
export function knowCompacted() {
  isAfterCompact = true
}
