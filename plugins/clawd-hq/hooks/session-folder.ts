// The session's project folder, followed (issue #5). The desktop app can start a session in a spare folder and move it to the project
// afterwards, while session start fires only once, in the spare folder. So the folder is read again from the engine (its project root,
// which follows a host's move but not a shell `cd`), and a move files everything under the new folder. A setup run begun in the old
// folder is dropped. Also: the folder `/office-setup <folder>` looks at. No `$`: register-setup.ts fills the io.
import type { OnboardIo } from './onboard-types'

export type FolderIo = {
  /** The folder everything is filed under now. */
  readonly folder: () => string
  /** The engine's project root, read now. */
  readonly root: () => Promise<string>
  /** Where a path really lands, every link followed; `undefined` when that cannot be told. */
  readonly real: (path: string) => Promise<string | undefined>
  /** Files everything under the new folder (set before anything is awaited) and reloads what is kept per folder. */
  readonly moveTo: (folder: string) => Promise<void>
  /** Why the root could not be read, or a check took too long, for the debug log: each called once a session. */
  readonly warn: (text: string) => void
  /** A timer, for the time limit on one check. */
  readonly after: (ms: number, fn: () => void) => { readonly cancel: () => void }
}

/** How long one check may take (reading the root, and reloading after a move) before the next one goes ahead without it. */
export const FOLLOW_MS = 10_000

/** Set once a root that could not be read was logged this session. */
let isRootFailureTold = false
/** Set once a check that took too long was logged this session. */
let isTimeoutTold = false
/** Session start: a root that cannot be read, or a check that takes too long, is logged once again. */
export const startFolderWatch = () => { isRootFailureTold = false; isTimeoutTold = false }

const trimmed = (path: string) => path.replace(/(?<=.)[\\/]+$/, '')
/** Paths that differ only in case are taken for one folder: macOS and Windows fold case by default, and a wrong move costs more than a missed one. */
const sameSpelling = (a: string, b: string) => trimmed(a).toLowerCase() === trimmed(b).toLowerCase()

/** Whether two spellings name one folder: the same but for a trailing slash or case, or landing in the same place once links are followed. */
export async function isSameFolder(a: string, b: string, real: FolderIo['real']): Promise<boolean> {
  if (sameSpelling(a, b)) return true
  const [ra, rb] = await Promise.all([real(a).catch(() => undefined), real(b).catch(() => undefined)])
  return ra !== undefined && rb !== undefined && sameSpelling(ra, rb)
}

/** One check. `isLate`: it ran past its time limit and the next went ahead, so a root it reads only now is too old to act on. */
async function follow(io: FolderIo, isLate: () => boolean): Promise<boolean> {
  const now = await io.root().catch((err: unknown) => {
    if (!isRootFailureTold) io.warn(`Clawd HQ could not read the session's project folder, so it stays ${io.folder() || 'unset'}: ${err instanceof Error ? err.message : String(err)}`)
    isRootFailureTold = true
    return undefined
  })
  if (!now || isLate() || (await isSameFolder(now, io.folder(), io.real)) || isLate()) return false
  await io.moveTo(now)
  return true
}

/** One check with its time limit: past it, the check counts as no move and the queue goes on (a hung read or reload never holds it). */
function inTime(io: FolderIo): Promise<boolean> {
  let isLate = false
  return new Promise<boolean>((done, fail) => {
    const timer = io.after(FOLLOW_MS, () => {
      isLate = true
      if (!isTimeoutTold) io.warn(`Clawd HQ's check of the session's project folder took over ${FOLLOW_MS / 1000} seconds, so it went on without it; the folder stays ${io.folder() || 'unset'} until a later check.`)
      isTimeoutTold = true
      done(false)
    })
    follow(io, () => isLate).then(moved => { timer.cancel(); done(moved) }, (err: unknown) => { timer.cancel(); fail(err) })
  })
}

/** Checks run one at a time, each reading the root afresh, so a slow read can never undo a newer move. */
let line: Promise<unknown> = Promise.resolve()
/** A check waiting its turn: a caller meanwhile shares it (it reads the root when it starts, so it sees the latest), and the queue never grows. */
let waiting: Promise<boolean> | undefined

/** Follows the session to the folder the engine has it in now; true when it had moved. A root that cannot be read leaves the folder as it is. */
export function followFolder(io: FolderIo): Promise<boolean> {
  if (waiting !== undefined) return waiting
  const run = line.then(() => { waiting = undefined; return inTime(io) })
  waiting = run
  line = run.catch(() => undefined)
  return run
}

/** Why a dropped run's calls are refused. */
export const MOVED = 'the session moved to another folder'

type Guarded = Pick<OnboardIo, 'set' | 'setCard' | 'spawnScout' | 'complete' | 'registerHire' | 'savePayroll'>

/**
 * Setup's calls that write, start or ask something, refused once the session has left the folder the run began in: such a run is
 * dropped at its next call, so it files nothing, starts no scout or Opus call, and leaves the card to the new folder's run.
 */
export function guardRun<T extends Guarded>(isStale: () => boolean, io: T): T {
  const guard = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => (...a: A): Promise<R> => (isStale() ? Promise.reject(new Error(MOVED)) : fn(...a))
  return {
    ...io, set: guard(io.set), setCard: guard(io.setCard), spawnScout: guard(io.spawnScout),
    complete: guard(io.complete), registerHire: guard(io.registerHire), savePayroll: guard(io.savePayroll),
  }
}

const isAbsolute = (path: string) => /^([A-Za-z]:)?[\\/]/.test(path)

/** A folder given to `/office-setup`, made absolute: `~` is the home folder, a relative path is under the root; `.` and `..` are folded, quotes come off. */
export function resolveFolder(given: string, root: string, home: string): string {
  const bare = given.trim().replace(/^(["'])(.*)\1$/, '$2')
  const path = bare === '~' ? home : /^~[\\/]/.test(bare) ? `${home}${bare.slice(1)}` : bare
  const full = isAbsolute(path) ? path : `${root.replace(/[\\/]+$/, '')}/${path}`
  const lead = full.match(/^([A-Za-z]:)?[\\/]/)?.[0] ?? '/'
  const parts = full.slice(lead.length).split(/[\\/]+/)
    .reduce<readonly string[]>((kept, part) => (part === '' || part === '.' ? kept : part === '..' ? kept.slice(0, -1) : [...kept, part]), [])
  return `${lead}${parts.join('/')}`
}

/** What `/office-setup` looks at: nothing given is the session's own folder (`{}`); a folder given must be there, or it is `refused`. */
export async function setupFolder(args: string, root: string, home: string, isFolder: (path: string) => Promise<boolean>): Promise<{ readonly folder?: string; readonly refused?: string }> {
  if (args.trim() === '') return {}
  const folder = resolveFolder(args, root, home)
  return (await isFolder(folder).catch(() => false)) ? { folder } : { refused: folder }
}
