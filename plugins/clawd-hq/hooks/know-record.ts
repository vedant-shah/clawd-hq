// The work being checked, written up for the checker, pure. Every step stays, in order, with its tool, target and
// outcome, beside the brief, the worker's own words and the report; only long outputs and inputs are trimmed, and each
// trim leaves a mark in words. hooks/know-hooks.ts reads the rows from the session and hands them in.
import type { SessionMessage } from 'claude-code'
import { BRIEF_NOTE } from './desk'
import { ago } from './office'

/** The whole record's limit: about 60K tokens, at about four characters a token. */
export const CAP_CHARS = 240_000
const INPUT = { limit: 2000, head: 1000, tail: 500 }
const PROMPT = { limit: 2000, head: 1500, tail: 500 }
const LOOKUP = { head: 600, tail: 0 }
const COMMAND = { head: 1500, tail: 2500 }
const ERROR = { head: 2000, tail: 2000 }
/** What the cap leaves of a command's output in the middle of the run. */
const SHORT_COMMAND = { head: 500, tail: 1000 }
const LOOKUP_TOOLS: Record<string, string> = {
  Read: 'file text', NotebookRead: 'file text', Grep: 'search results', Glob: 'search results', LS: 'search results',
  ToolSearch: 'search results', WebFetch: 'web page text', WebSearch: 'web search results',
}
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput'])
const TARGET_KEYS = ['file_path', 'notebook_path', 'command', 'pattern', 'url', 'query', 'path', 'description', 'skill', 'subagent_type']
const OUR_NOTE = "[trimmed: Clawd HQ's standard note on how to report, not shown]"

export type RecordInput = {
  /** Who did the work: a specialist's label, or Clawd. */
  who: string
  /** Clawd's own turn in the main chat, not a specialist's run. */
  isClawd?: boolean
  ended: 'answer' | 'aborted' | 'refusal' | 'error'
  /** The rows of this run: for a resumed specialist, only those since its last check. */
  rows: readonly SessionMessage[]
  /** The brief the specialist was hired with: used when the rows do not open with it, and beside a resumed run's opening message. */
  brief?: string
  /** A run after the first: its rows open with the message that started it, not the brief. */
  isResumed?: boolean
  report: string
  /** The person's latest prompts in the main chat, oldest first. */
  prompts: readonly string[]
  durationMs?: number
  tokens?: { input: number; output: number }
}

type Out = { text: string; what: string; isError: boolean; isLookup: boolean; cut: { head: number; tail: number }; isShort: boolean }
type Item =
  | { kind: 'step'; head: string; fields: string[]; out?: Out }
  | { kind: 'words'; text: string }

const commas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const linesIn = (text: string) => { const n = text.split('\n').length; return `${commas(n)} line${n === 1 ? '' : 's'} in all` }

/** The text, or its head and tail with a mark in words between them; never an ellipsis. */
function trimmed(text: string, head: number, tail: number, what: string, why = ''): string {
  if (text.length <= head + tail) return text
  const mark = `[trimmed: ${commas(text.length - head - tail)} characters of ${what} not shown${why}; ${linesIn(text)}]`
  return [text.slice(0, head), mark, tail > 0 ? text.slice(-tail) : ''].filter(part => part !== '').join('\n')
}

const capped = (text: string, rule: { limit: number; head: number; tail: number }, what: string) =>
  (text.length > rule.limit ? trimmed(text, rule.head, rule.tail, what) : text)

const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value) ?? String(value))

/** The input field a step is known by (a path, a command, a pattern), else its first text field; none for neither. */
function targetKey(input: Record<string, unknown>): string | undefined {
  return TARGET_KEYS.find(k => typeof input[k] === 'string') ?? Object.keys(input).find(k => typeof input[k] === 'string')
}

