import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { COFFEE_NOTE } from '../hooks/coffee-break'
import { AMBER } from '../hooks/office'
import { ALL_PANES, PANE, START, SURFACES } from './host'
import { endTurn, flowHost, handBack, hire, job, measure, say, startTurn } from './flow'

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null && 'props' in c)
const walk = (node: Tree, hit: (t: Tree) => boolean): Tree[] => [...(hit(node) ? [node] : []), ...elementsOf(node).flatMap(c => walk(c, hit))]
// The runner has a real timer, though its types do not list one.
declare const setTimeout: (run: () => void, ms: number) => unknown
const pause = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms))

const BUTTON = { key: 'coffee-break' }
const LABEL = '☕ Coffee break'
const OVER = 310_000

const mount = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal', pane: typeof PANE = PANE) => $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
/** Whether the button is on the pane right now, on a fresh drawing. */
async function isShown($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await mount($, surface)
  const found = await ui.find(BUTTON)
  await ui.unmount()
  return found !== undefined
}
/** A piece of work that has closed: asked, handed back, reported. Past the mark unless said otherwise. */
async function atCheckpoint($: Engine, h: ReturnType<typeof flowHost>, tokens: number | null = OVER) {
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await work.report()
  await measure($, tokens ?? undefined)
  return work
}
/** What the button's lines start with (a Text carries no key to find it by). */
const LINES = /^(The chat was not compacted|Couldn't compact|Not now|Ready in your prompt box|Type this)/
/** The one line under the footer's row, as drawn: its words and its colour. */
async function lineOf(ui: Awaited<ReturnType<typeof mount>>) {
  const lines = await ui.findAll({ type: 'Text', text: LINES })
  expect(lines.length).toBeLessThanOrEqual(1)
  const line = lines[0]
  return line === undefined ? undefined : { text: String(line.text), color: line.props.color, wrap: line.props.wrap }
}

// ---- When it shows ----

test('at a checkpoint past 300,000 tokens the button shows in the footer row, between the model and the Usage button', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atCheckpoint($, h)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const button = await ui.find(BUTTON)
    expect(button?.props.label).toBe(LABEL)
    const bar = walk((await ui.drawn()) as unknown as Tree, t => t.props.key === 'usage-bar')[0]!
    expect(elementsOf(bar).map(c => c.props.key)).toEqual(['usage-model', 'coffee-break', 'usage-toggle'])
    await ui.unmount()
  }
})

test('it shows on every pane, as a plain button', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h)
  for (const pane of ALL_PANES) {
    const ui = await mount($, 'desktop', pane)
    expect((await ui.find(BUTTON))?.type).toBe('Button')
    await ui.unmount()
  }
})

test('below 300,000 tokens it is hidden, and at exactly 300,000 it shows', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atCheckpoint($, h, 299_999)
  expect(await isShown($)).toBe(false)
  await measure($, 300_000)
  expect(await isShown($)).toBe(true)
})

test('where Claude Code compacts earlier than the 300k mark, it shows 90% of the way there', async ($, on) => {
  const h = flowHost(on)
  h.session.threshold = 200_000
  await $.session.start(START)
  await atCheckpoint($, h, 179_999)
  expect(await isShown($)).toBe(false)
  await measure($, 180_000)
  expect(await isShown($)).toBe(true)
})

test('where Claude Code compacts later, or never, the 300k mark comes first', async ($, on) => {
  const h = flowHost(on)
  h.session.threshold = 950_000
  await $.session.start(START)
  await atCheckpoint($, h, 299_999)
  expect(await isShown($)).toBe(false)
  await measure($, 300_000)
  expect(await isShown($)).toBe(true)
  h.session.threshold = undefined
  await $.session.start(START)
  await measure($, 299_999)
  expect(await isShown($)).toBe(false)
})

test('the point where Claude Code compacts is read again when a turn ends, so a changed window is followed', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atCheckpoint($, h, 200_000)
  expect(await isShown($)).toBe(false)
  h.session.threshold = 200_000
  await startTurn($, 'm3')
  await endTurn($, 'm3', 'Anything else.')
  await pause()
  expect(await isShown($)).toBe(true)
})

test('with no reading of the context there is no button', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h, null)
  expect(await isShown($)).toBe(false)
})

// ---- It is for a checkpoint, never between the steps of a job ----

test('mid-task: a specialist has handed back but Clawd has not reported yet, so it is hidden', async ($, on) => {
  const h = flowHost(on)
  const work = job($, h)
  await work.ask()
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
  await work.handBack()
  // Nobody is busy now, and the context is past the mark, but the report has not been made.
  expect(await isShown($)).toBe(false)
  await work.report()
  expect(await isShown($)).toBe(true)
})

