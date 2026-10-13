import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FOUR, PANE, START, SURFACES, host } from './host'

const MIN = 60_000
const BUILD = { prompt: 'Build the panel', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide' } as never
const call = ($: Engine, tool: string, input: Record<string, unknown>, agentId = 't1') => $.tool.call({ tool, ...input, agentId } as never)
const step = async ($: Engine, index: number, agentId = 't1') => {
  const run = $.turn.step({ turnId: 'r1', index, model: 'm', messageCount: 3, agentId } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
}
const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 83_490, cache_creation_input_tokens: 0 }

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
    expect((await ui.find({ type: 'Text', text: /^Tester$/ }))?.props.bold).toBe(true)
    const task = await ui.find({ type: 'Text', text: /^ Build redesigned panel$/ })
    expect(task?.props.dimColor).toBe(true)
    // Line 2: one plain sentence, then the time and tokens, dim.
    const sentence = await ui.find({ type: 'Text', text: /^Reading panel\.ts$/ })
    expect(sentence).toBeDefined()
    expect(sentence?.props.color).toBeUndefined()
    // The tool line is muted, so what the specialist says reads as the main line above it.
    expect(sentence?.props.dimColor).toBe(true)
    const stats = await ui.find({ type: 'Text', text: /^ · Opus 5\.5 · 12m · 84K tokens$/ })
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
  const line = (await ui.findAll({ type: 'Text' })).find(t => /^Tester Write a very long/.test(t.text))
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

test('a row never waits on the person: its border stays dim and its line stays muted, whatever its report will ask', async ($, on) => {
  const { clock } = hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  await clock.advance(4 * MIN)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Waiting on you/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^Reading a\.ts$/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^ · Opus 5\.5 · 4m$/ }))?.props.dimColor).toBe(true)
    const row = await ui.find({ key: 'desk-t1' })
    expect(row?.props.borderColor).toBeUndefined()
    expect(row?.props.borderDimColor).toBe(true)
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
    // Under them only the model, time and tokens, muted: the tool is not repeated when the specialist has said what it does.
    const all = texts.map(t => t.text)
    expect(all).not.toContain('Reading scoring.ts')
    expect(all).not.toContain('Now: ')
    const stats = texts.find(t => /^Opus 5\.5 · \d+[sm]( · [\d.]+K tokens)?$/.test(t.text))
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


// ---- A specialist is known by its role: one or two plain words, no made-up name ----

test('a specialist reads as its role alone, and two of one role read the same, each told apart by its task', async ($, on) => {
  const agents = [
    { id: 't1', type: 'ecc:tdd-guide', description: 'First job', status: 'running' },
    { id: 't2', type: 'ecc:tdd-guide', description: 'Second job', status: 'running' },
  ]
  host(on, agents)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `t${(n += 1)}` }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn({ prompt: 'p', description: 'First job', subagentType: 'ecc:tdd-guide' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Second job', subagentType: 'ecc:tdd-guide' } as never)
  await call($, 'Read', { file_path: '/repo/a.ts' }, 't1')
  await call($, 'Read', { file_path: '/repo/a.ts' }, 't2')
  for (const surface of SURFACES) {
    const texts = (await linesOf($, surface)).map(t => t.text)
    expect(texts.filter(t => t === 'Tester')).toHaveLength(2)
    expect(texts).toContain(' First job')
    expect(texts).toContain(' Second job')
    expect(texts.some(t => /#\d|\bthe Tester\b/.test(t))).toBe(false)
  }
})

// ---- Labels come from the given name or the agent type, never from words in the brief ----

type Cells = { type: string; props: { cells?: string; rows?: number; columns?: number; source?: string } }
const pictureOf = (node: unknown): Cells | undefined => {
  if (typeof node !== 'object' || node === null) return undefined
  const tree = node as Tree
  if (tree.type === 'Raster' || tree.type === 'Svg') return tree as unknown as Cells
  for (const child of tree.children ?? []) { const hit = pictureOf(child); if (hit) return hit }
  return undefined
}

test('two named general agents read as their names and get different pictures; the brief does not decide', async ($, on) => {
  const agents = [
    { id: 'n1', type: 'general-purpose', description: 'Designer proposal', status: 'running', name: 'designer' },
    { id: 'n2', type: 'general-purpose', description: 'Engineer proposal', status: 'running', name: 'engineer' },
  ]
  host(on, agents)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `n${(n += 1)}` }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  // Each brief is full of words that used to steer the label the wrong way.
  await $.agent.spawn({ prompt: 'Argue the technical side as an engineer would; test and execute.', description: 'Designer proposal', subagentType: 'general-purpose', name: 'designer' } as never)
  await $.agent.spawn({ prompt: 'Write tests, review the plan and execute it.', description: 'Engineer proposal', subagentType: 'general-purpose', name: 'engineer' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toContain('Designer')
    expect(texts).toContain('Engineer')
    expect(texts.some(t => /^(Tester|Executive|Generalist)$/.test(t))).toBe(false)
    const [one, two] = [pictureOf(await ui.find({ key: 'desk-n1' })), pictureOf(await ui.find({ key: 'desk-n2' }))]
    expect(one).toBeDefined()
    expect(JSON.stringify(one!.props)).not.toBe(JSON.stringify(two!.props))
    await ui.unmount()
  }
})

test('an unnamed general agent is a Generalist even when its brief talks of testing and executing', async ($, on) => {
  host(on, [{ id: 'g1', type: 'general-purpose', description: 'Check README against plugin', status: 'running' }])
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'g1' }))
  await $.agent.spawn({ prompt: 'Execute a careful check; test every claim an engineer would.', description: 'Check README against plugin', subagentType: 'general-purpose' } as never)
  for (const surface of SURFACES) {
    const texts = (await linesOf($, surface)).map(t => t.text)
    expect(texts).toContain('Generalist')
    expect(texts.some(t => /^(Tester|Executive|Engineer)$/.test(t))).toBe(false)
  }
})

