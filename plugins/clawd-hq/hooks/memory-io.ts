// Memory: the project's decisions, a plain file in its .clawd-hq folder, mirrored in state for the pane.
// What each call may do is an object of closures (the engine's `$` stays in register.tsx).
import type { Memory } from '../types'
import { LOGBOOK_FILE, loadLogbook, saveLogbook, withDecision } from './logbook'
import type { LogbookIo } from './logbook'
import { MAX_MEMORY } from './constants'

export type MemoryIo = {
  logbook: LogbookIo
  /** Puts the list in the state the pane draws. */
  keep: (list: Memory[]) => Promise<void>
  /** Shows the text once a session: the first failure is told, the rest are not. */
  warnOnce: (text: string) => void
  /** The Decisions tab's title follows the count. */
  retitle: () => Promise<void>
  now: () => Promise<number>
  /** The name an agent's own note is filed under; 'agent' when it is not on the books. */
  byOf: (agentId: string) => Promise<string>
}

export const loadMemory = async (io: MemoryIo): Promise<Memory[]> => (await loadLogbook(io.logbook)).list

export async function saveMemory(io: MemoryIo, fn: (list: Memory[]) => Memory[]) {
  const book = await loadLogbook(io.logbook)
  const list = fn(book.list).slice(-MAX_MEMORY)
  await io.keep(list)
  // The decision stays in this session; the person hears of it once.
  if (!(await saveLogbook(io.logbook, book, list))) io.warnOnce(`Could not save decisions to ${LOGBOOK_FILE}. They are kept for this session only.`)
  await io.retitle()
}

export async function remember(io: MemoryIo, m: Omit<Memory, 'id' | 'at'>, supersedes?: string) {
  const at = await io.now()
  const text = m.text.replace(/\s+/g, ' ').trim()
  if (!text) return
  await saveMemory(io, list => withDecision(list, { ...m, text }, at, supersedes))
}
