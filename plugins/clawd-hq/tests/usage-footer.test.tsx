import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { ACCENT } from '../hooks/office'
import { localOffset, resetAt } from '../hooks/usage'
import { ALL_PANES, CLEAR, HOUR, PANE, START, SURFACES, host } from './host'

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null && 'props' in c)
const walk = (node: Tree, hit: (t: Tree) => boolean): Tree[] => [...(hit(node) ? [node] : []), ...elementsOf(node).flatMap(c => walk(c, hit))]
const CONTEXT = { window: 1_000_000, tokens: 169_700, percent: 17 }
/** A Friday, 07:30 in UTC. */
const WEEKLY_AT = '2026-10-16T07:30:00Z'
// The runner has a real timer, though its types do not list one.
declare const setTimeout: (run: () => void, ms: number) => unknown
const pause = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** The readings of a subscriber: the context, a session window with 3 hr 52 min left, and a weekly one far out. */
async function measure($: Engine, now: number, withLimits = true) {
  const rateLimits = withLimits
    ? [
      { kind: 'five_hour', percentUsed: 44.2, resetsAt: new Date(now + 3 * HOUR + 52 * 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 75.6, resetsAt: WEEKLY_AT },
    ]
    : []
  await $.session.measure({ context: CONTEXT, rateLimits, changed: ['context', 'rateLimits'] } as never)
}

/** A request of the main chat (or of the specialist `agentId`), as the engine is about to send it. The note of it is not waited for by the request, so a moment is given for it to land. */
async function request($: Engine, model: string, effort: string | number | undefined, agentId?: string) {
  const run = $.turn.step({ turnId: 'r1', index: 0, model, effort, messageCount: 3, ...(agentId ? { agentId } : {}) } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
  await pause()
}

const answerSteps = (on: Parameters<typeof host>[0]) => on('turn.step', async function* (_$, e) {
  return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
})

const mount = ($: Engine, surface: 'terminal' | 'desktop' | 'vscode' | 'mobile', pane: typeof PANE = PANE) => $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
const texts = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text))

test('collapsed, the footer shows the model, the effort and exactly one Usage button, with no details', async ($, on) => {
  const { clock } = host(on)
  answerSteps(on)
  await measure($, clock.now())
  await request($, 'claude-opus-5-5', 'high')
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const root = (await ui.drawn()) as unknown as Tree
    const footer = walk(root, t => t.props.key === 'gauges')[0]!
    expect(walk(footer, t => t.type === 'Button')).toHaveLength(1)
    expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage 17% · 44% · 76% ▾')
    expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^High$/ })).toBeDefined()
    expect(await ui.find({ key: 'usage-details' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Context window|Session limit|Weekly/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('before the first reply there is no model and no effort, and the button has a dash', async ($, on) => {
  host(on)
  const ui = await mount($, 'terminal')
  expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage – ▾')
  expect(await ui.find({ key: 'usage-model' })).toBeUndefined()
  await ui.press({ key: 'usage-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Context window$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^No reading yet$/ })).toBeDefined()
  await ui.unmount()
})

test('a request of the main chat names the model and effort; a specialist\'s request and a number effort change nothing', async ($, on) => {
  host(on, [{ id: 'a1', type: 'ecc:planner', description: 'Plan', status: 'running' }])
  answerSteps(on)
  await request($, 'claude-opus-5-5', 'high')
  await request($, 'claude-haiku-4-5', 'low', 'a1')
  const ui = await mount($, 'terminal')
  expect(await texts(ui)).toEqual(expect.arrayContaining(['Opus 5.5', 'High']))
  expect(await ui.find({ type: 'Text', text: /^(Haiku 4\.5|Low)$/ })).toBeUndefined()
  // A later request of the main chat moves them.
  await request($, 'claude-sonnet-5-1', 'xhigh')
  expect(await ui.find({ type: 'Text', text: /^Sonnet 5\.1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Extra high$/ })).toBeDefined()
  // A thinking budget in tokens is not an effort word: the last effort of the same model stays.
  await request($, 'claude-sonnet-5-1', 8000)
  expect(await ui.find({ type: 'Text', text: /^Extra high$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Sonnet 5\.1$/ })).toBeDefined()
  await ui.unmount()
})

test('a session start reads the main chat\'s model', async ($, on) => {
  host(on)
  await $.session.start(START)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^Sonnet 5\.1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeUndefined()
  await ui.unmount()
})

// The test runner has no `process`, so the zone cannot be set from a test: the row is pinned to the zone this run
// really has. Where the zone is known it must read as the weekday and time exactly; the time left stands in only
// where the zone is not known (the unit tests pin each zone).
test('the weekly reset reads as the weekday and time in the zone this run has, and as time left only where there is none', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now())
  const offset = localOffset(Date.parse(WEEKLY_AT))
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'usage-toggle' })
    const weekly = (await texts(ui)).filter(t => /^Resets /.test(t) && t !== 'Resets in 3 hr 52 min')
    expect(weekly).toEqual([offset === undefined ? expect.stringMatching(/^Resets in \d+ hr/) : resetAt(Date.parse(WEEKLY_AT), offset)])
    await ui.press({ key: 'usage-toggle' })
    await ui.unmount()
  }
})

