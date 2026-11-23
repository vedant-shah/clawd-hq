// The risky-action guard, pure: what in a specialist's steps (which the main chat never sees) it flags, and the note it writes.
import type { SessionMessage } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { WHAT, commandsOf, guardNote, risksOf, sqlWhat } from '../hooks/know-guard'
import { ghpToken } from './fake-secrets'

type Use = SessionMessage['toolUses'][number]
let n = 0
const use = (tool: string, input: Record<string, unknown>, text = 'ok', isError = false): Use =>
  ({ tool_use_id: `u${(n += 1)}`, tool, input, text, ...(isError ? { isError: true as const } : {}) })
const bash = (command: string, extra: Record<string, unknown> = {}) => use('Bash', { command, ...extra })
const rows = (...uses: Use[]): SessionMessage[] => [{ role: 'user', text: 'The brief.', toolUses: [] }, { role: 'assistant', text: 'Working.', toolUses: uses }]
const kinds = (uses: Use[]) => risksOf(rows(...uses)).map(r => r.kind)
const whats = (command: string) => risksOf(rows(bash(command))).map(r => r.what)

// ---- Reading the command line ----

test('a command line splits into simple commands on unquoted separators only; quotes and heredoc bodies stay whole', () => {
  expect(commandsOf('cd x && rm -rf y; ls | wc -l')).toEqual([['cd', 'x'], ['rm', '-rf', 'y'], ['ls'], ['wc', '-l']])
  expect(commandsOf('echo "a; rm -rf src && b"')).toEqual([['echo', 'a; rm -rf src && b']])
  expect(commandsOf("bash -c 'rm -rf src'")).toEqual([['bash', '-c', 'rm -rf src']])
  expect(commandsOf('cat > notes.md <<EOF\nrm -rf src\ngit push --force\nEOF\nnpm test')).toEqual([['cat', '>', 'notes.md', '<<EOF'], ['npm', 'test']])
  expect(commandsOf('rm -rf "my folder"')).toEqual([['rm', '-rf', 'my folder']])
})

// ---- Destructive commands ----

test('destructive commands are flagged with what they do in plain words', () => {
  const cases: Array<[string, string]> = [
    ['rm -rf src/old', WHAT.delete], ['rm -fr ~/projects', WHAT.delete], ['rm -r -f data', WHAT.delete], ['sudo rm -Rf /var/app', WHAT.delete],
    ['cd x && rm --recursive --force y', WHAT.delete],
    ['git reset --hard HEAD~3', WHAT.reset], ['git push --force origin main', WHAT.push], ['git push -f', WHAT.push], ['git push origin +main', WHAT.push],
    ['git push origin :old-branch', WHAT.pushDelete], ['git push origin --delete old-branch', WHAT.pushDelete], ['git push -d origin old-branch', WHAT.pushDelete],
    ['git clean -fd', WHAT.clean], ['git branch -D feature', WHAT.branch],
    ['killall node', WHAT.kill], ['killall vite', WHAT.kill], ['pkill node', WHAT.kill], ['pkill -f python', WHAT.kill], ['pkill -u me', WHAT.kill], ['kill -9 -1', WHAT.kill], ['kill -1', WHAT.kill],
    ['docker system prune -af', WHAT.docker], ['docker volume prune -f', WHAT.docker],
    ['find . -name "*.log" -delete', WHAT.findDelete], ['find src -type f -exec rm {} +', WHAT.findDelete],
    ['git ls-files -d | xargs rm', WHAT.deleteGiven], ['ls *.bak | xargs -I {} rm -f {}', WHAT.deleteGiven],
    ['bash -c "rm -rf src"', WHAT.delete], ["sh -c 'git reset --hard'", WHAT.reset], ['zsh -lc "git push --force"', WHAT.push],
  ]
  for (const [command, what] of cases) expect(whats(command), command).toEqual([what])
})

