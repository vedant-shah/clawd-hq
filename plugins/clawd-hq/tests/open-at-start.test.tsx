import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { SETTINGS, START, host } from './host'

const IDS = ['clawd-hq', 'clawd-hq-people', 'clawd-hq-history', 'clawd-hq-settings']

/** The opens are not awaited by the start: give them turns to finish (more than they need, so an extra open would show). */
async function settle($: Engine) {
  for (let i = 0; i < 20; i++) {
    await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  }
}
const mainReplyEnds = ($: Engine) => $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)

test('with "Open the office at session start" on (the default), a start opens the four panes and asks for Office to be shown', async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened[4]!.focus).toBe(true)
})

test('with it off in the settings, a start opens no panes and asks for nothing', { options: { openAtStart: false } }, async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await settle($)
  expect(opened).toEqual([])
})

test('with it off, a desktop session that attaches later, and its first reply, open and ask for nothing', { options: { openAtStart: false } }, async ($, on) => {
  const { opened } = host(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  await mainReplyEnds($)
  await settle($)
  expect(opened).toEqual([])
})

test('a switch saved off in the store turns the open at start off', async ($, on) => {
  const { opened } = host(on, [], { 'toggle:openAtStart': false })
  await $.session.start(START)
  await settle($)
  expect(opened).toEqual([])
})

test('with it off, /office still opens the four panes and brings Office forward', { options: { openAtStart: false } }, async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await settle($)
  await $.command.run({ command: 'office', args: '' } as never)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened[4]!.focus).toBe(true)
})

test('a switch turned off after the start but before the desktop attaches stops the owed open', async ($, on) => {
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
