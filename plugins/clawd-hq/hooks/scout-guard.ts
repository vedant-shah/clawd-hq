// The path helpers the scout's answer is checked with (scout-pick.ts): a file it names is placed against the project folder,
// must lie inside it, and must not be a secret. Pure. Best effort on names: a secret under an odd name is not caught.
// The guard that judged each of the scout's calls is gone: the plugin starts the scout from its own timer, so in Claude Code
// none of its hooks run inside the scout and the guard never ran. Its own definition (scout-spec.ts) is the limit now.

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
