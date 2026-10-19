// The scout's guard, pure: the scout may read inside the project folder and nothing else, and never a secret.
// The spelling is judged here; `guardScout` then asks where the path really lands (a link inside the folder can lead out of it).
// The scout has Read and Glob only: Glob returns names, and a name is judged before it is opened. Grep is refused, because a
// search over contents could surface a secret under any name. Best effort on names: a secret under an odd name is not caught.
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
const DOTS = 'a path with .. in it is not allowed; name the file from the project folder down.'
const NO_FOLDER = 'the project folder is not known.'
const ONLY_READS = 'the scout only reads. It may use Read, Glob and team_pick.'

// ---- Paths ----

const slashes = (p: string) => p.replace(/\\/g, '/')
const hasDrive = (p: string) => /^[A-Za-z]:/.test(p)
/** Whether a path, in either slash, has a `..` segment (two dots inside a name do not count). */
const hasDots = (p: string) => slashes(p).split('/').includes('..')

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

/** File names (the last part of a path), judged without regard to case. The words are kept in the name wherever they fall. */
const SECRET_FILE = new RegExp([
  '\\.env',
  '\\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx|tfstate|tfvars|enc|keychain|keychain-db)$',
  '(secret|credential|token|password)',
  '^id_',
  '_history$',
  '^adbkey',
  '^\\.(npmrc|yarnrc|pypirc|netrc|pgpass|htpasswd|git-credentials|dockercfg|boto|vault_pass)',
  '^(wp-config\\.php|database\\.yml|google-services\\.json|googleservice-info\\.plist)$',
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

/** A path that may be looked at: no `..`, placeable, inside the folder and no secret. Returns the folded path, or the refusal. */
function allowed(folder: string, raw: unknown): ScoutVerdict | string {
  if (typeof raw !== 'string') return deny(NOT_THERE)
  if (hasDots(raw)) return deny(DOTS)
  const path = resolveIn(folder, raw)
  if (path === undefined) return deny(NOT_THERE)
  if (!isInside(folder, path)) return deny(OUTSIDE)
  return isSecretPath(path) ? deny(SECRET) : path
}

/** What the real-path check looks up: the folded path, and the scout's own spelling when it is a different string. */
const lookups = (path: string, raw: string): readonly string[] => (raw.trim() === path ? [path] : [path, raw.trim()])

/** A glob pattern that climbs out of the folder or starts at the root, a home folder or a drive. */
const isEscaping = (pattern: unknown): boolean =>
  typeof pattern !== 'string' || pattern.trim() === '' || /^(~|[\\/]|[A-Za-z]:)/.test(pattern.trim()) || hasDots(pattern)

function readCall(folder: string, input: Record<string, unknown>): ScoutVerdict {
  const path = allowed(folder, input.file_path)
  return typeof path === 'string' ? { run: {}, check: lookups(path, String(input.file_path)), read: path } : path
}

function globCall(folder: string, input: Record<string, unknown>): ScoutVerdict {
  if (typeof input.pattern !== 'string' || input.pattern === '') return deny('a search needs a pattern.')
  if (isEscaping(input.pattern)) return deny(OUTSIDE)
  if (input.path === undefined) return { run: {}, check: [folder] }
  const path = allowed(folder, input.path)
  return typeof path === 'string' ? { run: {}, check: lookups(path, String(input.path)) } : path
}

/** What the scout's call may do, judged by spelling alone. */
export function checkScoutCall(tool: string, input: Record<string, unknown>, folder: string): ScoutVerdict {
  if (folder.trim() === '') return deny(NO_FOLDER)
  if (tool === 'Read') return readCall(folder, input)
  if (tool === 'Glob') return globCall(folder, input)
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
      const judged = allowed(root, landed)
      if (typeof judged !== 'string') return judged
    }
    return verdict
  } catch {
    return deny(NOT_THERE)
  }
}