function outOf(use: SessionMessage['toolUses'][number]): Out | undefined {
  if (use.text === undefined || use.text === '') return undefined
  const isError = use.isError === true
  const lookup = LOOKUP_TOOLS[use.tool]
  const isLookup = !isError && lookup !== undefined
  const what = isError ? 'error text' : lookup ?? (COMMAND_TOOLS.has(use.tool) ? 'command output' : 'tool output')
  return { text: use.text, what, isError, isLookup, cut: isError ? ERROR : isLookup ? LOOKUP : COMMAND, isShort: false }
}

function stepOf(n: number, use: SessionMessage['toolUses'][number]): Item {
  const key = targetKey(use.input)
  const outcome = use.isError ? 'ERROR' : use.text !== undefined ? 'done' : 'no outcome recorded'
  const target = key === undefined ? '' : ` · ${capped(asText(use.input[key]), INPUT, 'input text')}`
  const fields = Object.entries(use.input).filter(([k]) => k !== key).map(([k, v]) => `${k}: ${capped(asText(v), INPUT, 'input text')}`)
  return { kind: 'step', head: `STEP ${n} · ${use.tool}${target} · ${outcome}`, fields, out: outOf(use) }
}

function render(item: Item): string {
  if (item.kind === 'words') return item.text
  const o = item.out
  const why = o?.isShort ? ', to keep the record short' : ''
  const out = o ? [o.isError ? 'error:' : 'output:', trimmed(o.text, o.cut.head, o.cut.tail, o.what, why)] : []
  return [item.head, ...item.fields, ...out].join('\n')
}

const isSame = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/** The steps and words of the run, in order. The last words, when they are the report itself, are not given twice. */
function itemsOf(rows: readonly SessionMessage[], input: RecordInput): Item[] {
  const lastSaid = rows.reduce((at, r, i) => (r.role === 'assistant' && r.text.trim() !== '' ? i : at), -1)
  const [speaker, toWorker] = input.isClawd ? ['CLAWD SAID', 'MESSAGE DURING THE TURN'] : ['THE SPECIALIST SAID', 'MESSAGE TO THE SPECIALIST']
  let n = 0
  return rows.flatMap((row, i): Item[] => {
    if (row.role === 'user') {
      return row.text.trim() === '' || (row.toolResults?.length ?? 0) > 0 ? [] : [{ kind: 'words', text: `${toWorker}: ${capped(row.text, INPUT, 'message text')}` }]
    }
    const isReport = i === lastSaid && isSame(row.text, input.report)
    const words: Item[] = row.text.trim() === '' || isReport ? [] : [{ kind: 'words', text: `${speaker}: ${row.text}` }]
    return [...words, ...row.toolUses.map(use => stepOf((n += 1), use))]
  })
}

/** Cuts outputs until the record fits: the oldest lookups to their step line first, then commands from the middle of the run outward. */
function fitted(items: Item[], fixed: number): { items: Item[]; size: number } {
  const list = [...items]
  let size = fixed + list.reduce((sum, it) => sum + render(it).length + 2, 0)
  const shrink = (i: number, cut: { head: number; tail: number }) => {
    const it = list[i]!
    if (size <= CAP_CHARS || it.kind !== 'step' || !it.out) return
    const next: Item = { ...it, out: { ...it.out, cut, isShort: true } }
    size += render(next).length - render(it).length
    list[i] = next
  }
  const outs = list.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'step' && it.out && !it.out.isError)
  for (const { i } of outs.filter(({ it }) => it.kind === 'step' && it.out!.isLookup)) shrink(i, { head: 0, tail: 0 })
  const mid = (list.length - 1) / 2
  const commands = outs.filter(({ it }) => it.kind === 'step' && !it.out!.isLookup).sort((a, b) => Math.abs(a.i - mid) - Math.abs(b.i - mid))
  for (const { i } of commands) shrink(i, SHORT_COMMAND)
  return { items: list, size }
}

const ENDED = {
  specialist: { answer: 'It finished and handed back its report.', error: 'It stopped on an error before it finished.', aborted: 'It was stopped before it finished.', refusal: 'The model refused to go on.' },
  clawd: { answer: 'He finished and answered.', error: 'He stopped on an error before he finished.', aborted: 'He was stopped before he finished.', refusal: 'The model refused to go on.' },
} as const

