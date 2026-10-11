import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { DECISIONS, FOUR, LOG, START, SURFACES, host, paneProps } from './host'

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null)
const remember = ($: Engine, decision: string) => $.tool.call({ tool: 'mcp__clawd-hq__remember', decision } as never)
const IDS = ['clawd-hq', 'clawd-hq-decisions', 'clawd-hq-people', 'clawd-hq-log']

// ---- Opening the four panes ----

test('/office opens Office, Decisions, People and Log in that order, then brings Office forward', async ($, on) => {
  const { opened, panes } = host(on)
  const result = (await $.command.run({ command: 'office', args: '' } as never)) as { text: string }

  expect(opened.slice(0, 4).map(o => [o.id, o.title])).toEqual([
    ['clawd-hq', 'Office'], ['clawd-hq-decisions', 'Decisions'], ['clawd-hq-people', 'People'], ['clawd-hq-log', 'Log'],
  ])
  // Only the last open asks for the keyboard: Office, so the later opens cannot leave another tab in front.
  expect(opened.slice(0, 4).every(o => o.focus === undefined)).toBe(true)
  expect(opened[4]).toMatchObject({ id: 'clawd-hq', title: 'Office', focus: true })
  expect(opened).toHaveLength(5)
  // The host's tab strip reads in open order.
  expect(panes.map(p => p.id)).toEqual(IDS)
  expect(result.text).toContain('Office · Decisions · People · Log')
  expect(result.text).not.toMatch(/\bo Office|\bd Decisions|\bp People|\bl Log/)
})

test('a session start opens the four panes the same way, without taking focus, and the Decisions title carries the count', async ($, on) => {
  const { opened, panes } = host(on)
  await remember($, 'Scores live in Postgres')
  await remember($, 'Use Drizzle for migrations')
  await $.session.start(START)
  // The opens are not awaited by the start: let them finish.
  await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  expect(opened.map(o => o.id)).toEqual(IDS)
  expect(opened.map(o => o.title)).toEqual(['Office', 'Decisions 2', 'People', 'Log'])
  expect(opened.every(o => o.focus === undefined)).toBe(true)
  expect(panes.map(p => p.id)).toEqual(IDS)
})

test('the office-demo command and the demo tool open the four panes without focus', async ($, on) => {
  const { opened } = host(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  expect(opened.slice(0, 4).map(o => o.id)).toEqual(IDS)
  expect(opened.slice(0, 4).every(o => o.focus === undefined)).toBe(true)
})

// ---- The Decisions title ----

test('the Decisions title follows the count of what the project remembers', async ($, on) => {
  const { panes } = host(on)
  const titleOf = () => panes.find(p => p.id === 'clawd-hq-decisions')?.title
  await $.command.run({ command: 'office', args: '' } as never)
  expect(titleOf()).toBe('Decisions')
  await remember($, 'Scores live in Postgres')
  expect(titleOf()).toBe('Decisions 1')
  await remember($, 'Use Drizzle for migrations')
  expect(titleOf()).toBe('Decisions 2')
  // Forgetting one, from the pane itself, brings the count down.
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...DECISIONS })
  await ui.press({ key: 'forget-M2' })
  expect(titleOf()).toBe('Decisions 1')
  await ui.press({ key: 'forget-M1' })
  expect(titleOf()).toBe('Decisions')
  await ui.unmount()
  // The other tabs keep their titles, and the order of the strip is unchanged.
  expect(panes.map(p => p.title)).toEqual(['Office', 'Decisions', 'People', 'Log'])
})