test('pressing the button opens three rows above it, each with a bar; pressing again closes them', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now())
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'usage-toggle' })

  expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage 17% · 44% · 76% ▴')
  const lines = await texts(ui)
  expect(lines).toEqual(expect.arrayContaining(['Context window', '169.7k / 1M (17%)', 'Session limit', 'Resets in 3 hr 52 min', '44%', 'Weekly · all models', '76%']))
  expect(lines.some(t => /^Resets /.test(t) && t !== 'Resets in 3 hr 52 min')).toBe(true)
  // A bar under each row: heavy glyphs for the used part, light for the rest.
  expect(await ui.findAll({ type: 'Text', text: /^─+$/ })).toHaveLength(3)
  expect(await ui.find({ type: 'Text', text: /^━{3}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^━{9}$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^━{15}$/ })).toBeDefined()

  // The rows sit above the button, which stays on the bottom edge.
  const footer = walk((await ui.drawn()) as unknown as Tree, t => t.props.key === 'gauges')[0]!
  const keys = elementsOf(footer).map(c => c.props.key)
  expect(keys.indexOf('usage-details')).toBeGreaterThan(-1)
  expect(keys.indexOf('usage-details')).toBeLessThan(keys.indexOf('usage-bar'))
  expect(walk(elementsOf(footer)[elementsOf(footer).length - 1]!, t => t.type === 'Button')).toHaveLength(1)
  expect(walk(footer, t => t.props.key === 'usage-details').length).toBe(1)

  await ui.press({ key: 'usage-toggle' })
  expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage 17% · 44% · 76% ▾')
  expect(await ui.find({ key: 'usage-details' })).toBeUndefined()
  await ui.unmount()
})

test('without a subscription only the context row opens, and the button lists one reading', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now(), false)
  const ui = await mount($, 'terminal')
  expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage 17% ▾')
  await ui.press({ key: 'usage-toggle' })
  expect(await ui.find({ type: 'Text', text: /^Context window$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Session limit|Weekly/ })).toBeUndefined()
  await ui.unmount()
})

test('a session window whose reset has passed is hidden', async ($, on) => {
  const { clock } = host(on)
  await $.session.measure({
    context: CONTEXT, changed: ['rateLimits'],
    rateLimits: [{ kind: 'five_hour', percentUsed: 90, resetsAt: new Date(clock.now() - 60_000).toISOString() }],
  } as never)
  const ui = await mount($, 'terminal')
  expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage 17% ▾')
  await ui.unmount()
})

test('open stays open on every pane, on every surface, and closing on one closes it on all', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now())
  for (const surface of SURFACES) {
    const first = await mount($, surface, ALL_PANES[0])
    await first.press({ key: 'usage-toggle' })
    await first.unmount()
    for (const pane of ALL_PANES) {
      const ui = await mount($, surface, pane)
      expect(await ui.find({ key: 'usage-details' })).toBeDefined()
      expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toMatch(/▴$/)
      await ui.unmount()
    }
    const last = await mount($, surface, ALL_PANES[ALL_PANES.length - 1])
    await last.press({ key: 'usage-toggle' })
    await last.unmount()
    const again = await mount($, surface, ALL_PANES[1])
    expect(await again.find({ key: 'usage-details' })).toBeUndefined()
    await again.unmount()
  }
})

test('the footer is the last row of every pane, open or closed, and nothing in it is set to cut text', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now())
  for (const surface of SURFACES) {
    for (const pane of ALL_PANES) {
      const ui = await mount($, surface, pane)
      for (const isOpen of [false, true]) {
        if (isOpen) await ui.press({ key: 'usage-toggle' })
        const root = (await ui.drawn()) as unknown as Tree
        const rows = elementsOf(root)
        expect(rows[rows.length - 1]?.props.key).toBe('gauges')
        const footer = walk(root, t => t.props.key === 'gauges')[0]!
        expect(JSON.stringify(footer)).not.toMatch(/truncate/)
        expect(walk(footer, t => t.type === 'Text').every(t => t.props.wrap === undefined || t.props.wrap === 'wrap')).toBe(true)
      }
      await ui.press({ key: 'usage-toggle' })
      await ui.unmount()
    }
  }
})

test('the bars are images where there is an Svg: 200 by 4, rounded, one for each open row', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now())
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await mount($, surface)
    await ui.press({ key: 'usage-toggle' })
    const bars = (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.height === 4)
    expect(bars).toHaveLength(3)
    expect(bars[0]!.props.width).toBe(200)
    expect(String(bars[0]!.props.source)).toContain('rx="2"')
    expect(String(bars[0]!.props.source)).toContain(`fill="${ACCENT}"`)
    expect(bars.map(b => String(b.props.alt))).toEqual(['Context window 17% used', 'Session limit 44% used', 'Weekly · all models 76% used'])
    expect(await ui.find({ type: 'Text', text: /[━─█░]/ })).toBeUndefined()
    await ui.press({ key: 'usage-toggle' })
    await ui.unmount()
  }
})

