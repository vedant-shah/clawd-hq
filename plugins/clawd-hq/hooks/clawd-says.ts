// How Clawd feels and what he says; pure, so the panel only draws it.
import type { Boss } from '../types'
import { CLAWD_LINES, fill, hash, lineOf } from './office'
import type { ClawdMood } from './office'

/** An office left this long with nobody at work puts Clawd to sleep. */
export const NAP_MS = 120_000
const BLINK_EVERY = 11

export function clawdMood(b: Boss, active: number, t: number, now: number): ClawdMood {
  if (t < b.oopsUntil) return 'oops'
  if (t < b.proudUntil) return 'proud'
  if (active >= 4) return 'stressed'
  if (t < b.waveUntil) return 'delegating'
  if (b.isBusy) return 'focused'
  if (active === 0 && b.idleSince > 0 && now - b.idleSince > NAP_MS) return 'sleepy'
  return active > 0 ? 'delegating' : 'chill'
}

/** What the bubble says: a fresh quip, else a line for the mood that holds for a while. */
export function quipOf(b: Boss, mood: ClawdMood, t: number, vars: Record<string, string | number>): string {
  if (b.quip && t < b.quip.until) return b.quip.text
  const seed = Math.floor(t / 20) + (mood === 'proud' || mood === 'oops' ? 0 : hash(mood))
  return fill(lineOf(CLAWD_LINES[mood], seed), vars)
}

/** Clawd's only liveness: an occasional blink. */
export const isBlinking = (t: number) => t % BLINK_EVERY === 0
