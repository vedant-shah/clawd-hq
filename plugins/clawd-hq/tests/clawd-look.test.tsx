import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { clawdAvatar } from '../hooks/avatars'
import { NAP_MS } from '../hooks/clawd-says'
import { COFFEE_AFTERGLOW_MS } from '../hooks/coffee-break'
import { rasterCells, svgOf, trimLike } from '../hooks/pixels'
import { PANE, PEOPLE, START } from './host'
import { endTurn, flowHost, job, measure, startTurn } from './flow'

// The runner has a real timer, though its types do not list one.
declare const setTimeout: (run: () => void, ms: number) => unknown
const pause = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms))

const OVER = 310_000
const NAME = 'Clawd, the chief of staff'
const MOMENT = 1_000

/** The alt text of Clawd's picture on the desktop pane, and what the terminal's picture draws, on a fresh drawing. */
async function cardNow($: Engine) {
  const desktop = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  const picture = (await desktop.findAll({ type: 'Svg' })).find(svg => String(svg.props.alt ?? '').startsWith(NAME))
  const alt = String(picture?.props.alt)
  const source = String(picture?.props.source)
  await desktop.unmount()
  const terminal = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const cells = (await terminal.find({ key: 'clawd' }))?.props.cells
  await terminal.unmount()
  return { alt, source, cells, size: [picture?.props.width, picture?.props.height] }
}

/** The picture a look draws in both drawings, over the still picture's box, at any step it can be on. */
const drawnAt = (look: 'asleep' | 'coffee') => {
  const still = clawdAvatar()
  const steps = [0, 1, 2, 3].map(step => clawdAvatar({ look, step }))
  return {
    svgs: steps.map(one => svgOf(trimLike(one.full, still.full), 4)),
    cells: steps.map(one => rasterCells(trimLike(one.compact, still.compact))),
  }
}

test('free and recently active he holds his logbook; past the nap time he is asleep, in both drawings and the same size', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await job($, h).ask()
  const awake = await cardNow($)
  expect(awake.alt).toBe(`${NAME}, in a navy blazer and red tie, holding a logbook`)

  await h.clock.advance(NAP_MS + MOMENT)
  const asleep = await cardNow($)
  expect(asleep.alt).toBe(`${NAME}, asleep at his desk`)
  expect(drawnAt('asleep').svgs).toContain(asleep.source)
  expect(drawnAt('asleep').cells).toContain(asleep.cells)
  // The size of the picture does not change: 23 by 20 dots at 4 pixels (his crown adds 4 rows).
  expect(asleep.size).toEqual(awake.size)
  expect(asleep.size).toEqual([92, 80])
})

test('a new turn wakes him at once', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await job($, h).ask()
  await h.clock.advance(NAP_MS + MOMENT)
  expect((await cardNow($)).alt).toMatch(/asleep at his desk$/)
  await startTurn($, 'm9', 'Another thing')
  expect((await cardNow($)).alt).toMatch(/holding a logbook$/)
})

const OFFER = "It's time to take a coffee break."
const BUTTON = { key: 'coffee-break' }

/** Whether the break sentence is in Clawd's bubble on the desktop pane, on a fresh drawing. */
async function isOffered($: Engine) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  const found = await ui.find({ type: 'Text', text: OFFER })
  await ui.unmount()
  return found !== undefined
}

/** A closed piece of work, past the mark: the button shows. */
async function atBreak($: Engine, h: ReturnType<typeof flowHost>) {
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await work.report()
  await measure($, OVER)
}

/** Presses the button (it is in the footer of every pane; the People pane keeps the Office pane free to look at meanwhile). */
async function press($: Engine) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PEOPLE })
  await ui.press(BUTTON)
  await ui.unmount()
}

test('while the button only shows he is awake in his normal look and says the one break sentence, even past the nap time', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atBreak($, h)
  const offer = await cardNow($)
  expect(offer.alt).toBe(`${NAME}, in a navy blazer and red tie, holding a logbook`)
  expect(await isOffered($)).toBe(true)

  // Past the nap time he would sleep: not through his own invitation.
  await h.clock.advance(NAP_MS + MOMENT)
  expect((await cardNow($)).alt).toMatch(/holding a logbook$/)
  expect(await isOffered($)).toBe(true)

  // The person's next message starts a turn: the button is gone, so are the sentence and the offer.
  await startTurn($, 'm9', 'Next thing')
  expect(await isOffered($)).toBe(false)
  await endTurn($, 'm9', 'Done.')
})

test('after the press he drinks while it compacts, and for two minutes after it stood, then looks normal and speaks normally', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atBreak($, h)
  let release: () => void = () => undefined
  h.compact.hold = new Promise<void>(resolve => { release = resolve })
  const pressing = press($)
  await pause()
  const coffee = await cardNow($)
  expect(coffee.alt).toBe(`${NAME}, drinking coffee`)
  expect(drawnAt('coffee').svgs).toContain(coffee.source)
  expect(drawnAt('coffee').cells).toContain(coffee.cells)
  expect(coffee.size).toEqual([92, 80])
  expect(await isOffered($)).toBe(false)
  release()
  await pressing

  // Done: the mug stays for two minutes (the nap time is the same length, and the mug is not the look of the sleeper).
  await h.clock.advance(COFFEE_AFTERGLOW_MS - MOMENT)
  expect((await cardNow($)).alt).toMatch(/drinking coffee$/)
  expect(await isOffered($)).toBe(false)
  await h.clock.advance(MOMENT)
  expect((await cardNow($)).alt).not.toMatch(/drinking coffee$/)
})

