import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { CLOSED, SETTINGS, START, host as baseHost } from './host'

/** These tests are about the switch itself, so the host keeps the plugin's real default (closed) unless a test seeds the switch. */
const host = (on: Parameters<typeof baseHost>[0], agents: unknown[] = [], store: Record<string, unknown> = {}) => baseHost(on, agents, { ...CLOSED, ...store })

const IDS = ['clawd-hq', 'clawd-hq-people', 'clawd-hq-history', 'clawd-hq-settings']
const TIP = 'Type /office to open the office and bring in Clawd' // "Clawd runs the chat" is on by default
const MARKER = 'officeOpened'

/** The opens are not awaited by the start: give them turns to finish (more than they need, so an extra open would show). */
async function settle($: Engine) {
  for (let i = 0; i < 20; i++) {
    await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  }
}
const mainReplyEnds = ($: Engine) => $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
const tips = (toasts: readonly string[]) => toasts.filter(t => t === TIP)

// ---- The switch: closed by default ----

test('with "Open the office at session start" on, a start opens the four panes and asks for Office to be shown', { options: { openAtStart: true } }, async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened[4]!.focus).toBe(true)
})

test('by default (the switch is off) a start opens no panes and asks for nothing', async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await settle($)
  expect(opened).toEqual([])
})

test('with it off, a desktop session that attaches later, and its first reply, open and ask for nothing', async ($, on) => {
  const { opened } = host(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  await mainReplyEnds($)
  await settle($)
  expect(opened).toEqual([])
})

test('a switch saved on in the store turns the open at start on', async ($, on) => {
  const { opened } = host(on, [], { 'toggle:openAtStart': true })
  await $.session.start(START)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
})

test('a switch saved off in the store keeps the panes closed even when the settings say on', { options: { openAtStart: true } }, async ($, on) => {
  const { opened } = host(on, [], { 'toggle:openAtStart': false })
  await $.session.start(START)
  await settle($)
  expect(opened).toEqual([])
})

test('with it off, /office still opens the four panes and brings Office forward', async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await settle($)
  await $.command.run({ command: 'office', args: '' } as never)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened[4]!.focus).toBe(true)
})

test('a switch turned off after the start but before the desktop attaches stops the owed open', { options: { openAtStart: true } }, async ($, on) => {
  const { opened } = host(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await settle($)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...SETTINGS })
  await ui.press({ key: 'config-openAtStart' }) // the switch pressed off, as a person would
  await ui.unmount()
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  await mainReplyEnds($)
  await settle($)
  expect(opened).toEqual([])
})

// ---- The tip: shown while the panels are closed, until the office has been opened once ----

test('with the panels closed, a fresh session shows the tip once', async ($, on) => {
  const { toasts } = host(on)
  await $.session.start(START)
  await settle($)
  await mainReplyEnds($)
  await settle($)
  expect(tips(toasts)).toHaveLength(1)
})

test('the tip is shown again in the next fresh session while the office has never been opened', async ($, on) => {
  const { toasts } = host(on)
  await $.session.start(START)
  await settle($)
  await $.session.start(START)
  await settle($)
  expect(tips(toasts)).toHaveLength(2)
})

test('/office leaves the marker, and the tip never shows again, in this session or the next', async ($, on) => {
  const { toasts, saved } = host(on)
  await $.session.start(START)
  await settle($)
  expect(tips(toasts)).toHaveLength(1)
  await $.command.run({ command: 'office', args: '' } as never)
  expect(saved.get(MARKER)).toBe(true)
  await $.session.start(START)
  await settle($)
  expect(tips(toasts)).toHaveLength(1)
})

test('a marker already kept from an earlier open means no tip at the start', async ($, on) => {
  const { toasts } = host(on, [], { [MARKER]: true })
  await $.session.start(START)
  await settle($)
  expect(tips(toasts)).toEqual([])
})

test('with the switch on the panes open and no tip is shown', { options: { openAtStart: true } }, async ($, on) => {
  const { toasts } = host(on)
  await $.session.start(START)
  await settle($)
  expect(tips(toasts)).toEqual([])
})

test('a marker that cannot be kept does not stop /office from opening the panes', async ($, on) => {
  const { opened, kv } = host(on)
  await $.session.start(START)
  await settle($)
  kv.isWriteFailing = true
  await $.command.run({ command: 'office', args: '' } as never)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
})

// ---- Any real open of the office keeps the marker ----

test('with the switch on, the start keeps the marker and shows no tip', { options: { openAtStart: true } }, async ($, on) => {
  const { saved } = host(on)
  await $.session.start(START)
  await settle($)
  expect(saved.get(MARKER)).toBe(true)
})

test('/office-setup keeps the marker', async ($, on) => {
  const { saved } = host(on)
  await $.session.start(START)
  await settle($)
  expect(saved.has(MARKER)).toBe(false)
  await $.command.run({ command: 'office-setup', args: '' } as never)
  await settle($)
  expect(saved.get(MARKER)).toBe(true)
})

test('the tour does not keep the marker', async ($, on) => {
  const { saved } = host(on)
  await $.session.start(START)
  await settle($)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await settle($)
  expect(saved.has(MARKER)).toBe(false)
})
