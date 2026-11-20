// Clawd is on only while "Clawd runs the chat" is on AND the office is open. Closed, no rules reach the chat by either road; open, they do.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LOCKED_RULES, RULES_FILE, SECTION_ID, VOICE_FILE } from '../hooks/instructions'
import { CLOSED, START, host as baseHost } from './host'

type On = Parameters<typeof baseHost>[0]

const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
const RULES = '# Clawd, chief of staff\n\nHand real work over.'

/** Seated outermost, it routes the prompt events past the person's plugins, as the built-in security plugin does (the backup road). */
const SEC = {
  name: 'cc-plugin-sec-default',
  tier: 'prepend',
  register(on: On) {
    on('prompt.compose', (_$, e, next) => next.to(e, 'append'))
    on('prompt.context', (_$, e, next) => next.to(e, 'append'))
  },
} as const
const BYPASSED = { plugins: [SEC] } as never
const BYPASSED_OFF = { plugins: [SEC], options: { chiefOfStaff: false } } as never

/** The host with the shipped files, a prompt that goes through, and a model request that answers. `isClosed`: the real default, a closed office. */
function setup(on: On, isClosed = true) {
  const h = baseHost(on, [], isClosed ? { ...CLOSED } : {})
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text, context: (e as { context?: string[] }).context }) as never)
  h.files.set(`${ROOT}/${RULES_FILE}`, RULES)
  h.files.set(`${ROOT}/${VOICE_FILE}`, 'Plain words.')
  return h
}

const compose = ($: Engine) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
const hasSection = async ($: Engine) => (await compose($)).sections.map(s => s.id).includes(SECTION_ID)
const say = async ($: Engine, text = 'Build the scoring API') =>
  ((await $.prompt.submit({ text, origin: { kind: 'composer' } } as never)) as { context?: string[] }).context ?? []
const carriesRules = (context: readonly string[]) => context.some(c => c.includes(RULES) && c.includes(LOCKED_RULES))
const office = ($: Engine) => $.command.run({ command: 'office', args: '' } as never)

type Row = { role: string; text: string }
const compacted = async ($: Engine, trigger: string) =>
  ((await $.session.compact({ trigger, messages: [{ role: 'user', text: 'Carry on', toolUses: [] }] } as never)) as { messages?: Row[] }).messages ?? []

// ---- The system prompt road ----

test('office closed: the rules are not in the main chat\'s instructions, though "Clawd runs the chat" is on', async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(await hasSection($)).toBe(false)
})

test('office open (the switch at start): the rules are in the main chat\'s instructions', { options: { openAtStart: true } }, async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(await hasSection($)).toBe(true)
})

test('/office opens the office and Clawd with it, from the next message on; the next /office closes it and he goes', async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(await hasSection($)).toBe(false)
  await office($)
  expect(await hasSection($)).toBe(true)
  await office($)
  expect(await hasSection($)).toBe(false)
  await office($)
  expect(await hasSection($)).toBe(true)
})

test('the Office panel shown by the host\'s own controls turns Clawd on, from the frame check on', async ($, on) => {
  const h = setup(on)
  await $.session.start(START)
  expect(await hasSection($)).toBe(false)
  h.panes.push({ id: 'clawd-hq', title: 'Office' }) // no /office typed
  for (let i = 0; i < 9; i++) await h.clock.advance(400) // the frame check notices it
  expect(await hasSection($)).toBe(true)
})

test('the Settings switch off still means off, office open or not', { options: { chiefOfStaff: false, openAtStart: true } }, async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(await hasSection($)).toBe(false)
  await office($)
  await office($)
  expect(await hasSection($)).toBe(false)
})

// ---- The backup road: the rules ride with a message ----

test('backup road, office closed: nothing rides with the first message', BYPASSED, async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(carriesRules(await say($))).toBe(false)
})

test('backup road, office open: the rules ride with the first message', { plugins: [SEC], options: { openAtStart: true } } as never, async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(carriesRules(await say($))).toBe(true)
})

test('backup road, opened mid-session: the first message after /office carries them, and none before it', BYPASSED, async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(carriesRules(await say($, 'Before'))).toBe(false)
  await office($)
  expect(carriesRules(await say($, 'After'))).toBe(true)
})

test('backup road, closed again: no second copy rides, and none after the close', BYPASSED, async ($, on) => {
  setup(on)
  await $.session.start(START)
  await office($)
  expect(carriesRules(await say($, 'One'))).toBe(true)
  await office($)
  expect(carriesRules(await say($, 'Two'))).toBe(false)
})

test('backup road with the Settings switch off: nothing rides even with the office open', { plugins: [SEC], options: { chiefOfStaff: false, openAtStart: true } } as never, async ($, on) => {
  setup(on)
  await $.session.start(START)
  expect(carriesRules(await say($))).toBe(false)
})

// ---- Auto-compact ----

test('an automatic compaction while the office is closed is left as the engine made it: no copy, no reminder', BYPASSED, async ($, on) => {
  setup(on)
  await $.session.start(START)
  const rows = await compacted($, 'auto')
  expect(rows.map(r => r.text)).toEqual(['A summary of the chat so far.']) // just the summary: no copy of the rules, no reminder
})

test('an automatic compaction while the office is open sends the rules again', BYPASSED, async ($, on) => {
  setup(on)
  await $.session.start(START)
  await office($)
  const rows = await compacted($, 'auto')
  expect(carriesRules(rows.map(r => r.text))).toBe(true)
})

// ---- The tip ----

test('a fresh session with the switch on but the office closed shows the tip, which now says Clawd comes with the office', async ($, on) => {
  const { toasts } = setup(on)
  await $.session.start(START)
  for (let i = 0; i < 20; i++) await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  expect(toasts.filter(t => t === 'Type /office to open the office and bring in Clawd')).toHaveLength(1)
})

test('with "Clawd runs the chat" off the tip does not mention him', { options: { chiefOfStaff: false } }, async ($, on) => {
  const { toasts } = setup(on)
  await $.session.start(START)
  for (let i = 0; i < 20; i++) await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  expect(toasts.filter(t => t === 'Type /office to open the office')).toHaveLength(1)
})
