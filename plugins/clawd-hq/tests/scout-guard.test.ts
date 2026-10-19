// The scout's guard: it may read inside the project folder and nothing else, and never a secret. Pure, so every
// rule is pinned here with made-up paths.
import { expect, test } from 'claude-code/testing'
import { checkScoutCall, guardScout, isSecretPath, resolveIn } from '../hooks/scout-guard'

const ROOT = '/home/me/shop'
const TEAM = 'mcp__clawd-hq__team_pick'
const denied = (v: unknown) => typeof v === 'object' && v !== null && 'deny' in v

test('a path is read against the project folder, with dots folded; anything that cannot be placed is nothing', () => {
  expect(resolveIn(ROOT, 'src/app.ts')).toBe('/home/me/shop/src/app.ts')
  expect(resolveIn(ROOT, './src/../README.md')).toBe('/home/me/shop/README.md')
  expect(resolveIn(ROOT, '/home/me/shop/src//app.ts')).toBe('/home/me/shop/src/app.ts')
  expect(resolveIn(ROOT, '../other/file')).toBe('/home/me/other/file')
  expect(resolveIn(ROOT, '/etc/passwd')).toBe('/etc/passwd')
  expect(resolveIn('C:\\work\\shop', 'src\\app.ts')).toBe('C:/work/shop/src/app.ts')
  for (const odd of ['', '   ', '~/notes', '~', 'a\0b', '//server/share/x', 'D:x']) expect(resolveIn(ROOT, odd)).toBeUndefined()
})

/** One test per kind of secret name, so a name that stops being caught says which kind it was. */
const SECRET_NAMES: Record<string, string[]> = {
  'a name with .env in it': ['.env', '.env.local', '.env.example', 'prod.env', 'apps/web/.ENV.production', 'config.env.bak'],
  'terraform': ['infra/prod.tfvars', 'terraform.tfstate', 'x/Terraform.TFVARS'],
  'secret, credential, token, password in a name': ['secrets.yaml', 'client_secret.json', 'aws-credentials', 'credentials.json', 'src/tokens.ts', 'auth_token.txt', 'docs/secrets-management.md', 'passwords.csv', 'MyPassword.txt'],
  'package manager and tool settings': ['.yarnrc', '.yarnrc.yml', '.npmrc', '.pypirc', '.netrc', '.dockercfg', '.docker/config.json', '.boto', '.vault_pass', '.vault_pass.txt', 'secrets.enc', 'vars.ENC'],
  'framework settings': ['wp-config.php', 'config/database.yml', 'app/google-services.json', 'ios/GoogleService-Info.plist'],
  'shell history': ['.bash_history', '.zsh_history', 'sh_history', 'home/.node_repl_history'],
  'keys': ['id_rsa', 'id_ed25519.pub', 'id_anything', 'certs/server.pem', 'deploy.KEY', 'store.p12', 'bundle.pfx', 'app.keystore', 'release.jks', 'tools/adbkey', 'tools/adbkey.pub', 'old.ppk', 'vault.kdbx'],
  'folders that keep secrets': ['.ssh/config', '.aws/config', '.git/config', '.claude/settings.local.json', 'gcp-service-account-prod.json', '.mozilla/firefox/x/places.sqlite'],
  'browser state and keychains': ['Library/Application Support/Google/Chrome/Default/History', 'Library/Keychains/login.keychain-db', 'profile/Cookies', 'profile/Login Data', 'profile/logins.json'],
}
for (const [kind, names] of Object.entries(SECRET_NAMES)) {
  test(`secret: ${kind}`, () => {
    for (const name of names) {
      const path = `${ROOT}/${name}`
      expect([path, isSecretPath(path)]).toEqual([path, true])
      expect([name, denied(checkScoutCall('Read', { file_path: name }, ROOT))]).toEqual([name, true])
    }
  })
}

test('ordinary files are not secrets, even when their names are close', () => {
  for (const p of [
    'README.md', 'src/env.ts', 'src/keyboard.ts', '.gitignore', '.github/workflows/ci.yml', 'package.json', 'src/identity.ts',
    'src/video_history.ts.txt.md', 'docs/history.md', 'src/app.ts', 'tsconfig.json', 'Dockerfile', 'src/idle.ts',
  ]) expect([p, isSecretPath(`${ROOT}/${p}`)]).toEqual([p, false])
})

