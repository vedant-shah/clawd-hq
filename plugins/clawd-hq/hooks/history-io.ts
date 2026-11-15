// Writing the history (records: hooks/history.ts). Each session writes only its own file, `.clawd-hq/history-<session>.jsonl`, so two sessions
// never race on one; readers read every history file there. The host has no append, so adding lines is one read and one write of the file:
// records wait in memory and go in batches of at most 500, one batch at a time through the history's own queue (only it writes these files,
// and a slow disk then holds no other writing of the plugin's).
//
// A write is never trusted blindly. The text last written is remembered: a file that reads back shorter than it (cut short by a failed write)
// is rebuilt from it. A failed write is tried once more at once; a batch that still fails waits, and flushes back off (30 seconds, doubling, at
// most 5 minutes) unless forced (the session's end). Past 2 MB a file is kept, byte for byte, as `history-<session>-<n>.jsonl`; the name is
// chosen once, so a retry writes the same file again. No history file is ever deleted.
//
// Each record carries the project folder it was made in and is written there. A `.clawd-hq` folder or a history file that is a link out of
// the project is refused, with a debug note. The first time a folder gets a history, `.clawd-hq/.gitignore` gets the rule `history*.jsonl`:
// written when there is no file, added as one line to a file without it, never written again once done (a file the person deletes stays gone).
//
// What waits is in this process's memory: a crash loses the records since the last batch; past the cap the oldest go, and how many is
// written as a `dropped` record once writing works again.
import {
  IGNORE_RULE, READ_LIMIT, ROTATE_BYTES, droppedRecord, ignoresHistory, isHistoryFile, isTabKind, lineOf, nextRotation, parseFiles, rotatedName, sessionFile, utf8Length,
} from './history'
import type { HistoryRecord } from './history'

export type HistoryEntry = { name: string; kind: string; size: number; mtimeMs: number; isLink?: boolean }

export type HistoryIo = {
  /** The session's project folder now, for reading back; '' when there is none. */
  root: () => string
  now: () => Promise<number>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<readonly HistoryEntry[]>
  /** Where a path really lands (links followed): to refuse a folder or file that leads out of the project. */
  stat: (path: string) => Promise<{ kind: string; isLink: boolean; realPath?: string }>
  /** A mark kept across sessions (the plugin's store): the ignore file was dealt with in this folder. */
  isMarked: (key: string) => Promise<boolean>
  mark: (key: string) => Promise<void>
  /** A line about a failure that was swallowed, for the history's own debug record. */
  debug?: (line: string) => Promise<void>
}

export type HistoryLimits = { maxWaiting: number; perFlush: number }
const LIMITS: HistoryLimits = { maxWaiting: 10_000, perFlush: 500 }
/** After a failed flush: wait 30 seconds, then twice as long each time, at most 5 minutes. */
export const BACKOFF_MS = { first: 30_000, most: 5 * 60_000 }

/** How a flush went: all written, some written and more waiting, waiting out a backoff, or failed. */
export type Flushed = 'done' | 'more' | 'waiting' | 'failed'

type Entry = { seq: number; root: string; record: HistoryRecord }
type FileState = { lastText?: string; isSuspect?: boolean; rotateTo?: string }

export const historyDir = (root: string) => `${root}/.clawd-hq`
const ignoreKey = (root: string) => `history:gitignore:${root}`
const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
const said = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Where the history goes in this folder, or why not: `.clawd-hq` and the file must lie inside the project, not lead out of it by a link. */
async function placed(io: HistoryIo, root: string, name: string): Promise<{ ok: true; dir: string } | { ok: false; why: string }> {
  const base = (await io.stat(root)).realPath
  if (base === undefined) return { ok: false, why: 'the project folder could not be placed' }
  const inside = norm(base)
  const dir = historyDir(norm(root))
  if (await io.exists(dir)) {
    const real = (await io.stat(dir)).realPath
    if (real === undefined || norm(real).toLowerCase() !== `${inside}/.clawd-hq`.toLowerCase()) return { ok: false, why: '.clawd-hq leads out of the project' }
  }
  const path = `${dir}/${name}`
  if (await io.exists(path)) {
    const s = await io.stat(path)
    if (s.kind !== 'file' || s.isLink || s.realPath === undefined || norm(s.realPath).toLowerCase() !== `${inside}/.clawd-hq/${name}`.toLowerCase()) return { ok: false, why: `${name} is not a plain file in the project` }
  }
  return { ok: true, dir }
}

