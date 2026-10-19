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

test('secrets are named by file, by folder and by kind of file', () => {
  for (const p of [
    '/home/me/shop/.env', '/home/me/shop/.env.local', '/home/me/shop/.env.example', '/home/me/shop/apps/web/.ENV.production',
    '/home/me/shop/certs/server.pem', '/home/me/shop/deploy.KEY', '/home/me/shop/store.p12', '/home/me/shop/app.keystore',
    '/home/me/shop/tools/adbkey', '/home/me/shop/tools/adbkey.pub', '/home/me/shop/id_rsa', '/home/me/shop/id_ed25519.pub',
    '/home/me/shop/.ssh/config', '/home/me/shop/.aws/credentials', '/home/me/shop/credentials.json', '/home/me/shop/secrets.yaml',
    '/home/me/shop/.npmrc', '/home/me/shop/.netrc', '/home/me/shop/.git-credentials', '/home/me/shop/.git/config',
    '/home/me/shop/.claude/settings.local.json', '/home/me/shop/gcp-service-account-prod.json', '/home/me/shop/terraform.tfstate',
    '/home/me/Library/Application Support/Google/Chrome/Default/Cookies', '/home/me/.mozilla/firefox/x/logins.json',
    '/home/me/Library/Keychains/login.keychain-db', '/home/me/.android/adbkey',
  ]) expect([p, isSecretPath(p)]).toEqual([p, true])
})

test('ordinary files are not secrets, even when their names are close', () => {
  for (const p of [
    '/home/me/shop/README.md', '/home/me/shop/src/env.ts', '/home/me/shop/src/keyboard.ts', '/home/me/shop/docs/secrets-management.md',
    '/home/me/shop/.gitignore', '/home/me/shop/.github/workflows/ci.yml', '/home/me/shop/package.json', '/home/me/shop/src/tokens.ts',
  ]) expect([p, isSecretPath(p)]).toEqual([p, false])
})

test('Read: a file inside the folder is allowed, and the path it names is returned for the real-path check', () => {
  const v = checkScoutCall('Read', { file_path: 'src/app.ts' }, ROOT)
  expect(v).toEqual({ run: {}, check: ['/home/me/shop/src/app.ts'], read: '/home/me/shop/src/app.ts' })
  expect(checkScoutCall('Read', { file_path: `${ROOT}/README.md`, offset: 2, limit: 50 }, ROOT)).toMatchObject({ read: '/home/me/shop/README.md' })
})

test('Read: a secret, a path outside the folder, a home-folder spelling and a missing path are each refused', () => {
  for (const file_path of ['.env', 'apps/web/.env.local', '../other/notes.md', '/etc/passwd', '~/.ssh/id_rsa', 'src/../../secrets.json', '', '.git/config']) {
    expect([file_path, denied(checkScoutCall('Read', { file_path }, ROOT))]).toEqual([file_path, true])
  }
  expect(denied(checkScoutCall('Read', {}, ROOT))).toBe(true)
  expect(denied(checkScoutCall('Read', { file_path: 7 }, ROOT))).toBe(true)
})

test('Glob: the folder or a place inside it; a pattern that climbs out or starts at the root is refused', () => {
  expect(checkScoutCall('Glob', { pattern: '**/*.md' }, ROOT)).toEqual({ run: {}, check: [ROOT] })
  expect(checkScoutCall('Glob', { pattern: '*.ts', path: 'src' }, ROOT)).toEqual({ run: {}, check: ['/home/me/shop/src'] })
  for (const input of [{ pattern: '../**/*' }, { pattern: '/etc/*' }, { pattern: '~/**' }, { pattern: 'src/../../*' }, { pattern: '*', path: '/etc' }, { pattern: '*', path: '../x' }, { pattern: '*', path: '.ssh' }, {}]) {
    expect([input, denied(checkScoutCall('Glob', input, ROOT))]).toEqual([input, true])
  }
})

test('Grep: only the names of files that match come back, so a secret\'s lines never reach the scout', () => {
  expect(checkScoutCall('Grep', { pattern: 'vitest' }, ROOT)).toEqual({ run: { output_mode: 'files_with_matches' }, check: [ROOT] })
  expect(checkScoutCall('Grep', { pattern: 'x', path: 'src', output_mode: 'content', '-n': true, '-C': 5 }, ROOT))
    .toEqual({ run: { output_mode: 'files_with_matches' }, check: ['/home/me/shop/src'] })
  for (const input of [{ pattern: 'x', path: '/etc' }, { pattern: 'x', path: '.env' }, { pattern: 'x', glob: '../**' }, { pattern: 'x', glob: '/etc/*' }, { path: 'src' }]) {
    expect([input, denied(checkScoutCall('Grep', input, ROOT))]).toEqual([input, true])
  }
})

test('the scout\'s own tool passes; every other tool is refused', () => {
  expect(checkScoutCall(TEAM, { picks: [] }, ROOT)).toEqual({ run: {}, check: [] })
  for (const tool of ['Bash', 'Write', 'Edit', 'WebFetch', 'Agent', 'mcp__other__thing', 'read', '']) {
    expect([tool, denied(checkScoutCall(tool, { file_path: 'a' }, ROOT))]).toEqual([tool, true])
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
  const io = real({ [ROOT]: ROOT, '/home/me/shop/notes.txt': '/home/me/.ssh/id_rsa', '/home/me/shop/cfg.txt': '/home/me/shop/.env', '/home/me/shop/ok.txt': '/home/me/shop/ok.txt' })
  expect(denied(await guardScout(io, 'Read', { file_path: 'notes.txt' }, ROOT))).toBe(true)
  expect(denied(await guardScout(io, 'Read', { file_path: 'cfg.txt' }, ROOT))).toBe(true)
  expect(await guardScout(io, 'Read', { file_path: 'ok.txt' }, ROOT)).toEqual({ run: {}, check: ['/home/me/shop/ok.txt'], read: '/home/me/shop/ok.txt' })
})

test('the folder itself may be a link: both sides are compared by where they really land', async () => {
  const io = real({ '/tmp/shop': '/private/tmp/shop', '/tmp/shop/a.md': '/private/tmp/shop/a.md', '/tmp/shop/src': '/private/tmp/shop/src' })
  expect(denied(await guardScout(io, 'Read', { file_path: 'a.md' }, '/tmp/shop'))).toBe(false)
  expect(denied(await guardScout(io, 'Glob', { pattern: '*', path: 'src' }, '/tmp/shop'))).toBe(false)
})

test('a path that leads nowhere is refused, and a refusal before the real-path check never asks for it', async () => {
  const asked: string[] = []
  const io = { real: async (p: string) => (asked.push(p), undefined) }
  expect(denied(await guardScout(io, 'Read', { file_path: 'missing.md' }, ROOT))).toBe(true)
  asked.length = 0
  expect(denied(await guardScout(io, 'Read', { file_path: '.env' }, ROOT))).toBe(true)
  expect(asked).toEqual([])
})

test('a real-path lookup that throws refuses the call instead of letting it through', async () => {
  const io = { real: async () => { throw new Error('stat failed') } }
  expect(denied(await guardScout(io, 'Read', { file_path: 'a.md' }, ROOT))).toBe(true)
})