test('while Clawd runs his report, or a specialist is at work, it is hidden', async ($, on) => {
  const h = flowHost(on)
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await measure($, OVER)
  await startTurn($, 'm2', 'The specialist finished')
  expect(await isShown($)).toBe(false)
  await endTurn($, 'm2', 'Built.')
  expect(await isShown($)).toBe(true)
  // A second specialist starts: the checkpoint is not open while it works, nor after it hands back until Clawd reports it.
  await startTurn($, 'm3', 'More')
  await hire($, 'w2', h)
  await endTurn($, 'm3', 'On the second one.')
  expect(await isShown($)).toBe(false)
  await handBack($, 'w2', 'w2-turn')
  expect(await isShown($)).toBe(false)
  await startTurn($, 'm4', 'The second finished')
  await endTurn($, 'm4', 'Both are built.')
  expect(await isShown($)).toBe(true)
})

test('a hand-back that arrives while Clawd is in a turn is not reported by that turn', async ($, on) => {
  const h = flowHost(on)
  const work = job($, h)
  await work.ask()
  await measure($, OVER)
  await startTurn($, 'm2', 'Meanwhile')
  await work.handBack()
  await endTurn($, 'm2', 'Meanwhile done.')
  expect(await isShown($)).toBe(false)
  await startTurn($, 'm3', 'The specialist finished')
  await endTurn($, 'm3', 'Built.')
  expect(await isShown($)).toBe(true)
})

test('question pending: a report that ends by asking the person something leaves it hidden', async ($, on) => {
  const h = flowHost(on)
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await work.report('The panel is built. Should I ship it on Friday or Monday?')
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
})

test('question pending: a question box open in Clawd\'s turn keeps it hidden until it is answered and the turn ends', async ($, on) => {
  const h = flowHost(on)
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await measure($, OVER)
  await startTurn($, 'm2', 'The specialist finished')
  let answer: (value: unknown) => void = () => undefined
  h.box.open = new Promise(resolve => { answer = resolve })
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Friday or Monday?' }] } as never)
  await pause()
  expect(await isShown($)).toBe(false)
  answer({ result: { answers: { 'Friday or Monday?': 'Friday' } } })
  await asking
  expect(await isShown($)).toBe(false)
  await endTurn($, 'm2', 'Friday it is. The panel is built.')
  expect(await isShown($)).toBe(true)
})

test('a plain chat reply with no work done is no checkpoint, however large the chat', async ($, on) => {
  const h = flowHost(on)
  await say($, 'What does this repo do?')
  await startTurn($, 'm1')
  await endTurn($, 'm1', 'It draws an office for your agents.')
  await measure($, OVER)
  expect(h.hiring.next).toBe('w1')
  expect(await isShown($)).toBe(false)
})

test('a specialist that failed or was stopped is not a hand-back', async ($, on) => {
  const h = flowHost(on)
  const work = job($, h)
  await work.ask()
  await $.turn.complete({ reason: 'error', answer: '', turnId: 'w-turn', agentId: 'w1', isAborted: false } as never)
  await work.report('It failed.')
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
})

test('a new message from the person hides it, until the next piece of work closes', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h)
  expect(await isShown($)).toBe(true)
  await say($, 'Now do the next thing')
  expect(await isShown($)).toBe(false)
  // Clawd answers it with words alone: still no checkpoint.
  await startTurn($, 'm3')
  await endTurn($, 'm3', 'Sure, it is a small change.')
  expect(await isShown($)).toBe(false)
  const next = job($, h, 'w9')
  await next.ask()
  await next.handBack()
  await next.report()
  expect(await isShown($)).toBe(true)
})

test('a notification, a peer message or a slash command does not take the checkpoint away', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h)
  await say($, 'A background task finished', 'task-notification')
  await say($, 'Hello from another session', 'peer')
  await say($, '/office')
  expect(await isShown($)).toBe(true)
  await say($, 'Please continue', 'bridge')
  expect(await isShown($)).toBe(false)
})

test('the tour is not a break', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await h.clock.advance(1)
  expect(await isShown($)).toBe(false)
})

// ---- Pressing it ----

test('pressing compacts the main chat right away, once, with the note, and the button goes', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h)
  for (const surface of SURFACES) {
    await measure($, OVER)
    const ui = await mount($, surface)
    await ui.press(BUTTON)
    expect(h.compacts.slice(-1)).toEqual([{ instructions: COFFEE_NOTE }])
    // The reading starts over until the engine's next measure, so the button is not left waiting on a number from before the compaction.
    expect(await ui.find(BUTTON)).toBeUndefined()
    expect(await lineOf(ui)).toBeUndefined()
    await ui.unmount()
  }
  expect(h.compacts).toHaveLength(2)
})