test('a project whose own path has a secret-looking word in it is not locked out', () => {
  const folder = '/home/me/tokens-and-secrets/shop'
  expect(denied(checkScoutCall('Read', { file_path: 'README.md' }, folder))).toBe(false)
  expect(denied(checkScoutCall('Read', { file_path: 'src/tokens.ts' }, folder))).toBe(true)
})

test('Read: a file inside the folder is allowed; the path it names, and the spelling the scout used, are both returned for the real-path check', () => {
  expect(checkScoutCall('Read', { file_path: 'src/app.ts' }, ROOT)).toEqual({ run: {}, check: ['/home/me/shop/src/app.ts', 'src/app.ts'], read: '/home/me/shop/src/app.ts' })
  expect(checkScoutCall('Read', { file_path: `${ROOT}/README.md`, offset: 2, limit: 50 }, ROOT)).toEqual({ run: {}, check: ['/home/me/shop/README.md'], read: '/home/me/shop/README.md' })
})

test('Read: a secret, a path outside the folder, a home-folder spelling and a missing path are each refused', () => {
  for (const file_path of ['.env', 'apps/web/.env.local', '../other/notes.md', '/etc/passwd', '~/.ssh/id_rsa', 'src/../../secrets.json', '', '.git/config']) {
    expect([file_path, denied(checkScoutCall('Read', { file_path }, ROOT))]).toEqual([file_path, true])
  }
  expect(denied(checkScoutCall('Read', {}, ROOT))).toBe(true)
  expect(denied(checkScoutCall('Read', { file_path: 7 }, ROOT))).toBe(true)
})

test('a path with a .. segment anywhere is refused, even one that folds back inside the folder', () => {
  for (const file_path of ['src/../package.json', './../shop/package.json', `${ROOT}/src/../README.md`, `${ROOT}/..`, '..', 'a\\..\\b.md', '../shop/README.md']) {
    expect([file_path, denied(checkScoutCall('Read', { file_path }, ROOT))]).toEqual([file_path, true])
  }
  for (const path of ['src/..', '../shop', `${ROOT}/src/../src`]) expect([path, denied(checkScoutCall('Glob', { pattern: '*', path }, ROOT))]).toEqual([path, true])
  expect(denied(checkScoutCall('Read', { file_path: 'src/a..b.md' }, ROOT))).toBe(false) // two dots in a name are not a segment
  expect(denied(checkScoutCall('Read', { file_path: 'src/..hidden/a.md' }, ROOT))).toBe(false)
})

test('Glob: the folder or a place inside it; a pattern that climbs out or starts at the root is refused', () => {
  expect(checkScoutCall('Glob', { pattern: '**/*.md' }, ROOT)).toEqual({ run: {}, check: [ROOT] })
  expect(checkScoutCall('Glob', { pattern: '*.ts', path: 'src' }, ROOT)).toEqual({ run: {}, check: ['/home/me/shop/src', 'src'] })
  for (const input of [{ pattern: '../**/*' }, { pattern: '/etc/*' }, { pattern: '~/**' }, { pattern: 'src/../../*' }, { pattern: '*', path: '/etc' }, { pattern: '*', path: '../x' }, { pattern: '*', path: '.ssh' }, {}]) {
    expect([input, denied(checkScoutCall('Glob', input, ROOT))]).toEqual([input, true])
  }
})

test('Grep is not for the scout: a search over file contents could find a secret, so it is refused whatever it asks', () => {
  for (const input of [{ pattern: 'vitest' }, { pattern: 'x', path: 'src' }, { pattern: 'x', output_mode: 'files_with_matches' }, {}]) {
    expect(checkScoutCall('Grep', input, ROOT)).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ: .*Read, Glob/) })
  }
})