/**
 * The history files a reader may read in this folder, as `placed` checks a writer's: none when `.clawd-hq` leads out of the project; of the
 * entries, plain files only (no link, no folder), each within the read limit.
 */
async function readable(io: HistoryIo, root: string): Promise<{ dir: string; entries: readonly HistoryEntry[] }> {
  const dir = historyDir(root)
  try {
    const base = (await io.stat(root)).realPath
    if (base === undefined || !(await io.exists(dir))) return { dir, entries: [] }
    const real = (await io.stat(dir)).realPath
    if (real === undefined || norm(real).toLowerCase() !== `${norm(base)}/.clawd-hq`.toLowerCase()) {
      await io.debug?.('history: not read: .clawd-hq leads out of the project').catch(() => undefined)
      return { dir, entries: [] }
    }
    const entries = (await io.list(dir)).filter(e => isHistoryFile(e.name) && e.kind === 'file' && e.isLink !== true && e.size <= READ_LIMIT)
    return { dir, entries }
  } catch {
    return { dir, entries: [] }
  }
}

/** `.clawd-hq/.gitignore`, once per folder: written when absent, the one rule added to a file without it, every other line kept as it is. */
async function ignoreOnce(io: HistoryIo, dir: string, root: string): Promise<void> {
  try {
    if (await io.isMarked(ignoreKey(root))) return
    const path = `${dir}/.gitignore`
    if (!(await io.exists(path))) await io.write(path, `${IGNORE_RULE}\n`)
    else {
      const text = await io.read(path)
      const eol = text.includes('\r\n') ? '\r\n' : '\n'
      if (!ignoresHistory(text)) await io.write(path, `${text}${text === '' || text.endsWith('\n') ? '' : eol}${IGNORE_RULE}${eol}`)
    }
    await io.mark(ignoreKey(root))
  } catch (err) {
    await io.debug?.(`history: the .gitignore was not dealt with: ${said(err)}`).catch(() => undefined)
  }
}

/** A write, and at once a second try when the first fails. */
async function writeTwice(io: HistoryIo, path: string, text: string): Promise<void> {
  try {
    await io.write(path, text)
  } catch {
    await io.write(path, text)
  }
}

