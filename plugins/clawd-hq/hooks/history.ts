// The history's records (pure): one JSON object per line, an audit of the project's work that cannot be filled in later, so every field is
// kept from the first release. Each session writes its own file, `.clawd-hq/history-<session>.jsonl` (history-io.ts), so two sessions never
// write one file; readers read them all. The register-*.ts files say when records are made.
//
// Kinds: goal_start, run (one per specialist run, when it ends), goal_end, tool (one per tool call: who, which tool, when, whether it went
// well), request (one per model request the host reports usage for), note (a "You should know" note raised about a run: its tag, no text) and
// dropped (how many records were lost to a history that could not be written). Common to all: v, at, kind, session, and goal when a goal's.
//
// The only free text ever written is a run's task, a step's text and its Decided lines, a goal's title and summary, and an artifact's title,
// each one clean line cut to 120 characters, and written as "" when it looks like a key or a token. Nothing of a brief, a report, a tool's
// input or its output is kept: the builders take only the fields they name, and a name, model, tool or skill that is not a plain identifier
// (no space, no @, at most 64 characters) is left out.
import type { EndedBy, Employee, KnowTag, PlanStep } from '../types'
import { isArtifactLink } from './artifacts'
import { fit, parseChoices } from './desk'
import { KNOW_TAGS, looksSecret, plainText } from './know'

export const HISTORY_V = 1 as const
/** At this size a file is kept under the next number and a new one starts: well under the host's 4 MiB a read or write may take. */
export const ROTATE_BYTES = 2 * 1024 * 1024
/** The most a reader takes in one read: the host refuses more. */
export const READ_LIMIT = 4 * 1024 * 1024
/** The rule `.clawd-hq/.gitignore` carries: the history is task names and usage, not for a public repo. It covers every session's files. */
export const IGNORE_RULE = 'history*.jsonl'
const TEXT_CHARS = 120
const ID_CHARS = 64
const URL_CHARS = 300
const KINDS = ['goal_start', 'run', 'goal_end', 'tool', 'request', 'note', 'dropped'] as const
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

type Kind = (typeof KINDS)[number]
export type Outcome = 'done' | 'failed' | 'lost' | 'stopped'
type Common<K extends Kind> = { v: typeof HISTORY_V; at: number; kind: K; session: string; goal?: string }
/** What every record of one moment shares: when, which session, and the goal's slug when it is a goal's. */
export type Stamp = { at: number; session: string; goal?: string }

export type GoalStartRecord = Common<'goal_start'> & { title: string; summary?: string; steps: number; by: 'clawd' | 'planner' }
export type RunRecord = Common<'run'> & {
  step?: string; stepText?: string; run: string; type: string; name?: string; task: string; model?: string; effort?: string; skills?: string[]
  group?: 'pair' | 'council'; startedAt: number; endedAt: number; outcome: Outcome; endedBy: EndedBy; tools: number
  tokens: { inPeak: number; out: number; in?: number; cached?: number; cacheWrite?: number }
  micro?: { done: number; total: number }; choices: number; questions: number; notes: number; isRetry: boolean
}
export type StepEnd = { id: string; text: string; isDone: boolean; choices: string[]; retries: number; lastOutcome?: Outcome }
export type GoalEndRecord = Common<'goal_end'> & {
  title: string; summary?: string; outcome: 'done' | 'stopped'; startedAt: number; stepsDone: number; stepsTotal: number
  runs: number; failedRuns: number; workMs: number; steps: StepEnd[]; artifacts?: Array<{ url: string; title: string }>
  /** The goal's tokens as every tab counts them (each run's peak input plus its output, added up); the true sums stay on its run records. */
  tokens?: number
}
export type ToolRecord = Common<'tool'> & { run?: string; name: string; type: string; tool: string; startedAt: number; endedAt: number; ms: number; ok: boolean; step?: string }
export type RequestRecord = Common<'request'> & { run?: string; model: string; effort?: string; tokens: { in: number; out: number; cached: number; cacheWrite: number }; step?: string }
export type NoteRecord = Common<'note'> & { run?: string; tag: KnowTag }
export type DroppedRecord = Common<'dropped'> & { count: number }
export type HistoryRecord = GoalStartRecord | RunRecord | GoalEndRecord | ToolRecord | RequestRecord | NoteRecord | DroppedRecord

// ---- Cleaning ----