function headerOf(input: RecordInput, steps: number): string {
  const who = input.isClawd ? 'Clawd, the chief of staff, in the main chat' : `${input.who}, a specialist Clawd hired`
  const cost = [
    input.durationMs === undefined ? '' : ago(input.durationMs),
    input.tokens ? `${commas(input.tokens.input)} input tokens, ${commas(input.tokens.output)} output tokens` : '',
  ].filter(Boolean).join('; ')
  return [
    `WHO DID THE WORK: ${who}`,
    `HOW IT ENDED: ${ENDED[input.isClawd ? 'clawd' : 'specialist'][input.ended]}`,
    ...(cost ? [`TIME AND TOKENS: ${cost}`] : []),
    `STEPS TAKEN: ${steps}`,
  ].join('\n')
}

const withoutOurNote = (text: string) => (text.includes(BRIEF_NOTE) ? `${text.replace(BRIEF_NOTE, '').trimEnd()}\n\n${OUR_NOTE}` : text)

/** The brief, and the message that started a resumed run; the rows after the opening one. */
function briefOf(input: RecordInput): { sections: string[]; rest: readonly SessionMessage[] } {
  const first = input.rows[0]
  const isOpening = first?.role === 'user' && first.text.trim() !== '' && (first.toolResults?.length ?? 0) === 0
  const opening = isOpening ? withoutOurNote(first.text) : undefined
  const rest = isOpening ? input.rows.slice(1) : input.rows
  if (input.isClawd) return { sections: [`THE PERSON'S REQUEST:\n${opening ?? 'Not available.'}`], rest }
  const hired = input.brief === undefined || (!input.isResumed && opening !== undefined) ? undefined : withoutOurNote(input.brief)
  const brief = hired ?? opening ?? 'Not available.'
  const started = opening !== undefined && hired !== undefined && !isSame(opening, hired) ? [`MESSAGE THAT STARTED THIS RUN:\n${opening}`] : []
  return { sections: [`BRIEF:\n${brief}`, ...started], rest }
}

function promptsOf(prompts: readonly string[]): string[] {
  if (prompts.length === 0) return []
  return [`THE PERSON'S LATEST PROMPTS TO CLAWD:\n${prompts.map((p, i) => `${i + 1}. ${capped(p, PROMPT, 'the prompt')}`).join('\n')}`]
}

/** The record the checker reads, how many steps it holds, and its size; `isOverCap` when even the cuts left it too long. */
export function buildRecord(input: RecordInput): { text: string; steps: number; chars: number; isOverCap: boolean } {
  const { sections, rest } = briefOf(input)
  const all = itemsOf(rest, input)
  const steps = all.filter(it => it.kind === 'step').length
  const before = [headerOf(input, steps), ...promptsOf(input.prompts), ...sections, 'STEPS AND WORDS, IN ORDER:'].join('\n\n')
  const after = `${input.isClawd ? 'FINAL ANSWER' : 'REPORT HANDED BACK'}:\n${input.report.trim() === '' ? 'No report text.' : input.report}`
  const { items } = fitted(all, before.length + after.length + 4)
  const text = [before, ...items.map(render), after].join('\n\n')
  return { text, steps, chars: text.length, isOverCap: text.length > CAP_CHARS }
}

const isTyped = (r: SessionMessage) => r.role === 'user' && r.text.trim() !== '' && (r.toolResults?.length ?? 0) === 0

/**
 * The rows of one turn of the main chat: from the person's message that opened it (found by the turn's text), else from
 * the last message they typed; all of them when there is none.
 */
export function turnRows(rows: readonly SessionMessage[], text: string): readonly SessionMessage[] {
  const head = text.trim().slice(0, 200)
  const typed = rows.map((r, i) => ({ r, i })).filter(({ r }) => isTyped(r))
  const opened = [...typed].reverse().find(({ r }) => head !== '' && r.text.includes(head)) ?? typed[typed.length - 1]
  return opened ? rows.slice(opened.i) : rows
}
