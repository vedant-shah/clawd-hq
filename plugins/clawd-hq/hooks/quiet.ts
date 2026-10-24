// The quiet chat: which rows of the main chat are filler the person need not see. Pure; register.tsx draws (or hides) them.
// The full view (ctrl+o, --verbose) is never changed, and a failure is never hidden.
import type { Employee } from '../types'

/** What Clawd writes, and nothing else, when a specialist's message leaves nothing to tell the person. */
export const NO_UPDATE = '[no update]'

const ONLY_MARK = /^\[no update\]\.?$/i

/** A reply that is the mark alone. */
export const isNoUpdate = (text: string) => ONLY_MARK.test(text.trim())

export type ChatRow = {
  /** The view draws the row in full: left alone. */
  isExpanded: boolean
  originKind: string
  /** What the row shows. */
  text: string
  /** The background task a notice reports on. `type` is set for kinds with content of their own (a remote agent, an artifact watch). */
  task?: { id?: string; status?: string; type?: string }
  /** Who sent the message, when it was not the person. */
  from?: { name: string }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
/** A message that asks for something is never filler: a question, or a request for permission, approval or shutdown. */
const ASKS = /\?|\b(permission|approv|shut ?down)/i

/** A message that reports a failure or a block is never filler either. */
const TROUBLE = /\b(fail\w*|error\w*|blocked|unable|cannot|can'?t|crash\w*|stuck)\b/i

/**
 * The lines the transcript folds several finished background jobs into: agents, shell commands, or the summary that still counts
 * what is running ("1 background task completed, 1 running"). Anything with a failure in it does not match.
 */
const MERGED_DONE = /^\d+ background (?:agents?|commands?|tasks?) completed(?:, \d+ running)?\.?$/i

/**
 * That merged line, when it is plainly a success. It names no task of its own, so it cannot be checked against the specialists the
 * office hired; it is hidden whoever they were. Only the engine's own notification stamp counts, and a status that is not "completed" is shown.
 */
const isMergedDone = (row: ChatRow): boolean =>
  row.originKind === 'task-notification' && MERGED_DONE.test(row.text.trim()) && (row.task?.status === undefined || row.task.status === 'completed')

/** Who the engine names for a specialist's message when it has no better word. */
const GENERIC_SENDER = 'subagent'

/** The office's own: a specialist hired by name or by agent type, the generic sender, or no sender named at all. */
const isOfficeSender = (from: ChatRow['from'], staff: Employee[]): boolean =>
  from === undefined || same(from.name, GENERIC_SENDER) || staff.some(one => same(one.type, from.name) || (one.name !== undefined && same(one.name, from.name)))

/**
 * A specialist's message to Clawd (a SendMessage delivery), when it asks for nothing and reports no trouble. The specialist's
 * final report says the rest, so the row can go; one with a question, a failure or a permission request in it is shown.
 */
const isPeerFiller = (row: ChatRow, staff: Employee[]): boolean =>
  row.originKind === 'peer-send-message' && !ASKS.test(row.text) && !TROUBLE.test(row.text) && isOfficeSender(row.from, staff)

/**
 * A row that only hands work back to Clawd: the "finished" notice of a job that ended well (a specialist the office
 * hired, or a background shell or monitor it did not), or a message from a teammate the office hired by name. Clawd
 * reports on it and the Settings tab lists it, so the raw row can go. A hidden request would be a lost action, so the
 * rule is narrow: anything it is unsure of is shown.
 */
export function isHandback(row: ChatRow, staff: Employee[]): boolean {
  if (row.isExpanded) return false
  if (isMergedDone(row) || isPeerFiller(row, staff)) return true
  if (row.task) {
    if (row.originKind !== 'task-notification' || row.task.status !== 'completed') return false
    if (staff.some(one => one.id === row.task!.id)) return true
    // A job the office did not hire: only a plain one (no kind of its own), and never a notice that asks for something.
    return row.task.type === undefined && !ASKS.test(row.text)
  }
  const name = row.from?.name
  // A teammate's message carries no stamp of where it came from; another session's, a channel's or the person's does.
  if (name === undefined || row.originKind !== 'unclassified' || ASKS.test(row.text)) return false
  return staff.some(one => one.name !== undefined && same(one.name, name))
}

// ---- Small tool rows: the office's own bookkeeping calls are hidden or dimmed, never an error or a question ----
const STEP_TOOL = 'mcp__clawd-hq__step'
const DIMMED_OWN_TOOLS: ReadonlySet<string> = new Set(['mcp__clawd-hq__offer_rule', 'mcp__clawd-hq__find_helpers', 'mcp__clawd-hq__hire_contractor'])
const TOOL_SEARCH = 'ToolSearch'
const SEND_MESSAGE = 'SendMessage'
const TASK_LIST_TOOLS: ReadonlySet<string> = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
const HIDDEN_TOOLS: ReadonlySet<string> = new Set([STEP_TOOL, TOOL_SEARCH])
const BACKGROUND_HINT = 'background_hint'

export type ToolRow = { tool: string; input?: unknown; output?: unknown; isErrored: boolean; isInterrupted?: boolean; isExpanded?: boolean }
export type RowLook = 'show' | 'dim' | 'hide'

/** The run-in-background pill under a running tool call. */
export const isBackgroundHint = (kind: string) => kind === BACKGROUND_HINT

/** What a message to a teammate says, and whom it goes to, when the call is shaped like one. */
function sentMessage(input: unknown): { to: string; message: string } | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
  const { to, message } = input as { to?: unknown; message?: unknown }
  return typeof to === 'string' ? { to, message: typeof message === 'string' ? message : '' } : undefined
}

/** A message from Clawd to a teammate the office hired by name (the row writes it with an @). However it is worded: it is Clawd talking to his own team. */
function isToTeammate(input: unknown, staff: Employee[]): boolean {
  const sent = sentMessage(input)
  if (sent === undefined) return false
  const to = sent.to.trim().replace(/^@/, '')
  return staff.some(one => one.name !== undefined && same(one.name, to))
}

const AGENT_TOOL = 'Agent'
/** What an Agent call answers at once when its agent runs on in the background (or in the cloud): a launch, not a finish. */
const LAUNCHED: ReadonlySet<string> = new Set(['async_launched', 'remote_launched'])

/** The result row of an Agent call that only launched a background agent. A result row carries no input; the call row does. */
function isLaunchResult(row: ToolRow): boolean {
  if (row.tool !== AGENT_TOOL || 'input' in row) return false
  const status = typeof row.output === 'object' && row.output !== null ? (row.output as { status?: unknown }).status : undefined
  return typeof status === 'string' && LAUNCHED.has(status)
}

/** How a tool call's row (or its result) is drawn. The full view, and anything errored or cut short, is shown as the engine draws it, whatever the tool. */
export function rowLook(row: ToolRow, staff: Employee[]): RowLook {
  if (row.isExpanded || row.isErrored || row.isInterrupted) return 'show'
  if (HIDDEN_TOOLS.has(row.tool) || isLaunchResult(row)) return 'hide'
  if (DIMMED_OWN_TOOLS.has(row.tool) || TASK_LIST_TOOLS.has(row.tool)) return 'dim'
  // A result row carries no input (only the call's answer): Clawd's own SendMessage answer is dimmed with the call.
  if (row.tool === SEND_MESSAGE && (row.input === undefined ? !('input' in row) : isToTeammate(row.input, staff))) return 'dim'
  return 'show'
}

// ---- A dimmed row's own words: the engine's drawing cannot sit inside a dim Text, so the row is one short line of ours ----
const DIM_LINE_CHARS = 100
const DIM_RESULT = '  └ done'
const MCP_NAME = /^mcp__.+?__(.+)$/

/** The tool's own name: `find_helpers` for `mcp__clawd-hq__find_helpers`, a built-in's as it is. */
const shortName = (tool: string) => MCP_NAME.exec(tool)?.[1] ?? tool

/** The input's text fields, in order, on one line; lists and objects are left out. */
function inputSummary(input: unknown): string {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ''
  return Object.values(input).filter((v): v is string => typeof v === 'string' && v.trim() !== '').join(' · ').replace(/\s+/g, ' ').trim()
}

const clip = (text: string) => (text.length > DIM_LINE_CHARS ? `${text.slice(0, DIM_LINE_CHARS - 1)}…` : text)

/** The line a dimmed row draws: the call's tool and what it was asked, or, for a result row (which has no input), that it is done. */
export function dimLine(row: ToolRow): string {
  if (!('input' in row)) return DIM_RESULT
  const summary = inputSummary(row.input)
  return clip(summary === '' ? shortName(row.tool) : `${shortName(row.tool)} · ${summary}`)
}