/** Free text as one clean line of at most 120 characters; "" when it looks like a key or a token; none when nothing is left. */
export const freeText = (raw: unknown): string | undefined => {
  const clean = typeof raw === 'string' ? fit(plainText(raw), TEXT_CHARS) : ''
  if (clean === '') return undefined
  return looksSecret(clean) ? '' : clean
}
const IDENT = /^[\p{L}\p{N}][\p{L}\p{N}._:+-]*$/u
/** A name, a type, a model, a tool or a skill: kept only as a plain identifier (letters, digits and . _ : + -, no space, no @, at most 64), never a command or a path. */
export const ident = (raw: unknown): string | undefined => {
  const one = typeof raw === 'string' ? raw.trim() : ''
  return one !== '' && one.length <= ID_CHARS && IDENT.test(one) ? one : undefined
}
const count = (raw: unknown): number => (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 0)
const effortOf = (raw: unknown) => ((EFFORTS as readonly unknown[]).includes(raw) ? (raw as string) : undefined)
/** The object without the fields that are undefined, so a record never carries an empty key. */
const defined = <T extends Record<string, unknown>>(one: T): T => Object.fromEntries(Object.entries(one).filter(([, v]) => v !== undefined)) as T
const common = <K extends Kind>(kind: K, s: Stamp) => ({ v: HISTORY_V, at: s.at, kind, session: s.session, goal: ident(s.goal) })

// ---- The records ----

export function goalStartRecord(s: Stamp, plan: { title: string; summary?: string; steps: number }, by: 'clawd' | 'planner'): GoalStartRecord {
  return defined({ ...common('goal_start', s), title: freeText(plan.title) ?? '', summary: freeText(plan.summary), steps: count(plan.steps), by })
}

const QUESTION = /^[ \t]*[-*]?[ \t]*QUESTION:/gim
const OUTCOMES: readonly string[] = ['done', 'failed', 'lost', 'stopped']
const UNHAPPY: readonly string[] = ['failed', 'lost', 'stopped']

/**
 * A run as it ended. `answer` is its last message where the end came with one (counted for its choices and questions, never kept); with none,
 * the choices already on its record. `notes` is how many notes were raised about it so far (the note records count the rest); `isRetry`
 * whether an earlier run on its step ended badly (`isRetryOf`).
 */
export function runRecord(s: Stamp, one: Employee, extra: { stepText?: string; answer?: string; notes: number; isRetry: boolean }): RunRecord {
  const linked = one.planKey !== undefined && one.stepId !== undefined
  const skills = (one.skills ?? []).map(ident).filter((k): k is string => k !== undefined)
  return defined({
    ...common('run', { ...s, goal: linked ? s.goal : undefined }), step: linked ? ident(one.stepId) : undefined, stepText: linked ? freeText(extra.stepText) : undefined,
    run: ident(one.id) ?? 'unknown', type: ident(one.type) ?? 'unknown', name: ident(one.name), task: freeText(one.description) ?? '',
    model: ident(one.model), effort: effortOf(one.effort), skills: skills.length > 0 ? skills : undefined,
    group: one.pair === undefined ? undefined : one.pair.isCouncil ? 'council' as const : 'pair' as const,
    startedAt: one.startedAt, endedAt: one.endedAt ?? s.at, outcome: (OUTCOMES.includes(one.mood) ? one.mood : 'lost') as Outcome, endedBy: one.endedBy ?? 'signal',
    tools: count(one.tools),
    tokens: { inPeak: count(one.peakInput), out: count(one.outTokens), in: count(one.inTokens), cached: count(one.cachedTokens), cacheWrite: count(one.cacheWriteTokens) },
    micro: one.stepTotal === undefined ? undefined : { done: count(one.stepDone), total: count(one.stepTotal) },
    choices: extra.answer === undefined ? (one.choices ?? []).length : parseChoices(extra.answer).length,
    questions: extra.answer === undefined ? 0 : (extra.answer.match(QUESTION) ?? []).length,
    notes: count(extra.notes), isRetry: extra.isRetry,
  })
}

/**
 * Whether an earlier run on the same step of the same goal ended failed, lost or stopped: on this session's books, or in the history's run
 * records (`goal` the goal's slug), which hold earlier sessions' runs too.
 */
export function isRetryOf(one: Employee, staff: readonly Employee[], records: readonly HistoryRecord[] = [], goal?: string): boolean {
  if (one.planKey === undefined || one.stepId === undefined) return false
  const onBooks = staff.some(other => other.id !== one.id && other.planKey === one.planKey && other.stepId === one.stepId && other.startedAt < one.startedAt && UNHAPPY.includes(other.mood))
  return onBooks || records.some(r => r.kind === 'run' && r.goal === goal && r.step === one.stepId && r.run !== one.id && r.startedAt < one.startedAt && UNHAPPY.includes(r.outcome))
}

