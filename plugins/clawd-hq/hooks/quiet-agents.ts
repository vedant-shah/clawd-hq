// The session's agent list as the quiet chat reads it: at most once a short while, so a redraw or a scroll of the same rows does not ask
// again. Not pure: the cache is the caller's (register-state.ts keeps one, emptied at a session start, a clear or a resume).
import type { ListedAgent } from './quiet'

/** How long one read of the list serves. */
export const AGENT_LIST_MS = 2_000

type Load = () => Promise<readonly ListedAgent[]>

/** A cached read: calls within `ttlMs` of the last read share it, those at the same moment included; a read that fails gives none. */
export function agentListCache(ttlMs = AGENT_LIST_MS) {
  let last: { at: number; list: Promise<readonly ListedAgent[]> } | undefined
  return (now: number, load: Load): Promise<readonly ListedAgent[]> => {
    if (last === undefined || now - last.at >= ttlMs) last = { at: now, list: load().catch(() => []) }
    return last.list
  }
}
