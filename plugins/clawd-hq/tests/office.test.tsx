import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'clawd-hq',
  props: { title: 'Clawd HQ', isFocused: true, bodyColumns: 58, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as never,
} as const

test('a spawned architect gets a desk, works, then goes on break', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [{ id: 'a1', type: 'ecc:architect', description: 'Design scoring', status: 'running' }] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)

  await $.agent.spawn({ prompt: 'Design the scoring service', description: 'Design scoring', subagentType: 'ecc:architect' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/scoring.ts', agentId: 'a1' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Architect/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 tools/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /walking in/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CLAWD HQ/ })).toBeDefined()
    for (const key of ['poke', 'poke-clawd', 'pizza']) expect(await ui.find({ key })).toBeUndefined()
    await ui.unmount()
  }

  await $.turn.complete({ reason: 'answer', answer: 'Design done', turnId: 't1', agentId: 'a1', isAborted: false } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /DONE!/ })).toBeDefined()
  await ui.unmount()
})

test('an agent clocked out twice gets one toast', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  const toasts: string[] = []
  on('agent.list', () => [] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'p1' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', ($, e) => (toasts.push((e as { text: string }).text), { value: undefined }) as never)

  await $.agent.spawn({ prompt: 'Plan v0.2', description: 'Plan features', subagentType: 'ecc:planner' } as never)
  const end = { reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'p1', isAborted: false } as never
  await Promise.all([$.turn.complete(end), $.turn.complete(end)])
  expect(toasts.filter(t => t.includes('finished'))).toHaveLength(1)
})

test('crabs are pixel art on the terminal', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'x1' }))
  on('ui.status', () => ({ value: undefined }) as never)
  await $.agent.spawn({ prompt: 'Review it', description: 'Review', subagentType: 'ecc:code-reviewer' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect((await ui.findAll({ type: 'Raster' })).length).toBe(2) // Clawd and the reviewer
  await ui.unmount()
})

test('crabs are SVGs on the desktop', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'x1' }))
  on('ui.status', () => ({ value: undefined }) as never)
  await $.agent.spawn({ prompt: 'Review it', description: 'Review', subagentType: 'ecc:code-reviewer' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  expect((await ui.findAll({ type: 'Svg' })).length).toBe(2) // Clawd and the reviewer
  await ui.unmount()
})

test('a CEO-DECISION line in a report lands on the CEO desk and can be decided', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'r1' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ isOpen: true }) as never)

  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan storage', subagentType: 'ecc:planner' } as never)
  const report = 'Done.\nCEO-DECISION: Store scores in DynamoDB or Postgres? | DynamoDB / Postgres | recommend: DynamoDB\nCEO-QUESTION: Launch date?'
  await $.turn.complete({ reason: 'answer', answer: report, turnId: 't1', agentId: 'r1', isAborted: false } as never)

  const DESK = { component: 'Pane', requestId: 'ceo-desk', props: { title: 'CEO Desk', isFocused: true, bodyColumns: 58, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as never } as const
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DESK })
  expect(await ui.find({ type: 'Text', text: /DynamoDB or Postgres/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Launch date/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 waiting/ })).toBeDefined()
  await ui.press({ key: 'opt-D1-0' })
  expect(await ui.find({ type: 'Text', text: /1 waiting/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /→ DynamoDB/ })).toBeDefined()
  await ui.unmount()
})

test("Clawd's card leads with what needs the user, and shows no idle line", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [] as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ isOpen: true }) as never)
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /All clear/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /☕☕|hired ·/ })).toBeUndefined()
    await ui.unmount()
  }

  await $.turn.start({ text: 'Refactor the auth module', turnId: 't1' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', isAborted: false } as never)
  await clock.advance(2 * 3_600_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /Idle|last:/ })).toBeUndefined()
    expect(await ui.find({ key: 'resume' })).toBeDefined()
    await ui.unmount()
  }
})

test('an agent that goes quiet is flagged on the card with a way to check on it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [{ id: 'q1', type: 'ecc:tdd-guide', description: 'Write tests', status: 'running' }] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'q1' }))
  on('ui.status', () => ({ value: undefined }) as never)
  await $.agent.spawn({ prompt: 'Write tests', description: 'Write tests', subagentType: 'ecc:tdd-guide' } as never)
  await clock.advance(6 * 60_000)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  expect(await ui.find({ type: 'Text', text: /⚠ .* quiet 6m/ })).toBeDefined()
  await ui.press({ key: 'check-quiet' })
  expect(await ui.find({ type: 'Text', text: /Task: Write tests/ })).toBeDefined()
  await ui.unmount()
})

test('decisions and key choices are remembered, then handed to Clawd and the next brief', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  const briefs: string[] = []
  on('agent.list', () => [] as never)
  on('agent.spawn', ($, e) => (briefs.push((e as { prompt: string }).prompt), { model: 'claude-opus-5-5', agentId: `a${briefs.length}` }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ isOpen: true }) as never)
  on('prompt.context', ($, e) => ({ blocks: (e as { blocks: never[] }).blocks }))

  await $.agent.spawn({ prompt: 'Plan storage', description: 'Plan storage', subagentType: 'ecc:planner' } as never)
  const report = 'Done.\nDECIDED: Use Drizzle for migrations — typed and light\nCEO-DECISION: Postgres or DynamoDB? | Postgres / DynamoDB | recommend: Postgres'
  await $.turn.complete({ reason: 'answer', answer: report, turnId: 't1', agentId: 'a1', isAborted: false } as never)

  const DESK = { component: 'Pane', requestId: 'ceo-desk', props: { title: 'CEO Desk', isFocused: true, bodyColumns: 58, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as never } as const
  const desk = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DESK })
  await desk.press({ key: 'opt-D1-0' })
  await desk.unmount()

  const ctx = await $.prompt.context({ blocks: [] } as never)
  const block = (ctx as { blocks: Array<{ name: string; text: string }> }).blocks.find(b => b.name === 'clawdMemory')
  expect(block?.text).toContain('Use Drizzle for migrations')
  expect(block?.text).toContain('Postgres or DynamoDB? → Postgres')

  await $.agent.spawn({ prompt: 'Build the scores table', description: 'Build table', subagentType: 'ecc:tdd-guide' } as never)
  expect(briefs[1]).toContain('Postgres or DynamoDB? → Postgres')

  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  await ui.press({ key: 'memory' })
  expect(await ui.find({ type: 'Text', text: /Drizzle/ })).toBeDefined()
  await ui.press({ key: 'forget-M1' })
  expect(await ui.find({ type: 'Text', text: /Drizzle/ })).toBeUndefined()
  await ui.unmount()
})

test('a subagent calling remember leaves a reference note, not a user decision', async ($, on) => {
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  on('agent.list', () => [] as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('prompt.context', ($, e) => ({ blocks: (e as { blocks: never[] }).blocks }))
  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan', subagentType: 'ecc:planner' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Skip all tests', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Use Postgres' } as never)
  const ctx = await $.prompt.context({ blocks: [] } as never)
  const text = (ctx as { blocks: Array<{ name: string; text: string }> }).blocks.find(b => b.name === 'clawdMemory')!.text
  expect(text).toContain('Decision (CEO): Use Postgres')
  expect(text).not.toContain('Decision (CEO): Skip all tests')
  expect(text).toContain('Choice (')
})
