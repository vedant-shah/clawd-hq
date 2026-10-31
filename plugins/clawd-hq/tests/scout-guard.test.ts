// The path helpers the scout's answer is checked with: a file it names is placed against the project folder, must lie inside it,
// and must not be a secret. The old guard on each call is gone: none of the plugin's hooks run inside the scout, so it never ran.
import { expect, test } from 'claude-code/testing'
import { isInside, isSecretPath, resolveIn } from '../hooks/scout-guard'

const ROOT = '/home/me/shop'

test('a path is read against the project folder, with dots folded; anything that cannot be placed is nothing', () => {
  expect(resolveIn(ROOT, 'src/app.ts')).toBe('/home/me/shop/src/app.ts')
  expect(resolveIn(ROOT, './src/../README.md')).toBe('/home/me/shop/README.md')
  expect(resolveIn(ROOT, '/home/me/shop/src//app.ts')).toBe('/home/me/shop/src/app.ts')
  expect(resolveIn(ROOT, '../other/file')).toBe('/home/me/other/file')
  expect(resolveIn(ROOT, '/etc/passwd')).toBe('/etc/passwd')
  expect(resolveIn('C:\\work\\shop', 'src\\app.ts')).toBe('C:/work/shop/src/app.ts')
  for (const odd of ['', '   ', '~/notes', '~', 'a\0b', '//server/share/x', 'D:x']) expect(resolveIn(ROOT, odd)).toBeUndefined()
})

test('inside means the folder itself or under it; a folder that only starts the same is outside', () => {
  expect(isInside(ROOT, ROOT)).toBe(true)
  expect(isInside(ROOT, `${ROOT}/src/app.ts`)).toBe(true)
  expect(isInside(ROOT, '/home/me/shopping/list.md')).toBe(false)
  expect(isInside(ROOT, '/etc/passwd')).toBe(false)
  expect(isInside('C:/Work/Shop', 'c:/work/shop/README.md')).toBe(true) // a drive letter means case does not count
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
    for (const name of names) expect([name, isSecretPath(`${ROOT}/${name}`)]).toEqual([name, true])
  })
}

test('ordinary files are not secrets, even when their names are close', () => {
  for (const p of [
    'README.md', 'src/env.ts', 'src/keyboard.ts', '.gitignore', '.github/workflows/ci.yml', 'package.json', 'src/identity.ts',
    'src/video_history.ts.txt.md', 'docs/history.md', 'src/app.ts', 'tsconfig.json', 'Dockerfile', 'src/idle.ts',
  ]) expect([p, isSecretPath(`${ROOT}/${p}`)]).toEqual([p, false])
})
