// When a piece of work has closed, pure: the coffee break button is offered only at such a checkpoint, never between the steps of a job.
// A specialist handing its work back starts it; Clawd's own turn that reports it closes it, even if it ends with a question; the person's
// next message ends it. Clawd's card (the boss) keeps the marks.
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

/** The person sent a message: what closed before it is behind us. `kind` is where it came from, kept for the record of the button. */
export const withPersonSpoke = (b: Boss, kind?: string): Boss =>
  ({ ...b, handedBackAt: undefined, carriedAt: undefined, isCheckpoint: false, spokeBy: kind ?? 'none' })

/**
 * Clawd's turn ended. It closes a piece of work when a specialist handed work back in an earlier turn (the turn it arrived in is not
 * the report: the report is a turn that started after it) and the turn ended in an answer. A report that ends with a plain-text
 * question ("what next?") still counts; an open question box keeps the turn busy, so the button waits for it elsewhere.
 * A turn that is not that leaves no checkpoint standing.
 */
export function withTurnEnd(b: Boss, end: { reason: string }): Boss {
  const isReport = b.handedBackAt !== undefined && b.turns > b.handedBackAt
  const isClosed = isReport && end.reason === 'answer'
  return b.isCheckpoint === isClosed ? b : { ...b, isCheckpoint: isClosed }
}

/** A prompt that is the person's own message to Clawd: not from a notification, a peer or a schedule, and not a slash command. */
export const isPersonMessage = (e: { text: string; origin?: { kind: string } }): boolean =>
  (e.origin === undefined || PERSON_ORIGINS.has(e.origin.kind)) && !e.text.trimStart().startsWith('/')

/** A background job's notification: a specialist finishing in the background raises one. */
export const isNotification = (e: { origin?: { kind: string } }): boolean => e.origin?.kind === 'task-notification'
