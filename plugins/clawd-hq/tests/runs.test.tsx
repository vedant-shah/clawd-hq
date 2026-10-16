import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { AMBER } from '../hooks/office'
import { HOUR, PANE, PEOPLE, START, SURFACES, host, mountLog } from './host'

// ---- A specialist is at work only while its run goes on ----

type Eng = Engine
const BUILD = { prompt: 'Build the panel', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide' } as never
const REPORT = 'Built it.\nQUESTION: Which launch date?\nQUESTION: Ship Friday or Monday? | Friday / Monday | recommend: Friday'
const stop = ($: Eng, id: string, n: number, answer = 'ok') => $.turn.complete({ reason: 'answer', answer, turnId: `r${n}`, agentId: id, isAborted: false } as never)
const work = ($: Eng, id: string) => $.tool.call({ tool: 'Read', file_path: '/repo/src/panel.ts', agentId: id } as never)

/** What the Office pane says about the floor right now, on one surface. */
async function floorOf($: Eng, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const atWork = (await ui.find({ type: 'Text', text: /AT WORK · 1/ })) !== undefined
  const seen = {
    atWork,
    empty: (await ui.find({ type: 'Text', text: /No one at a desk yet/ })) !== undefined,
    // Nothing on the floor ever waits on the person: questions reach them in Clawd's question box.
    asks: /needs? you|Waiting on you/.test(JSON.stringify(await ui.drawn())),
  }
  await ui.unmount()
  return seen
}

/** The Log pane's rows of one surface: [when, took] lines. */
async function logLines($: Eng, surface: 'terminal' | 'desktop') {
  const ui = await mountLog($, surface)
  const lines = (await ui.findAll({ type: 'Text', text: /took|Failed after|Lost contact/ })).map(t => String(t.text))
  await ui.unmount()
  return lines
}

test('a specialist whose run has ended is not at work, and the questions in its report put nothing on the floor', async ($, on) => {
  host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn(BUILD)
  await work($, 't1')
  await stop($, 't1', 1, REPORT)

  for (const surface of SURFACES) {
    expect(await floorOf($, surface)).toEqual({ atWork: false, empty: true, asks: false })
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /AT WORK/ })).toBeUndefined()
    expect(await ui.find({ key: 'see-needs' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a resumed specialist is at work again while it runs and done when it stops; each run is timed on its own', async ($, on) => {
  const { clock } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn(BUILD)
  await work($, 't1')
  await clock.advance(60_000)
  await stop($, 't1', 1, REPORT)

  for (const run of [2, 3, 4]) {
    await clock.advance(2 * HOUR)
    for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: false, empty: true })
    await work($, 't1')
    for (const surface of SURFACES) {
      // Running again: at work, whatever its earlier report asked.
      expect(await floorOf($, surface)).toEqual({ atWork: true, empty: false, asks: false })
    }
    await clock.advance(120_000)
    await stop($, 't1', run)
    for (const surface of SURFACES) {
      expect(await floorOf($, surface)).toEqual({ atWork: false, empty: true, asks: false })
    }
  }
  for (const surface of SURFACES) {
    const lines = await logLines($, surface)
    expect(lines).toHaveLength(1)
    // The last run took two minutes, not the hours since the first spawn.
    expect(lines[0]).toMatch(/took 2m/)
  }
})

test('a resumed specialist with nothing to ask is Working from its first model step, before any tool call', async ($, on) => {
  const { clock } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'm', input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 0 } } as never
  })
  await $.agent.spawn(BUILD)
  await stop($, 't1', 1)
  await clock.advance(HOUR)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: false, empty: true })

  const run = $.turn.step({ turnId: 'r2', index: 0, model: 'm', messageCount: 3, agentId: 't1' } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
  for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: true, asks: false })
  await stop($, 't1', 2)
  for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: false, empty: true })
})

for (const [status, text] of [['idle', /took/], ['completed', /took/], ['failed', /Failed after/], ['killed', /Failed after/]] as const) {
  test(`a specialist the engine reports as ${status} is sent home within a few frames even if no stop was seen`, async ($, on) => {
    const agents = [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }]
    const { clock } = host(on, agents)
    on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
    on('tool.call', () => ({ result: 'ok' }) as never)
    await $.session.start(START)
    await $.agent.spawn(BUILD)
    await work($, 't1')
    await clock.advance(30_000)
    expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })

    agents[0]!.status = status
    await clock.advance(5_000)
    expect(await floorOf($, 'terminal')).toMatchObject({ atWork: false, empty: true })
    expect((await logLines($, 'terminal'))[0]).toMatch(text)
  })
}