test('SQL that drops or empties a table, or deletes or changes every row, is flagged in a database client or a database tool', () => {
  expect(whats('psql -c "DROP TABLE users"')).toEqual([WHAT.drop])
  expect(whats('sqlite3 app.db "truncate table orders"')).toEqual([WHAT.truncate])
  expect(whats('mysql -e "DELETE FROM sessions"')).toEqual([WHAT.deleteRows])
  expect(whats('psql -c "UPDATE users SET plan = \'free\'"')).toEqual([WHAT.updateRows])
  expect(whats('psql <<SQL\nDELETE FROM carts;\nSQL')).toEqual([WHAT.deleteRows])
  expect(whats('psql -c "DELETE FROM sessions WHERE expires < now()"')).toEqual([])
  expect(whats('psql -c "UPDATE users SET plan = \'pro\' WHERE id = 7"')).toEqual([])
  expect(kinds([use('mcp__supabase__execute_sql', { query: 'DROP TABLE profiles;' })])).toEqual(['destructive'])
  expect(kinds([use('mcp__supabase__execute_sql', { query: 'delete from profiles' })])).toEqual(['destructive'])
  expect(kinds([use('mcp__supabase__execute_sql', { query: 'select * from profiles' })])).toEqual([])
  expect(sqlWhat('DELETE FROM a WHERE id = 1; DELETE FROM b')).toBe(WHAT.deleteRows)
})

test('everyday commands are not flagged: build output and temp folders anywhere in a path, narrow kills, safe git, quoted text', () => {
  for (const command of [
    'rm -rf node_modules', 'rm -rf dist build coverage', 'rm -rf .next', 'rm -rf packages/web/dist', 'rm -rf apps/api/.venv', 'rm -rf src/__pycache__',
    'rm -rf /tmp/claude-501/x', 'rm -rf "$TMPDIR/scratch"', 'rm -rf ./build/cache', 'find dist -name "*.map" -delete',
    'rm file.txt', 'rm -f stale.lock', 'rm -r empty-dir',
    'git reset HEAD file', 'git push origin main', 'git push -u origin feature', 'git push --force-with-lease', 'git push --force-with-lease origin feat',
    'git clean -n', 'git checkout main', 'git checkout -- src/app.ts', 'git checkout .', 'git branch -d done',
    'git merge feature && git branch -D feature',
    'kill 4242', 'lsof -ti:3000 | xargs kill', 'pkill -f vite', 'pkill -f "node server.js"', 'pkill -f next-server',
    'npm test', 'echo "drop the table later"', 'grep -r "DROP TABLE" migrations', 'echo "rm -rf src; git push --force"',
    'cat > plan.md <<EOF\nThen rm -rf the old folder and git push --force.\nEOF', 'docker ps', 'git commit -m "update users set flag"',
  ]) {
    expect(whats(command), command).toEqual([])
  }
})

test('a branch deleted after an earlier step merged it is tidying up; one never merged is flagged', () => {
  expect(kinds([bash('git merge --no-ff feature'), bash('git branch -D feature')])).toEqual([])
  expect(kinds([bash('git merge other'), bash('git branch -D feature')])).toEqual(['destructive'])
})

test('a command run with the sandbox turned off is flagged', () => {
  expect(kinds([bash('npm install', { dangerouslyDisableSandbox: true })])).toEqual(['sandbox-off'])
  expect(kinds([bash('npm install', { dangerouslyDisableSandbox: false })])).toEqual([])
})

// ---- Refused, then done another way ----

const DENIED = 'Permission to use Write has been denied.'
const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."

test('a refused action done another way is flagged: the same kind of tool on the same full path, or the same program and subcommand', () => {
  expect(kinds([use('Write', { file_path: '/repo/.env', content: 'x' }, DENIED, true), use('Edit', { file_path: '/repo/.env', old_string: 'a', new_string: 'b' })])).toEqual(['denied-retried'])
  expect(kinds([use('Edit', { file_path: 'src/app.ts' }, REJECTED, true), use('Write', { file_path: 'src/app.ts', content: 'all new' })])).toEqual(['denied-retried'])
  expect(kinds([use('Bash', { command: 'git push origin main' }, 'Permission to use Bash with command git push origin main has been denied.', true), bash('git push origin HEAD:main')])).toEqual(['denied-retried'])
})

