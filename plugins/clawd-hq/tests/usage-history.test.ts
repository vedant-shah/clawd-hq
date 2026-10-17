import { expect, test } from 'claude-code/testing'
import { MAX_FILES, MAX_FILE_BYTES, countLine, pastUse, projectFolders } from '../hooks/usage-history'
import { fakeScan } from './scan-fake'

const use = (name: string, input: Record<string, unknown>) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const SECRET = 'my secret prompt text'
const said = JSON.stringify({ type: 'user', message: { content: SECRET } })
const dir = '/home/me/.claude/projects/-work-proj'

test('the project folder name turns slash, underscore and dot into a dash, with a looser name second', () => {
  expect(projectFolders('/Users/me/my_app.v2')).toEqual(['-Users-me-my-app-v2'])
  expect(projectFolders('/Users/me/My App')).toEqual(['-Users-me-My App', '-Users-me-My-App'])
})

test('one line counts agent, task and skill uses and nothing else', () => {
  const line = JSON.stringify({
    message: { content: [
      { type: 'tool_use', name: 'Agent', input: { subagent_type: 'planner', prompt: SECRET } },
      { type: 'tool_use', name: 'Task', input: { subagent_type: 'planner' } },
      { type: 'tool_use', name: 'Skill', input: { skill: 'ecc:tdd-workflow' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      { type: 'text', text: 'hello' },
    ] },
  })
  expect(countLine(line, { agents: {}, skills: {} })).toEqual({ agents: { planner: 2 }, skills: { 'ecc:tdd-workflow': 1 } })
})

test('a broken line, a line without tool use and an odd shape are ignored', () => {
  const start = { agents: { a: 1 }, skills: {} }
  expect(countLine('{"tool_use": oops', start)).toBe(start)
  expect(countLine(said, start)).toBe(start)
  expect(countLine('{"message":{"content":"tool_use"}}', start)).toBe(start)
  expect(countLine(use('Agent', {}), start)).toEqual(start)
})

test('counting returns new records and leaves the old ones alone', () => {
  const start = Object.freeze({ agents: Object.freeze({}), skills: Object.freeze({}) })
  expect(countLine(use('Skill', { skill: 's' }), start).skills).toEqual({ s: 1 })
  expect(start.skills).toEqual({})
})

test('past sessions are summed across files; only names and counts are kept', async () => {
  const f = fakeScan({
    [`${dir}/a.jsonl`]: [said, use('Agent', { subagent_type: 'planner' }), use('Skill', { skill: 'grill-me' })].join('\n'),
    [`${dir}/b.jsonl`]: [use('Agent', { subagent_type: 'planner' }), 'not json at all "tool_use"'].join('\n'),
  })
  const got = await pastUse(f.io)
  expect(got).toEqual({ agents: { planner: 2 }, skills: { 'grill-me': 1 }, files: 2, skipped: 0 })
  expect(JSON.stringify(got)).not.toContain(SECRET)
})

test('a file over the size limit is skipped, counted and never read', async () => {
  const f = fakeScan(
    { [`${dir}/big.jsonl`]: use('Agent', { subagent_type: 'x' }), [`${dir}/ok.jsonl`]: use('Agent', { subagent_type: 'y' }) },
    { sizes: { [`${dir}/big.jsonl`]: MAX_FILE_BYTES + 1 } },
  )
  const got = await pastUse(f.io)
  expect(got).toEqual({ agents: { y: 1 }, skills: {}, files: 1, skipped: 1 })
  expect(f.log.reads).toEqual([`${dir}/ok.jsonl`])
})

test('only the newest 100 files are read, newest first by time', async () => {
  const files: Record<string, string> = {}
  const times: Record<string, number> = {}
  for (let i = 0; i < MAX_FILES + 5; i += 1) {
    files[`${dir}/s${i}.jsonl`] = use('Skill', { skill: i < 5 ? 'old' : 'new' })
    times[`${dir}/s${i}.jsonl`] = i < 5 ? 1 : 1000 + i
  }
  const got = await pastUse(fakeScan(files, { times }).io)
  expect(got.files).toBe(MAX_FILES)
  expect(got.skills).toEqual({ new: MAX_FILES })
})

test('files without a time still pick 100, by name', async () => {
  const files: Record<string, string> = {}
  for (let i = 0; i < MAX_FILES + 3; i += 1) files[`${dir}/${String(i).padStart(3, '0')}.jsonl`] = use('Skill', { skill: 'k' })
  const f = fakeScan(files)
  expect((await pastUse(f.io)).files).toBe(MAX_FILES)
  expect(f.log.reads).toHaveLength(MAX_FILES)
})

test('other files and folders in the project folder are not session files', async () => {
  const f = fakeScan({ [`${dir}/notes.txt`]: 'x', [`${dir}/sub/c.jsonl`]: use('Skill', { skill: 'z' }), [`${dir}/a.jsonl`]: use('Skill', { skill: 'a' }) })
  expect(await pastUse(f.io)).toEqual({ agents: {}, skills: { a: 1 }, files: 1, skipped: 0 })
})

test('the config folder comes from the setting, else the home folder', async () => {
  const f = fakeScan({ '/cfg/projects/-work-proj/a.jsonl': use('Skill', { skill: 'a' }) }, { configDir: '/cfg' })
  expect((await pastUse(f.io)).files).toBe(1)
})

test('the looser folder name is tried when the first is missing', async () => {
  const f = fakeScan({ '/home/me/.claude/projects/-work-My-App/a.jsonl': use('Skill', { skill: 'a' }) }, { cwd: '/work/My App' })
  expect((await pastUse(f.io)).files).toBe(1)
})

test('no project folder means no past use, not an error', async () => {
  expect(await pastUse(fakeScan({}).io)).toEqual({ agents: {}, skills: {}, files: 0, skipped: 0 })
})

test('a file that cannot be read is left out of the count', async () => {
  const f = fakeScan({ [`${dir}/a.jsonl`]: use('Skill', { skill: 'a' }), [`${dir}/b.jsonl`]: 'x' })
  const io = { ...f.io, read: async (p: string) => (p.endsWith('b.jsonl') ? undefined : f.io.read(p)) }
  expect(await pastUse(io)).toEqual({ agents: {}, skills: { a: 1 }, files: 1, skipped: 0 })
})
