import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { seedDecisions } from './decisions-file'
import { ALL_PANES, PEOPLE, START, SURFACES, host, mountLog, paneProps } from './host'

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null)
const IDS = ['clawd-hq', 'clawd-hq-people', 'clawd-hq-settings']

// ---- Opening the three panes ----

test('/office opens Office, People and Settings in that order, then brings Office forward; there is no Decisions tab', async ($, on) => {
  const { opened, panes } = host(on)
  const result = (await $.command.run({ command: 'office', args: '' } as never)) as { text: string }

  expect(opened.slice(0, 3).map(o => [o.id, o.title])).toEqual([
    ['clawd-hq', 'Office'], ['clawd-hq-people', 'People'], ['clawd-hq-settings', 'Settings'],
  ])
  // Only the last open asks for the keyboard: Office, so the later opens cannot leave another tab in front.
  expect(opened.slice(0, 3).every(o => o.focus === undefined)).toBe(true)
  expect(opened[3]).toMatchObject({ id: 'clawd-hq', title: 'Office', focus: true })
  expect(opened).toHaveLength(4)
  // The host's tab strip reads in open order.
  expect(panes.map(p => p.id)).toEqual(IDS)
  expect(result.text).toContain('Office · People · Settings')
  expect(result.text).not.toMatch(/Log|Clawd ·|Decisions/)
  expect(result.text).not.toMatch(/\bo Office|\bp People|\bs Settings/)
})

test('panes of the old Log, Clawd and Decisions tabs, left open by an earlier version, are closed when the office opens', async ($, on) => {
  const { closed, panes } = host(on)
  for (const id of ['clawd-hq-log', 'clawd-hq-clawd', 'clawd-hq-decisions']) panes.push({ id, title: id })
  await $.command.run({ command: 'office', args: '' } as never)
  expect(closed).toEqual(['clawd-hq-log', 'clawd-hq-clawd', 'clawd-hq-decisions'])
  expect(panes.map(p => p.id)).toEqual(IDS)
})

/** The opens are not awaited by the start: give them turns to finish (more than they need, so an extra open would show). */
async function settle($: Engine) {
  for (let i = 0; i < 20; i++) {
    await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  }
}

test('a desktop session opens the three panes in order once its surface attaches, then asks for Office to be shown, whatever old decisions the project has', async ($, on) => {
  const { opened, panes, files } = host(on)
  seedDecisions(files, [{ text: 'Scores live in Postgres' }, { text: 'Use Drizzle for migrations' }])
  // The desktop app runs the session headless: it starts with no surface and attaches after. An open before then would be
  // refused, and the engine would write "ui.open: no-surface" into the chat, so nothing is opened until the attach.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await settle($)
  expect(opened).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened.map(o => o.title)).toEqual(['Office', 'People', 'Settings', 'Office'])
  // Only the engine's focus request brings an open pane forward: the last Office open makes it.
  expect(opened.slice(0, 3).every(o => o.focus === undefined)).toBe(true)
  expect(opened[3]!.focus).toBe(true)
  expect(panes.map(p => p.id)).toEqual(IDS)
})

test('a terminal session start opens the three panes in order and then asks for Office to be shown, as the desktop does', async ($, on) => {
  const { opened, panes } = host(on)
  await $.session.start(START)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened.slice(0, 3).every(o => o.focus === undefined)).toBe(true)
  expect(opened[3]!.focus).toBe(true)
  expect(panes.map(p => p.id)).toEqual(IDS)
})

const mainReplyEnds = ($: Engine) => $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
const focusAsks = (opened: Array<{ id: string; focus?: true }>) => opened.filter(o => o.focus === true).map(o => o.id)

