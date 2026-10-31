import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, START, SURFACES, host } from './host'

const STEP = 'mcp__clawd-hq__step'
const BUILD = { prompt: 'Build the panel', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide' } as never
const specialist = { id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', status: 'running' }

function hostWithSpecialist(on: Parameters<typeof host>[0]) {
  const h = host(on, [specialist])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  return h
}

/** A call of the step tool, from the specialist `agentId` (the main chat when none). */
const report = ($: Engine, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: STEP, ...input, ...(agentId ? { agentId } : {}) } as never) as Promise<{ result?: string; deny?: string }>

/** What a mounted Office pane shows for the specialist's row: its texts, and the bars in it. */
async function rowOf($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const row = await ui.find({ key: 'desk-t1' })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const bars = (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.height === 4)
  await ui.unmount()
  // A terminal bar is a heavy run and a light run, each its own text.
  return { row, texts, bars, glyphs: texts.filter(t => /^━+$|^─+$/.test(t)) }
}

test('the step tool is registered with the demo, offer_rule and find_helpers tools; there is no remember tool', async ($, on) => {
  const { tools } = host(on)
  await $.session.start(START)
  expect(tools).toEqual(['demo', 'offer_rule', 'step', 'find_helpers', 'hire_contractor']) // no team_pick: the scout answers in its own words
})

test('every hire\'s brief carries the line that asks for steps, whatever its type', async ($, on) => {
  host(on)
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => (prompts.push((e as { prompt: string }).prompt), { model: 'claude-opus-5-5', agentId: `h${prompts.length}` }))
  for (const subagentType of ['ecc:planner', 'general-purpose', 'ecc:tdd-guide']) {
    await $.agent.spawn({ prompt: 'Do the job', description: 'A job', subagentType } as never)
  }
  expect(prompts).toHaveLength(3)
  for (const prompt of prompts) {
    expect(prompt).toMatch(/Do the job/)
    expect(prompt).toContain(STEP)
    expect(prompt).toMatch(/before (any )?other work/i)
    expect(prompt).toMatch(/`total`.*3 to 8/)
    expect(prompt).toMatch(/`done: 0`/)
    expect(prompt).toMatch(/after each step/i)
  }
})

test('a call from the main chat, or from an agent that is not a specialist here, is ignored with a short answer', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  const main = await report($, { done: 1, total: 3 })
  expect(main.result).toMatch(/^Ignored/)
  const stranger = await report($, { done: 1, total: 3 }, 'nobody')
  expect(stranger.result).toMatch(/^Ignored/)
  const ui = await rowOf($, 'terminal')
  expect(ui.glyphs).toEqual([])
  expect(ui.texts.some(t => /^Step \d+ of \d+$/.test(t))).toBe(false)
})

test('a report from a specialist that already finished is ignored, so an old bar never comes back', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', agentId: 't1', isAborted: false } as never)
  expect((await report($, { done: 1, total: 3 }, 't1')).result).toMatch(/^Ignored/)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 't1' } as never)
  expect((await rowOf($, 'terminal')).texts.some(t => /^Step \d+ of \d+$/.test(t))).toBe(false)
})

test('a first report that comes before the hire is recorded still counts: the engine lists the agent, so it joins the books first', async ($, on) => {
  host(on, [specialist])
  let early: { result?: string; deny?: string } | undefined
  // The specialist runs inside the spawn call: its first step call lands before the spawn has answered.
  on('agent.spawn', async () => {
    early = await report($, { done: 0, total: 4, note: 'Making a plan' }, 't1')
    return { model: 'claude-opus-5-5', agentId: 't1' }
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn(BUILD)
  expect(early?.result).toMatch(/^Noted/)
  for (const surface of SURFACES) {
    const { texts, row } = await rowOf($, surface)
    expect(row).toBeDefined()
    expect(texts).toContain('Step 0 of 4')
    expect(texts).toContain('Making a plan')
  }
})

test('a first report from an agent that is neither on the books nor listed is still ignored', async ($, on) => {
  host(on, [])
  expect((await report($, { done: 0, total: 4 }, 'ghost')).result).toMatch(/^Ignored/)
})

test('a bad report is refused with a clear error, and nothing changes', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 1, total: 4 }, 't1')
  const refusals = [
    await report($, { done: 0, total: 0 }, 't1'),
    await report($, { done: 0, total: 13 }, 't1'),
    await report($, { done: -1, total: 4 }, 't1'),
    await report($, { done: 0, total: 4, note: 'x'.repeat(81) }, 't1'),
  ]
  expect(refusals.map(r => typeof r.deny)).toEqual(['string', 'string', 'string', 'string'])
  expect(refusals[0]!.deny).toMatch(/total must be a whole number from 1 to 12/)
  expect(refusals[2]!.deny).toMatch(/done must be a whole number/)
  expect(refusals[3]!.deny).toMatch(/note is 81 characters; the most is 80/)
  const { texts } = await rowOf($, 'terminal')
  expect(texts).toContain('Step 1 of 4')
})