export function toolRecord(s: Stamp, x: { run?: string; name: string; type: string; tool: string; startedAt: number; endedAt: number; ok: boolean; step?: string }): ToolRecord {
  return defined({
    ...common('tool', s), run: ident(x.run), name: ident(x.name) ?? 'unknown', type: ident(x.type) ?? 'unknown', tool: ident(x.tool) ?? 'other',
    startedAt: x.startedAt, endedAt: x.endedAt, ms: Math.max(0, x.endedAt - x.startedAt), ok: x.ok === true, step: ident(x.step),
  })
}

type Usage = { model?: string; input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

/** One model request as the host reported it: `in` is the uncached input, `cached` what the cache served, `cacheWrite` what it stored. */
export function requestRecord(s: Stamp, x: { run?: string; usage: Usage; model?: string; effort?: unknown; step?: string }): RequestRecord {
  const u = x.usage
  return defined({
    ...common('request', s), run: ident(x.run), model: ident(u.model) ?? ident(x.model) ?? 'unknown', effort: effortOf(x.effort),
    tokens: { in: count(u.input_tokens), out: count(u.output_tokens), cached: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens) },
    step: ident(x.step),
  })
}

/** A "You should know" note raised about a run (none for one about Clawd's own turn): its tag only, never its words. */
export function noteRecord(s: Stamp, x: { run?: string; tag: string }): NoteRecord {
  const tag = (KNOW_TAGS as readonly string[]).includes(x.tag) ? (x.tag as KnowTag) : KNOW_TAGS[0]!
  return defined({ ...common('note', s), run: ident(x.run), tag })
}

/** How many records were lost while the history could not be written, said once it can again. */
export const droppedRecord = (s: Stamp, n: number): DroppedRecord => defined({ ...common('dropped', s), count: count(n) })

/** Run records with one per run: a run ended twice (a guessed end, then its real one) keeps its last record. */
export function collapseRuns(records: readonly HistoryRecord[]): RunRecord[] {
  const last = new Map<string, RunRecord>()
  for (const r of records) if (r.kind === 'run') last.set(`${r.run}@${r.startedAt}`, r)
  return [...last.values()]
}

/** A run's tokens as the cards, People and every total count them: its peak input plus its output. The true sums stay on the record. */
export const runTokens = (r: RunRecord) => r.tokens.inPeak + r.tokens.out

/** A goal's totals from its run records: how many, how many failed, the working time added up (not the wall clock), the tokens, and each step's retries and last outcome. */
export function goalTotals(records: readonly HistoryRecord[], steps: readonly PlanStep[]) {
  const runs = collapseRuns(records)
  const ordered = [...runs].sort((a, b) => a.endedAt - b.endedAt)
  return {
    runs: runs.length, failedRuns: runs.filter(r => r.outcome === 'failed').length, workMs: runs.reduce((n, r) => n + Math.max(0, r.endedAt - r.startedAt), 0),
    tokens: runs.reduce((n, r) => n + runTokens(r), 0),
    steps: steps.map((step): StepEnd => {
      const on = ordered.filter(r => r.step === step.id)
      const last = on[on.length - 1]
      return defined({
        id: step.id, text: freeText(step.text) ?? '', isDone: step.isDone, choices: step.choices.map(freeText).filter((c): c is string => c !== undefined),
        retries: on.filter(r => r.isRetry).length, lastOutcome: last?.outcome,
      })
    }),
  }
}

export function goalEndRecord(s: Stamp, end: { title: string; summary?: string; outcome: 'done' | 'stopped'; startedAt: number; steps: readonly PlanStep[]; runs: readonly HistoryRecord[]; artifacts?: ReadonlyArray<{ url: string; title: string }> }): GoalEndRecord {
  const pages = (end.artifacts ?? []).filter(a => isArtifactLink(a.url) && a.url.length <= URL_CHARS && !looksSecret(a.url))
  return defined({
    ...common('goal_end', s), title: freeText(end.title) ?? '', summary: freeText(end.summary), outcome: end.outcome, startedAt: end.startedAt,
    stepsDone: end.steps.filter(step => step.isDone).length, stepsTotal: end.steps.length, ...goalTotals(end.runs, end.steps),
    artifacts: pages.length > 0 ? pages.map(a => ({ url: a.url, title: freeText(a.title) ?? '' })) : undefined,
  })
}

// ---- Lines ----

export const lineOf = (record: HistoryRecord): string => JSON.stringify(record)

