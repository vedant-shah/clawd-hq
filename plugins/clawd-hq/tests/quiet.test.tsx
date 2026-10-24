import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { host } from './host'

type On = Parameters<typeof host>[0]

/** A session with one finished reviewer and a teammate named judge; a row the plugin leaves alone is drawn as ENGINE. */
async function office($: Engine, on: On) {
  const h = host(on, [])
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: ['a1', 't1'][n++]! }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  await $.agent.spawn({ prompt: 'Review it', description: 'Review', subagentType: 'ecc:code-reviewer' } as never)
  await $.agent.spawn({ prompt: 'Judge it', description: 'Judge', subagentType: 'general-purpose', name: 'judge' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'r1', agentId: 'a1', isAborted: false } as never)
  return h
}
const drawn = async ($: Engine, component: 'UserMessage' | 'AssistantMessage' | 'ToolUse' | 'ToolResult' | 'ToolProgress', props: Record<string, unknown>, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, component, props } as never)
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}
const notice = (over: Record<string, unknown> = {}) => ({ text: 'Agent finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { id: 'a1', status: 'completed' }, ...over })
const fromJudge = (over: Record<string, unknown> = {}) => ({ text: 'Message 5 of 6 received.', origin: { kind: 'unclassified' }, isExpanded: false, from: { name: 'judge' }, ...over })
// The kit marks each drawing with the plugin that drew it (`part`): that label is not text on the screen.
const isHidden = (text: string) => !text.includes('ENGINE') && !/[A-Za-z]{3}/.test(text.replace(/"type":"Text"|"props"|"children"|"part":\{"plugin":"clawd-hq"\}/g, ''))

test('a specialist\'s finished notice and a teammate\'s message are hidden in the main chat, on every surface', async ($, on) => {
  await office($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(isHidden(await drawn($, 'UserMessage', notice(), surface))).toBe(true)
    expect(isHidden(await drawn($, 'UserMessage', fromJudge(), surface))).toBe(true)
  }
})

test('a failure, the full view, the person\'s own message and anything the office did not hire stay as the engine draws them', async ($, on) => {
  await office($, on)
  expect(await drawn($, 'UserMessage', notice({ task: { id: 'a1', status: 'failed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ isExpanded: true }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge({ isExpanded: true }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', { text: 'fix the login bug', origin: { kind: 'composer' }, isExpanded: false })).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ task: { id: 'shell-9', status: 'failed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge({ from: { name: 'Another session' } }))).toContain('ENGINE')
  // Another session that happens to carry the teammate's name, a message under an agent type, and a teammate's request.
  expect(await drawn($, 'UserMessage', fromJudge({ origin: { kind: 'peer' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge({ from: { name: 'ecc:code-reviewer' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge({ text: 'I need permission to run the build.' }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge({ text: 'Which side goes first?' }))).toContain('ENGINE')
})

test('a reply of Clawd\'s that is only the no-update mark is hidden; a real reply is not', async ($, on) => {
  await office($, on)
  expect(isHidden(await drawn($, 'AssistantMessage', { text: '[no update]', isFirstOfReply: true }))).toBe(true)
  expect(await drawn($, 'AssistantMessage', { text: 'ChatGPT won, 7 to 6.', isFirstOfReply: true })).toContain('ENGINE')
  expect(await drawn($, 'AssistantMessage', { text: '[no update] but one test failed', isFirstOfReply: true })).toContain('ENGINE')
  // A reply in two blocks: only the block that is the mark alone goes.
  expect(await drawn($, 'AssistantMessage', { text: 'The judge has ruled.', isFirstOfReply: false })).toContain('ENGINE')
  expect(isHidden(await drawn($, 'AssistantMessage', { text: '[no update]', isFirstOfReply: false, isSummary: true }))).toBe(true)
})

const tool = (name: string, over: Record<string, unknown> = {}) => ({ tool_use_id: 't1', tool: name, input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {}, ...over })
const result = (name: string, over: Record<string, unknown> = {}) => ({ tool_use_id: 't1', tool: name, output: {}, isErrored: false, ...over })
// A dimmed row is a dim line of the plugin's own: the engine's drawing cannot sit inside a dim Text (tests/quiet-dim.test.tsx).
const isDim = (text: string) => !text.includes('ENGINE') && text.includes('"dimColor":true')

test('a finished notice of a background job the office did not hire is hidden when it finished well, on every surface', async ($, on) => {
  await office($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const text = 'Background command finished (2m 2s)'
    expect(isHidden(await drawn($, 'UserMessage', notice({ text, task: { id: 'shell-9', status: 'completed' } }), surface))).toBe(true)
  }
  for (const status of ['failed', 'killed', 'stopped']) {
    expect(await drawn($, 'UserMessage', notice({ task: { id: 'shell-9', status } }))).toContain('ENGINE')
  }
  expect(await drawn($, 'UserMessage', notice({ isExpanded: true, task: { id: 'shell-9', status: 'completed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ origin: { kind: 'scheduled-trigger' }, task: { id: 'shell-9', status: 'completed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ origin: { kind: 'channel' }, task: { id: 'shell-9', status: 'completed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ text: 'Compacted: kept the plan', task: { id: 'shell-9', status: 'completed', type: 'compaction' } }))).toContain('ENGINE')
})

test('the merged "N background agents completed" line is hidden on every surface; a failure or the full view is not', async ($, on) => {
  await office($, on)
  const merged = (over: Record<string, unknown> = {}) => notice({ text: '2 background agents completed', task: undefined, ...over })
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(isHidden(await drawn($, 'UserMessage', merged(), surface))).toBe(true)
    expect(isHidden(await drawn($, 'UserMessage', merged({ task: { status: 'completed' } }), surface))).toBe(true)
  }
  expect(await drawn($, 'UserMessage', merged({ text: '2 background agents failed' }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', merged({ task: { status: 'failed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', merged({ isExpanded: true }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', merged({ origin: { kind: 'composer' } }))).toContain('ENGINE')
})

test('"N background commands completed" and the task summary line are hidden on every surface; a failure or the full view is not', async ($, on) => {
  await office($, on)
  for (const text of ['2 background commands completed', '3 background commands completed', '1 background task completed, 1 running']) {
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(isHidden(await drawn($, 'UserMessage', notice({ text, task: undefined }), surface))).toBe(true)
    }
    expect(await drawn($, 'UserMessage', notice({ text, task: { status: 'failed' } }))).toContain('ENGINE')
    expect(await drawn($, 'UserMessage', notice({ text, task: undefined, isExpanded: true }))).toContain('ENGINE')
    expect(await drawn($, 'UserMessage', notice({ text, task: undefined, origin: { kind: 'composer' } }))).toContain('ENGINE')
  }
  expect(await drawn($, 'UserMessage', notice({ text: '2 background commands completed, 1 failed', task: undefined }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ text: '1 background task completed, 1 failed', task: undefined }))).toContain('ENGINE')
})

test('a specialist\'s peer message to Clawd is hidden on every surface, even with no sender named; a question, a failure or another session is not', async ($, on) => {
  await office($, on)
  const peer = (over: Record<string, unknown> = {}) => ({ text: 'Decisions on review findings: kept 3.', origin: { kind: 'peer-send-message' }, isExpanded: false, from: { name: 'judge' }, ...over })
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(isHidden(await drawn($, 'UserMessage', peer(), surface))).toBe(true)
    expect(isHidden(await drawn($, 'UserMessage', peer({ from: undefined }), surface))).toBe(true)
  }
  expect(await drawn($, 'UserMessage', peer({ text: 'Which side goes first?' }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', peer({ text: 'I need permission to run the build.' }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', peer({ text: 'The build failed.' }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', peer({ from: { name: 'Another session' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', peer({ isExpanded: true }))).toContain('ENGINE')
})

test('Clawd\'s own SendMessage row to a hired teammate is dimmed, call and result, with an @ in the name or a worded request', async ($, on) => {
  await office($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const input = { to: '@judge', message: 'Decisions on review findings. Approved?' }
    expect(isDim(await drawn($, 'ToolUse', tool('SendMessage', { input }), surface))).toBe(true)
    expect(isDim(await drawn($, 'ToolResult', result('SendMessage'), surface))).toBe(true)
  }
})

test('the plugin\'s step calls, tool-loading rows and the background hint are hidden, call and result alike', async ($, on) => {
  await office($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const name of ['mcp__clawd-hq__step', 'ToolSearch']) {
      expect(isHidden(await drawn($, 'ToolUse', tool(name), surface))).toBe(true)
      expect(isHidden(await drawn($, 'ToolResult', result(name), surface))).toBe(true)
    }
  }
  expect(isHidden(await drawn($, 'ToolProgress', { tool_use_id: 't1', kind: 'background_hint', hint: '(ctrl+b to run in background)' }))).toBe(true)
})

test('the offer of a rule, a message to a hired teammate and the task list are dimmed on every surface, not hidden', async ($, on) => {
  await office($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    expect(isDim(await drawn($, 'ToolUse', tool('mcp__clawd-hq__offer_rule'), surface))).toBe(true)
    expect(isDim(await drawn($, 'ToolResult', result('mcp__clawd-hq__offer_rule'), surface))).toBe(true)
    expect(isDim(await drawn($, 'ToolUse', tool('SendMessage', { input: { to: 'judge', message: 'Score round 2.' } }), surface))).toBe(true)
    for (const name of ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']) expect(isDim(await drawn($, 'ToolUse', tool(name), surface))).toBe(true)
  }
})

test('errored or interrupted rows, questions, other tools and a message to anyone else are drawn as the engine draws them', async ($, on) => {
  await office($, on)
  for (const name of ['mcp__clawd-hq__step', 'ToolSearch', 'mcp__clawd-hq__offer_rule', 'TodoWrite']) {
    expect(await drawn($, 'ToolUse', tool(name, { isErrored: true }))).toContain('ENGINE')
    expect(await drawn($, 'ToolUse', tool(name, { isInterrupted: true }))).toContain('ENGINE')
    expect(await drawn($, 'ToolResult', result(name, { isErrored: true }))).toContain('ENGINE')
    expect(isDim(await drawn($, 'ToolUse', tool(name, { isErrored: true })))).toBe(false)
  }
  for (const name of ['AskUserQuestion', 'Agent', 'Bash', 'ExitPlanMode', 'ScheduleWakeup', 'mcp__clawd-hq__artifact']) {
    const text = await drawn($, 'ToolUse', tool(name))
    expect(text).toContain('ENGINE')
    expect(isDim(text)).toBe(false)
  }
  const other = await drawn($, 'ToolUse', tool('SendMessage', { input: { to: 'someone-else', message: 'hi' } }))
  expect(other).toContain('ENGINE')
  expect(isDim(other)).toBe(false)
  const errored = await drawn($, 'ToolResult', result('SendMessage', { isErrored: true }))
  expect(errored).toContain('ENGINE')
  expect(isDim(errored)).toBe(false)
  expect(await drawn($, 'ToolProgress', { tool_use_id: 't1', kind: 'other', hint: 'x' })).toContain('ENGINE')
})

test('with the quiet chat setting off, nothing in the chat is hidden', { options: { quietChat: false } }, async ($, on) => {
  await office($, on)
  expect(await drawn($, 'ToolUse', tool('mcp__clawd-hq__step'))).toContain('ENGINE')
  expect(isDim(await drawn($, 'ToolUse', tool('TodoWrite')))).toBe(false)
  expect(await drawn($, 'ToolProgress', { tool_use_id: 't1', kind: 'background_hint', hint: 'x' })).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ task: { id: 'shell-9', status: 'completed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice())).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ text: '2 background agents completed', task: undefined }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge())).toContain('ENGINE')
  for (const text of ['2 background commands completed', '1 background task completed, 1 running']) {
    expect(await drawn($, 'UserMessage', notice({ text, task: undefined }))).toContain('ENGINE')
  }
  expect(await drawn($, 'UserMessage', { text: 'Done.', origin: { kind: 'peer-send-message' }, isExpanded: false, from: { name: 'judge' } })).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', { text: 'Done.', origin: { kind: 'peer-send-message' }, isExpanded: false })).toContain('ENGINE')
  const sent = await drawn($, 'ToolUse', tool('SendMessage', { input: { to: 'judge', message: 'Score round 2.' } }))
  expect(sent).toContain('ENGINE')
  expect(isDim(sent)).toBe(false)
  expect(isDim(await drawn($, 'ToolResult', result('SendMessage')))).toBe(false)
  expect(await drawn($, 'AssistantMessage', { text: '[no update]', isFirstOfReply: true })).toContain('ENGINE')
})

test('with Clawd not running the chat, nothing in the chat is hidden either', { options: { chiefOfStaff: false } }, async ($, on) => {
  await office($, on)
  expect(await drawn($, 'ToolUse', tool('mcp__clawd-hq__step'))).toContain('ENGINE')
  expect(isDim(await drawn($, 'ToolUse', tool('TodoWrite')))).toBe(false)
  expect(await drawn($, 'UserMessage', notice({ task: { id: 'shell-9', status: 'completed' } }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice())).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', notice({ text: '2 background agents completed', task: undefined }))).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge())).toContain('ENGINE')
  for (const text of ['2 background commands completed', '1 background task completed, 1 running']) {
    expect(await drawn($, 'UserMessage', notice({ text, task: undefined }))).toContain('ENGINE')
  }
  expect(await drawn($, 'UserMessage', { text: 'Done.', origin: { kind: 'peer-send-message' }, isExpanded: false, from: { name: 'judge' } })).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', { text: 'Done.', origin: { kind: 'peer-send-message' }, isExpanded: false })).toContain('ENGINE')
  const sent = await drawn($, 'ToolUse', tool('SendMessage', { input: { to: 'judge', message: 'Score round 2.' } }))
  expect(sent).toContain('ENGINE')
  expect(isDim(sent)).toBe(false)
  expect(isDim(await drawn($, 'ToolResult', result('SendMessage')))).toBe(false)
  expect(await drawn($, 'AssistantMessage', { text: '[no update]', isFirstOfReply: true })).toContain('ENGINE')
})
