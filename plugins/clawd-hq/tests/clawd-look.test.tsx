import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { clawdAvatar } from '../hooks/avatars'
import { NAP_MS } from '../hooks/clawd-says'
import { rasterCells, svgOf, trimLike } from '../hooks/pixels'
import { PANE, START } from './host'
import { endTurn, flowHost, job, measure, startTurn } from './flow'

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
  // The size of the picture does not change: 23 by 16 dots at 4 pixels.
  expect(asleep.size).toEqual(awake.size)
  expect(asleep.size).toEqual([92, 64])
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

test('at a break he drinks coffee, even if he would also be asleep, and goes back to work with the next turn', async ($, on) => {
  const h = flowHost(on)
  await $.session.start(START)
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await work.report()
  await measure($, OVER)
  const coffee = await cardNow($)
  expect(coffee.alt).toBe(`${NAME}, drinking coffee`)
  expect(drawnAt('coffee').svgs).toContain(coffee.source)
  expect(drawnAt('coffee').cells).toContain(coffee.cells)
  expect(coffee.size).toEqual([92, 64])

  // Past the nap time the break is still on: coffee wins over sleep.
  await h.clock.advance(NAP_MS + MOMENT)
  expect((await cardNow($)).alt).toMatch(/drinking coffee$/)

  // The person's next message starts a turn: the break is over.
  await startTurn($, 'm9', 'Next thing')
  expect((await cardNow($)).alt).toMatch(/holding a logbook$/)
  await endTurn($, 'm9', 'Done.')
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