test('the scout\'s own tool passes; every other tool is refused', () => {
  expect(checkScoutCall(TEAM, { picks: [] }, ROOT)).toEqual({ run: {}, check: [] })
  for (const tool of ['Bash', 'Write', 'Edit', 'WebFetch', 'Agent', 'mcp__other__thing', 'read', '']) {
    expect([tool, denied(checkScoutCall(tool, { file_path: 'a' }, ROOT))]).toEqual([tool, true])
  }
})

test('with no project folder known, everything is refused', () => {
  for (const folder of ['', '   ']) {
    expect(denied(checkScoutCall('Read', { file_path: 'README.md' }, folder))).toBe(true)
    expect(denied(checkScoutCall('Read', { file_path: '/README.md' }, folder))).toBe(true)
    expect(denied(checkScoutCall('Glob', { pattern: '*' }, folder))).toBe(true)
  }
})

test('the refusal says plainly that it is Clawd HQ and why', () => {
  const v = checkScoutCall('Read', { file_path: '.env' }, ROOT)
  expect(v).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ: .*secret/i) })
  expect(checkScoutCall('Read', { file_path: '/etc/passwd' }, ROOT)).toMatchObject({ deny: expect.stringMatching(/inside the project/i) })
})

// ---- the real path: a link inside the folder that leads outside is no better than the place it leads to ----

const real = (map: Record<string, string>) => ({ real: async (p: string) => map[p] })

test('a link inside the folder that lands outside it, or on a secret, is refused', async () => {
  const io = real({ [ROOT]: ROOT, '/home/me/shop/notes.txt': '/home/me/.ssh/id_rsa', '/home/me/shop/cfg.txt': '/home/me/shop/.env', '/home/me/shop/ok.txt': '/home/me/shop/ok.txt', 'ok.txt': '/home/me/shop/ok.txt' })
  expect(denied(await guardScout(io, 'Read', { file_path: 'notes.txt' }, ROOT))).toBe(true)
  expect(denied(await guardScout(io, 'Read', { file_path: 'cfg.txt' }, ROOT))).toBe(true)
  expect(await guardScout(io, 'Read', { file_path: 'ok.txt' }, ROOT)).toEqual({ run: {}, check: ['/home/me/shop/ok.txt', 'ok.txt'], read: '/home/me/shop/ok.txt' })
})

test('the scout\'s own spelling is looked up too: if it lands outside the folder, the call is refused', async () => {
  const asked: string[] = []
  const io = { real: async (p: string) => (asked.push(p), p === 'src/app.ts' ? '/etc/shadow' : p) }
  expect(denied(await guardScout(io, 'Read', { file_path: 'src/app.ts' }, ROOT))).toBe(true)
  expect(asked).toContain('src/app.ts')
  expect(asked).toContain('/home/me/shop/src/app.ts')
})

test('the folder itself may be a link: both sides are compared by where they really land', async () => {
  const io = real({
    '/tmp/shop': '/private/tmp/shop', '/tmp/shop/a.md': '/private/tmp/shop/a.md', 'a.md': '/private/tmp/shop/a.md',
    '/tmp/shop/src': '/private/tmp/shop/src', src: '/private/tmp/shop/src',
  })
  expect(denied(await guardScout(io, 'Read', { file_path: 'a.md' }, '/tmp/shop'))).toBe(false)
  expect(denied(await guardScout(io, 'Glob', { pattern: '*', path: 'src' }, '/tmp/shop'))).toBe(false)
})

test('a path that leads nowhere is refused, and a refusal before the real-path check never asks for it', async () => {
  const asked: string[] = []
  const io = { real: async (p: string) => (asked.push(p), undefined) }
  expect(denied(await guardScout(io, 'Read', { file_path: 'missing.md' }, ROOT))).toBe(true)
  asked.length = 0
  expect(denied(await guardScout(io, 'Read', { file_path: '.env' }, ROOT))).toBe(true)
  expect(denied(await guardScout(io, 'Read', { file_path: 'src/../a.md' }, ROOT))).toBe(true)
  expect(asked).toEqual([])
})

test('a real-path lookup that throws refuses the call instead of letting it through', async () => {
  const io = { real: async () => { throw new Error('stat failed') } }
  expect(denied(await guardScout(io, 'Read', { file_path: 'a.md' }, ROOT))).toBe(true)
})
