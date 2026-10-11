import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { AMBER } from '../hooks/office'
import { FOUR, PANE, START, SURFACES, host } from './host'

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

test('a specialist at work is one full-width row: avatar, name and task, then what it is doing, with its time and tokens', async ($, on) => {
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

    // Line 1: the name in bold, then the task, dim.
    expect((await ui.find({ type: 'Text', text: /^\w+ the Tester$/ }))?.props.bold).toBe(true)
    const task = await ui.find({ type: 'Text', text: /^ Build redesigned panel$/ })
    expect(task?.props.dimColor).toBe(true)
    // Line 2: one plain sentence, then the time and tokens, dim.
    const sentence = await ui.find({ type: 'Text', text: /^Reading panel\.ts$/ })
    expect(sentence).toBeDefined()
    expect(sentence?.props.color).toBeUndefined()
    // The tool line is muted, so what the specialist says reads as the main line above it.
    expect(sentence?.props.dimColor).toBe(true)
    const stats = await ui.find({ type: 'Text', text: /^ · 12m · 84K tokens$/ })
    expect(stats?.props.dimColor).toBe(true)
    // The old card's words are gone.
    expect(await ui.find({ type: 'Text', text: /Working · / })).toBeUndefined()
    await ui.unmount()
  }
  // Both lines wrap: nothing in the row is cut to fit.
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const lines = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'wrap' && /Tester|Reading panel/.test(t.text))
  expect(lines.length).toBeGreaterThanOrEqual(2)
  expect((await ui.findAll({ type: 'Text' })).some(t => /Tester/.test(t.text) && t.props.wrap === 'truncate')).toBe(false)
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

test('a long task wraps in the row: it is never cut with a mark', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn({ prompt: 'p', description: 'Write a very long description '.repeat(10), subagentType: 'ecc:tdd-guide' } as never)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const line = (await ui.findAll({ type: 'Text' })).find(t => /^\w+ the Tester Write a very long/.test(t.text))
  expect(line).toBeDefined()
  expect(line?.props.wrap).toBe('wrap')
  expect(line?.text).not.toContain('\n')
  expect(line?.text).not.toMatch(/…/)
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

test('a long sentence wraps in the row, is kept whole up to a generous length and never ends in a mark', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  const note = `Run all of the ${'long '.repeat(15)}checks`
  const { lines, row } = await sentenceAfter($, 'Bash', { command: 'x', description: note })
  expect(lines).toContain(note)
  expect(lines.join('\n')).not.toMatch(/…/)
  const text = JSON.stringify(row)
  expect(text).not.toContain('"wrap":"truncate"')
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
    // A question waiting on you is not muted: it needs you.
    expect(waiting?.props.dimColor).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Now: $/ })).toBeUndefined()
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


// ---- What the specialist is saying: its own words, one to three sentences, wrapped ----

const linesOf = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts
}

test('the row shows what the specialist says, wrapped, with only its time and tokens under it, and the words stay until newer words replace them', async ($, on) => {
  hostWithSpecialist(on)
  let answer = 'Now I will read the scoring rules. They decide the ranking. I will compare them with the tests. Then I will report.'
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn(BUILD)
  await step($, 0)
  await call($, 'Read', { file_path: '/repo/scoring.ts' })

  for (const surface of SURFACES) {
    const texts = await linesOf($, surface)
    const line = texts.find(t => t.text.startsWith('Now I will read the scoring rules.'))
    // One to three sentences, in full.
    expect(line?.text).toBe('Now I will read the scoring rules. They decide the ranking. I will compare them with the tests.')
    expect(line?.props.wrap).toBe('wrap')
    expect(line?.props.dimColor).toBeUndefined()
    // Its words are in italics, as someone speaking.
    expect(line?.props.italic).toBe(true)
    // Under them only the time and tokens, muted: the tool is not repeated when the specialist has said what it does.
    const all = texts.map(t => t.text)
    expect(all).not.toContain('Reading scoring.ts')
    expect(all).not.toContain('Now: ')
    const stats = texts.find(t => /^\d+[sm]( · [\d.]+K tokens)?$/.test(t.text))
    expect(stats?.props.dimColor).toBe(true)
  }

  // The next request starts, and a step that only calls a tool says nothing: the last words stay, and the tool is not shown.
  answer = ''
  await step($, 1)
  await call($, 'Bash', { command: 'sleep 15', description: 'Pausing a moment' })
  const kept = (await linesOf($)).map(t => t.text)
  expect(kept.some(t => t.startsWith('Now I will read the scoring rules.'))).toBe(true)
  expect(kept).not.toContain('Pausing a moment')

  // New words replace them.
  answer = 'The ranking looks right. Checking the footer next.'
  const run = $.turn.step({ turnId: 'r1', index: 2, model: 'm', messageCount: 7, agentId: 't1' } as never)
  await run.next()
  let part = await run.next()
  while (!part.done) part = await run.next()
  await call($, 'Edit', { file_path: '/repo/footer.tsx', old_string: 'a', new_string: 'b' })
  const after = await linesOf($)
  expect(after.some(t => t.text === 'The ranking looks right. Checking the footer next.')).toBe(true)
  expect(after.some(t => t.text.startsWith('Now I will read'))).toBe(false)
  expect(after.map(t => t.text)).not.toContain('Editing footer.tsx')
})

test('a step that only calls tools says nothing, so the row shows just the tool line', async ($, on) => {
  hostWithSpecialist(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn(BUILD)
  await step($, 0)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  const texts = (await linesOf($)).map(t => t.text)
  expect(texts).toContain('Reading a.ts')
  // With nothing said, the tool line stands in, labelled.
  expect(texts).toContain('Now: ')
  expect(texts.some(t => /^(Now I|I will)/.test(t))).toBe(false)
})

test('the words are the specialist\'s own and are kept short: only the first sentences, with nothing of its code', async ($, on) => {
  hostWithSpecialist(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '```sh\nexport TOKEN=SECRET\n```\nWriting the config now.', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn(BUILD)
  await step($, 0)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const drawn = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(drawn).toContain('Writing the config now.')
  expect(drawn).not.toContain('SECRET')
})

test('words that arrive after a run was sent home are not kept: if the run goes on, the row does not show them', async ($, on) => {
  const agents = [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }]
  const { clock } = host(on, agents)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  on('turn.step', async function* (_$, e) {
    await gate
    return { turnId: e.turnId, index: e.index, answer: 'Writing the config with the key now.', toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.session.start(START)
  await $.agent.spawn(BUILD)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  // A request goes out; while it is out, the engine's list says the run is over and the quiet rule sends it home.
  const run = $.turn.step({ turnId: 'r1', index: 1, model: 'm', messageCount: 5, agentId: 't1' } as never)
  const first = run.next()
  agents[0]!.status = 'completed'
  await clock.advance(30_000)
  expect((await linesOf($)).map(t => t.text)).not.toContain('Thinking')
  release()
  await first
  let part = await run.next()
  while (!part.done) part = await run.next()

  // The run shows life again (the list was wrong): the late words must not come back with it.
  agents[0]!.status = 'running'
  await call($, 'Edit', { file_path: '/repo/b.ts', old_string: 'a', new_string: 'b' })
  const texts = (await linesOf($)).map(t => t.text)
  expect(texts).toContain('Editing b.ts')
  expect(texts.join('\n')).not.toContain('with the key')
})