test('collapsed, no bar is drawn at all', async ($, on) => {
  const { clock } = host(on)
  await measure($, clock.now())
  const ui = await mount($, 'desktop')
  expect((await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.height === 4)).toHaveLength(0)
  await ui.unmount()
  const term = await mount($, 'terminal')
  expect(await term.find({ type: 'Text', text: /^[━─]+$/ })).toBeUndefined()
  await term.unmount()
})

test('a /clear empties the context reading but keeps the model', async ($, on) => {
  const { clock } = host(on)
  answerSteps(on)
  await measure($, clock.now())
  await request($, 'claude-opus-5-5', 'high')
  await $.session.end(CLEAR)
  const ui = await mount($, 'terminal')
  expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage – · 44% · 76% ▾')
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
  await ui.press({ key: 'usage-toggle' })
  expect(await ui.find({ type: 'Text', text: /^No reading yet$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /169\.7k/ })).toBeUndefined()
  await ui.unmount()
})

// ---- The request's own note of the model never stands in the request's way ----

test('a request goes through even when the stored gauge never answers a read', async ($, on) => {
  host(on)
  answerSteps(on)
  on('state.get', { plugin: 'clawd-hq', key: 'gauge' }, () => new Promise<never>(() => undefined))
  const outcome = await Promise.race([request($, 'claude-opus-5-5', 'high').then(() => 'went through'), pause(1_000).then(() => 'stuck')])
  expect(outcome).toBe('went through')
})

test('a read of the gauge that fails during a request neither breaks it nor changes the footer', async ($, on) => {
  host(on)
  answerSteps(on)
  const failing = { isOn: true, hits: 0 }
  on('state.get', { plugin: 'clawd-hq', key: 'gauge' }, (_$, e, next) => {
    failing.hits += 1
    if (failing.isOn) throw new Error('the state could not be read')
    return next(e)
  })
  await expect(request($, 'claude-opus-5-5', 'high')).resolves.toBeUndefined()
  expect(failing.hits).toBeGreaterThan(0)
  failing.isOn = false
  // Once the store works again, the next request is noted as usual.
  await request($, 'claude-opus-5-5', 'high')
  const after = await mount($, 'terminal')
  expect(await after.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
  await after.unmount()
})

test('a write of the gauge that fails during a request neither breaks it nor changes the footer', async ($, on) => {
  host(on)
  answerSteps(on)
  const failing = { isOn: true, hits: 0 }
  on('state.set', { plugin: 'clawd-hq', key: 'gauge' }, (_$, e, next) => {
    failing.hits += 1
    if (failing.isOn) throw new Error('the state could not be written')
    return next(e)
  })
  await expect(request($, 'claude-opus-5-5', 'high')).resolves.toBeUndefined()
  expect(failing.hits).toBeGreaterThan(0)
  failing.isOn = false
  await request($, 'claude-opus-5-5', 'high')
  const after = await mount($, 'terminal')
  expect(await after.find({ type: 'Text', text: /^Opus 5\.5$/ })).toBeDefined()
  await after.unmount()
})

test('a request that changes neither the model nor the effort makes no write', async ($, on) => {
  host(on)
  answerSteps(on)
  const writes: string[] = []
  on('state.set', { plugin: 'clawd-hq', key: 'gauge' }, (_$, e, next) => (writes.push('write'), next(e)))
  await request($, 'claude-opus-5-5', 'high')
  expect(writes).toHaveLength(1)
  await request($, 'claude-opus-5-5', 'high')
  // An effort the request does not report keeps the last known one: still nothing to write.
  await request($, 'claude-opus-5-5', undefined)
  await request($, 'claude-opus-5-5', 8000)
  expect(writes).toHaveLength(1)
  await request($, 'claude-opus-5-5', 'low')
  expect(writes).toHaveLength(2)
})

test('a request with no effort keeps the effort shown for the same model, and drops it for another', async ($, on) => {
  host(on)
  answerSteps(on)
  await request($, 'claude-opus-5-5', 'high')
  await request($, 'claude-opus-5-5', undefined)
  const same = await mount($, 'terminal')
  expect(await same.find({ type: 'Text', text: /^High$/ })).toBeDefined()
  await same.unmount()
  await request($, 'claude-sonnet-5-1', undefined)
  const other = await mount($, 'terminal')
  expect(await other.find({ type: 'Text', text: /^Sonnet 5\.1$/ })).toBeDefined()
  expect(await other.find({ type: 'Text', text: /^High$/ })).toBeUndefined()
  await other.unmount()
})
