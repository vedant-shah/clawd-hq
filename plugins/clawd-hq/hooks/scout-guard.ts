// The scout's guard, pure: the scout may read inside the project folder and nothing else, and never a secret.
// The spelling is judged here; `guardScout` then asks where the path really lands (a link inside the folder can lead out of it).
// Best effort on names: a secret under an odd name is not caught, which is why Grep only ever returns file names.
import { TEAM_TOOL } from './constants'

/** What a scout's call may do: be refused with a plain reason, or run (with these fields set over its own). */
export type ScoutVerdict =
  | { readonly deny: string }
  | { readonly run: Readonly<Record<string, unknown>>; readonly check: readonly string[]; readonly read?: string }

const REFUSED = 'Refused by Clawd HQ: '
const deny = (why: string): ScoutVerdict => ({ deny: `${REFUSED}${why}` })
const OUTSIDE = 'the scout may only look inside the project folder.'
const SECRET = 'that looks like a secret (keys, credentials, .env files, browser data), and the scout never opens those.'
const NOT_THERE = 'that is not a file or folder inside the project.'
const ONLY_READS = 'the scout only reads. It may use Read, Grep, Glob and team_pick.'

// ---- Paths ----

const slashes = (p: string) => p.replace(/\\/g, '/')
const hasDrive = (p: string) => /^[A-Za-z]:/.test(p)

/** The path against the folder as one absolute spelling, dots folded; `undefined` for one that cannot be placed (`~`, a network path, drive-relative, empty). */
export function resolveIn(folder: string, path: string): string | undefined {
  const p = slashes(path.trim())
  if (p === '' || p.includes('\0') || p.startsWith('~') || p.startsWith('//') || /^[A-Za-z]:(?!\/)/.test(p)) return undefined
  const isAbsolute = p.startsWith('/') || hasDrive(p)
  const full = isAbsolute ? p : `${slashes(folder).replace(/\/+$/, '')}/${p}`
  const drive = hasDrive(full) ? full.slice(0, 2) : ''
  const parts = full.slice(drive.length).split('/').reduce<readonly string[]>((out, seg) => {
    if (seg === '' || seg === '.') return out
    return seg === '..' ? out.slice(0, -1) : [...out, seg]
  }, [])
  return `${drive}/${parts.join('/')}`
}

/** Whether `path` is the folder or lies under it; compared without regard to case when the folder has a drive letter. */
export function isInside(folder: string, path: string): boolean {
  const [f, p] = hasDrive(folder) ? [folder.toLowerCase(), path.toLowerCase()] : [folder, path]
  return p === f || p.startsWith(f === '/' ? '/' : `${f}/`)
}

// ---- Secrets ----

const SECRET_FILE = new RegExp([
  '^\\.env',
  '\\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|tfstate|keychain|keychain-db)$',
  '^id_(rsa|dsa|ecdsa|ed25519)(\\.pub)?$',
  '^adbkey',
  '^\\.(npmrc|pypirc|netrc|pgpass|htpasswd|git-credentials)$',
  '^\\.?credentials?(\\.(json|ya?ml|txt|xml|ini|toml))?$',
  '^secrets?\\.(json|ya?ml|env|txt|toml|ini)$',
  'service-account[^/]*\\.json$',
  '^settings\\.local\\.json$',
  '^(cookies(\\.sqlite)?|login data|logins\\.json|key[34]\\.db|local state|web data)$',
].join('|'), 'i')

const SECRET_FOLDER = new RegExp(
  '(^|/)(\\.ssh|\\.aws|\\.gnupg|\\.gcloud|\\.azure|\\.kube|\\.docker|\\.android|\\.git|\\.password-store|\\.secrets|\\.mozilla|\\.thunderbird'
  + '|library/(keychains|cookies|safari)|application support/(google/chrome|firefox|brave-software|microsoft edge)'
  + '|\\.config/(google-chrome|chromium|bravesoftware|microsoft-edge))(/|$)',
  'i',
)

/** Whether an absolute, folded path names a secret: a file of that kind, or anything under a folder that keeps them. */
export function isSecretPath(path: string): boolean {
  const p = slashes(path)
  return SECRET_FOLDER.test(p) || SECRET_FILE.test(p.slice(p.lastIndexOf('/') + 1))
}

// ---- The call ----

/** The path in an input field, resolved; a missing or odd field is `undefined`. */
const placed = (folder: string, v: unknown): string | undefined => (typeof v === 'string' ? resolveIn(folder, v) : undefined)

/** A path that may be looked at: inside the folder and no secret. */
function allowed(folder: string, path: string | undefined): ScoutVerdict | string {
  if (path === undefined) return deny(NOT_THERE)
  if (!isInside(folder, path)) return deny(OUTSIDE)
  return isSecretPath(path) ? deny(SECRET) : path
}

/** A glob pattern that climbs out of the folder or starts at the root, a home folder or a drive. */
const isEscaping = (pattern: unknown): boolean =>
  typeof pattern !== 'string' || pattern.trim() === '' || /^(~|[\\/]|[A-Za-z]:)/.test(pattern.trim()) || slashes(pattern).split('/').includes('..')

function readCall(folder: string, input: Record<string, unknown>): ScoutVerdict {
  const path = allowed(folder, placed(folder, input.file_path))
  return typeof path === 'string' ? { run: {}, check: [path], read: path } : path
}

function searchCall(folder: string, tool: 'Glob' | 'Grep', input: Record<string, unknown>): ScoutVerdict {
  const isGrep = tool === 'Grep'
  const { pattern } = input
  if (typeof pattern !== 'string' || pattern === '') return deny('a search needs a pattern.')
  if (!isGrep && isEscaping(pattern)) return deny(OUTSIDE)
  if (isGrep && input.glob !== undefined && isEscaping(input.glob)) return deny(OUTSIDE)
  const path = input.path === undefined ? folder : allowed(folder, placed(folder, input.path))
  // Only the names of the files that match come back, so a secret the search happens to match is never shown.
  return typeof path === 'string' ? { run: isGrep ? { output_mode: 'files_with_matches' } : {}, check: [path] } : path
}

/** What the scout's call may do, judged by spelling alone. */
export function checkScoutCall(tool: string, input: Record<string, unknown>, folder: string): ScoutVerdict {
  if (tool === 'Read') return readCall(folder, input)
  if (tool === 'Glob' || tool === 'Grep') return searchCall(folder, tool, input)
  return tool === TEAM_TOOL ? { run: {}, check: [] } : deny(ONLY_READS)
}

// ---- Where a path really lands ----

/** The one call the real-path check needs: where a path lands with every link followed, or `undefined` when it leads nowhere. */
export type RealIo = { readonly real: (path: string) => Promise<string | undefined> }

/** The same check on the real paths: each must land inside the real folder, on no secret. A lookup that fails refuses the call. */
export async function guardScout(io: RealIo, tool: string, input: Record<string, unknown>, folder: string): Promise<ScoutVerdict> {
  const verdict = checkScoutCall(tool, input, folder)
  if ('deny' in verdict || verdict.check.length === 0) return verdict
  try {
    const root = (await io.real(folder)) ?? folder
    for (const path of verdict.check) {
      const landed = await io.real(path)
      const judged = allowed(root, landed === undefined ? undefined : resolveIn(root, landed))
      if (typeof judged !== 'string') return judged
    }
    return verdict
  } catch {
    return deny(NOT_THERE)
  }
}