/** The records in several files: a line that is in an earlier file too (a rotated copy whose new file is not written yet) counts once. */
export function parseFiles(texts: readonly string[]): HistoryRecord[] {
  const seen = new Set<string>()
  return texts.flatMap(text => {
    const lines = text.split(/\r?\n/)
    const fresh = lines.filter(line => !seen.has(line))
    for (const line of lines) seen.add(line)
    return parseHistory(fresh.join('\n'))
  })
}

/** The most steps, Decided lines a step, skills and pages a record read back may hold: what the plan and the office ever write. */
const MAX_STEPS = 40
const MAX_CHOICES = 5
const MAX_LIST = 20
const OUTCOME_LIST = ['done', 'failed', 'lost', 'stopped'] as const
const ENDED_BY = ['signal', 'engine', 'stale'] as const
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
const oneOf = <T extends string>(x: unknown, list: readonly T[]): T | undefined => ((list as readonly unknown[]).includes(x) ? (x as T) : undefined)
const obj = (x: unknown): Record<string, unknown> => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
const list = (x: unknown, most: number): unknown[] => (Array.isArray(x) ? x.slice(0, most) : [])

/** A step of a goal_end read back: its id an identifier, its words and Decided lines clean free text, a few of each at most. */
function cleanStep(raw: unknown): StepEnd | undefined {
  const s = obj(raw)
  const id = ident(s.id)
  if (id === undefined) return undefined
  return defined({
    id, text: freeText(s.text) ?? '', isDone: s.isDone === true, choices: list(s.choices, MAX_CHOICES).map(freeText).filter((c): c is string => c !== undefined),
    retries: count(s.retries), lastOutcome: oneOf(s.lastOutcome, OUTCOME_LIST),
  })
}

/**
 * A record read back, rebuilt from its checked fields alone: the file is in the project and anyone may have edited it, so nothing in it is
 * trusted. Free text goes through `freeText` (one clean line, 120 characters), names and ids through the identifier rule, links through
 * `isArtifactLink`; lists are cut to what the office ever writes. A record missing what it cannot do without is no record.
 */
export function cleanRecord(raw: Record<string, unknown>): HistoryRecord | undefined {
  const at = num(raw.at)
  const kind = oneOf(raw.kind, KINDS)
  if (raw.v !== HISTORY_V || at === undefined || kind === undefined || typeof raw.session !== 'string') return undefined
  const base = { v: HISTORY_V, at, kind, session: ident(raw.session) ?? 'unknown', goal: ident(raw.goal) }
  const tokens = obj(raw.tokens)
  switch (kind) {
    case 'goal_start': return defined({ ...base, kind, title: freeText(raw.title) ?? '', summary: freeText(raw.summary), steps: count(raw.steps), by: oneOf(raw.by, ['clawd', 'planner'] as const) ?? 'clawd' })
    case 'run': {
      const [run, startedAt, endedAt, outcome] = [ident(raw.run), num(raw.startedAt), num(raw.endedAt), oneOf(raw.outcome, OUTCOME_LIST)]
      if (run === undefined || startedAt === undefined || endedAt === undefined || outcome === undefined) return undefined
      const skills = list(raw.skills, MAX_LIST).map(ident).filter((k): k is string => k !== undefined)
      const micro = obj(raw.micro)
      return defined({
        ...base, kind, step: ident(raw.step), stepText: freeText(raw.stepText), run, type: ident(raw.type) ?? 'unknown', name: ident(raw.name), task: freeText(raw.task) ?? '',
        model: ident(raw.model), effort: oneOf(raw.effort, EFFORTS), skills: skills.length > 0 ? skills : undefined, group: oneOf(raw.group, ['pair', 'council'] as const),
        startedAt, endedAt, outcome, endedBy: oneOf(raw.endedBy, ENDED_BY) ?? 'signal', tools: count(raw.tools),
        tokens: { inPeak: count(tokens.inPeak), out: count(tokens.out), in: count(tokens.in), cached: count(tokens.cached), cacheWrite: count(tokens.cacheWrite) },
        micro: raw.micro === undefined ? undefined : { done: count(micro.done), total: count(micro.total) },
        choices: count(raw.choices), questions: count(raw.questions), notes: count(raw.notes), isRetry: raw.isRetry === true,
      })
    }
    case 'goal_end': {
      const [goal, outcome, startedAt] = [ident(raw.goal), oneOf(raw.outcome, ['done', 'stopped'] as const), num(raw.startedAt)]
      if (goal === undefined || outcome === undefined || startedAt === undefined) return undefined
      const steps = list(raw.steps, MAX_STEPS).map(cleanStep).filter((s): s is StepEnd => s !== undefined)
      const pages = list(raw.artifacts, MAX_LIST).map(obj).filter(a => isArtifactLink(a.url) && String(a.url).length <= URL_CHARS && !looksSecret(String(a.url)))
        .map(a => ({ url: String(a.url), title: freeText(a.title) ?? '' }))
      return defined({
        ...base, kind, goal, title: freeText(raw.title) ?? '', summary: freeText(raw.summary), outcome, startedAt, stepsDone: count(raw.stepsDone), stepsTotal: count(raw.stepsTotal),
        runs: count(raw.runs), failedRuns: count(raw.failedRuns), workMs: count(raw.workMs), steps, artifacts: pages.length > 0 ? pages : undefined,
        tokens: raw.tokens === undefined ? undefined : count(raw.tokens),
      })
    }
    case 'tool': {
      const [startedAt, endedAt] = [num(raw.startedAt), num(raw.endedAt)]
      if (startedAt === undefined || endedAt === undefined) return undefined
      return defined({ ...base, kind, run: ident(raw.run), name: ident(raw.name) ?? 'unknown', type: ident(raw.type) ?? 'unknown', tool: ident(raw.tool) ?? 'other', startedAt, endedAt, ms: count(raw.ms), ok: raw.ok === true, step: ident(raw.step) })
    }
    case 'request': return defined({ ...base, kind, run: ident(raw.run), model: ident(raw.model) ?? 'unknown', effort: oneOf(raw.effort, EFFORTS), tokens: { in: count(tokens.in), out: count(tokens.out), cached: count(tokens.cached), cacheWrite: count(tokens.cacheWrite) }, step: ident(raw.step) })
    case 'note': {
      const tag = oneOf(raw.tag, KNOW_TAGS as readonly KnowTag[])
      return tag === undefined ? undefined : defined({ ...base, kind, run: ident(raw.run), tag })
    }
    case 'dropped': return defined({ ...base, kind, count: count(raw.count) })
  }
}

