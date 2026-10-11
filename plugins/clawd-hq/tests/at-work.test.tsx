import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { AMBER } from '../hooks/office'
import { FOUR, PANE, SURFACES, host } from './host'

const MIN = 60_000
const BUILD = { prompt: 'Build the panel', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide' } as never
const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId = 't1') => $.tool.call({ tool, ...input, agentId } as never)
const step = async ($: Engine, index: number, agentId = 't1') => {
  const run = $.turn.step({ turnId: 'r1', index, model: 'm', messageCount: 3, agentId } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
}
const usage = { model: 'm', input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 83_490, cache_creation_input_tokens: 0 }

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const find = (node: unknown, key: string): Tree | undefined => {
  if (typeof node !== 'object' || node === null) return undefined
  const tree = node as Tree
  if (tree.props?.key === key) return tree
  for (const child of tree.children ?? []) { const hit = find(child, key); if (hit) return hit }
  return undefined
}

/** The sentence a specialist shows on the Office pane, after one tool call. */
async function sentenceAfter($: Engine, tool: string, input: Record<string, unknown>, surface: 'terminal' | 'desktop' = 'terminal') {
  await call($, tool, input)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const row = await ui.find({ key: 'desk-t1' })
  const lines = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return { row, lines }
}

function hostWithSpecialist(on: Parameters<typeof host>[0]) {
  const h = host(on, [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  return h
}

test('a specialist at work is one full-width row: avatar, name and task, then a sentence with its time and tokens', async ($, on) => {
  const { clock } = hostWithSpecialist(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn(BUILD)
  await step($, 0)
  await call($, 'Read', { file_path: '/repo/src/panel.ts' })
  await clock.advance(12 * MIN)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const row = await ui.find({ key: 'desk-t1' })
    // As wide as the pane: no width of its own, in a column of rows that does not wrap.
    expect(row?.props.width).toBeUndefined()
    expect(row?.props.flexDirection).toBe('row')
    expect((await ui.find({ key: 'floor-rows' }))?.props).toMatchObject({ flexDirection: 'column' })
    expect((await ui.find({ key: 'floor-rows' }))?.props.flexWrap).toBeUndefined()

    // Line 1: the name in bold, then the task, dim, cut with an ellipsis when long.
    expect((await ui.find({ type: 'Text', text: /^\w+ the Tester$/ }))?.props.bold).toBe(true)
    const task = await ui.find({ type: 'Text', text: /^ Build redesigned panel$/ })
    expect(task?.props.dimColor).toBe(true)
    // Line 2: one plain sentence, then the time and tokens, dim.
    const sentence = await ui.find({ type: 'Text', text: /^Reading panel\.ts$/ })
    expect(sentence).toBeDefined()
    expect(sentence?.props.color).toBeUndefined()
    const stats = await ui.find({ type: 'Text', text: /^ · 12m · 84K tokens$/ })
    expect(stats?.props.dimColor).toBe(true)
    // The old card's words are gone.
    expect(await ui.find({ type: 'Text', text: /Working · / })).toBeUndefined()
    await ui.unmount()
  }
  // Both lines are cut, never wrapped.
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const lines = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'truncate')
  expect(lines.length).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('every specialist at work gets its own row, one under the other', async ($, on) => {
  host(on, ['r1', 'r2', 'r3'].map(id => ({ id, type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' })))
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `r${(n += 1)}` }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  for (const id of ['r1', 'r2', 'r3']) {
    await $.agent.spawn(BUILD)
    await call($, 'Read', { file_path: `/repo/${id}.ts` }, id)
  }
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /AT WORK · 3/ })).toBeDefined()
  const sentences = (await ui.findAll({ type: 'Text', text: /^Reading r\d\.ts$/ })).map(t => String(t.text))
  expect(sentences).toEqual(['Reading r1.ts', 'Reading r2.ts', 'Reading r3.ts'])
  const floor = find(await ui.drawn(), 'floor-rows')
  expect((floor?.children ?? []).filter(c => typeof c === 'object')).toHaveLength(3)
  await ui.unmount()
})

test('a long task is cut to one line, not wrapped', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn({ prompt: 'p', description: 'Write a very long description '.repeat(10), subagentType: 'ecc:tdd-guide' } as never)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const line = (await ui.findAll({ type: 'Text' })).find(t => t.props.wrap === 'truncate' && /^\w+ the Tester Write a very long/.test(t.text))
  expect(line).toBeDefined()
  expect(line?.text).not.toContain('\n')
  // The task is cut where it is stored, with an ellipsis, so even a pane that cannot truncate shows one line.
  expect(line?.text.endsWith('…')).toBe(true)
  await ui.unmount()
})

// ---- The sentence, from the tool call the specialist really made ----

const CASES: Array<[string, Record<string, unknown>, string]> = [
  ['Read', { file_path: '/Users/me/repo/src/scoring.ts' }, 'Reading scoring.ts'],
  ['Edit', { file_path: '/repo/src/panel.tsx', old_string: 'a', new_string: 'b' }, 'Editing panel.tsx'],
  ['NotebookEdit', { notebook_path: '/repo/nb/analysis.ipynb', new_source: 'x' }, 'Editing analysis.ipynb'],
  ['Write', { file_path: '/repo/docs/plan.md', content: 'x' }, 'Writing plan.md'],
  ['Bash', { command: 'npm test', description: 'Run the unit tests' }, 'Run the unit tests'],
  ['Grep', { pattern: 'computeScore' }, 'Searching the code for “computeScore”'],
  ['Glob', { pattern: '**/*.tsx' }, 'Searching the code for “**/*.tsx”'],
  ['WebSearch', { query: 'claude code plugins' }, 'Searching the web for “claude code plugins”'],
  ['WebFetch', { url: 'https://docs.example.com/guide?x=1', prompt: 'p' }, 'Reading docs.example.com'],
  ['Agent', { subagent_type: 'ecc:planner', description: 'd', prompt: 'p' }, 'Briefing a planner'],
  ['Skill', { skill: 'ecc:tdd-workflow' }, 'Using the tdd-workflow skill'],
  ['SendMessage', { to: 'x', message: 'm' }, 'Sending a message'],
  ['mcp__github__create_pull_request', { title: 't' }, 'Using github: create pull request'],
  ['TodoWrite', { todos: [] }, 'Using TodoWrite'],
]

for (const [tool, input, expected] of CASES) {
  test(`the row says "${expected}" after a ${tool} call, on the terminal and the desktop`, async ($, on) => {
    hostWithSpecialist(on)
    await $.agent.spawn(BUILD)
    for (const surface of SURFACES) {
      const { lines } = await sentenceAfter($, tool, input, surface)
      expect(lines).toContain(expected)
    }
  })
}

test('a Bash command with no description reads "Running a command" and its text never reaches the panel', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  const command = 'curl -H "Authorization: Bearer sk-live-SECRET" https://api.example.com'
  for (const surface of SURFACES) {
    const { lines } = await sentenceAfter($, 'Bash', { command }, surface)
    expect(lines).toContain('Running a command')
    expect(lines.join('\n')).not.toMatch(/SECRET|curl|api\.example/)
  }
  // Nor does it stay in the kept state, which the panel (and any export of it) can read.
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(JSON.stringify(await ui.drawn())).not.toContain('SECRET')
  await ui.unmount()
})

test('a sentence is one line of at most 80 characters, with a path cut to the file name', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  const { lines } = await sentenceAfter($, 'Bash', { command: 'x', description: `Run all\nof the ${'long '.repeat(40)}checks` })
  const sentence = lines.find(l => l.startsWith('Run all of the') && l.endsWith('…'))
  expect(sentence).toBeDefined()
  expect(sentence!.length).toBeLessThanOrEqual(80)
  expect(sentence).not.toContain('\n')
})

test('before anything is seen the row reads "Reading the brief"; a model step with no tool call since reads "Thinking"', async ($, on) => {
  hostWithSpecialist(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn(BUILD)
  const sentence = async () => {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
    const lines = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
    await ui.unmount()
    return lines
  }
  expect(await sentence()).toContain('Reading the brief')

  await call($, 'Read', { file_path: '/repo/a.ts' })
  expect(await sentence()).toContain('Reading a.ts')
  // The next request: the specialist is working out what to do with what it read.
  await step($, 1)
  const after = await sentence()
  expect(after).toContain('Thinking')
  expect(after).not.toContain('Reading a.ts')
  await call($, 'Edit', { file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  expect(await sentence()).toContain('Editing a.ts')
})

test('a specialist waiting on you shows "Waiting on you: <the question>" in amber instead, with its time and tokens still dim', async ($, on) => {
  const { clock } = hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  await call($, 'mcp__clawd-hq__ask_ceo', { kind: 'decision', question: 'Store scores in DynamoDB or Postgres?', options: ['DynamoDB', 'Postgres'] })
  await clock.advance(4 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const waiting = await ui.find({ type: 'Text', text: /^Waiting on you: Store scores in DynamoDB or Postgres\?$/ })
    expect(waiting?.props.color).toBe(AMBER)
    expect((await ui.find({ type: 'Text', text: /^ · 4m$/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ key: 'desk-t1' }))?.props.borderColor).toBe(AMBER)
    expect(await ui.find({ type: 'Text', text: /^Reading a\.ts$/ })).toBeUndefined()
    await ui.unmount()
  }
})

/** Every value the plugin writes to its state, as text: what is stored, which the panes (and any export of it) can read. */
function recordWrites(on: Parameters<typeof host>[0]) {
  const writes: string[] = []
  on('state.set', (_$, e, next) => { writes.push(JSON.stringify(e)); return next(e) })
  return writes
}

test('a raw shell command is stored nowhere: not in the boss state, not in the staff state, not in any pane', async ($, on) => {
  hostWithSpecialist(on)
  const writes = recordWrites(on)
  await $.agent.spawn(BUILD)
  const command = 'curl -H "Authorization: Bearer sk-live-SECRET" https://api.example.com'
  // Once for the main conversation (Clawd himself), once for the specialist.
  await $.tool.call({ tool: 'Bash', command } as never)
  await call($, 'Bash', { command })

  const stored = writes.join('\n')
  // The sentence is stored (twice: Clawd's line and the specialist's), the command never.
  expect(stored).toContain('"activity":"Running a command"')
  expect(stored.match(/Running a command/g)!.length).toBeGreaterThanOrEqual(2)
  expect(stored).not.toContain('SECRET')
  expect(stored).not.toContain('curl')
  for (const surface of SURFACES) {
    for (const pane of FOUR) {
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
      expect(JSON.stringify(await ui.drawn())).not.toContain('SECRET')
      await ui.unmount()
    }
  }
})

test('Clawd\'s own activity line says what he is doing in the same plain sentences, patterns and all', async ($, on) => {
  hostWithSpecialist(on)
  const writes = recordWrites(on)
  await $.tool.call({ tool: 'Grep', pattern: 'computeScore' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as never)
  const stored = writes.join('\n')
  expect(stored).toContain('"activity":"Searching the code for “computeScore”"')
  expect(stored).toContain('"activity":"Reading a.ts"')
})
