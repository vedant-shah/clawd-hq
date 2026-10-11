import { expect, test } from 'claude-code/testing'
import { READING_BRIEF, THINKING, sentenceOf } from '../hooks/activity'

test('reading, editing and writing name the file, never the path', () => {
  expect(sentenceOf('Read', { file_path: '/Users/me/repo/src/scoring.ts' })).toBe('Reading scoring.ts')
  expect(sentenceOf('Edit', { file_path: '/repo/src/panel.tsx', old_string: 'a', new_string: 'b' })).toBe('Editing panel.tsx')
  expect(sentenceOf('MultiEdit', { file_path: '/repo/src/panel.tsx' })).toBe('Editing panel.tsx')
  expect(sentenceOf('NotebookEdit', { notebook_path: '/repo/analysis.ipynb' })).toBe('Editing analysis.ipynb')
  expect(sentenceOf('Write', { file_path: '/repo/docs/plan.md' })).toBe('Writing plan.md')
  expect(sentenceOf('Read', { file_path: 'C:\\repo\\notes.txt' })).toBe('Reading notes.txt')
  expect(sentenceOf('Read', { file_path: '/repo/src/' })).toBe('Reading src')
})

test('a file tool with no usable path still says something plain', () => {
  expect(sentenceOf('Read', {})).toBe('Reading a file')
  expect(sentenceOf('Edit', { file_path: 42 })).toBe('Editing a file')
  expect(sentenceOf('Write', { file_path: '' })).toBe('Writing a file')
})

test('a Bash call shows its own description, and never the command', () => {
  const command = 'curl -H "Authorization: Bearer sk-live-SECRET" https://api.example.com && echo $TOKEN'
  expect(sentenceOf('Bash', { command, description: 'Fetch the account list' })).toBe('Fetch the account list')
  const bare = sentenceOf('Bash', { command })
  expect(bare).toBe('Running a command')
  expect(bare).not.toContain('SECRET')
  expect(sentenceOf('Bash', { command, description: '   ' })).toBe('Running a command')
  expect(sentenceOf('Bash', { command, description: 42 })).toBe('Running a command')
  expect(sentenceOf('Bash', { command, description: 'Fetch the account list' })).not.toContain('SECRET')
})

test('searching the code or the web quotes the pattern or query, cut to about 30 characters', () => {
  expect(sentenceOf('Grep', { pattern: 'computeScore' })).toBe('Searching the code for “computeScore”')
  expect(sentenceOf('Glob', { pattern: '**/*.tsx' })).toBe('Searching the code for “**/*.tsx”')
  expect(sentenceOf('WebSearch', { query: 'claude code plugin api' })).toBe('Searching the web for “claude code plugin api”')
  const long = sentenceOf('Grep', { pattern: 'a'.repeat(80) })
  expect(long).toBe(`Searching the code for “${'a'.repeat(29)}…”`)
  expect(sentenceOf('WebSearch', { query: 'one\ntwo   three' })).toBe('Searching the web for “one two three”')
  expect(sentenceOf('Grep', {})).toBe('Searching the code')
  expect(sentenceOf('WebSearch', {})).toBe('Searching the web')
})

test('fetching a page names the host, not the address', () => {
  expect(sentenceOf('WebFetch', { url: 'https://docs.example.com/guide/start?token=abc#top', prompt: 'x' })).toBe('Reading docs.example.com')
  expect(sentenceOf('WebFetch', { url: 'not a url' })).toBe('Reading a web page')
  expect(sentenceOf('WebFetch', {})).toBe('Reading a web page')
})

test('briefing another agent, using a skill and sending a message', () => {
  expect(sentenceOf('Agent', { subagent_type: 'Explore', description: 'Map it', prompt: 'p' })).toBe('Briefing an Explore')
  expect(sentenceOf('Task', { subagent_type: 'ecc:planner' })).toBe('Briefing a planner')
  expect(sentenceOf('Agent', { subagent_type: 'acme-ops:(o_o) data-analyst' })).toBe('Briefing a data-analyst')
  expect(sentenceOf('Agent', {})).toBe('Briefing an agent')
  expect(sentenceOf('Skill', { skill: 'ecc:tdd-workflow' })).toBe('Using the tdd-workflow skill')
  expect(sentenceOf('Skill', { skill: 'simplify' })).toBe('Using the simplify skill')
  expect(sentenceOf('Skill', {})).toBe('Using a skill')
  expect(sentenceOf('SendMessage', { to: 'a1', message: 'secret plan' })).toBe('Sending a message')
})

test('an MCP tool reads as its server, then its name in words', () => {
  expect(sentenceOf('mcp__github__create_pull_request', { title: 'x' })).toBe('Using github: create pull request')
  expect(sentenceOf('mcp__clawd-hq__demo', {})).toBe('Using clawd-hq: demo')
  expect(sentenceOf('mcp__github', {})).toBe('Using github')
})

test('any other tool is named plainly', () => {
  expect(sentenceOf('TodoWrite', { todos: [] })).toBe('Using TodoWrite')
  expect(sentenceOf('ToolSearch', { query: 'select:Foo' })).toBe('Using ToolSearch')
})

test('a sentence is always one line of at most 80 characters', () => {
  const wordy = `Run the whole\nintegration suite ${'and then keep going '.repeat(10)}`
  const bash = sentenceOf('Bash', { command: 'x', description: wordy })
  expect(bash).not.toContain('\n')
  expect(bash.length).toBeLessThanOrEqual(80)
  expect(bash.endsWith('…')).toBe(true)
  const file = sentenceOf('Read', { file_path: `/repo/${'very-long-name-'.repeat(12)}.ts` })
  expect(file.length).toBeLessThanOrEqual(80)
  expect(file.startsWith('Reading very-long-name-')).toBe(true)
  const skill = sentenceOf('Skill', { skill: 'x'.repeat(200) })
  expect(skill.length).toBeLessThanOrEqual(80)
  expect(sentenceOf('mcp__srv__' + 'tool_'.repeat(40), {}).length).toBeLessThanOrEqual(80)
})

test('the two resting sentences', () => {
  expect(THINKING).toBe('Thinking')
  expect(READING_BRIEF).toBe('Reading the brief')
})

test('a sentence deliberately keeps the quoted search pattern or query, so the user can see what a specialist is looking for', () => {
  expect(sentenceOf('Grep', { pattern: 'TODO' })).toContain('“TODO”')
  expect(sentenceOf('WebSearch', { query: 'rate limit headers' })).toContain('“rate limit headers”')
})
