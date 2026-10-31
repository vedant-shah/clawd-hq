// The council: the "Hold a council" button and the /office-council command (which put `Hold a council on: <question>` in front of Clawd),
// and what a council voice keeps of its report for the council card (hooks/panel-council.tsx). Grouping lives in hooks/pair-up.ts.
import type { Employee } from '../types'
import { fit } from './desk'
import { withChoices } from './staff-model'

/** The words Clawd reads as a request for a council (his rules, prompts/chief-of-staff.md, say what he does with them). */
export const COUNCIL_LEAD = 'Hold a council on: '

/** The calls behind the button and the command; register.tsx fills them in. */
export type CouncilIo = {
  /** Puts text in the prompt box after what is there; never sends. */
  fill: (text: string) => Promise<{ isFilled: boolean }>
  /** Sends text as the person's own words. */
  submit: (text: string) => Promise<unknown>
  /** Runs `fn` as a later event: the engine refuses a send made inside the command's own hook, which holds the turn the send would wait on. */
  later: (fn: () => unknown) => unknown
  toast: (text: string) => unknown
}

/** The button: fills the prompt box with the lead words, nothing more. A box that cannot take them gets a toast with the words to type. Returns whether the box took them. */
export async function fillCouncil(io: CouncilIo): Promise<boolean> {
  const r = await io.fill(COUNCIL_LEAD).catch(() => ({ isFilled: false }))
  if (!r.isFilled) io.toast(`Type this in the chat: ${COUNCIL_LEAD}`)
  return r.isFilled
}

/**
 * `/office-council <question>`: the person typed it, so the question goes to Clawd as their own words, sent just after the command ends (see `later`).
 * With no question the prompt box is filled instead. A send that fails leaves the words in the prompt box, ready to send, and says so in a toast.
 * Returns the command's one line.
 */
export async function runCouncil(io: CouncilIo, args: string): Promise<string> {
  const question = args.trim()
  if (question === '') {
    const isFilled = await fillCouncil(io)
    return isFilled ? `The prompt box has "${COUNCIL_LEAD.trim()}" ready. Type your question after it.` : `Type the question after "${COUNCIL_LEAD.trim()}" in the chat.`
  }
  const text = `${COUNCIL_LEAD}${question}`
  await io.later(() => io.submit(text).catch(async (err: unknown) => {
    const why = err instanceof Error ? err.message : String(err)
    const r = await io.fill(text).catch(() => ({ isFilled: false }))
    io.toast(r.isFilled ? `Couldn't send the council question (${why}). It is in your prompt box: press Enter.` : `Couldn't send the council question (${why}). Type this in the chat: ${text}`)
  }))
  return `Asking Clawd to hold a council on: ${question}`
}

/** A report line is kept to a size a card can wrap, cut at a word and with no mark. */
const LINE_CHARS = 240
const FENCE = /^\s*```/
const HEADING = /^\s*#{1,6}(\s|$)/

/** The first line of a voice's report, in plain words: code fences and headings skipped; list marks, quotes, bold, code ticks and link marks taken off. None when there is nothing. */
export function voiceLine(answer: string): string | undefined {
  const lines = answer.split(/\r?\n/)
  const first = lines.reduce<{ inFence: boolean; line?: string }>((seen, raw) => {
    if (seen.line !== undefined) return seen
    if (FENCE.test(raw)) return { inFence: !seen.inFence }
    if (seen.inFence || raw.trim() === '' || HEADING.test(raw)) return seen
    const plain = raw.replace(/^\s*(?:[-*+>]\s+|\d+[.)]\s+)+/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1')
    return plain.trim() === '' ? seen : { inFence: false, line: plain }
  }, { inFence: false }).line
  return first === undefined ? undefined : fit(first, LINE_CHARS)
}

/** A hand-back on the books: the voice of a council keeps the first line of its report; any specialist keeps the choices it reported. Anyone else with no choice is left as it was. */
export function withVoiceNotes(one: Employee, choices: readonly string[], answer: string): Employee {
  const kept = withChoices(one, choices)
  const line = one.pair?.isCouncil ? voiceLine(answer) : undefined
  return line === undefined ? kept : { ...kept, report: line }
}
