// When the "You should know" check forks Clawd's conversation, pure. It runs at the end of Clawd's own turn, right after he
// answered, while the main thread's prompt cache is warm: the fork re-sends that request, so the prefix is read from the cache.
import { OWN_TURN_TOOLS } from './know'

/** What the turn that just ended did: hand-backs received since the last check, and tools Clawd used himself in it. */
export type TurnWork = { handbacks: number; tools: number }

/** A turn is worth checking when a specialist handed work back since the last check, or Clawd did six or more steps himself. */
export const isWorthChecking = (w: TurnWork) => w.handbacks > 0 || w.tools >= OWN_TURN_TOOLS

/** What may hold a check that is worth making, read at the turn's end. `unseen` and `held` say why, when they hold it. */
export type Gates = {
  isAnswer: boolean
  /** Clawd is on, read live: "Clawd runs the chat" is on and the office is open. The prompt is about Clawd's office. */
  isClawdOn: boolean
  /** A compaction of the main chat came, and no turn of Clawd's has begun since: the cache holds the conversation from before it. */
  isAfterCompact: boolean
  unseen?: string
  held?: string
  /** The plugin's one side request is out (another check, a Learn more, or the coffee break's recap). */
  isBusy: boolean
}

/**
 * Why the check is not made now, first reason first, or nothing when it may run. A transient reason keeps the hand-backs for the
 * next turn's end; any other uses them up, as a check would have.
 */
export function whyNotNow(g: Gates): { reason: string; isTransient: boolean } | undefined {
  if (!g.isClawdOn) return { reason: 'Clawd does not run the chat', isTransient: false }
  if (!g.isAnswer) return { reason: 'the turn did not end with an answer', isTransient: true }
  if (g.isAfterCompact) return { reason: 'no main reply since the compaction', isTransient: true }
  if (g.unseen) return { reason: g.unseen, isTransient: false }
  if (g.held) return { reason: g.held, isTransient: false }
  if (g.isBusy) return { reason: 'another side request is running', isTransient: true }
  return undefined
}