test('after a compaction the next measure decides: small, it stays hidden; large again, it returns', async ($, on) => {
  const h = flowHost(on)
  await atCheckpoint($, h)
  const ui = await mount($)
  await ui.press(BUTTON)
  await measure($, 40_000)
  expect(await ui.find(BUTTON)).toBeUndefined()
  await measure($, OVER)
  expect(await ui.find(BUTTON)).toBeDefined()
  await ui.unmount()
})

test('a compaction a hook skipped shows one plain amber line with the reason, and the button stays for another try', async ($, on) => {
  const h = flowHost(on)
  h.compact.skip = 'a hook said no'
  await atCheckpoint($, h)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press(BUTTON)
    expect(await lineOf(ui)).toEqual({ text: 'The chat was not compacted: a hook said no.', color: AMBER, wrap: 'wrap' })
    expect(await ui.find(BUTTON)).toBeDefined()
    await ui.unmount()
  }
})

test('a compaction that fails shows one plain amber line with why, never swallowed, and a later press can succeed', async ($, on) => {
  const h = flowHost(on)
  h.compact.error = 'a turn is running'
  await atCheckpoint($, h)
  const ui = await mount($)
  await ui.press(BUTTON)
  // The test engine words the reason itself when a hook of ours throws; the exact reason is checked on the unit tests.
  expect(await lineOf(ui)).toEqual({ text: expect.stringMatching(/^Couldn't compact the chat: .+\.$/), color: AMBER, wrap: 'wrap' })
  // A second failure replaces the line, it does not add one (lineOf holds to one).
  await ui.press(BUTTON)
  expect(await lineOf(ui)).toBeDefined()
  h.compact.error = undefined
  await ui.press(BUTTON)
  expect(await lineOf(ui)).toBeUndefined()
  expect(h.compacts).toHaveLength(3)
  await ui.unmount()
})

test('the amber line belongs to the turn it was made in: once Clawd begins another, it is gone', async ($, on) => {
  const h = flowHost(on)
  h.compact.skip = 'a hook said no'
  await atCheckpoint($, h)
  const ui = await mount($)
  await ui.press(BUTTON)
  expect(await lineOf(ui)).toBeDefined()
  await say($, 'Never mind, carry on')
  await startTurn($, 'm3')
  await endTurn($, 'm3', 'Sure.')
  const next = job($, h, 'w9')
  await next.ask()
  await next.handBack()
  await next.report()
  // At the next checkpoint the button is back, and the old line is not.
  expect(await ui.find(BUTTON)).toBeDefined()
  expect(await lineOf(ui)).toBeUndefined()
  await ui.unmount()
})

test('two presses at once compact once', async ($, on) => {
  const h = flowHost(on)
  let release: () => void = () => undefined
  h.compact.hold = new Promise<void>(resolve => { release = resolve })
  await atCheckpoint($, h)
  const [a, b] = [await mount($, 'terminal'), await mount($, 'desktop')]
  const presses = Promise.all([a.press(BUTTON), b.press(BUTTON)])
  await pause()
  expect(h.compacts).toHaveLength(1)
  // While it works the button gives way to a plain word on every pane, so there is nothing to press twice.
  expect(await a.find(BUTTON)).toBeUndefined()
  expect(await a.find({ type: 'Text', text: /^Compacting the chat/ })).toBeDefined()
  release()
  await presses
  expect(h.compacts).toHaveLength(1)
  await a.unmount()
  await b.unmount()
})

// ---- The footer around it ----

test('the footer stays the last row, nothing in it is cut, and the button and line only use text styles every engine takes', async ($, on) => {
  const h = flowHost(on)
  h.compact.skip = 'a hook said no'
  await atCheckpoint($, h)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press(BUTTON)
    const root = (await ui.drawn()) as unknown as Tree
    const rows = elementsOf(root)
    expect(rows[rows.length - 1]?.props.key).toBe('gauges')
    const footer = walk(root, t => t.props.key === 'gauges')[0]!
    expect(JSON.stringify(footer)).not.toMatch(/truncate/)
    expect(walk(footer, t => t.type === 'Text').every(t => t.props.wrap === undefined || t.props.wrap === 'wrap')).toBe(true)
    await ui.unmount()
  }
})

test('nothing shows when there is no work and a small chat: the footer is as it was', async ($, on) => {
  flowHost(on)
  const ui = await mount($)
  expect(await ui.find(BUTTON)).toBeUndefined()
  expect(walk((await ui.drawn()) as unknown as Tree, t => t.props.key === 'usage-bar')[0]).toBeDefined()
  await ui.unmount()
})
