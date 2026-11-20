import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { isPersonClosingOffice } from '../hooks/office-tip'
import { closeOtherPanes } from '../hooks/panes'
import { CLOSED, START, host as baseHost } from './host'

// `/office` toggles: closed, it opens the four panes and brings Office forward; open, it closes the four panes and says so.

const IDS = ['clawd-hq', 'clawd-hq-people', 'clawd-hq-history', 'clawd-hq-settings']

/** The real default, a closed office, unless a test seeds the switch. */
const host = (on: Parameters<typeof baseHost>[0], store: Record<string, unknown> = {}) => baseHost(on, [], { ...CLOSED, ...store })
const office = ($: Engine) => $.command.run({ command: 'office', args: '' } as never) as Promise<{ text: string }>

/** The opens and closes are not awaited by the start: give them turns to finish. */
async function settle($: Engine) {
  for (let i = 0; i < 20; i++) await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
}

test('closed, /office opens the four panes and brings Office forward, as it always did', async ($, on) => {
  const { opened, panes } = host(on)
  await $.session.start(START)
  await settle($)
  const r = await office($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(panes.map(p => p.id)).toEqual(IDS)
  expect(r.text).toMatch(/open/i)
})

test('open, /office closes the four panes and says so in one short line', async ($, on) => {
  const { closed, panes } = host(on)
  await $.session.start(START)
  await settle($)
  await office($)
  closed.length = 0
  const r = await office($)
  expect([...closed].sort()).toEqual([...IDS].sort())
  expect(panes).toEqual([])
  expect(r.text).toMatch(/closed/i)
  expect(r.text.split('\n')).toHaveLength(1)
  expect(r.text.length).toBeLessThan(100)
})

test('a third /office opens it again', async ($, on) => {
  const { opened, panes } = host(on)
  await $.session.start(START)
  await office($)
  await office($)
  opened.length = 0
  await office($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(panes.map(p => p.id)).toEqual(IDS)
})

test('with the switch on the office is open from the start, so the first /office closes it', { options: { openAtStart: true } }, async ($, on) => {
  const { closed, panes } = host(on)
  await $.session.start(START)
  await settle($)
  expect(panes.map(p => p.id)).toEqual(IDS)
  closed.length = 0 // the start closed the retired tabs of old versions
  await office($)
  expect([...closed].sort()).toEqual([...IDS].sort())
  expect(panes).toEqual([])
})

// The test kit cannot raise a close as the person's (`$.ui.close` is not on its engine), so the rule that decides it is tested whole.
test('only the person\'s own close of the Office pane closes the office: not ours, not another tab\'s', () => {
  expect(isPersonClosingOffice({ id: 'clawd-hq', origin: { kind: 'person' } })).toBe(true)
  expect(isPersonClosingOffice({ id: 'clawd-hq', origin: { kind: 'plugin' } })).toBe(false)
  expect(isPersonClosingOffice({ id: 'clawd-hq', origin: { kind: 'unload' } })).toBe(false)
  expect(isPersonClosingOffice({ id: 'clawd-hq-people', origin: { kind: 'person' } })).toBe(false)
})

test('when the person closes the Office pane, the other three panes are closed too, and Office is not closed a second time', async () => {
  const closedIds: string[] = []
  await closeOtherPanes({ open: async () => undefined, list: async () => [], close: async id => { closedIds.push(id) }, hasSurface: async () => true })
  expect(closedIds).toEqual(['clawd-hq-people', 'clawd-hq-history', 'clawd-hq-settings'])
})

/** Another plugin that closes the Office pane with `$.ui.close`: a close that is not the person's. */
const CLOSER = {
  name: 'closer',
  tier: 'append',
  register(on: Parameters<typeof baseHost>[0]) {
    on('command.run', { command: 'closer-run' }, async $ => { await $.ui.close({ id: 'clawd-hq' }); return { text: 'closed' } })
  },
} as const

test('a plugin\'s close of the Office pane leaves the office open: the next /office closes the panes', { plugins: [CLOSER] } as never, async ($, on) => {
  const { closed } = host(on)
  await $.session.start(START)
  await office($)
  await $.command.run({ command: 'closer-run', args: '' } as never)
  closed.length = 0
  await office($)
  expect(closed).toContain('clawd-hq-people')
})

test('a /office that closes the panes does not stop /office-setup from opening them and starting setup later', async ($, on) => {
  const { opened } = host(on)
  await $.session.start(START)
  await office($)
  await office($)
  opened.length = 0
  await $.command.run({ command: 'office-setup', args: '' } as never)
  expect(opened.map(o => o.id)).toContain('clawd-hq')
})
