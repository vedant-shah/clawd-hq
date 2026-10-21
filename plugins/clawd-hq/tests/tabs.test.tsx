import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { seedDecisions } from './decisions-file'
import { ALL_PANES, DECISIONS, START, SURFACES, host, mountLog, paneProps } from './host'

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null)
const IDS = ['clawd-hq', 'clawd-hq-decisions', 'clawd-hq-people', 'clawd-hq-settings']

// ---- Opening the four panes ----

test('/office opens Office, Decisions, People and Settings in that order, then brings Office forward', async ($, on) => {
  const { opened, panes } = host(on)
  const result = (await $.command.run({ command: 'office', args: '' } as never)) as { text: string }

  expect(opened.slice(0, 4).map(o => [o.id, o.title])).toEqual([
    ['clawd-hq', 'Office'], ['clawd-hq-decisions', 'Decisions'], ['clawd-hq-people', 'People'], ['clawd-hq-settings', 'Settings'],
  ])
  // Only the last open asks for the keyboard: Office, so the later opens cannot leave another tab in front.
  expect(opened.slice(0, 4).every(o => o.focus === undefined)).toBe(true)
  expect(opened[4]).toMatchObject({ id: 'clawd-hq', title: 'Office', focus: true })
  expect(opened).toHaveLength(5)
  // The host's tab strip reads in open order.
  expect(panes.map(p => p.id)).toEqual(IDS)
  expect(result.text).toContain('Office · Decisions · People · Settings')
  expect(result.text).not.toMatch(/Log|Clawd ·/)
  expect(result.text).not.toMatch(/\bo Office|\bd Decisions|\bp People|\bs Settings/)
})

test('panes of the old Log and Clawd tabs, left open by an earlier version, are closed when the office opens', async ($, on) => {
  const { closed, panes } = host(on)
  for (const id of ['clawd-hq-log', 'clawd-hq-clawd']) panes.push({ id, title: id })
  await $.command.run({ command: 'office', args: '' } as never)
  expect(closed).toEqual(['clawd-hq-log', 'clawd-hq-clawd'])
  expect(panes.map(p => p.id)).toEqual(IDS)
})

/** The opens are not awaited by the start: give them turns to finish (more than they need, so an extra open would show). */
async function settle($: Engine) {
  for (let i = 0; i < 20; i++) {
    await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
  }
}

test('a desktop session start opens the four panes in order, then asks for Office to be shown, and the Decisions title carries the count', async ($, on) => {
  const { opened, panes, files } = host(on)
  seedDecisions(files, [{ text: 'Scores live in Postgres' }, { text: 'Use Drizzle for migrations' }])
  // The desktop app runs the session headless: it starts with no surface and attaches after.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened.map(o => o.title)).toEqual(['Office', 'Decisions 2', 'People', 'Settings', 'Office'])
  // Only the engine's focus request brings an open pane forward: the last Office open makes it.
  expect(opened.slice(0, 4).every(o => o.focus === undefined)).toBe(true)
  expect(opened[4]!.focus).toBe(true)
  expect(panes.map(p => p.id)).toEqual(IDS)
})

test('a terminal session start opens the four panes in order and then asks for Office to be shown, as the desktop does', async ($, on) => {
  const { opened, panes } = host(on)
  await $.session.start(START)
  await settle($)
  expect(opened.map(o => o.id)).toEqual([...IDS, 'clawd-hq'])
  expect(opened.slice(0, 4).every(o => o.focus === undefined)).toBe(true)
  expect(opened[4]!.focus).toBe(true)
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

test('the office-demo command and the demo tool open the four panes without focus', async ($, on) => {
  const { opened } = host(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  expect(opened.slice(0, 4).map(o => o.id)).toEqual(IDS)
  expect(opened.slice(0, 4).every(o => o.focus === undefined)).toBe(true)
})

// ---- The Decisions title ----

test('the Decisions title follows the count of what the project remembers', async ($, on) => {
  const { panes, files } = host(on)
  const titleOf = () => panes.find(p => p.id === 'clawd-hq-decisions')?.title
  seedDecisions(files, [{ text: 'Scores live in Postgres' }, { text: 'Use Drizzle for migrations' }])
  await $.session.start(START)
  await $.command.run({ command: 'office', args: '' } as never)
  expect(titleOf()).toBe('Decisions 2')
  // Forgetting one, from the pane itself, brings the count down.
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...DECISIONS })
  await ui.press({ key: 'forget-M2' })
  expect(titleOf()).toBe('Decisions 1')
  await ui.press({ key: 'forget-M1' })
  expect(titleOf()).toBe('Decisions')
  await ui.unmount()
  // The other tabs keep their titles, and the order of the strip is unchanged.
  expect(panes.map(p => p.title)).toEqual(['Office', 'Decisions', 'People', 'Settings'])
})

test('a retitle only changes a pane that is open: a Decisions pane the person closed is not opened again', async ($, on) => {
  const { opened, panes, closePane, files } = host(on)
  seedDecisions(files, [{ text: 'Scores live in Postgres' }, { text: 'Use Drizzle for migrations' }])
  await $.session.start(START)
  await $.command.run({ command: 'office', args: '' } as never)
  const before = opened.length
  closePane('clawd-hq-decisions')
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...DECISIONS })
  await ui.press({ key: 'forget-M2' })
  await ui.unmount()
  expect(opened).toHaveLength(before)
  expect(panes.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-people', 'clawd-hq-settings'])
})

