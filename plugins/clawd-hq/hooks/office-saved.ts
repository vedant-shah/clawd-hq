// The office's open or closed state, kept per session id in the plugin's own store, so a plugin reload, `claude --resume` (the same id)
// and a compaction find it as the person left it. Only the person changes it (`/office`, closing the Office pane). A new id has nothing
// saved and starts from the switch. One small record under one key; a session not seen for 30 days is dropped at each save.
import type { EngineInterface } from 'claude-code'

export const SAVED_KEY = 'office:sessions'
export const SAVED_MS = 30 * 24 * 60 * 60 * 1000

type SavedOne = { open: boolean; seen: number }
type SavedList = Readonly<Record<string, SavedOne>>

const isSavedOne = (v: unknown): v is SavedOne =>
  typeof v === 'object' && v !== null && typeof (v as SavedOne).open === 'boolean' && typeof (v as SavedOne).seen === 'number'

/** The saved state for a session, or none when nothing whole is saved under its id. */
export function savedStateOf(raw: unknown, id: string): boolean | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const one = (raw as Record<string, unknown>)[id]
  return isSavedOne(one) ? one.open : undefined
}

/** The list with this session's state set at `now`, and every session not seen for 30 days dropped (and anything not whole). A new list; the old one is not changed. */
export function withSaved(raw: unknown, id: string, open: boolean, now: number): SavedList {
  const entries = typeof raw === 'object' && raw !== null ? Object.entries(raw as Record<string, unknown>) : []
  const kept = entries.filter((entry): entry is [string, SavedOne] => entry[0] !== id && isSavedOne(entry[1]) && now - entry[1].seen <= SAVED_MS)
  return { ...Object.fromEntries(kept), [id]: { open, seen: now } }
}

/** The id the engine gives this session; none where it cannot say (nothing is saved or read then). */
async function idOf($: EngineInterface): Promise<string | undefined> {
  try {
    const id = await $.session.id()
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

/** What is saved for this session: open, closed, or none (nothing saved, no id, or a store that cannot be read). */
export async function savedOpen($: EngineInterface): Promise<boolean | undefined> {
  const id = await idOf($)
  if (id === undefined) return undefined
  try {
    return savedStateOf(await $.store.get(SAVED_KEY), id)
  } catch {
    return undefined
  }
}

/** Keeps this session's state. A store that refuses only means it is not kept: the office still opens or closes now. Never rejects. */
export async function saveOpen($: EngineInterface, open: boolean): Promise<void> {
  const id = await idOf($)
  if (id === undefined) return
  try {
    const now = await $.clock.now()
    await $.store.set(SAVED_KEY, withSaved(await $.store.get(SAVED_KEY), id, open, now))
  } catch {
    // not kept; see above
  }
}