test('not counted: another file of the same name, another kind of tool, a read, a plain error, or anything after the same call goes through', () => {
  expect(kinds([use('Write', { file_path: '/repo/.env' }, DENIED, true), use('Write', { file_path: '/repo/api/.env', content: 'x' })])).toEqual([])
  // DECIDED: the shell is another kind of tool than a file edit, as the review asked.
  expect(kinds([use('Write', { file_path: '/repo/.env' }, DENIED, true), bash("printf 'x' > /repo/.env")])).toEqual([])
  expect(kinds([use('Write', { file_path: '/repo/.env' }, DENIED, true), use('Read', { file_path: '/repo/.env' })])).toEqual([])
  expect(kinds([use('Bash', { command: 'npm test' }, 'Exit code 1', true), bash('npm test -- --watch=false')])).toEqual([])
  // The same call made again and let through reads as the person saying yes: later steps on it are not going round a refusal.
  const write = { file_path: '/repo/.env', content: 'x' }
  expect(kinds([use('Write', write, DENIED, true), use('Write', write), use('Edit', { file_path: '/repo/.env', old_string: 'x', new_string: 'y' })])).toEqual([])
  expect(kinds([use('Write', write, DENIED, true), use('Write', write, DENIED, true), use('Edit', { file_path: '/repo/.env' })])).toEqual(['denied-retried'])
})

// ---- What the note shows ----

test('a command\'s text never reaches the note: passwords in connection strings, settings or flags stay out', () => {
  for (const command of [
    'psql postgres://app:hunter2pw@db.example.com/shop -c "DROP TABLE users"',
    'PGPASSWORD=hunter2pw psql -h db -U app -c "TRUNCATE orders"',
    'mysql -u root -phunter2pw -e "DELETE FROM sessions"',
    `GH=${ghpToken()} git push --force`,
  ]) {
    const risks = risksOf(rows(bash(command)))
    expect(risks, command).toHaveLength(1)
    const note = JSON.stringify(guardNote('Builder', risks))
    for (const part of ['hunter2pw', 'db.example.com', 'postgres://', 'sessions', 'orders', 'users', ghpToken()]) expect(note, command).not.toContain(part)
  }
})

test('each risk names its step, counted as the person would count them, and the tool that took it', () => {
  expect(risksOf(rows(bash('npm test'), use('Read', { file_path: 'a' }), bash('git reset --hard origin/main')))).toEqual([
    { kind: 'destructive', what: WHAT.reset, step: 3, tool: 'Bash' },
  ])
  expect(risksOf(rows(use('mcp__clawd-hq__step', { done: 0, total: 2 }), bash('rm -rf src')))[0]!.step).toBe(1)
})

test('the note names the specialist and what it did in plain words, tagged Heads up, with the steps and their tools listed', () => {
  const note = guardNote('Builder', risksOf(rows(bash('npm test'), bash('git push --force'), bash('npm i', { dangerouslyDisableSandbox: true }), use('mcp__db__query', { sql: 'drop table x' }))))
  expect(note).toEqual({
    line: 'The Builder ran a command that overwrites history on the shared copy, in steps the main chat does not show.',
    tag: 'Heads up',
    title: 'A risky step in the Builder\'s work',
    explain: 'These come from the Builder\'s own steps, which you and Clawd do not see in the chat. Step 2: a command that overwrites history on the shared copy (Bash). Step 3: a command run with the sandbox turned off (Bash). Step 4: a step that drops a database table (mcp__db__query). Check nothing you need was lost or changed, and ask Clawd if this was not meant to happen.',
  })
  expect(guardNote('Builder', risksOf(rows(use('mcp__db__query', { sql: 'drop table x' }))))!.line).toBe('The Builder took a step that drops a database table, in steps the main chat does not show.')
  expect(guardNote('Tester', [])).toBeUndefined()
})

test('a refusal worked round leads the note, as the most serious', () => {
  const note = guardNote('Builder', risksOf(rows(bash('rm -rf src'), use('Write', { file_path: '/repo/.env' }, DENIED, true), use('Edit', { file_path: '/repo/.env' }))))!
  expect(note.line).toBe('The Builder was refused an action, then did it another way, in steps the main chat does not show.')
})

test('at most three risks are listed, and the note stays within its limits', () => {
  const many = risksOf(rows(...Array.from({ length: 6 }, (_, i) => bash(`rm -rf src/part${i}`))))
  expect(many).toHaveLength(6)
  const note = guardNote('Builder', many)!
  expect(note.explain.match(/Step \d+:/g)).toHaveLength(3)
  expect(note.explain).toContain('and 3 more')
  expect(note.line.length).toBeLessThanOrEqual(240)
  expect(note.explain.length).toBeLessThanOrEqual(1200)
})