test('the toast and Clawd use the same label as the row: a named agent finishes under its name', async ($, on) => {
  const { toasts } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'n1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Designer proposal', subagentType: 'general-purpose', name: 'designer' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'n1', isAborted: false } as never)
  expect(toasts.find(t => t.includes('finished'))).toMatch(/^\S+ Designer finished: Designer proposal \(/)
})

// ---- On the terminal a specialist's picture is the small one, so the words get the room ----

test('on the terminal a specialist row draws the tiny picture and Clawd his small one; elsewhere both are full size', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await call($, 'Read', { file_path: '/repo/a.ts' })
  const terminal = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const small = pictureOf(await terminal.find({ key: 'desk-t1' }))!
  const drawn = (await terminal.drawn()) as unknown
  await terminal.unmount()
  // A half-block row is two picture rows: the 8 by 8 picture is 4 rows and 8 columns at most.
  expect(small.props.rows).toBeLessThanOrEqual(4)
  expect(small.props.columns).toBeLessThanOrEqual(8)
  // Clawd's own picture, the first one in the pane, is his small drawing: no taller than a specialist's, and wider.
  expect(pictureOf(drawn)!.props.rows).toBeLessThanOrEqual(4)
  expect(pictureOf(drawn)!.props.columns).toBeGreaterThan(small.props.columns!)

  const desktop = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  const big = pictureOf(await desktop.find({ key: 'desk-t1' })) as unknown as { props: { height: number } }
  await desktop.unmount()
  expect(big.props.height).toBeGreaterThan(40)
})

test('a new hire\'s row names its model at once, before its first step', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5 · / })).toBeDefined()
    await ui.unmount()
  }
})

test('a hire whose model comes back empty shows only its time, with no stray separator', async ($, on) => {
  host(on, [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }])
  on('agent.spawn', () => ({ model: '', agentId: 't1' }))
  await $.agent.spawn(BUILD)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^ · \d+s$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus|· ·/ })).toBeUndefined()
  await ui.unmount()
})

test('a specialist at work moves a little: its picture changes from beat to beat and never changes size; a finished one stands still', async ($, on) => {
  const { clock } = hostWithSpecialist(on)
  await $.session.start(START)
  await $.agent.spawn(BUILD)
  for (const surface of SURFACES) {
    const seen = new Set<string>()
    const sizes = new Set<string>()
    for (let beat = 0; beat < 14; beat += 1) {
      await clock.advance(400)
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
      const picture = surface === 'terminal'
        ? (await ui.findAll({ type: 'Raster' })).find(r => r.props.key === 'desk-t1')!
        : (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.height !== 4)[1]!
      seen.add(String(surface === 'terminal' ? picture.props.cells : picture.props.source))
      sizes.add(surface === 'terminal' ? `${picture.props.columns}x${picture.props.rows}` : `${picture.props.width}x${picture.props.height}`)
      await ui.unmount()
    }
    expect(seen.size).toBeGreaterThanOrEqual(2)
    expect(sizes.size).toBe(1)
  }
})