test('until the specialist reports there is no bar and no count, on every surface', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  for (const surface of SURFACES) {
    const { row, texts, bars, glyphs } = await rowOf($, surface)
    expect(row).toBeDefined()
    expect(bars).toHaveLength(0)
    expect(glyphs).toEqual([])
    expect(texts.some(t => /^Step \d+ of \d+$/.test(t))).toBe(false)
  }
})

/** One model request of the specialist `t1`, which answers with `words`. */
async function says($: Engine, on: Parameters<typeof host>[0], words: { text: string }) {
  const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: words.text, toolUses: [], stopReason: 'end_turn', usage } as never
  })
  return async (index: number) => {
    const run = $.turn.step({ turnId: 'r1', index, model: 'm', messageCount: 3, agentId: 't1' } as never)
    let part = await run.next()
    while (!part.done) part = await run.next()
  }
}

test('a specialist that writes "Step 1 of 4" in its own words gets a bar from it, on every surface, and not before', async ($, on) => {
  hostWithSpecialist(on)
  const words = { text: 'Working out where to start.' }
  const ask = await says($, on, words)
  await $.agent.spawn(BUILD)
  await ask(0)
  for (const surface of SURFACES) expect((await rowOf($, surface)).texts.some(t => /^Step \d+ of \d+$/.test(t))).toBe(false)

  words.text = 'Step 1 of 4: looking at what the three commits changed.'
  await ask(1)
  const terminal = await rowOf($, 'terminal')
  expect(terminal.texts).toContain('Step 1 of 4')
  expect(terminal.glyphs).toEqual(['━'.repeat(3), '─'.repeat(7)])
  const desktop = await rowOf($, 'desktop')
  expect(desktop.texts).toContain('Step 1 of 4')
  expect(desktop.bars).toHaveLength(1)
  expect(desktop.bars[0]!.props.width).toBe(100)

  words.text = 'Step 2 of 4: checking the rules.'
  await ask(2)
  expect((await rowOf($, 'terminal')).texts).toContain('Step 2 of 4')
})

test('the tool\'s report wins over the specialist\'s words, before and after it', async ($, on) => {
  hostWithSpecialist(on)
  const words = { text: 'Step 1 of 4: starting.' }
  const ask = await says($, on, words)
  await $.agent.spawn(BUILD)
  await ask(0)
  expect((await rowOf($, 'terminal')).texts).toContain('Step 1 of 4')
  await report($, { done: 2, total: 5 }, 't1')
  expect((await rowOf($, 'terminal')).texts).toContain('Step 2 of 5')
  words.text = 'Step 3 of 6: more.'
  await ask(1)
  const { texts } = await rowOf($, 'terminal')
  expect(texts).toContain('Step 2 of 5')
  expect(texts).not.toContain('Step 3 of 6')
})

test('the step tool is registered in front, not behind a search', async ($, on) => {
  const { toolSpecs } = host(on)
  await $.session.start(START)
  expect(toolSpecs.find(t => t.name === 'step')?.isDeferred).toBe(false)
  expect(toolSpecs.find(t => t.name === 'find_helpers')?.isDeferred).toBe(false) // Clawd calls it before every hire
  expect(toolSpecs.find(t => t.name === 'hire_contractor')?.isDeferred).toBe(false) // find_helpers sends him to it
  expect(toolSpecs.filter(t => !['step', 'find_helpers', 'hire_contractor'].includes(t.name)).every(t => t.isDeferred === undefined)).toBe(true)
})

test('after a report the row shows a small bar and the count: line glyphs on the terminal, a thin image elsewhere', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  const answer = await report($, { done: 2, total: 5, note: 'Writing the tests' }, 't1')
  expect(answer.deny).toBeUndefined()
  expect(answer.result).toMatch(/2 of 5/)

  const terminal = await rowOf($, 'terminal')
  expect(terminal.texts).toContain('Step 2 of 5')
  // Ten cells in all: four heavy for two of five, six light.
  expect(terminal.glyphs).toEqual(['━'.repeat(4), '─'.repeat(6)])
  expect(terminal.bars).toHaveLength(0)

  const desktop = await rowOf($, 'desktop')
  expect(desktop.texts).toContain('Step 2 of 5')
  expect(desktop.bars).toHaveLength(1)
  expect(desktop.bars[0]!.props.width).toBe(100)
  expect(String(desktop.bars[0]!.props.source)).toContain('rx="2"')
  expect(String(desktop.bars[0]!.props.alt)).toBe('2 of 5 steps done')
  expect(desktop.glyphs).toEqual([])
})

test('done is brought down to the total, and a new total replaces the old one', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 9, total: 5 }, 't1')
  expect((await rowOf($, 'terminal')).texts).toContain('Step 5 of 5')
  await report($, { done: 2, total: 8 }, 't1')
  const { texts, glyphs } = await rowOf($, 'terminal')
  expect(texts).toContain('Step 2 of 8')
  expect(texts).not.toContain('Step 5 of 5')
  expect(glyphs).toEqual(['━'.repeat(3), '─'.repeat(7)])
})