test('a focus request the surface refused at session start (a reply is running) is made once more when the first main-chat reply ends, and never again', async ($, on) => {
  const { opened, front, focus, panes } = host(on)
  // The surface is showing another tab and turns the request down.
  front.id = 'clawd-hq-settings'
  focus.isRefused = true
  for (const surface of ['terminal', 'desktop'] as const) {
    // Each surface is a fresh start: no pane of an earlier run is up.
    panes.length = 0
    opened.length = 0
    focus.isRefused = true
    await $.session.start({ cwd: '/repo', surface, isInteractive: true } as never)
    await settle($)
    expect(focusAsks(opened)).toEqual(['clawd-hq'])

    // Specialists finishing do not count as the main chat's reply.
    await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'a', agentId: 'a1', isAborted: false } as never)
    expect(focusAsks(opened)).toEqual(['clawd-hq'])

    focus.isRefused = false
    await mainReplyEnds($)
    expect(focusAsks(opened)).toEqual(['clawd-hq', 'clawd-hq'])
    expect(front.id).toBe('clawd-hq')

    front.id = 'clawd-hq-people'
    await mainReplyEnds($)
    expect(focusAsks(opened)).toEqual(['clawd-hq', 'clawd-hq'])
    expect(front.id).toBe('clawd-hq-people')
    front.id = 'clawd-hq-settings'
  }
})

test('the desktop app attaching after the session started: Office is asked to the front when it attaches, and not again after the first reply', async ($, on) => {
  const { opened, front, surface } = host(on)
  front.id = 'clawd-hq-settings'
  surface.isAbsent = true
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await settle($)
  // Nothing places the panes yet, so the start's request had nothing to land on.
  expect(front.id).toBe('clawd-hq-settings')

  surface.isAbsent = false
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  expect(front.id).toBe('clawd-hq')

  front.id = 'clawd-hq-people'
  const asks = focusAsks(opened).length
  await mainReplyEnds($)
  expect(focusAsks(opened)).toHaveLength(asks)
  expect(front.id).toBe('clawd-hq-people')
})

test('an attach when nothing is owed (the start was granted) does not move the person off the tab they are on', async ($, on) => {
  const { opened, front } = host(on)
  front.id = 'clawd-hq-settings'
  await $.session.start(START)
  await settle($)
  front.id = 'clawd-hq-people'
  const asks = focusAsks(opened).length
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  expect(focusAsks(opened)).toHaveLength(asks)
  expect(front.id).toBe('clawd-hq-people')
})

test('a reload of the plugin (a config changed) finds its panes up: they open again without focus, and nothing is asked after the reply', async ($, on) => {
  const { opened, front, focus } = host(on)
  front.id = 'clawd-hq-settings'
  await $.session.start(START)
  await settle($)
  expect(focusAsks(opened)).toEqual(['clawd-hq'])
  // The person goes to Settings and presses a toggle: the plugin reloads and its session start runs again.
  front.id = 'clawd-hq-settings'
  focus.isRefused = true
  opened.length = 0
  await $.session.start(START)
  await settle($)
  expect(opened.map(o => o.id)).toEqual(IDS)
  expect(focusAsks(opened)).toEqual([])
  focus.isRefused = false
  await mainReplyEnds($)
  expect(focusAsks(opened)).toEqual([])
  expect(front.id).toBe('clawd-hq-settings')
})

test('a granted request at session start is not made again after the first reply', async ($, on) => {
  const { opened, front } = host(on)
  front.id = 'clawd-hq-settings'
  await $.session.start(START)
  await settle($)
  expect(front.id).toBe('clawd-hq')
  await mainReplyEnds($)
  expect(focusAsks(opened)).toEqual(['clawd-hq'])
})

