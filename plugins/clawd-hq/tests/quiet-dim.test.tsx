import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { dimLine } from '../hooks/quiet'
import { host } from './host'

type On = Parameters<typeof host>[0]
type Component = 'ToolUse' | 'ToolResult'

/** The engine's own drawing, as a session hands it back from `next(e)`: a node no Text may hold. */
const ENGINE_NODE = { type: 'engine', ref: 0 }

/** A session with a teammate named judge; every row the plugin leaves alone is the engine's own node. */
async function office($: Engine, on: On) {
  const h = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 't1' }))
  on('ui.render', () => ENGINE_NODE as never)
  await $.agent.spawn({ prompt: 'Judge it', description: 'Judge', subagentType: 'general-purpose', name: 'judge' } as never)
  return h
}
/** The tree as drawn, as JSON. It rejects, as a session refuses it, when the surface cannot draw what the hooks returned. */
const drawn = async ($: Engine, component: Component, props: Record<string, unknown>, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, component, props } as never)
  try { return JSON.stringify(await ui.drawn()) } finally { await ui.unmount() }
}
const call = (tool: string, over: Record<string, unknown> = {}) => ({ tool_use_id: 't1', tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {}, ...over })
const result = (tool: string, over: Record<string, unknown> = {}) => ({ tool_use_id: 't1', tool, output: {}, isErrored: false, ...over })
const isEngine = (text: string) => text === JSON.stringify(ENGINE_NODE)
const isDim = (text: string) => text.includes('"dimColor":true') && !text.includes('"engine"')
const isHidden = (text: string) => !text.includes('"engine"') && !/[A-Za-z]{3}/.test(text.replace(/"type":"Text"|"props"|"children"|"part":\{"plugin":"clawd-hq"\}/g, ''))

const FIND = 'mcp__clawd-hq__find_helpers'
const DIMMED: Array<[string, Record<string, unknown>]> = [
  [FIND, { job: 'Research macOS cleanup options', keywords: ['macOS', 'cleanup'] }],
  ['mcp__clawd-hq__offer_rule', { rule: 'Never use tabs' }],
  ['mcp__clawd-hq__hire_contractor', { skill: 'shadcn', role: 'Designer' }],
  ['TodoWrite', { todos: [] }],
  ['TaskCreate', { subject: 'Write the tests' }],
  ['SendMessage', { to: '@judge', message: 'Score round 2.' }],
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a dimmed call is drawn dim without an engine node inside a Text (${surface})`, async ($, on) => {
    await office($, on)
    for (const [name, input] of DIMMED) expect(isDim(await drawn($, 'ToolUse', call(name, { input }), surface))).toBe(true)
  })
  test(`a dimmed call's result is drawn dim without an engine node inside a Text (${surface})`, async ($, on) => {
    await office($, on)
    for (const [name] of DIMMED) expect(isDim(await drawn($, 'ToolResult', result(name), surface))).toBe(true)
  })
}

test('the dim call row says which tool ran and what it was asked, in one short line', async ($, on) => {
  await office($, on)
  const text = await drawn($, 'ToolUse', call(FIND, { input: { job: 'Research macOS cleanup options', keywords: ['macOS'] } }))
  expect(text).toContain('find_helpers')
  expect(text).toContain('Research macOS cleanup options')
  expect(text).not.toContain('mcp__')
  const long = await drawn($, 'ToolUse', call(FIND, { input: { job: 'x'.repeat(400) } }))
  expect(long.length).toBeLessThan(300)
})

test('the full view draws every quiet row as the engine does: dimmed and hidden alike', async ($, on) => {
  await office($, on)
  for (const name of [FIND, 'TodoWrite', 'mcp__clawd-hq__step', 'ToolSearch']) {
    expect(isEngine(await drawn($, 'ToolUse', call(name, { isExpanded: true })))).toBe(true)
    expect(isEngine(await drawn($, 'ToolResult', result(name, { isExpanded: true })))).toBe(true)
  }
})

test('an errored dimmed call is drawn as the engine draws it', async ($, on) => {
  await office($, on)
  expect(isEngine(await drawn($, 'ToolUse', call(FIND, { isErrored: true })))).toBe(true)
  expect(isEngine(await drawn($, 'ToolResult', result(FIND, { isErrored: true })))).toBe(true)
})

test('the dim line: the tool\'s own name, its text fields on one line, and "done" for a result', () => {
  expect(dimLine({ tool: 'mcp__plugin_ecc_chrome-devtools__click', input: {}, isErrored: false })).toBe('click')
  expect(dimLine({ tool: 'SendMessage', input: { to: '@judge', message: 'Score\nround 2.' }, isErrored: false })).toBe('SendMessage · @judge · Score round 2.')
  expect(dimLine({ tool: 'TodoWrite', input: { todos: [{ content: 'x' }] }, isErrored: false })).toBe('TodoWrite')
  expect(dimLine({ tool: FIND, output: {}, isErrored: false })).toBe('  └ done')
})

const launched = { status: 'async_launched', agentId: 'a9', description: 'Research Mac cleanup options', prompt: 'Look', outputFile: '/tmp/a9' }

test('the result row of an agent launched in the background is hidden on every surface; its call row is not', async ($, on) => {
  await office($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(isHidden(await drawn($, 'ToolResult', result('Agent', { output: launched }), surface))).toBe(true)
    expect(isHidden(await drawn($, 'ToolResult', result('Agent', { output: { ...launched, status: 'remote_launched' } }), surface))).toBe(true)
    expect(isEngine(await drawn($, 'ToolUse', call('Agent', { output: launched }), surface))).toBe(true)
  }
})

test('a real agent completion, an errored launch and the full view keep the engine\'s agent result', async ($, on) => {
  await office($, on)
  const done = { status: 'completed', content: [{ type: 'text', text: 'All clean.' }], totalToolUseCount: 4 }
  expect(isEngine(await drawn($, 'ToolResult', result('Agent', { output: done })))).toBe(true)
  expect(isEngine(await drawn($, 'ToolResult', result('Agent', { output: launched, isErrored: true })))).toBe(true)
  expect(isEngine(await drawn($, 'ToolResult', result('Agent', { output: launched, isExpanded: true })))).toBe(true)
  expect(isEngine(await drawn($, 'ToolResult', result('Bash', { output: launched })))).toBe(true)
})

test('with the quiet chat off, the background launch and the dimmed rows are the engine\'s', { options: { quietChat: false } }, async ($, on) => {
  await office($, on)
  expect(isEngine(await drawn($, 'ToolResult', result('Agent', { output: launched })))).toBe(true)
  expect(isEngine(await drawn($, 'ToolUse', call(FIND)))).toBe(true)
  expect(isEngine(await drawn($, 'ToolResult', result(FIND)))).toBe(true)
})