test('a resumed run is not ended by the engine\'s stale "completed" in its first seconds', { timeoutMs: 15_000 }, async ($, on) => {
  const agents = [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'completed' }]
  const { clock } = host(on, agents)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
  await $.agent.spawn(BUILD)
  await stop($, 't1', 1)
  await clock.advance(HOUR)
  await work($, 't1')
  await clock.advance(4_000)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
  // Once the run has gone on a while with the engine still saying completed, it has ended.
  await clock.advance(30_000)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: false })
})

test('the token figure is what the agent used, not each request\'s whole context added up', async ($, on) => {
  const { clock } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  // Every request reads an 80 000-token cached prompt and writes 500 tokens.
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'm', input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 0 } } as never
  })
  await $.agent.spawn(BUILD)
  for (const index of [0, 1, 2]) {
    const run = $.turn.step({ turnId: 'r1', index, model: 'm', messageCount: 3, agentId: 't1' } as never)
    let part = await run.next()
    while (!part.done) part = await run.next()
  }
  await clock.advance(60_000)
  await stop($, 't1', 1)
  for (const surface of SURFACES) {
    const lines = await logLines($, surface)
    // 80 010 in the latest request plus 3 x 500 generated: about 82K, not 3 x 80 510 = 242K.
    expect(lines[0]).toMatch(/took 1m · 82K tokens/)
    expect(lines[0]).not.toMatch(/242K/)
  }
})

// ---- Lost contact, stop signals, and runs ended by a guess ----

const stopSignal = ($: Eng, id: string) => $.classic.SubagentStop({ stop_hook_active: false, agent_id: id, agent_transcript_path: '', agent_type: 'ecc:tdd-guide' })
const stepOf = async ($: Eng, id: string, index: number) => {
  const run = $.turn.step({ turnId: 'r1', index, model: 'm', messageCount: 3, agentId: id } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
}
const MIN = 60_000

test('a run the engine still calls running but that went silent for 30 minutes is recorded as lost contact, in amber, with no cheer', { timeoutMs: 15_000 }, async ($, on) => {
  const agents = [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }]
  const { clock, toasts } = host(on, agents)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
  await $.agent.spawn(BUILD)
  await work($, 't1')
  await clock.advance(29 * MIN)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })

  await clock.advance(2 * MIN)
  for (const surface of SURFACES) {
    expect(await floorOf($, surface)).toMatchObject({ atWork: false, empty: true })
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    // Not a failure and not a win: Clawd stays at "All clear".
    expect(await ui.find({ type: 'Text', text: /All clear/ })).toBeDefined()
    const log = await mountLog($, surface)
    const lost = await log.find({ type: 'Text', text: /Lost contact after 30m/ })
    expect(lost).toBeDefined()
    expect(lost?.props.color).toBe(AMBER)
    expect(await log.find({ type: 'Text', text: /took|Failed after/ })).toBeUndefined()
    await log.unmount()
    await ui.unmount()
  }
  expect(toasts.filter(t => /finished|could not finish/.test(t))).toEqual([])
})

test('a specialist the engine reports as waiting is never lost, however long it waits', { timeoutMs: 15_000 }, async ($, on) => {
  const agents = [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'waiting' }]
  const { clock } = host(on, agents)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
  await $.agent.spawn(BUILD)
  await work($, 't1')
  await clock.advance(50 * MIN)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
  // Once it runs and then goes silent, the limit applies from its last sign of life.
  agents[0]!.status = 'running'
  await clock.advance(5_000)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
  await clock.advance(31 * MIN)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: false })
})

test('a run ended by the engine list that then shows life goes on as the same run: clock and tokens kept, no leftover Log row', async ($, on) => {
  const agents = [{ id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }]
  const { clock } = host(on, agents)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'm', input_tokens: 10, output_tokens: 500, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 0 } } as never
  })
  await $.session.start(START)
  await $.agent.spawn(BUILD)
  await work($, 't1')
  await stepOf($, 't1', 0)
  await clock.advance(10_000)

  // The list says the run is over, though it is not: it is sent home once it has been quiet a while.
  agents[0]!.status = 'completed'
  await clock.advance(30_000)
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: false })
  expect(await logLines($, 'terminal')).toHaveLength(1)

  // A late tool call: the same run is back, with nothing in the Log.
  agents[0]!.status = 'running'
  await work($, 't1')
  for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: true, asks: false })
  expect(await logLines($, 'terminal')).toEqual([])

  await clock.advance(5_000)
  await stop($, 't1', 2)
  const [line] = await logLines($, 'terminal')
  // About 55 seconds since the first spawn, and the first step's 80 510 tokens still counted.
  expect(Number(/took (\d+)s/.exec(line!)?.[1])).toBeGreaterThanOrEqual(45)
  expect(line).toMatch(/81K tokens/)
})

