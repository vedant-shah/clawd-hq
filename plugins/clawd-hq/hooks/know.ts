// "You should know", pure: how a reply is read, the notes, lists and back-off it keeps, and what each check cost.
// hooks/know-check.ts makes the checks and keeps the state; hooks/know-prompts.ts fills the prompts; hooks/know-guard.ts is the
// risky-action guard on specialists' steps.
import type { KnowNote, KnowState, KnowTag } from '../types'
import { HIDDEN_MARKS } from './plain'

export const KNOW_TAGS: readonly KnowTag[] = ['You should know', 'Heads up']
/** A note longer than this is refused whole; it is never cut. */
export const LINE_CHARS = 240
/** About 100 words asked; an explanation past this is dropped whole, and Learn more is hidden. */
export const EXPLAIN_CHARS = 1200
/** Learn more's own explanation: up to 160 words (More detail) and a small sketch; past this it is not shown. */
export const EXPLAIN_FORK_CHARS = 1600
const TITLE_CHARS = 80
/** A turn of Clawd's own with this many tool uses or more is checked. */
export const OWN_TURN_TOOLS = 6
export const SHOWN_KEEP = 10
/** The topics the person pressed Knew this on that ride in the question: the newest ten. */
export const KNEW_KEEP = 10
export const LOG_KEEP = 20
/** The person's second prompt after a note appeared takes it off the card. */
const CLEAR_AFTER_PROMPTS = 2
/** The fourth prompt after the person opened a note (Learn more) takes it off. */
const CLEAR_OPENED_AFTER_PROMPTS = 4

export type Parsed =
  | { kind: 'none' }
  | { kind: 'failed'; why: string }
  | { kind: 'note'; line: string; tag: KnowTag; title?: string; explain?: string }

/** Model text made safe to draw: control characters and hidden marks go, a tab becomes a space. */
export function plainText(text: string): string {
  return text.replace(/\t/g, ' ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').replace(HIDDEN_MARKS, '')
}

/** A key or token by its shape: common prefixes, or a long run of letters and digits in both cases. */
export function looksSecret(text: string): boolean {
  if (/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/.test(text)) return true
  if (/\b[0-9a-f]{32,}\b/i.test(text)) return true
  return (text.match(/[A-Za-z0-9_+=-]{32,}/g) ?? []).some(run => /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run))
}

/**
 * Text that could send the person somewhere or run something: a web address, a pipe into a shell, or backtick-quoted
 * code. The model's text is untrusted, so text that carries any of these is refused whole. (A note's own backticks, and an
 * explanation's, are taken out before this reads them, see `parseNote` and `parseExplanation`; other readers keep refusing them.)
 */
export function looksUnsafe(text: string): boolean {
  // `file:` only before a slash and `javascript:` only with no space after it: "the config file: it reads" and "JavaScript: the
  // language" are prose; `file:///etc` and `javascript:alert(1)` are addresses.
  return /https?:\/\/|\bwww\.|\b(ftp|mailto):|\bjavascript:(?!\s|$)|\bfile:\//i.test(text) ||
    /\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s/]/i.test(text) ||
    /\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i.test(text) ||
    text.includes('`')
}

const NAME_CHARS = 40

/** A name to show on the card (a specialist's label): plain, short, and with no key, address or command in it; else `fallback`. */
export function safeName(name: string, fallback = 'specialist'): string {
  const plain = plainText(name).replace(/\s+/g, ' ').trim()
  return plain === '' || plain.length > NAME_CHARS || looksSecret(plain) || looksUnsafe(plain) ? fallback : plain
}

