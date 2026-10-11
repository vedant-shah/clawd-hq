import { expect, test } from 'claude-code/testing'
import { READING_BRIEF, THINKING, narrationOf, sentenceOf } from '../hooks/activity'

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

test('searching the code or the web quotes the pattern or query, cut to 40 characters, without a mark', () => {
  expect(sentenceOf('Grep', { pattern: 'computeScore' })).toBe('Searching the code for “computeScore”')
  expect(sentenceOf('Glob', { pattern: '**/*.tsx' })).toBe('Searching the code for “**/*.tsx”')
  expect(sentenceOf('WebSearch', { query: 'claude code plugin api' })).toBe('Searching the web for “claude code plugin api”')
  const long = sentenceOf('Grep', { pattern: 'a'.repeat(80) })
  expect(long).toBe(`Searching the code for “${'a'.repeat(40)}”`)
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

test('a sentence is one line that wraps in the pane: it is cut only at a word and never ends in a mark', () => {
  const wordy = `Run the whole\nintegration suite ${'and then keep going '.repeat(20)}`
  const bash = sentenceOf('Bash', { command: 'x', description: wordy })
  expect(bash).not.toContain('\n')
  expect(bash.length).toBeLessThanOrEqual(200)
  expect(bash).not.toMatch(/…|\.\.\.|\s$/)
  expect(bash.startsWith('Run the whole integration suite and then keep going')).toBe(true)
  // A sentence of ordinary length is kept whole.
  const note = 'Run the whole integration suite and then keep going until the end of the run'
  expect(sentenceOf('Bash', { command: 'x', description: note })).toBe(note)
  const file = sentenceOf('Read', { file_path: `/repo/${'very-long-name-'.repeat(20)}.ts` })
  expect(file.length).toBeLessThanOrEqual(200)
  expect(file.startsWith('Reading very-long-name-')).toBe(true)
})

test('the two resting sentences', () => {
  expect(THINKING).toBe('Thinking')
  expect(READING_BRIEF).toBe('Reading the brief')
})

test('a sentence deliberately keeps the quoted search pattern or query, so the user can see what a specialist is looking for', () => {
  expect(sentenceOf('Grep', { pattern: 'TODO' })).toContain('“TODO”')
  expect(sentenceOf('WebSearch', { query: 'rate limit headers' })).toContain('“rate limit headers”')
})

// ---- The specialist's own words ----

test('what a specialist says is its first one to three sentences, in its own words', () => {
  expect(narrationOf('I will run the tests now.')).toBe('I will run the tests now.')
  expect(narrationOf('Now I will run the tests. They cover the scoring rules. After that I will fix what fails. Then I will report back.'))
    .toBe('Now I will run the tests. They cover the scoring rules. After that I will fix what fails.')
  expect(narrationOf('  Checking\nthe   panel.  Then the footer.  ')).toBe('Checking the panel. Then the footer.')
  // A question or an exclamation ends a sentence too.
  expect(narrationOf('Found it! The bug is in scores.ts. Fixing that now.')).toBe('Found it! The bug is in scores.ts. Fixing that now.')
})

test('what a specialist says is plain text: code, links and marks are dropped, a list or a table is not a sentence', () => {
  expect(narrationOf('I will edit `scores.ts` and the **footer**.')).toBe('I will edit scores.ts and the footer.')
  expect(narrationOf('See [the guide](https://example.com/a) first. Then I start.')).toBe('See the guide first. Then I start.')
  expect(narrationOf('```ts\nconst a = 1\n```\nThat compiles. Moving on.')).toBe('That compiles. Moving on.')
  // A heading is its own block, not part of the sentence after it; a list under an intro line is not read.
  expect(narrationOf('## Plan\nFirst the tests. Then the code.')).toBe('First the tests. Then the code.')
  expect(narrationOf('Checking files:\n- a.ts\n- b.ts')).toBe('Checking files:')
  expect(narrationOf('Two things:\n1. a\n2. b\nThen done.')).toBe('Two things:')
  // Only paired marks are dropped: a lone star or a code span in a sentence stays what it is.
  expect(narrationOf('Edit src/*.ts and compute 2 * 3 now.')).toBe('Edit src/*.ts and compute 2 * 3 now.')
  expect(narrationOf('Run ```npm test``` now. Then stop.')).toBe('Run npm test now. Then stop.')
  expect(narrationOf('This is **bold** and ~~gone~~ text.')).toBe('This is bold and gone text.')
  expect(narrationOf('- one\n- two')).toBeUndefined()
  expect(narrationOf('| a | b |\n|---|---|')).toBeUndefined()
  expect(narrationOf('   ')).toBeUndefined()
  expect(narrationOf('')).toBeUndefined()
})

test('what a specialist says is cut only whole sentences at a time, or at a word for one very long sentence, never with a mark', () => {
  const sentence = (n: number) => `Word ${'word '.repeat(n - 1).trim()}.`
  const said = narrationOf(`${sentence(25)} ${sentence(25)} ${sentence(25)}`)!
  expect(said).toBe(`${sentence(25)} ${sentence(25)}`)
  const huge = narrationOf(sentence(200))!
  expect(huge.length).toBeLessThanOrEqual(280)
  expect(huge).not.toMatch(/…|\.\.\.|\s$/)
  expect(huge.startsWith('Word word word')).toBe(true)
})