// ---- No tab strip inside the panes; the gauges are the footer ----

test('no pane draws its own tab strip or the o, d, p, s keys', async ($, on) => {
  const { files } = host(on)
  seedDecisions(files, [{ text: 'Use Postgres' }])
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
    expect(await ui.find({ type: 'Text', text: /🎬 1\/12/ })).toBeDefined()
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

  await clock.advance(8 * 5_000 + 100)
  await clock.advance(100)
  expect(raised().pop()).toBe('clawd-hq-settings')
  const log = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-settings', 'Settings') })
  expect(await log.find({ type: 'Text', text: /Finishers are listed in Settings, under Finished this session, with how long they took\./ })).toBeDefined()
  expect(await log.find({ type: 'Text', text: /took/ })).toBeDefined()
  expect(await log.find({ key: 'settings-back' })).toBeDefined()
  await log.unmount()

  // Leaving for People puts Settings back on its switches, so the finished list is not left open after the tour.
  await clock.advance(5_000)
  expect(raised().pop()).toBe('clawd-hq-people')
  const after = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-settings', 'Settings') })
  expect(await after.find({ key: 'settings-log' })).toBeDefined()
  await after.unmount()
  const people = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-people', 'People') })
  expect(await people.find({ type: 'Text', text: /^🎬 10\/12 · People is the payroll/ })).toBeDefined()
  await people.unmount()

  await clock.advance(5_000)
  expect(raised().pop()).toBe('clawd-hq')
})

test('the tour does not reopen a pane the person closed', async ($, on) => {
  const { clock, opened, closePane } = host(on, [])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  closePane('clawd-hq-settings')
  const before = opened.length
  await clock.advance(9 * 5_000 + 200)
  expect(opened.slice(before).some(o => o.id === 'clawd-hq-settings')).toBe(false)
})

// ---- A pane the host cannot open or list never breaks the turn that asked ----

test('one pane the host refuses does not stop the others from opening', async ($, on) => {
  const { opened, panes, fail } = host(on)
  fail.ids.add('clawd-hq-decisions')
  const result = (await $.command.run({ command: 'office', args: '' } as never)) as { text: string }
  expect(result.text).toContain('Office')
  expect(panes.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-people', 'clawd-hq-settings'])
  expect(opened[opened.length - 1]).toMatchObject({ id: 'clawd-hq', focus: true })
})

test('with the host refusing every open and every listing, /office, /office-demo, the demo tool, a memory write and the whole tour finish without throwing', async ($, on) => {
  const { clock, fail } = host(on)
  on('tool.call', () => ({ result: { questions: [], answers: { 'Where do scores live?': 'Scores live in Postgres' } } }) as never)
  fail.open = true
  fail.list = true
  await expect($.command.run({ command: 'office', args: '' } as never)).resolves.toMatchObject({ text: expect.stringContaining('Office') })
  await expect($.command.run({ command: 'office-demo', args: '' } as never)).resolves.toMatchObject({ text: expect.stringContaining('tour') })
  await expect($.tool.call({ tool: 'mcp__clawd-hq__demo' } as never)).resolves.toBeDefined()
  // A decision saved from the question box, while the host refuses everything.
  await expect($.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Where do scores live?', options: [{ label: 'Scores live in Postgres' }] }] } as never)).resolves.toBeDefined()
  // The tour's own steps raise panes: all thirteen run, and the demo state is cleaned up at the end.
  await clock.advance(13 * 5_000 + 2_000)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DECISIONS })
  expect(await ui.find({ type: 'Text', text: /Scores live in Postgres/ })).toBeDefined()
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
      if (pane.requestId === 'clawd-hq-people') expect(texts.find(t => t.text === LONG_BLURB)?.props.wrap).toBe('wrap')
      if (pane.requestId === 'clawd-hq') expect(texts.some(t => /Scoring plan/.test(String(t.text)))).toBe(true)
      await ui.unmount()
    }
  }
})
