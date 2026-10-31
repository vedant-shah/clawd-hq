// The scout's final answer, read. The plugin starts the scout from its own timer, so in Claude Code none of the plugin's hooks
// run inside it (they are skipped as re-entry): it cannot send its picks through a tool of ours. It ends with a team block
// instead, and the plugin reads that from its transcript. Everything here is untrusted text; scout-pick.ts checks each pick.
// Pure; no `$`.
import type { ScoutReport } from './onboard-types'

export const TEAM_START = 'TEAM START'
export const TEAM_END = 'TEAM END'
/** One line of the block, as the scout is told to write it. */
export const LINE_FORMAT = 'seat | name | evidence | reason'
/** Only this many lines of a block are looked at. */
const MAX_LINES = 40

/** One line of the block, split into its fields; nothing in it is checked yet. */
export type AnswerEntry = { readonly seat: string; readonly name: string; readonly evidence: string; readonly reason: string }
/** The part of the scout's transcript read here: who wrote each message, its words, and the tools it called. */
export type ScoutMessage = {
  readonly role: string
  readonly text: string
  readonly toolUses: readonly { readonly tool: string; readonly input: Readonly<Record<string, unknown>>; readonly isError?: boolean }[]
}

/** One line as its four fields, or `undefined` when it has fewer. A bar inside the reason stays part of it. */
function entryOf(line: string): AnswerEntry | undefined {
  const [seat, name, evidence, ...rest] = line.split('|').map(f => f.trim())
  const reason = rest.join(' | ').trim()
  return seat && name && evidence && reason ? { seat, name, evidence, reason } : undefined
}

/** The lines of the team block in a text, or `undefined` when it holds no whole block (a start, then an end). */
export function answerEntries(text: string): readonly AnswerEntry[] | undefined {
  const start = text.lastIndexOf(TEAM_START)
  const end = start < 0 ? -1 : text.indexOf(TEAM_END, start)
  if (end < 0) return undefined
  const lines = text.slice(start + TEAM_START.length, end).split('\n').filter(l => l.trim() !== '').slice(0, MAX_LINES)
  return lines.flatMap(l => entryOf(l) ?? [])
}

/** Every path the scout opened with Read, in the order it opened them; a read that failed does not count. */
const readsOf = (messages: readonly ScoutMessage[]): readonly string[] =>
  messages.flatMap(m => (m.role === 'assistant' ? m.toolUses : []))
    .flatMap(u => (u.tool === 'Read' && u.isError !== true && typeof u.input.file_path === 'string' ? [u.input.file_path] : []))

/** The tool a background agent hands its final report back with (seen in a real scout run): its `message` is the answer. */
const HANDBACK = 'SubagentHandback'

/**
 * The words of the scout's final answer: its last message, calling no tool but the hand-back, with what it handed back.
 * `undefined` while its last message still calls a tool: a block written before more work is a draft, not the answer.
 */
function finalWords(messages: readonly ScoutMessage[]): string | undefined {
  const last = [...messages].reverse().find(m => m.role === 'assistant')
  if (last === undefined || last.toolUses.some(u => u.tool !== HANDBACK)) return undefined
  return [last.text, ...last.toolUses.map(u => (typeof u.input.message === 'string' ? u.input.message : ''))].join('\n')
}

/** The scout's picks from its final answer, with the files it opened; `undefined` until it has given one with a team block. */
export function scoutReport(messages: readonly ScoutMessage[]): ScoutReport | undefined {
  const words = finalWords(messages)
  const entries = words === undefined ? undefined : answerEntries(words)
  return entries === undefined ? undefined : { picks: { picks: entries }, reads: readsOf(messages) }
}