/** Backticks are dropped from the note, not a reason to refuse it: Discuss copies the line into the prompt box. */
const withoutTicks = (text: string) => text.replace(/`/g, '')

const LABEL = /^\s*(learn|tag|explain)\s*:/i
const unquote = (text: string) => text.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
const unbold = (text: string) => text.replace(/\*\*|__/g, '')

/** The learn line, with the lines that run on from it up to a blank line or the next label. */
function learnOf(lines: string[]): string | undefined {
  const at = lines.findIndex(l => /^\s*learn\s*:/i.test(l))
  if (at < 0) return undefined
  const rest = lines.slice(at + 1)
  const end = rest.findIndex(l => l.trim() === '' || LABEL.test(l))
  const more = end < 0 ? rest : rest.slice(0, end)
  return squash(unquote(squash([lines[at]!.replace(/^\s*learn\s*:/i, ''), ...more].join(' '))))
}

function tagOf(lines: string[]): KnowTag {
  const said = lines.find(l => /^\s*tag\s*:/i.test(l))?.replace(/^\s*tag\s*:/i, '') ?? ''
  const plain = squash(unquote(unbold(said))).toLowerCase()
  return KNOW_TAGS.find(t => t.toLowerCase() === plain) ?? 'You should know'
}

/** The lines of the explanation, as written; none when there is no explain label. */
function explainLines(lines: string[]): string[] {
  const at = lines.findIndex(l => /^\s*explain\s*:/i.test(l))
  return at < 0 ? [] : [lines[at]!.replace(/^\s*explain\s*:/i, ''), ...lines.slice(at + 1)]
}

const explainBlock = (lines: string[]) => explainLines(lines).join('\n')

/** The bold title and the explanation under it, plain; nothing when there is none, it runs far too long, or the title does. */
function explainOf(lines: string[]): { title?: string; explain?: string } {
  const kept = explainLines(lines).filter(l => !looksSecret(l)).join('\n').trim()
  if (kept === '') return {}
  const bold = /^\*\*(.+?)\*\*/.exec(kept)
  const title = bold ? squash(bold[1]!) : undefined
  const explain = squash(unbold(bold ? kept.slice(bold[0].length) : kept))
  if (explain === '' || explain.length > EXPLAIN_CHARS || (title !== undefined && title.length > TITLE_CHARS)) return {}
  return title ? { title, explain } : { explain }
}

/**
 * An empty learn line, "none" as the whole line (any case, with punctuation), or "none" directly followed by a mark
 * (. , ; : ! — -) and then anything: "None. Nothing worth flagging." is silence. "None of the tests ran" and "none were
 * run" have a word right after "none", so they are real notes.
 */
const isSilence = (learn: string) => learn === '' || /^[\s\p{P}]*none(?:[\s\p{P}]*$|[.,;:!—-])/iu.test(learn)

/** Why a reply could not be read at all; every other failed reply was read, and its note refused. */
export const NO_LEARN = 'no learn line'

/** Reads the checker's reply: nothing to say, a reply that cannot be used, or a note. */
export function parseNote(reply: string): Parsed {
  const text = withoutTicks(plainText(reply))
  if (/^\s*none\.?\s*$/i.test(text)) return { kind: 'none' }
  const lines = text.split(/\r?\n/)
  const learn = learnOf(lines)
  if (learn === undefined) return { kind: 'failed', why: NO_LEARN }
  if (isSilence(learn)) return { kind: 'none' }
  if (learn.length > LINE_CHARS) return { kind: 'failed', why: `the line was over ${LINE_CHARS} characters` }
  if (looksSecret(learn)) return { kind: 'failed', why: 'the line looked like a key or token' }
  if (looksUnsafe(learn) || looksUnsafe(explainBlock(lines))) return { kind: 'failed', why: 'the note held a web address, a command or quoted code' }
  const line = unbold(/[.!?]$/.test(learn) ? learn : `${learn}.`)
  return { kind: 'note', line, tag: tagOf(lines), ...explainOf(lines) }
}

export type Explained = { kind: 'explained'; title?: string; explain: string } | { kind: 'failed'; why: string }

/**
 * Learn more's reply: a bold title on the first line and the explanation under it, its lines kept (it may hold a before and
 * after, or a small sketch). Code names in backticks are kept as plain words; a web address or a pipe into a shell refuses the
 * whole reply, and a line that looks like a key is left out.
 */
export function parseExplanation(reply: string): Explained {
  const text = withoutTicks(plainText(reply))
  if (looksUnsafe(text)) return { kind: 'failed', why: 'the explanation held a web address or a command' }
  const kept = text.split(/\r?\n/).map(l => l.trimEnd()).filter(l => !looksSecret(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const bold = /^\*\*(.+?)\*\*[ ]*(?:\n|$)/.exec(kept)
  const title = bold ? squash(bold[1]!) : undefined
  const explain = (bold ? kept.slice(bold[0].length) : kept).replace(/\*\*/g, '').trim()
  if (explain === '') return { kind: 'failed', why: 'the explanation was empty' }
  if (explain.length > EXPLAIN_FORK_CHARS || (title !== undefined && title.length > TITLE_CHARS)) return { kind: 'failed', why: 'the explanation was too long' }
  return title ? { kind: 'explained', title, explain } : { kind: 'explained', explain }
}

const normal = (text: string) => squash(text).toLowerCase().replace(/\.$/, '')

export const isRepeat = (line: string, shown: readonly string[], knew: readonly string[]) =>
  [...shown, ...knew].some(x => normal(x) === normal(line))

/** The list with `item` last, once, and only its newest `max` entries. */
export function keepLast(list: readonly string[], item: string, max: number): string[] {
  return [...list.filter(x => normal(x) !== normal(item)), item].slice(-max)
}

/** A list read back from the store: its strings, newest `max`; anything else reads empty. */
export function listFrom(saved: unknown, max: number): string[] {
  return Array.isArray(saved) ? saved.filter((x): x is string => typeof x === 'string').slice(-max) : []
}

// ---- Backing off when notes are passed over ----

/** Notes passed over in a row, and how many checks are still to be skipped. */
export type Backoff = { ignored: number; skipLeft: number }
export const BACKOFF0: Backoff = { ignored: 0, skipLeft: 0 }
const MAX_SKIPS = 16

/** Checks skipped after `ignored` notes in a row were passed over: none for the first two, then 1, 2, 4 and so on up to 16. */
export const skipsAfter = (ignored: number) => (ignored < 2 ? 0 : Math.min(MAX_SKIPS, 2 ** (ignored - 2)))

export const afterIgnored = (b: Backoff): Backoff => ({ ignored: b.ignored + 1, skipLeft: skipsAfter(b.ignored + 1) })

/** Whether this check is skipped, and the back-off after it. */
export function nextCheck(b: Backoff): { isSkipped: boolean; backoff: Backoff } {
  return b.skipLeft > 0 ? { isSkipped: true, backoff: { ...b, skipLeft: b.skipLeft - 1 } } : { isSkipped: false, backoff: b }
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0

export function backoffFrom(saved: unknown): Backoff {
  const b = (saved ?? {}) as Partial<Backoff>
  return isCount(b.ignored) && isCount(b.skipLeft) ? { ignored: b.ignored, skipLeft: b.skipLeft } : BACKOFF0
}

// ---- The note on the card ----

export const KNOW0: KnowState = { isOpen: false, promptsSince: 0 }

/** The note takes an empty card, closed and with its own count of prompts; a card already holding one takes no more. */
export function withNote(s: KnowState, note: KnowNote): KnowState {
  return s.note ? s : { note, isOpen: false, promptsSince: 0 }
}

/** The note goes and the card is empty again. */
export function withoutNote(s: KnowState): KnowState {
  return s.note ? KNOW0 : s
}

/** The note is opened (Learn more): its count of prompts starts over, so it is read for four more. Opening again changes nothing. */
export function withOpened(s: KnowState): KnowState {
  return !s.note || s.isOpen ? s : { ...s, isOpen: true, promptsSince: 0 }
}

/** The card with neither an explanation being written nor a line about the last one. */
const settled = (s: KnowState): KnowState => {
  const { explaining: _, explainNote: __, ...rest } = s
  return rest
}

/** Learn more is writing an explanation of the note `id` (the first, or a follow-up); the note is open meanwhile. */
export function withExplaining(s: KnowState, id: string, kind: NonNullable<KnowState['explaining']>): KnowState {
  return s.note?.id === id ? { ...settled(s), isOpen: true, explaining: kind } : s
}

/** The new explanation takes the place of the last one, on the note it was written for only. */
export function withExplanation(s: KnowState, id: string, said: { title?: string; explain: string }): KnowState {
  return s.note?.id === id ? { ...settled(s), note: { ...s.note, title: said.title, explain: said.explain } } : s
}

/** No new explanation came for the note `id`: the last one stays, with a short line saying why. */
export function withExplainNote(s: KnowState, id: string, text: string): KnowState {
  return s.note?.id === id ? { ...settled(s), explainNote: text } : s
}

/**
 * One prompt of the person's: the second since the note appeared takes it off, passed over. An opened note goes on the
 * fourth since it was opened, and that is not passing it over, since it was read.
 */
export function afterPrompt(s: KnowState): { state: KnowState; isIgnored: boolean } {
  if (!s.note) return { state: s, isIgnored: false }
  const seen = s.promptsSince + 1
  if (seen < (s.isOpen ? CLEAR_OPENED_AFTER_PROMPTS : CLEAR_AFTER_PROMPTS)) return { state: { ...s, promptsSince: seen }, isIgnored: false }
  return { state: withoutNote(s), isIgnored: !s.isOpen }
}

// ---- The trial log: what the checks cost, kept to measure it ----

/** Which rules wrote a row: goes up when the question or the way its reply is read changes, so rows can be told apart. */
export const KNOW_VERSION = 3

/** What the person did with a shown note. A note opened and then dismissed has both. */
export type Reaction = 'opened' | 'simpler' | 'shorter' | 'more-detail' | 'discussed' | 'knew-this' | 'dismissed' | 'passed-over'

/** What made the check: a fork of the main conversation, or code alone (the risky-action guard). */
export type KnowEngine = 'fork' | 'code'
const ENGINES: readonly KnowEngine[] = ['fork', 'code']

/** What one check cost: its engine, the API's four token counts, the time, and the share of input the cache served. */
export type KnowCost = {
  engine?: KnowEngine
  /** Input tokens not read from the cache nor written to it: on a fork, the prompt itself and what the cache had lost. */
  inTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outTokens?: number
  ms?: number
  /** Cache reads over all input, to two places: near 1, the fork reused the cached chat; near 0, it paid for all of it. */
  cacheShare?: number
}

export type KnowLogEntry = KnowCost & {
  at: number
  who: string
  /** `shown`, `none`, `repeat`, `failed`, `api-error`, `empty-reply`, `aborted`, `nothing-to-fork`, `timed-out`, `stale`, `skipped`, `explained`. */
  outcome: string
  /** `check` (the fork after Clawd answered), `explain` (Learn more and its follow-ups), `guard` (the risky-action guard). */
  stage?: 'check' | 'explain' | 'guard'
  reason?: string
  /** The shown note's id (`KnowNote.id`): the rows of notes only. */
  noteId?: string
  version?: number
  /** What the person did with the note, in order. */
  reactions?: Reaction[]
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** The cost fields of a log row; no token counts when no request was made. */
export function costOf(engine: KnowEngine, usage: Usage | undefined, ms: number): KnowCost {
  if (!usage) return { engine, ms }
  const [input, read, write] = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens]
  const total = input + read + write
  const share = total > 0 ? { cacheShare: Math.round((read / total) * 100) / 100 } : {}
  return { engine, inTokens: input, cacheReadTokens: read, cacheWriteTokens: write, outTokens: usage.output_tokens, ms, ...share }
}

export const withLog = (log: readonly KnowLogEntry[], entry: KnowLogEntry): KnowLogEntry[] => [...log, entry].slice(-LOG_KEEP)

/** The row of the note with its reaction added; the same log when the note's row has left it. */
export function withReaction(log: readonly KnowLogEntry[], noteId: string, reaction: Reaction): readonly KnowLogEntry[] {
  if (!log.some(row => row.noteId === noteId)) return log
  return log.map(row => (row.noteId === noteId ? { ...row, reactions: [...(row.reactions ?? []), reaction] } : row))
}

/** One engine's checks summed: how many, their tokens and their time. */
export type CostSums = { checks: number; inTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outTokens: number; ms: number }
const SUMS0: CostSums = { checks: 0, inTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outTokens: 0, ms: 0 }

/** Counts that outlast the log's 20 rows: how often each outcome, reason and reaction came up in a project, and what each engine cost. */
export type KnowTally = {
  outcomes: Record<string, number>; reasons: Record<string, number>; reactions: Record<string, number>
  costs: Partial<Record<KnowEngine, CostSums>>
}
export const TALLY0: KnowTally = { outcomes: {}, reasons: {}, reactions: {}, costs: {} }

/** Each count holds at most this many keys, so a reason that varies (an agent id, say) cannot grow the tally without end. */
export const TALLY_KEYS = 64
const OTHER = 'other'

/** One more for `key`; a new key past the limit is counted under "other", which takes the last place. */
function bumped(counts: Record<string, number>, key: string): Record<string, number> {
  const has = (k: string) => Object.hasOwn(counts, k)
  const at = has(key) || Object.keys(counts).length < TALLY_KEYS - 1 ? key : OTHER
  return { ...counts, [at]: (has(at) ? counts[at]! : 0) + 1 }
}

function withCost(costs: KnowTally['costs'], entry: KnowLogEntry): KnowTally['costs'] {
  if (entry.engine === undefined) return costs
  const s = costs[entry.engine] ?? SUMS0
  return {
    ...costs,
    [entry.engine]: {
      checks: s.checks + 1, inTokens: s.inTokens + (entry.inTokens ?? 0), cacheReadTokens: s.cacheReadTokens + (entry.cacheReadTokens ?? 0),
      cacheWriteTokens: s.cacheWriteTokens + (entry.cacheWriteTokens ?? 0), outTokens: s.outTokens + (entry.outTokens ?? 0), ms: s.ms + (entry.ms ?? 0),
    },
  }
}

export const withTallied = (t: KnowTally, entry: KnowLogEntry): KnowTally => ({
  ...t,
  outcomes: bumped(t.outcomes, entry.outcome),
  reasons: entry.reason === undefined ? t.reasons : bumped(t.reasons, entry.reason),
  costs: withCost(t.costs, entry),
})

export const withReacted = (t: KnowTally, reaction: Reaction): KnowTally => ({ ...t, reactions: bumped(t.reactions, reaction) })

const countsFrom = (saved: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(saved && typeof saved === 'object' ? saved : {}).filter(([, n]) => isCount(n)).slice(0, TALLY_KEYS))

/** One engine's sums read back: each a whole count, else 0. */
function sumsFrom(saved: unknown): CostSums {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof CostSums, unknown>>
  const n = (v: unknown) => (isCount(v) ? v : 0)
  return { checks: n(s.checks), inTokens: n(s.inTokens), cacheReadTokens: n(s.cacheReadTokens), cacheWriteTokens: n(s.cacheWriteTokens), outTokens: n(s.outTokens), ms: n(s.ms) }
}

function costsFrom(saved: unknown): KnowTally['costs'] {
  const c = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>
  return Object.fromEntries(ENGINES.filter(e => Object.hasOwn(c, e)).map(e => [e, sumsFrom(c[e])]))
}

/** A tally read back from the store: whole counts only; anything else reads empty. */
export function tallyFrom(saved: unknown): KnowTally {
  const t = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof KnowTally, unknown>>
  return { outcomes: countsFrom(t.outcomes), reasons: countsFrom(t.reasons), reactions: countsFrom(t.reactions), costs: costsFrom(t.costs) }
}

// ---- Keeping Claude Code's own "You should know" quiet while ours is on ----

/** Claude Code's own side agent for notes, as the host names who asked: built in, under its own name. */
export const isBuiltinKnow = (origin: { plugin: string; tier: string }) =>
  origin.tier === 'builtin' && /^cc-plugin-you-should-know(@|$)/.test(origin.plugin)

/** Its side question's answer: nothing to ask about yet, which it already handles by showing nothing. */
export const QUIET_FORK = { isAnswered: false, reason: 'nothing-to-fork' } as const