test('a retitle only changes a pane that is open: a Decisions pane the person closed is not opened again', async ($, on) => {
  const { opened, panes, closePane } = host(on)
  // Nothing open yet: remembering opens nothing.
  await remember($, 'Scores live in Postgres')
  expect(opened).toEqual([])

  await $.command.run({ command: 'office', args: '' } as never)
  const before = opened.length
  closePane('clawd-hq-decisions')
  await remember($, 'Use Drizzle for migrations')
  expect(opened).toHaveLength(before)
  expect(panes.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-people', 'clawd-hq-log'])
})

test('an unchanged count does not reopen the pane', async ($, on) => {
  const { opened } = host(on)
  await $.command.run({ command: 'office', args: '' } as never)
  const before = opened.length
  // The same decision said again moves to the end but the count stays one.
  await remember($, 'Scores live in Postgres')
  expect(opened).toHaveLength(before + 1)
  await remember($, 'Scores live in Postgres')
  expect(opened).toHaveLength(before + 1)
})

// ---- No tab strip inside the panes; the gauges are the footer ----

test('no pane draws its own tab strip or the o, d, p, l keys', async ($, on) => {
  host(on)
  await remember($, 'Use Postgres')
  for (const surface of SURFACES) {
    for (const pane of FOUR) {
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
      for (const view of ['office', 'decisions', 'people', 'log']) {
        expect(await ui.find({ key: `tab-${view}` })).toBeUndefined()
        expect(await ui.find({ key: `tabbox-${view}` })).toBeUndefined()
      }
      const hotkeys = (await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)
      for (const key of ['o', 'd', 'p', 'l']) expect(hotkeys).not.toContain(key)
      await ui.unmount()
    }
  }
})

test('on every pane the gauges are the last thing, and nothing above them is a gauge', async ($, on) => {
  host(on)
  await $.session.measure({ context: { window: 1_000_000, tokens: 210_000, percent: 21 }, rateLimits: [], changed: ['context'] } as never)
  for (const surface of SURFACES) {
    for (const pane of FOUR) {
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
      const rows = elementsOf((await ui.drawn()) as unknown as Tree)
      expect(rows[rows.length - 1]?.props.key).toBe('gauges')
      expect(rows.slice(0, -1).some(r => r.props.key === 'gauges')).toBe(false)
      expect((await ui.findAll({ key: 'gauges' }))).toHaveLength(1)
      expect(await ui.find({ type: 'Text', text: /^Context$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('the demo caption stays at the top of every pane, above everything else', async ($, on) => {
  const { clock } = host(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await clock.advance(100)
  for (const pane of FOUR) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...pane })
    expect(await ui.find({ type: 'Text', text: /🎬 1\/13/ })).toBeDefined()
    const rows = elementsOf((await ui.drawn()) as unknown as Tree)
    expect(rows[0]?.props.borderColor).toBe('yellow')
    expect(rows[rows.length - 1]?.props.key).toBe('gauges')
    await ui.unmount()
  }
})

test('the footer sits on the bottom edge where the room is known: a docked terminal pane fills its rows, other surfaces fill their body, an inline terminal pane just ends with it', async ($, on) => {
  host(on)
  const rowsOf = async (surface: 'terminal' | 'desktop', over: Record<string, unknown>) => {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq-log', 'Log', over) })
    const root = (await ui.drawn()) as unknown as Tree
    await ui.unmount()
    return { root, rows: elementsOf(root) }
  }

  const docked = await rowsOf('terminal', { placement: 'dock', scroll: { offset: 0, bodyRows: 37 } })
  expect(docked.root.props.minHeight).toBe(37)
  // A spacer that grows sits just above the footer.
  expect(docked.rows[docked.rows.length - 2]?.props.flexGrow).toBe(1)

  const inline = await rowsOf('terminal', { placement: 'inline', scroll: { offset: 0, bodyRows: 12 } })
  expect(inline.root.props.minHeight).toBeUndefined()
  expect(inline.rows.some(r => r.props.flexGrow === 1)).toBe(false)
  expect(inline.rows[inline.rows.length - 1]?.props.key).toBe('gauges')

  const desktop = await rowsOf('desktop', { placement: 'dock' })
  expect(desktop.root.props.minHeight).toBe('100%')
  expect(desktop.rows[desktop.rows.length - 2]?.props.flexGrow).toBe(1)
})

// ---- The tour ----

test('the tour brings the Log pane forward for the finishers, then People, then Office, and says so in plain words', async ($, on) => {
  const { clock, opened } = host(on, [])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  const raised = () => opened.filter(o => o.focus === true).map(o => o.id)

  await clock.advance(9 * 5_000 + 100)
  await clock.advance(100)
  expect(raised().pop()).toBe('clawd-hq-log')
  const log = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...LOG })
  expect(await log.find({ type: 'Text', text: /Finishers move to the Log tab, with how long they took\./ })).toBeDefined()
  expect(await log.find({ type: 'Text', text: /\(l\)/ })).toBeUndefined()
  expect(await log.find({ type: 'Text', text: /took/ })).toBeDefined()
  await log.unmount()

  await clock.advance(5_000)
  expect(raised().pop()).toBe('clawd-hq-people')
  const people = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-people', 'People') })
  expect(await people.find({ type: 'Text', text: /^🎬 11\/13 · People is the payroll/ })).toBeDefined()
  await people.unmount()

  await clock.advance(5_000)
  expect(raised().pop()).toBe('clawd-hq')
})

test('the tour does not reopen a pane the person closed', async ($, on) => {
  const { clock, opened, closePane } = host(on, [])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  closePane('clawd-hq-log')
  const before = opened.length
  await clock.advance(9 * 5_000 + 200)
  expect(opened.slice(before).some(o => o.id === 'clawd-hq-log')).toBe(false)
})

// ---- A pane the host cannot open or list never breaks the turn that asked ----

test('one pane the host refuses does not stop the others from opening', async ($, on) => {
  const { opened, panes, fail } = host(on)
  fail.ids.add('clawd-hq-decisions')
  const result = (await $.command.run({ command: 'office', args: '' } as never)) as { text: string }
  expect(result.text).toContain('Office')
  expect(panes.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-people', 'clawd-hq-log'])
  expect(opened[opened.length - 1]).toMatchObject({ id: 'clawd-hq', focus: true })
})

test('with the host refusing every open and every listing, /office, /office-demo, the demo tool, a memory write and the whole tour finish without throwing', async ($, on) => {
  const { clock, fail } = host(on)
  fail.open = true
  fail.list = true
  await expect($.command.run({ command: 'office', args: '' } as never)).resolves.toMatchObject({ text: expect.stringContaining('Office') })
  await expect($.command.run({ command: 'office-demo', args: '' } as never)).resolves.toMatchObject({ text: expect.stringContaining('tour') })
  await expect($.tool.call({ tool: 'mcp__clawd-hq__demo' } as never)).resolves.toBeDefined()
  await expect(remember($, 'Scores live in Postgres')).resolves.toBeDefined()
  // The tour's own steps raise panes: all thirteen run, and the demo state is cleaned up at the end.
  await clock.advance(13 * 5_000 + 2_000)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DECISIONS })
  expect(await ui.find({ type: 'Text', text: /Scores live in Postgres/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /🎬/ })).toBeUndefined()
  await ui.unmount()
})