test('a skipped or failed compaction gives him no mug', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atBreak($, h)
  h.compact.skip = 'a hook said no'
  await press($)
  expect((await cardNow($)).alt).toMatch(/holding a logbook$/)
  h.compact.skip = undefined
  h.compact.error = 'a turn is running'
  await press($)
  expect((await cardNow($)).alt).toMatch(/holding a logbook$/)
})

// ---- The person's own /compact: typed, or the one the button filled on the desktop app ----

/** The desktop app refuses the plugin's compact call in its SDK session, so the press only fills `/compact` into the prompt box. */
const HEADLESS = 'clawd-hq: $.session.compact: not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on.'
/** The person sends `/compact`, with or without text after it: the engine's own compaction, trigger `manual`. */
const sendCompact = ($: Engine, over: { instructions?: string; trigger?: string; agentId?: string } = {}) =>
  $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'Build the panel', toolUses: [] }], ...over } as never)
/** Holds the next compaction until the returned function is called. */
function holdCompact(h: ReturnType<typeof flowHost>) {
  let release: () => void = () => undefined
  h.compact.hold = new Promise<void>(resolve => { release = resolve })
  return () => { release(); h.compact.hold = undefined }
}
const isDrinkingNow = async ($: Engine) => (await cardNow($)).alt.endsWith('drinking coffee')
async function isButtonShown($: Engine) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  const found = await ui.find(BUTTON)
  await ui.unmount()
  return found !== undefined
}

test('desktop: a press that only fills /compact gives no mug; once the person sends it he drinks while it runs and two minutes after', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atBreak($, h)
  h.compact.error = HEADLESS
  await press($)
  expect(await isDrinkingNow($)).toBe(false)
  h.compact.error = undefined

  const release = holdCompact(h)
  const sending = sendCompact($, { instructions: 'Keep my latest request and any open work.' })
  await pause()
  expect(await isDrinkingNow($)).toBe(true)
  expect(await isOffered($)).toBe(false)
  release()
  await sending
  // It stood: the same as after a pressed compaction, the checkpoint is over and the button goes.
  expect(await isButtonShown($)).toBe(false)
  await h.clock.advance(COFFEE_AFTERGLOW_MS - MOMENT)
  expect(await isDrinkingNow($)).toBe(true)
  await h.clock.advance(MOMENT)
  expect(await isDrinkingNow($)).toBe(false)
})

test('desktop: a turn that the /compact itself starts mid-run does not take the mug away', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atBreak($, h)
  const release = holdCompact(h)
  const sending = sendCompact($)
  await pause()
  await startTurn($, 'm-compact', '/compact')
  expect(await isDrinkingNow($)).toBe(true)
  release()
  await sending
  await endTurn($, 'm-compact', '')
  expect(await isDrinkingNow($)).toBe(true)
})

test('a /compact typed with no text, and with no break on offer, gets the mug too', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await job($, h).ask()
  const release = holdCompact(h)
  const sending = sendCompact($)
  await pause()
  expect(await isDrinkingNow($)).toBe(true)
  release()
  await sending
  expect(await isDrinkingNow($)).toBe(true)
})

test('a /compact that is skipped, fails or is cancelled leaves no mug and no afterglow', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await atBreak($, h)
  h.compact.skip = 'a hook said no'
  await sendCompact($)
  expect(await isDrinkingNow($)).toBe(false)
  h.compact.skip = undefined
  h.compact.error = 'Compaction canceled.'
  const release = holdCompact(h)
  const failing = sendCompact($).catch((err: unknown) => err)
  await pause()
  expect(await isDrinkingNow($)).toBe(true)
  release()
  // The send fails (the test engine names a failing stand-in as "no implementation", not by its words).
  expect(await failing).toBeDefined()
  expect(await isDrinkingNow($)).toBe(false)
  // Passing the failure on never makes the engine run the compaction again.
  expect(h.compacts).toHaveLength(2)
})

test('the engine compacting by itself, or a specialist\'s own compaction, gives no mug', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await job($, h).ask()
  for (const over of [{ trigger: 'auto' }, { trigger: 'manual', agentId: 'w1' }]) {
    const release = holdCompact(h)
    const running = sendCompact($, over)
    await pause()
    expect(await isDrinkingNow($)).toBe(false)
    release()
    await running
    expect(await isDrinkingNow($)).toBe(false)
  }
})

test('before the chat is big enough there is no break, so no coffee', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await work.report()
  await measure($, 50_000)
  expect((await cardNow($)).alt).toMatch(/holding a logbook$/)
})

test('the z\'s and the steam move as the office ticks on, with the panel redrawn from the same quiet ticks', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  await job($, h).ask()
  await h.clock.advance(NAP_MS + MOMENT)
  const seen = new Set<string>()
  // A quiet office still writes a tick every few frames: over half a minute the sleeping picture is drawn on more than one step.
  for (let i = 0; i < 6; i++) {
    seen.add((await cardNow($)).source)
    await h.clock.advance(2_500)
  }
  expect(seen.size).toBeGreaterThan(1)
})