test('both stop signals for one stop end it once: one Log row and one toast, in either order', async ($, on) => {
  const { toasts } = host(on, [])
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `s${(n += 1)}` }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn(BUILD)
  await work($, 's1')
  await stop($, 's1', 1)
  await stopSignal($, 's1')
  await $.agent.spawn(BUILD)
  await work($, 's2')
  await stopSignal($, 's2')
  await stop($, 's2', 1)
  for (const surface of SURFACES) expect(await logLines($, surface)).toHaveLength(2)
  expect(toasts.filter(t => t.includes('finished'))).toHaveLength(2)
})

test('the SubagentStop signal alone ends a run, and one for an agent nobody knows changes nothing', async ($, on) => {
  host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn(BUILD)
  await work($, 't1')
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
  await stopSignal($, 'ghost')
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
  await stopSignal($, 't1')
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: false, empty: true })
  expect(await logLines($, 'terminal')).toHaveLength(1)
  // A message resumes it after a real stop: a new run.
  await work($, 't1')
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
  expect(await logLines($, 'terminal')).toEqual([])
})

test('a tool call with an agent id nobody announced and the engine does not list hires no one', async ($, on) => {
  const { clock } = host(on, [])
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
  await work($, 'ghost')
  await clock.advance(1_000)
  for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: false, empty: true })
  await clock.advance(40_000)
  await work($, 'ghost')
  expect(await logLines($, 'terminal')).toEqual([])
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  expect(await ui.find({ type: 'Text', text: /general-purpose|Generalist.*hired 1 time/ })).toBeUndefined()
  await ui.unmount()
})

test('an agent the engine lists but no spawn announced is still hired on its first tool call', async ($, on) => {
  host(on, [{ id: 'x1', type: 'ecc:code-reviewer', description: 'Review', status: 'running' }])
  on('tool.call', () => ({ result: 'ok' }) as never)
  await work($, 'x1')
  expect(await floorOf($, 'terminal')).toMatchObject({ atWork: true })
})

test('the token figure does not go down when a compaction shrinks the next request', async ($, on) => {
  const { clock } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('turn.step', async function* (_$, e) {
    const [cache, output] = e.index === 0 ? [80_000, 500] : [20_000, 300]
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: 'm', input_tokens: 10, output_tokens: output, cache_read_input_tokens: cache, cache_creation_input_tokens: 0 } } as never
  })
  await $.agent.spawn(BUILD)
  await stepOf($, 't1', 0)
  await stepOf($, 't1', 1)
  await clock.advance(60_000)
  await stop($, 't1', 1)
  // 80 010 at the peak plus 800 generated; the last request alone would read 21K.
  expect((await logLines($, 'terminal'))[0]).toMatch(/81K tokens/)
})

// ---- A resumed run announced by agent.spawn (Claude Code 2.1.299 raises it with `resume`) ----

/** The engine's spawn: every prompt it was handed, and the id it answers with (the resumed one on a resume). */
function spawner(on: Parameters<typeof host>[0]) {
  const sent: string[] = []
  on('agent.spawn', (_$, e) => {
    const ev = e as { prompt: string; resume?: { agentId: string } }
    sent.push(ev.prompt)
    return { model: 'claude-opus-5-5', agentId: ev.resume?.agentId ?? 't1' } as never
  })
  return sent
}
const RESUME = (prompt: string, agentId = 't1') => ({ prompt, description: 'Resumed run', subagentType: 'ecc:tdd-guide', resume: { agentId } }) as never

test('a resumed spawn passes the message on as it is: no decisions or reporting note are added a second time', async ($, on) => {
  host(on, [])
  const sent = spawner(on)
  await $.agent.spawn(BUILD)
  await stop($, 't1', 1)
  await $.agent.spawn(RESUME('Also add the dark theme.'))
  expect(sent).toHaveLength(2)
  expect(sent[0]).not.toBe('Build the panel')
  expect(sent[1]).toBe('Also add the dark theme.')
})