test('a zero count shows an empty bar and 0/5: the plan is known, nothing is done yet', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 0, total: 5 }, 't1')
  const { texts, glyphs } = await rowOf($, 'terminal')
  expect(texts).toContain('Step 0 of 5')
  // Only the light run: no heavy glyph at all.
  expect(glyphs.length).toBeGreaterThan(0)
  expect(glyphs.every(g => g === '─'.repeat(10))).toBe(true)
})

test('the note stands in for the sentence of what it is doing, once, and a later word of its own takes its place', async ($, on) => {
  hostWithSpecialist(on)
  const usage = { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  let said = ''
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: said, toolUses: [], stopReason: 'end_turn', usage } as never
  })
  await $.agent.spawn(BUILD)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/panel.ts', agentId: 't1' } as never)
  await report($, { done: 1, total: 4, note: 'Reading the old footer' }, 't1')
  for (const surface of SURFACES) {
    const { texts } = await rowOf($, surface)
    // The note is the "Now" line; the tool's own sentence is not shown beside it.
    expect(texts).toContain('Reading the old footer')
    expect(texts).not.toContain('Reading panel.ts')
    expect(texts.filter(t => t === 'Reading the old footer')).toHaveLength(1)
  }

  // The specialist says something afterwards: its words are newer than the note, so they are shown instead.
  said = 'Now writing the footer tests.'
  const run = $.turn.step({ turnId: 'r1', index: 1, model: 'm', messageCount: 3, agentId: 't1' } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
  const after = await rowOf($, 'terminal')
  expect(after.texts).toContain('Now writing the footer tests.')
  expect(after.texts).not.toContain('Reading the old footer')
  // The count stays.
  expect(after.texts).toContain('Step 1 of 4')
})

test('a note is cleaned before it is kept: control characters never reach the pane or the state', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 1, total: 3, note: 'Fixing\u0000 the\nbug \u001b[31mred' }, 't1')
  const { texts } = await rowOf($, 'terminal')
  expect(texts).toContain('Fixing the bug [31mred')
  expect(texts.join('')).not.toMatch(/[\u0000-\u001f\u007f]/)
})

test('a report is not counted as a tool the specialist used', async ($, on) => {
  const { toasts } = hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 1, total: 3 }, 't1')
  await report($, { done: 2, total: 3 }, 't1')
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', agentId: 't1', isAborted: false } as never)
  expect(toasts.some(t => /finished: .*\(.*, 0 tools\)/.test(t))).toBe(true)
})

test('a specialist that finishes leaves the at-work list, bar and all, as before', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 3, total: 5 }, 't1')
  expect((await rowOf($, 'terminal')).row).toBeDefined()
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', agentId: 't1', isAborted: false } as never)
  for (const surface of SURFACES) {
    const { row, texts, glyphs, bars } = await rowOf($, surface)
    expect(row).toBeUndefined()
    expect(texts).toContain('No one at a desk yet.')
    expect(glyphs).toEqual([])
    expect(bars).toHaveLength(0)
    expect(texts).not.toContain('Step 3 of 5')
  }
})

test('a finished specialist that is hired again for a new run starts with no bar', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 3, total: 5 }, 't1')
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', agentId: 't1', isAborted: false } as never)
  // The same specialist is spoken to again: a new run.
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 't1' } as never)
  const { row, texts, glyphs } = await rowOf($, 'terminal')
  expect(row).toBeDefined()
  expect(glyphs).toEqual([])
  expect(texts.some(t => /^Step \d+ of \d+$/.test(t))).toBe(false)
})

test('the step count sits beside the bar, not in the specialist\'s words, on every surface', async ($, on) => {
  hostWithSpecialist(on)
  const words = { text: 'Step 1 of 4: looking at what the three commits changed.' }
  const ask = await says($, on, words)
  await $.agent.spawn(BUILD)
  await ask(0)
  for (const surface of SURFACES) {
    const { texts } = await rowOf($, surface)
    expect(texts).toContain('Looking at what the three commits changed.')
    expect(texts.filter(t => t === 'Step 1 of 4')).toHaveLength(1)
    expect(texts.some(t => /Step 1 of 4:/.test(t))).toBe(false)
  }
})

test('words that are only a step give way to the existing sentence, so nothing is said twice', async ($, on) => {
  hostWithSpecialist(on)
  const words = { text: 'Step 1 of 4' }
  const ask = await says($, on, words)
  await $.agent.spawn(BUILD)
  await ask(0)
  for (const surface of SURFACES) {
    const { texts } = await rowOf($, surface)
    expect(texts).toContain('Now: ')
    expect(texts.filter(t => t === 'Step 1 of 4')).toHaveLength(1)
  }
})

test('a tool note that begins with a step is cleaned the same way', async ($, on) => {
  hostWithSpecialist(on)
  await $.agent.spawn(BUILD)
  await report($, { done: 2, total: 5, note: 'Step 2 of 5: reading the footer' }, 't1')
  for (const surface of SURFACES) {
    const { texts } = await rowOf($, surface)
    expect(texts).toContain('Reading the footer')
    expect(texts).toContain('Step 2 of 5')
  }
})
