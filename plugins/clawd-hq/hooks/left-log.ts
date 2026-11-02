// Left undone, the log of its checks (no `$`): one row each time the check was meant to run, so how often it raises a false
// alarm can be counted. Modelled on the "You should know" log (hooks/know.ts, hooks/know-check.ts). A row holds when it ran,
// what came of it and how many items it found; never the person's request or the report.
import { fit } from './desk'
import { inLine } from './state'

/** Rows kept, the newest: the same as the "You should know" log. */
export const LEFT_LOG_KEEP = 20
const REASON_CHARS = 80

export type LeftLogEntry = {
  at: number
  /** `found`, `none`, `skipped` or `failed`. */
  outcome: 'found' | 'none' | 'skipped' | 'failed'
  /** Why it was skipped or failed. */
  reason?: string
  /** Items the check found. */
  count: number
}

/** What the log may do: the store, read and written under one key. */
export type LeftLogIo = {
  folder: () => string
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<unknown>
}

/** Kept per project folder, as the list is. */
export const logKey = (folder: string) => `leftUndone:log:${folder}`

const isEntry = (one: unknown): one is LeftLogEntry =>
  typeof one === 'object' && one !== null && typeof (one as LeftLogEntry).at === 'number' && typeof (one as LeftLogEntry).outcome === 'string' && typeof (one as LeftLogEntry).count === 'number'

/** The log as the store gave it: a list of rows, anything else read as empty. */
export const cleanLog = (raw: unknown): LeftLogEntry[] => (Array.isArray(raw) ? raw.filter(isEntry) : [])

/** The log with one more row, the newest `LEFT_LOG_KEEP` kept. */
export const withLeftLog = (log: readonly LeftLogEntry[], entry: LeftLogEntry): LeftLogEntry[] => [...log, entry].slice(-LEFT_LOG_KEEP)

/**
 * Adds one row, on the log as it stands when its turn comes. A store that will not read or write only means the row is lost:
 * the log never stops a check. Never throws. A row is filed under `folder`, the project the check was made in: a row written
 * later (after a wait in the line) must not land in the log of a project opened since.
 */
export function logCheck(io: LeftLogIo, row: { outcome: LeftLogEntry['outcome']; reason?: string; count?: number }, folder: string): Promise<void> {
  return inLine(async () => {
    const at = await io.now()
    const before = cleanLog(await io.get(logKey(folder)))
    const reason = row.reason === undefined ? {} : { reason: fit(row.reason, REASON_CHARS) }
    await io.set(logKey(folder), withLeftLog(before, { at, outcome: row.outcome, ...reason, count: row.count ?? 0 }))
  }).catch(() => undefined)
}
