// When a piece of work has closed, pure: the coffee break button is offered only at such a checkpoint, never between the steps of a job.
// A checkpoint is Clawd's turn ending while no hand-back waits for its report and the turn edited no files. A specialist handing its work
// back holds it off until Clawd has reported it (even if the report ends with a question). New work ends it: a specialist hired or resumed,
// or a turn in which Clawd edited files himself. Reading, searching, running commands and plain chat do not. Clawd's card (the boss) keeps the marks.
//
// Which turn reports a hand-back? The one that starts after it. But a background job's notification can also JOIN a turn already running
// (Clawd waiting at a question box while a second specialist finishes), or be heard before the specialist's own end: then that turn is the
// report, and no later one will come. `withNotice` and `carriedAt` carry that.
import type { Boss } from '../types'

/** Prompts that come from the person: their own Enter, the remote bridge, a script's host. A notification, a peer, a schedule or a plugin is not. */
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

/**
 * A specialist handed its work back. No checkpoint until Clawd has reported it, in a turn that starts after this. The exception is a turn
 * a notification already started or joined with no hand-back heard (`carriedAt`): the hand-back is heard late, and that turn is the report.
 */
export function withHandBack(b: Boss): Boss {
  const isCarried = b.isBusy && b.carriedAt === b.turns
  return { ...b, handedBackAt: isCarried ? b.turns - 1 : b.turns, carriedAt: isCarried ? undefined : b.carriedAt, isCheckpoint: false }
}

/**
 * A background job's notification reached Clawd, new turn (`isIntoTurn` false: it starts the next one) or joining the running one. A
 * hand-back heard in the running turn and not yet carried is reported by this turn (it joined); one heard before an idle notification is
 * reported by the turn that starts. With no hand-back heard yet, the turn that carries the notification is kept for the one that comes.
 */
export function withNotice(b: Boss, isIntoTurn: boolean): Boss {
  const isPending = b.handedBackAt === b.turns
  if (!isIntoTurn) return isPending ? b : { ...b, carriedAt: b.turns + 1 }
  return isPending ? { ...b, handedBackAt: b.turns - 1 } : { ...b, carriedAt: b.turns }
}

/**
 * The person sent a message. A checkpoint that stands stays: plain chat is not new work. Only a hand-back still waiting for its report is
 * dropped. `kind` is where the message came from, kept for the record of the button.
 */
export const withPersonSpoke = (b: Boss, kind?: string): Boss =>
  ({ ...b, handedBackAt: undefined, carriedAt: undefined, spokeBy: kind ?? 'none' })

/** The only tools that are work: the ones that change files. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** Clawd used a tool himself: that turn is work only if the tool edits files. */
export const withToolUsed = (b: Boss, tool: string): Boss => (!EDIT_TOOLS.has(tool) || b.hasWorked ? b : { ...b, hasWorked: true })

/** A specialist was hired or resumed: new work has started, and the checkpoint is over. */
export const withNewWork = (b: Boss): Boss => ({ ...b, handedBackAt: undefined, isCheckpoint: false })

/**
 * Clawd's turn ended. It is a checkpoint when no hand-back still waits for its report (a hand-back heard in this very turn, or not yet
 * carried, is reported by a later one), Clawd edited no files in it, and it ended in an answer. A report that ends with a plain-text
 * question still counts; an open question box keeps the turn busy, so the button waits for it elsewhere. A checkpoint that stands lasts
 * through any turn that edits nothing, whatever way it ended.
 */
export function withTurnEnd(b: Boss, end: { reason: string }): Boss {
  const isWaiting = b.handedBackAt !== undefined && b.turns <= b.handedBackAt
  const isClosed = !b.hasWorked && !isWaiting && (end.reason === 'answer' || b.isCheckpoint === true)
  return { ...b, isCheckpoint: isClosed, hasWorked: undefined }
}

/** A prompt that is the person's own message to Clawd: not from a notification, a peer or a schedule, and not a slash command. */
export const isPersonMessage = (e: { text: string; origin?: { kind: string } }): boolean =>
  (e.origin === undefined || PERSON_ORIGINS.has(e.origin.kind)) && !e.text.trimStart().startsWith('/')

/** A background job's notification: a specialist finishing in the background raises one. */
export const isNotification = (e: { origin?: { kind: string } }): boolean => e.origin?.kind === 'task-notification'
