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
const drawn = async ($: Engine, component: 'UserMessage' | 'AssistantMessage', props: Record<string, unknown>, surface: 'terminal' | 'desktop' = 'terminal') => {
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
  expect(await drawn($, 'UserMessage', notice({ task: { id: 'shell-9', status: 'completed' } }))).toContain('ENGINE')
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

test('with the quiet chat setting off, nothing in the chat is hidden', { options: { quietChat: false } }, async ($, on) => {
  await office($, on)
  expect(await drawn($, 'UserMessage', notice())).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge())).toContain('ENGINE')
  expect(await drawn($, 'AssistantMessage', { text: '[no update]', isFirstOfReply: true })).toContain('ENGINE')
})

test('with Clawd not running the chat, nothing in the chat is hidden either', { options: { chiefOfStaff: false } }, async ($, on) => {
  await office($, on)
  expect(await drawn($, 'UserMessage', notice())).toContain('ENGINE')
  expect(await drawn($, 'UserMessage', fromJudge())).toContain('ENGINE')
  expect(await drawn($, 'AssistantMessage', { text: '[no update]', isFirstOfReply: true })).toContain('ENGINE')
})
