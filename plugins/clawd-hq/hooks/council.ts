// The council: the "Hold a council" button and the /office-council command (which put `Hold a council on: <question>` in front of Clawd),
// and what a council voice keeps of its report for the council card (hooks/panel-council.tsx). Grouping lives in hooks/pair-up.ts.
import type { Employee } from '../types'
import { fit } from './desk'

/** The words Clawd reads as a request for a council (his rules, prompts/chief-of-staff.md, say what he does with them). */
export const COUNCIL_LEAD = 'Hold a council on: '

/** The calls behind the button and the command; register-io.ts fills them in. */
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