/**
 * The records in a file's text, each rebuilt by `cleanRecord`: a line that does not parse, is not a record, has another version or an unknown
 * kind, or lacks what its kind needs, is skipped. Two equal lines in one file are two events (two calls in the same millisecond). Never throws.
 */
export function parseHistory(raw: string): HistoryRecord[] {
  return raw.split(/\r?\n/).flatMap(line => {
    if (line.trim() === '') return []
    try {
      const one: unknown = JSON.parse(line)
      if (typeof one !== 'object' || one === null || Array.isArray(one)) return []
      const clean = cleanRecord(one as Record<string, unknown>)
      return clean === undefined ? [] : [clean]
    } catch {
      return []
    }
  })
}

/** The kinds the History tab draws from (or counts): what it reads and keeps; the tool and request records are left in the file. */
export const TAB_KINDS: readonly HistoryRecord['kind'][] = ['run', 'goal_end', 'dropped', 'note']
export const isTabKind = (r: HistoryRecord) => TAB_KINDS.includes(r.kind)

// ---- Files ----

/** A session id as a safe part of a file name: letters, digits and dashes, at most 64; "unknown" when nothing is left. */
export const fileKey = (session: string) => session.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'unknown'
/** A session's current file. */
export const sessionFile = (session: string) => `history-${fileKey(session)}.jsonl`
/** A session's `n`th rotated file. */
export const rotatedName = (session: string, n: number) => `history-${fileKey(session)}-${n}.jsonl`
/** Any history file: this version's, an earlier one, a rotated one. */
export const isHistoryFile = (name: string) => /^history[A-Za-z0-9-]*\.jsonl$/.test(name)

/** The number the session's next rotated file gets: one past the highest of its own there, so a restart never reuses one. */
export function nextRotation(names: readonly string[], session: string): number {
  const head = `history-${fileKey(session)}-`
  const ns = names.filter(n => n.startsWith(head) && n.endsWith('.jsonl')).map(n => n.slice(head.length, -'.jsonl'.length)).filter(n => /^\d{1,9}$/.test(n)).map(Number)
  return Math.max(0, ...ns) + 1
}

/** Whether a `.gitignore`'s text already keeps the history out of git: a line that is the rule, or one that ignores everything there. */
export const ignoresHistory = (text: string) => text.split(/\r?\n/).map(l => l.trim()).some(l => [IGNORE_RULE, `/${IGNORE_RULE}`, '*', '*.jsonl', '/*'].includes(l))

/** The text's size in bytes as UTF-8, which is what the file will take. */
export function utf8Length(s: string): number {
  let n = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return n
}