/** A history for one plugin load: `add` records made in a folder, `flush` them, `readSince` a time. */
export function makeHistory(io: HistoryIo, limits: HistoryLimits = LIMITS, onWritten?: (root: string, records: readonly HistoryRecord[]) => void) {
  let waiting: readonly Entry[] = []
  let seq = 0
  let dropped = 0
  let retryAt = 0
  let backoff = 0
  const files = new Map<string, FileState>()
  /** The batch being written, by number; the ones the cap trimmed meanwhile are lost only if their write then fails. */
  let inFlight = new Set<number>()
  let trimmedInFlight: number[] = []
  /** One batch at a time: the history's own queue. */
  let line: Promise<unknown> = Promise.resolve()
  const inLine = <T>(task: () => Promise<T>): Promise<T> => {
    const run = line.then(task, task)
    line = run.catch(() => undefined)
    return run
  }

  /** Records made in `root`; none are kept for a session with no project folder. Past the cap the oldest go, and are counted. */
  const add = (root: string, records: readonly HistoryRecord[]) => {
    if (root === '' || records.length === 0) return
    const all = [...waiting, ...records.map(record => ({ seq: (seq += 1), root, record }))]
    const over = Math.max(0, all.length - limits.maxWaiting)
    const trimmed = all.slice(0, over)
    dropped += trimmed.filter(e => !inFlight.has(e.seq)).length
    trimmedInFlight = [...trimmedInFlight, ...trimmed.filter(e => inFlight.has(e.seq)).map(e => e.seq)]
    waiting = all.slice(over)
  }

  /** One session's records into its file: added, or the file kept under its rotation name and a new one started. Throws when it cannot. */
  const writeSession = async (dir: string, session: string, records: readonly HistoryRecord[]) => {
    const name = sessionFile(session)
    const path = `${dir}/${name}`
    const state = files.get(path) ?? {}
    const read = (await io.exists(path)) ? await io.read(path).catch(() => undefined) : ''
    const known = state.lastText
    const isShort = read === undefined || (known !== undefined && utf8Length(read) < utf8Length(known))
    // The file as it should be: what was read, or (cut short, unreadable, or after a failed write) what was last written in full.
    const base = known !== undefined && (state.isSuspect || isShort) ? known : read
    if (base === undefined) throw new Error(`${name} could not be read`)
    const eol = base.includes('\r\n') ? '\r\n' : '\n'
    const lines = records.map(lineOf).join(eol) + eol
    const head = base === '' || base.endsWith('\n') ? base : base + eol
    if (base !== '' && utf8Length(head) + utf8Length(lines) > ROTATE_BYTES) {
      const to = state.rotateTo ?? rotatedName(session, nextRotation((await io.list(dir)).map(e => e.name), session))
      files.set(path, { ...state, rotateTo: to, lastText: base })
      await writeTwice(io, `${dir}/${to}`, base)
      try {
        await writeTwice(io, path, lines)
      } catch (err) {
        files.set(path, { lastText: base, isSuspect: true, rotateTo: to })
        throw err
      }
      files.set(path, { lastText: lines })
      return
    }
    try {
      await writeTwice(io, path, head + lines)
    } catch (err) {
      files.set(path, { ...state, lastText: base, isSuspect: true })
      throw err
    }
    files.set(path, { lastText: head + lines })
  }

  /** One folder's records, by session. Records refused (a link out of the project) are dropped with a note; ones that fail stay. */
  const writeRoot = async (root: string, entries: readonly Entry[]): Promise<{ done: number[]; failed: boolean }> => {
    const sessions = [...new Set(entries.map(e => e.record.session))]
    const done: number[] = []
    let failed = false
    for (const session of sessions) {
      const mine = entries.filter(e => e.record.session === session)
      try {
        const place = await placed(io, root, sessionFile(session))
        if (!place.ok) {
          await io.debug?.(`history: ${mine.length} records not written: ${place.why}`).catch(() => undefined)
          done.push(...mine.map(e => e.seq))
          continue
        }
        await ignoreOnce(io, place.dir, root)
        await writeSession(place.dir, session, mine.map(e => e.record))
        done.push(...mine.map(e => e.seq))
        onWritten?.(root, mine.map(e => e.record))
      } catch (err) {
        failed = true
        await io.debug?.(`history: ${mine.length} records wait, the file could not be written: ${said(err)}`).catch(() => undefined)
      }
    }
    return { done, failed }
  }

  /** Writes up to one batch of what waits. `isForced` (the session's end) does not wait out a backoff. */
  const flush = (isForced = false): Promise<Flushed> => inLine(async (): Promise<Flushed> => {
    if (waiting.length === 0) return 'done'
    const now = await io.now()
    if (!isForced && now < retryAt) return 'waiting'
    const batch = waiting.slice(0, limits.perFlush)
    inFlight = new Set(batch.map(e => e.seq))
    const roots = [...new Set(batch.map(e => e.root))]
    const results = []
    for (const root of roots) results.push(await writeRoot(root, batch.filter(e => e.root === root)))
    const written = new Set(results.flatMap(r => r.done))
    dropped += trimmedInFlight.filter(n => !written.has(n)).length
    ;[inFlight, trimmedInFlight] = [new Set(), []]
    // Only what was written leaves, by its number: records added (or trimmed) meanwhile are left as they are.
    waiting = waiting.filter(e => !written.has(e.seq))
    if (results.some(r => r.failed)) {
      backoff = backoff === 0 ? BACKOFF_MS.first : Math.min(backoff * 2, BACKOFF_MS.most)
      retryAt = now + backoff
      return 'failed'
    }
    [backoff, retryAt] = [0, 0]
    if (dropped > 0 && batch.length > 0) {
      const first = batch[0]!
      add(first.root, [droppedRecord({ at: now, session: first.record.session }, dropped)])
      dropped = 0
    }
    return waiting.length === 0 ? 'done' : 'more'
  })

  /** The records since `at` in the current folder: every history file changed since then (newest first, none over the read limit), and what still waits; sorted by time. */
  const readSince = async (at: number): Promise<HistoryRecord[]> => {
    const root = io.root()
    const kept = waiting.filter(e => e.root === root && e.record.at >= at).map(e => e.record)
    if (root === '') return kept
    const { dir, entries } = await readable(io, root)
    // A file not changed since `at` holds nothing newer: the search stops at the files older than what is needed. A time of 0 is unknown: read.
    const recent = entries.filter(e => e.mtimeMs === 0 || e.mtimeMs >= at).sort((a, b) => b.mtimeMs - a.mtimeMs)
    const texts = await Promise.all(recent.map(e => io.read(`${dir}/${e.name}`).catch(() => '')))
    const read = parseFiles(texts).filter(r => r.at >= at)
    return [...read, ...kept].sort((a, b) => a.at - b.at)
  }

  /**
   * The newest records of the current folder that the History tab draws from (`isTabKind`): the history files there, newest first, as many as
   * fit in `maxBytes` (never more), and what still waits; sorted by time. Older files past the cap are not read: the tab shows the newest.
   */
  const readRecent = async (maxBytes: number): Promise<HistoryRecord[]> => {
    const root = io.root()
    const kept = waiting.filter(e => e.root === root).map(e => e.record).filter(isTabKind)
    if (root === '') return kept
    const { dir, entries } = await readable(io, root)
    const files = [...entries].sort((a, b) => b.mtimeMs - a.mtimeMs)
    const picked = files.reduce<{ names: string[]; bytes: number }>((at, e) => (at.bytes + e.size > maxBytes ? at : { names: [...at.names, e.name], bytes: at.bytes + e.size }), { names: [], bytes: 0 })
    const texts = await Promise.all(picked.names.map(name => io.read(`${dir}/${name}`).catch(() => '')))
    return [...parseFiles(texts).filter(isTabKind), ...kept].sort((a, b) => a.at - b.at)
  }

  return { add, flush, readSince, readRecent, pending: () => waiting.length, retryIn: async () => Math.max(0, retryAt - (await io.now())) }
}

