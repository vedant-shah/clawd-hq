// The quiet chat: which rows of the main chat are filler the person need not see. Pure; register.tsx draws (or hides) them.
// The full view (ctrl+o, --verbose) is never changed, and a failure is never hidden.
import type { Employee } from '../types'

/** What Clawd writes, and nothing else, when a specialist's message leaves nothing to tell the person. */
export const NO_UPDATE = '[no update]'

const ONLY_MARK = /^\[no update\]\.?$/i

/** A reply that is the mark alone. */
export const isNoUpdate = (text: string) => ONLY_MARK.test(text.trim())

export type ChatRow = {
  /** The view draws the row in full: left alone. */
  isExpanded: boolean
  originKind: string
  /** What the row shows. */
  text: string
  /** The background task a notice reports on. */
  task?: { id?: string; status?: string }
  /** Who sent the message, when it was not the person. */
  from?: { name: string }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
/** A message that asks for something is never filler: a question, or a request for permission, approval or shutdown. */
const ASKS = /\?|\b(permission|approv|shut ?down)/i

/**
 * A row that only hands work back to Clawd: the "finished" notice of a specialist the office hired, when it ended
 * well, or a message from a teammate the office hired by name. Clawd reports on it and the Settings tab lists it, so the
 * raw row can go. A hidden request would be a lost action, so the rule is narrow: anything it is unsure of is shown.
 */
export function isHandback(row: ChatRow, staff: Employee[]): boolean {
  if (row.isExpanded) return false
  if (row.task) return row.originKind === 'task-notification' && row.task.status === 'completed' && staff.some(one => one.id === row.task!.id)
  const name = row.from?.name
  // A teammate's message carries no stamp of where it came from; another session's, a channel's or the person's does.
  if (name === undefined || row.originKind !== 'unclassified' || ASKS.test(row.text)) return false
  return staff.some(one => one.name !== undefined && same(one.name, name))
}