test('a resumed specialist keeps its record and is at work again; the hire is not counted twice', async ($, on) => {
  const { clock, saved } = host(on, [])
  spawner(on)
  await $.agent.spawn(BUILD)
  await clock.advance(60_000)
  await stop($, 't1', 1)
  expect(saved.get('roster')).toMatchObject({ 'ecc:tdd-guide': { jobs: 1 } })
  for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: false, empty: true })

  await clock.advance(HOUR)
  await $.agent.spawn(RESUME(''))
  for (const surface of SURFACES) expect(await floorOf($, surface)).toEqual({ atWork: true, empty: false, asks: false })
  expect(saved.get('roster')).toMatchObject({ 'ecc:tdd-guide': { jobs: 1 } })
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: / Build redesigned panel$/ })).toBeDefined()
  await ui.unmount()
  // A new run with its own clock: two minutes, not the hour since the first.
  await clock.advance(120_000)
  await stop($, 't1', 2)
  expect(await logLines($, 'terminal')).toEqual([expect.stringMatching(/took 2m/)])
})

test('a resumed specialist the books do not hold (from before a reload) joins them at work, with no hire counted', async ($, on) => {
  const { saved } = host(on, [])
  spawner(on)
  await $.agent.spawn(RESUME('Carry on.', 'old1'))
  for (const surface of SURFACES) expect(await floorOf($, surface)).toEqual({ atWork: true, empty: false, asks: false })
  expect((saved.get('roster') as Record<string, { jobs: number }> | undefined)?.['ecc:tdd-guide']?.jobs ?? 0).toBe(0)
})

test('a workflow\'s agent keeps the script\'s prompt as it is (its answer is the script\'s to read) and is still at work on the floor', async ($, on) => {
  host(on, [])
  const sent = spawner(on)
  await $.agent.spawn({ prompt: 'Review the diff. Answer in JSON.', description: 'Review', subagentType: 'general-purpose', workflow: { runId: 'wf_1', agentIndex: 1 } } as never)
  expect(sent).toEqual(['Review the diff. Answer in JSON.'])
  expect(await floorOf($, 'terminal')).toEqual({ atWork: true, empty: false, asks: false })
})

test('a resume the engine refuses changes nothing on the books', async ($, on) => {
  host(on, [])
  on('agent.spawn', () => ({ deny: 'parked' }) as never)
  const r = await $.agent.spawn(RESUME('Carry on.', 'old1'))
  expect(r).toEqual({ deny: 'parked' })
  for (const surface of SURFACES) expect(await floorOf($, surface)).toMatchObject({ atWork: false, empty: true })
})

// ---- A resumed specialist keeps the effort level it was hired with ----

/** Every effort the engine was about to send for the model requests of specialists, in order. */
function efforts(on: Parameters<typeof host>[0]) {
  const seen: Array<unknown> = []
  on('turn.step', async function* (_$, e) {
    seen.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  return seen
}
const request = async ($: Eng, id: string) => {
  const run = $.turn.step({ turnId: 'r1', index: 0, model: 'claude-opus-5-5', messageCount: 3, agentId: id } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
}
const cardOf = async ($: Eng, id: string) => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const row = JSON.stringify(await ui.find({ key: `desk-${id}` }))
  await ui.unmount()
  return row
}
const HIRE_MEDIUM = { prompt: '[effort: medium]\nBuild the panel', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide' } as never

test('a resumed specialist with no effort line keeps its hired level on every request and on its card', async ($, on) => {
  host(on, [])
  spawner(on)
  const seen = efforts(on)
  await $.agent.spawn(HIRE_MEDIUM)
  await stop($, 't1', 1)
  for (let i = 0; i < 4; i++) {
    await $.agent.spawn(RESUME('Keep going.'))
    await request($, 't1')
    await stop($, 't1', 2 + i)
  }
  expect(seen).toEqual(['medium', 'medium', 'medium', 'medium'])
  await $.agent.spawn(RESUME('Once more.'))
  expect(await cardOf($, 't1')).toMatch(/medium · /)
})

test('a follow-up that starts with an effort line changes the level', async ($, on) => {
  host(on, [])
  spawner(on)
  const seen = efforts(on)
  await $.agent.spawn(HIRE_MEDIUM)
  await stop($, 't1', 1)
  await $.agent.spawn(RESUME('[effort: high]\nThink harder.'))
  await request($, 't1')
  expect(seen).toEqual(['high'])
  expect(await cardOf($, 't1')).toMatch(/high · /)
})

test('a resume the engine answers under another id hands the level on to that id', async ($, on) => {
  host(on, [])
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: (e as { resume?: unknown }).resume ? 'n2' : 't1' }) as never)
  const seen = efforts(on)
  await $.agent.spawn(HIRE_MEDIUM)
  await stop($, 't1', 1)
  await $.agent.spawn(RESUME('Keep going.'))
  await request($, 'n2')
  expect(seen).toEqual(['medium'])
  expect(await cardOf($, 'n2')).toMatch(/medium · /)
})
