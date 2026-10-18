// Onboarding, piece 8: the two setup questions (does Clawd run the chat, is the chat quiet), their answers from the question
// box (one at a time: the host's own ask) or the card's buttons, and the switch changes they make. Pure, or over closures; no `$`.
import type { AskQuestion, OnboardIo, PendingToggle, ToggleField } from './onboard-types'

export type SetupQuestion = AskQuestion & { readonly field: ToggleField }

export const YES = 'Yes (Recommended)'
export const NO = 'No'

export const QUESTIONS: readonly SetupQuestion[] = [
  {
    field: 'chiefOfStaff',
    question: 'Should I run the chat as your chief of staff, handing real work to specialists?',
    header: 'Run chat',
    options: [
      { label: YES, description: 'I hand real work to specialists, ask you only what needs you, and report in plain words.' },
      { label: NO, description: 'Claude works as usual, and you keep the office panel.' },
    ],
  },
  {
    field: 'quietChat',
    question: 'Should I keep the chat quiet, hiding the "finished" notices of specialists I hired?',
    header: 'Quiet chat',
    options: [
      { label: YES, description: 'I report once a job is done. Failures and questions always show.' },
      { label: NO, description: 'The chat shows every row as Claude Code draws it.' },
    ],
  },
]

/** A Yes or a No, with or without the (Recommended) mark; anything else (a typed answer) is no answer. */
export function answerOf(said: string | undefined): boolean | undefined {
  const word = (said ?? '').trim().toLowerCase()
  if (/^yes\b/.test(word)) return true
  if (/^no\b/.test(word)) return false
  return undefined
}

/** The first question with no answer yet, for the card's buttons. */
export const nextQuestion = (answered: readonly PendingToggle[]) => QUESTIONS.find(q => !answered.some(a => a.field === q.field))

/** The answers with one more; a second answer to the same question replaces the first. */
export const withAnswer = (answered: readonly PendingToggle[], one: PendingToggle): readonly PendingToggle[] =>
  [...answered.filter(a => a.field !== one.field), one]

export type ApplyIo = Pick<OnboardIo, 'options' | 'isBusy' | 'setToggle'> & {
  /** Saves the answers still waiting, so a reload part way resumes with the rest. */
  readonly keep: (pending: readonly PendingToggle[]) => Promise<void>
}
export type Applied = { readonly pending: readonly PendingToggle[]; readonly refused: readonly ToggleField[] }

/**
 * Applies the waiting answers one by one, through the same path as the Settings switches. Only a value that differs from
 * the switch now is set. While Clawd's turn runs nothing is set: the answers wait for its end (or the next session start).
 */
export async function applyPending(io: ApplyIo, pending: readonly PendingToggle[]): Promise<Applied> {
  if (pending.length === 0 || (await io.isBusy())) return { pending, refused: [] }
  const now = await io.options()
  let left = pending
  let refused: readonly ToggleField[] = []
  for (const one of pending) {
    const isSet = now[one.field] === one.value || (await io.setToggle(one.field, one.value).catch(() => false))
    if (!isSet) refused = [...refused, one.field]
    left = left.filter(p => p !== one)
    await io.keep(left)
  }
  return { pending: left, refused }
}