test('the office-demo command and the demo tool open the three panes without focus', async ($, on) => {
  const { opened } = host(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  expect(opened.slice(0, 3).map(o => o.id)).toEqual(IDS)
  expect(opened.slice(0, 3).every(o => o.focus === undefined)).toBe(true)
})

// ---- No tab strip inside the panes; the gauges are the footer ----

test('no pane draws its own tab strip or the o, p, s keys', async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    for (const pane of ALL_PANES) {
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
      for (const view of ['office', 'decisions', 'people', 'settings']) {
        expect(await ui.find({ key: `tab-${view}` })).toBeUndefined()
        expect(await ui.find({ key: `tabbox-${view}` })).toBeUndefined()
      }
      const hotkeys = (await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)
      for (const key of ['o', 'd', 'p', 's']) expect(hotkeys).not.toContain(key)
      await ui.unmount()
    }
  }
})

test('on every pane the gauges are the last thing, and nothing above them is a gauge', async ($, on) => {
  host(on)
  await $.session.measure({ context: { window: 1_000_000, tokens: 210_000, percent: 21 }, rateLimits: [], changed: ['context'] } as never)
  for (const surface of SURFACES) {
    for (const pane of ALL_PANES) {
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
      const rows = elementsOf((await ui.drawn()) as unknown as Tree)
      expect(rows[rows.length - 1]?.props.key).toBe('gauges')
      expect(rows.slice(0, -1).some(r => r.props.key === 'gauges')).toBe(false)
      expect((await ui.findAll({ key: 'gauges' }))).toHaveLength(1)
      expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage ▾')
      expect(await ui.find({ type: 'Text', text: /^21%$/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('the demo caption stays at the top of every pane, above everything else', async ($, on) => {
  const { clock } = host(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await clock.advance(100)
  for (const pane of ALL_PANES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...pane })
    expect(await ui.find({ type: 'Text', text: /🎬 1\/20/ })).toBeDefined()
    const rows = elementsOf((await ui.drawn()) as unknown as Tree)
    expect(rows[0]?.props.borderColor).toBe('yellow')
    expect(rows[rows.length - 1]?.props.key).toBe('gauges')
    await ui.unmount()
  }
})

test('the footer sits on the bottom edge where the room is known: a docked terminal pane fills its rows, other surfaces too, falling back to their whole body, an inline terminal pane just ends with it', async ($, on) => {
  host(on)
  const rowsOf = async (surface: 'terminal' | 'desktop', over: Record<string, unknown>) => {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq-settings', 'Settings', over) })
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

  const desktop = await rowsOf('desktop', { placement: 'dock', scroll: { offset: 0, bodyRows: 52 } })
  expect(desktop.root.props.minHeight).toBe(52)
  expect(desktop.rows[desktop.rows.length - 2]?.props.flexGrow).toBe(1)

  // Where the surface gives no rows, the body's whole height stands in.
  const unsized = await rowsOf('desktop', { placement: 'dock', scroll: { offset: 0, bodyRows: 0 } })
  expect(unsized.root.props.minHeight).toBe('100%')
  expect(unsized.rows[unsized.rows.length - 2]?.props.flexGrow).toBe(1)
})

// ---- The tour ----

test('the tour brings Settings forward, on the finished list, for the finishers, then People, then Office, and says so in plain words', async ($, on) => {
  const { clock, opened } = host(on, [])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  const raised = () => opened.filter(o => o.focus === true).map(o => o.id)

  await clock.advance(14 * 4_500 + 100)
  await clock.advance(100)
  expect(raised().pop()).toBe('clawd-hq-settings')
  const log = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-settings', 'Settings') })
  expect(await log.find({ type: 'Text', text: /Finished work stays tidy: the pair-up and the council get one card each, voice by voice\./ })).toBeDefined()
  expect(await log.find({ type: 'Text', text: /took/ })).toBeDefined()
  expect(await log.find({ key: 'settings-back' })).toBeDefined()
  await log.unmount()

  // Leaving for People puts Settings back on its switches, so the finished list is not left open after the tour.
  await clock.advance(4 * 4_500)
  expect(raised().pop()).toBe('clawd-hq-people')
  const after = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-settings', 'Settings') })
  expect(await after.find({ key: 'settings-log' })).toBeDefined()
  await after.unmount()
  const people = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-people', 'People') })
  expect(await people.find({ type: 'Text', text: /^🎬 19\/20 · People lists the team/ })).toBeDefined()
  await people.unmount()

  await clock.advance(4_500)
  expect(raised().pop()).toBe('clawd-hq')
})

test('the tour says an answer in the question box settles the job at hand, and no longer says answers are saved as decisions', async ($, on) => {
  const { clock } = host(on, [])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await clock.advance(15 * 4_500 + 100)
  await clock.advance(100)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq', 'Office') })
  const caption = await ui.find({ type: 'Text', text: /^🎬 16\/20 · Questions wait and come in one box/ })
  expect(String(caption?.text)).toContain('Your answer settles the job at hand only.')
  expect(String(caption?.text)).not.toMatch(/saved as decisions/)
  await ui.unmount()
})

test('the tour does not reopen a pane the person closed', async ($, on) => {
  const { clock, opened, closePane } = host(on, [])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  closePane('clawd-hq-settings')
  const before = opened.length
  await clock.advance(15 * 4_500 + 200)
  expect(opened.slice(before).some(o => o.id === 'clawd-hq-settings')).toBe(false)
})

// ---- A pane the host cannot open or list never breaks the turn that asked ----

test('one pane the host refuses does not stop the others from opening', async ($, on) => {
  const { opened, panes, fail } = host(on)
  fail.ids.add('clawd-hq-people')
  const result = (await $.command.run({ command: 'office', args: '' } as never)) as { text: string }
  expect(result.text).toContain('Office')
  expect(panes.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-settings'])
  expect(opened[opened.length - 1]).toMatchObject({ id: 'clawd-hq', focus: true })
})

test('with the host refusing every open and every listing, /office, /office-demo, the demo tool and the whole tour finish without throwing', async ($, on) => {
  const { clock, fail } = host(on)
  fail.open = true
  fail.list = true
  await expect($.command.run({ command: 'office', args: '' } as never)).resolves.toMatchObject({ text: expect.stringContaining('Office') })
  await expect($.command.run({ command: 'office-demo', args: '' } as never)).resolves.toMatchObject({ text: expect.stringContaining('tour') })
  await expect($.tool.call({ tool: 'mcp__clawd-hq__demo' } as never)).resolves.toBeDefined()
  // The tour's own steps raise panes: all twenty run, and the demo state is cleaned up at the end.
  await clock.advance(20 * 4_500 + 2_000)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  expect(await ui.find({ type: 'Text', text: /🎬/ })).toBeUndefined()
  await ui.unmount()
})

// ---- Nothing is cut, in any tab ----

const LONG_BLURB = 'Plans the work in small steps before anyone builds, and checks each step against the brief and the decisions already made.'

test('no text in any tab is cut short: nothing truncates on either surface, and a long blurb on People shows whole', async ($, on) => {
  host(on, [], { 'artifacts:/repo': [{ url: 'https://claude.ai/artifact/9WdR8H2T9Z7QScxjCbQjEM', title: 'Scoring plan', at: 500 }] })
  on('agent.offer', () => ({ isOffered: true }) as never)
  await $.session.start(START)
  await $.agent.offer({ agent: 'ecc:planner', description: LONG_BLURB } as never)
  for (const pane of ALL_PANES) {
    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
      const texts = await ui.findAll({ type: 'Text' })
      expect(texts.filter(t => t.props.wrap === 'truncate').map(t => `${pane.requestId}: ${String(t.text)}`)).toEqual([])
      if (pane.requestId === 'clawd-hq-people') expect(texts.find(t => t.text === 'Plans the work in small steps before anyone builds')?.props.wrap).toBe('wrap')
      if (pane.requestId === 'clawd-hq') expect(texts.some(t => /Scoring plan/.test(String(t.text)))).toBe(true)
      await ui.unmount()
    }
  }
})
