// A small record of what the quiet chat decided for peer and notification rows, so a live session (the desktop app's above all) can be
// read and not guessed. Kept in the store under one key, the latest few only, never holding a word of the row: its kind, sender, flags and look.
// register-quiet.ts hands in every call as `io` (`$` never leaves the register-*.ts files).
import { hasHandbackLine } from './quiet'
import type { ChatRow } from './quiet'

/** Where the records live in the plugin's store (the file is ~/.claude/plugins/store/clawd-hq_inline-*.json). */
export const QUIET_DEBUG_KEY = 'debug:quiet'

const KEPT = 20
const TRACED: ReadonlySet<string> = new Set(['peer', 'task-notification'])

export type QuietRecord = {
  at: number
  kind: string
  /** The sender's name as the row gives it, null for none. */
  from: string | null
  /** The row opens with the engine's hand-back line. */
  isHandbackLine: boolean
  status: string | null
  type: string | null
  isExpanded: boolean
  look: 'hide' | 'show'
}

export type QuietDebugIo = {
  now: () => Promise<number>
  get: (key: string) => Promise<unknown>
  save: (key: string, value: QuietRecord[]) => Promise<unknown>
}

/** The record of one decision, or none for a row of another kind. */
export function quietRecord(row: ChatRow, look: QuietRecord['look'], at: number): QuietRecord | undefined {
  if (!TRACED.has(row.originKind)) return undefined
  return {
    at, kind: row.originKind, from: row.from?.name ?? null, isHandbackLine: hasHandbackLine(row.text),
    status: row.task?.status ?? null, type: row.task?.type ?? null, isExpanded: row.isExpanded, look,
  }
}

/** What a record says, less when: a row drawn again (a scroll, a redraw) decides the same and is not written again. */
const signature = ({ at: _at, ...rest }: QuietRecord) => JSON.stringify(rest)

async function append(io: QuietDebugIo, record: QuietRecord): Promise<void> {
  try {
    const stored = await io.get(QUIET_DEBUG_KEY)
    const list = Array.isArray(stored) ? (stored as QuietRecord[]) : []
    await io.save(QUIET_DEBUG_KEY, [...list, { ...record, at: await io.now() }].slice(-KEPT))
  } catch { /* the last list stays; this is only a way to look */ }
}

/**
 * A keeper for one session (`reset` at a session start, a clear or a resume): each new decision is added to the stored list, newest
 * last, the latest 20 kept. `keep` never holds the row: the writes go one after another on one chain, so two at the same moment do
 * not overwrite each other, and `flush` is that chain. A diagnostic must never stop a hook, so a write that fails leaves the old list.
 */
export function quietRecorder() {
  let seen = new Set<string>()
  let chain: Promise<void> = Promise.resolve()
  return {
    keep(io: QuietDebugIo, row: ChatRow, look: QuietRecord['look']): void {
      const record = quietRecord(row, look, 0)
      if (record === undefined || seen.has(signature(record))) return
      seen = new Set([...seen, signature(record)])
      chain = chain.then(() => append(io, record))
    },
    reset(): void { seen = new Set() },
    flush: (): Promise<void> => chain,
  }
}
