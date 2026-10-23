// Clawd's rules reach the model even when another plugin hooks the same events first. Claude Code's built-in security
// plugin (cc-plugin-sec-default) sits outermost for Team and Enterprise organizations and on machines with managed
// settings, and sends prompt.compose and prompt.context past every plugin a person installs (`next.to(e, 'append')`).
// The inline plugin below does the same, so Clawd HQ's system prompt and context hooks never run.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LOCKED_RULES, RULES_FILE, SECTION_ID, VOICE_FILE } from '../hooks/instructions'
import { PANE, START, host } from './host'

type On = Parameters<typeof host>[0]

const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
const RULES = '# Clawd, chief of staff\n\nHand real work over.'

/** Seated outermost, it routes the prompt events past the person's plugins, as the built-in security plugin does. */
const SEC = {
  name: 'cc-plugin-sec-default',
  tier: 'prepend',
  register(on: On) {
    on('prompt.compose', (_$, e, next) => next.to(e, 'append'))
    on('prompt.context', (_$, e, next) => next.to(e, 'append'))
  },
} as const
const BYPASSED = { plugins: [SEC] } as never

/** The host with the shipped files (or none, `isShipped` false), a prompt that goes through, and a model request that answers. */
function office(on: On, store: Record<string, unknown> = {}, isShipped = true) {
  const h = host(on, [], store)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text, context: (e as { context?: string[] }).context }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  if (isShipped) {
    h.files.set(`${ROOT}/${RULES_FILE}`, RULES)
    h.files.set(`${ROOT}/${VOICE_FILE}`, 'Plain words.')
  }
  return h
}

const compose = ($: Engine) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
const say = async ($: Engine, text = 'Build the scoring API') =>
  ((await $.prompt.submit({ text, origin: { kind: 'composer' } } as never)) as { context?: string[] }).context ?? []
/** One model request of the main chat, as the engine makes it: the system prompt is composed for it first. */
async function request($: Engine, messageCount: number, isComposed = true) {
  if (isComposed) await compose($)
  const run = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
}
const carriesRules = (context: readonly string[]) => context.some(c => c.includes(RULES) && c.includes(LOCKED_RULES))
const lostLine = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const found = await ui.find({ type: 'Text', text: /instructions did not reach Claude/ })
  await ui.unmount()
  return found
}

test('the cause: a plugin seated outermost sends the system prompt past Clawd HQ, so his section is never added', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  expect((await compose($)).sections.map(s => s.id)).not.toContain(SECTION_ID)
})

test('with the system prompt routed past him, Clawd\'s rules ride with the person\'s first message', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  expect(carriesRules(await say($))).toBe(true)
})

test('they ride once: the next message carries no second copy', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  await say($)
  await request($, 3)
  expect(carriesRules(await say($, 'And the tests'))).toBe(false)
})

test('after the conversation shrinks (a compaction or a rewind), the next message carries them again', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  await say($)
  await request($, 40)
  await request($, 2) // the compaction's summary and the prompt after it
  expect(carriesRules(await say($, 'Carry on'))).toBe(true)
})

test('a /clear starts a new conversation, and its first message carries them again', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  await say($)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(carriesRules(await say($))).toBe(true)
})

test('the profile from setup rides with them, since the context hook is routed past too', BYPASSED, async ($, on) => {
  office(on, { profile: { role: 'Web developer', workflow: ['Ask before big changes'] } })
  await $.session.start(START)
  const context = await say($)
  expect(context.some(c => c.includes('Their role: Web developer') && c.includes('1. Ask before big changes'))).toBe(true)
})

test('a slash command carries none: the next real message does', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  expect(carriesRules(await say($, '/office'))).toBe(false)
  expect(carriesRules(await say($))).toBe(true)
})

test('where the system prompt hook runs, no copy rides with messages', async ($, on) => {
  office(on)
  await $.session.start(START)
  expect((await compose($)).sections.map(s => s.id)).toContain(SECTION_ID)
  expect(carriesRules(await say($))).toBe(false)
})

test('once a request shows the system prompt hook runs here, a later session sends no copy with its first message', async ($, on) => {
  office(on)
  await $.session.start(START)
  await say($) // the very first message, before any request: it is not known yet, so a copy rides once
  await request($, 3)
  await $.session.start(START)
  expect(carriesRules(await say($))).toBe(false)
})

test('rules that reached the model by either road leave Clawd\'s card without a warning', BYPASSED, async ($, on) => {
  office(on)
  await $.session.start(START)
  await say($)
  await request($, 3, false)
  expect(await lostLine($)).toBeUndefined()
})

test('rules that could not reach the model show a warning on Clawd\'s card', BYPASSED, async ($, on) => {
  office(on, {}, false)
  await $.session.start(START)
  await say($)
  await request($, 3, false)
  const line = await lostLine($)
  expect(String(line?.text)).toMatch(/instructions did not reach Claude/)
})

test('the warning goes once a later request gets the rules', async ($, on) => {
  const { files } = office(on, {}, false)
  await $.session.start(START)
  await request($, 3)
  expect(await lostLine($)).toBeDefined()
  files.set(`${ROOT}/${RULES_FILE}`, RULES)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await request($, 1)
  expect(await lostLine($)).toBeUndefined()
})

test('with Clawd not running the chat, nothing rides with messages and no warning shows', { ...BYPASSED as object, options: { chiefOfStaff: false } } as never, async ($, on) => {
  office(on)
  await $.session.start(START)
  expect(carriesRules(await say($))).toBe(false)
  await request($, 3, false)
  expect(await lostLine($)).toBeUndefined()
})
