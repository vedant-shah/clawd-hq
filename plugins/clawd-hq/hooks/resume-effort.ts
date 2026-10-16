// The effort level a resumed specialist works at: the new line if the follow-up has one, else the one it was hired with.
import type { Employee } from '../types'
import type { Effort } from './desk'

/**
 * `said` is the level on the follow-up's own [effort: …] line. Without it, the first of `ids` (the id the engine answered
 * with, then the id that was resumed) that has a level wins: the in-memory one, else the one on the staff record.
 */
export function resumedEffort(
  said: Effort | undefined, ids: ReadonlyArray<string | undefined>, rows: readonly Employee[], memory: ReadonlyMap<string, Effort>,
): Effort | undefined {
  if (said) return said
  for (const id of ids) {
    if (!id) continue
    const level = memory.get(id) ?? rows.find(one => one.id === id)?.effort
    if (level) return level
  }
  return undefined
}