export type History = ReturnType<typeof makeHistory>

/**
 * The History tab's records for one folder: read once, on the tab's first draw, then grown by what this session writes. The folder is taken
 * before the read begins, so records written during it are held and added after it, those the read did not already hold.
 */
export function makeTabCache() {
  type Shown = { root: string; records: readonly HistoryRecord[]; held?: readonly HistoryRecord[]; reading?: Promise<void> }
  let shown: Shown | undefined

  const get = async (root: string, read: () => Promise<HistoryRecord[]>): Promise<readonly HistoryRecord[]> => {
    if (shown?.root === root) {
      await shown.reading
      return shown.records
    }
    const reading = (async () => {
      const got = await read().catch(() => [] as HistoryRecord[])
      if (shown?.root !== root) return
      const lines = new Set(got.map(lineOf))
      shown = { root, records: [...got, ...(shown.held ?? []).filter(r => !lines.has(lineOf(r)))] }
    })()
    shown = { root, records: [], held: [], reading }
    await reading
    return shown?.root === root ? shown.records : []
  }

  /** Records this session wrote in `root`: whether what the tab shows changed (none of the tab's kinds, or no read yet: no). */
  const add = (root: string, records: readonly HistoryRecord[]): boolean => {
    const mine = records.filter(isTabKind)
    if (mine.length === 0 || shown?.root !== root) return false
    if (shown.held !== undefined) {
      shown = { ...shown, held: [...shown.held, ...mine] }
      return false
    }
    shown = { ...shown, records: [...shown.records, ...mine] }
    return true
  }

  return { get, add }
}
