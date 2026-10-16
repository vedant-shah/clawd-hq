import { expect, test } from 'claude-code/testing'
import { clawdAvatar } from '../hooks/avatars'
import type { Grid } from '../hooks/avatars'
import { PALETTE } from '../hooks/avatar-data'
import { NAP_MS, clawdMood } from '../hooks/clawd-says'
import { COFFEE_WORDS, ASLEEP_WORDS, STEP_TICKS, lookAlt, lookOf, stepOf } from '../hooks/clawd-look'
import type { Look } from '../hooks/clawd-look'
import { trimLike } from '../hooks/pixels'
import type { Boss } from '../types'

const boss = (over: Partial<Boss> = {}): Boss => ({
  activity: '', isBusy: false, waveUntil: 0, turns: 0, proudUntil: 0, oopsUntil: 0, lastTitle: '', idleSince: 0, hires: 0, wins: 0, fails: 0, ...over,
})
const [BLUE, GREY] = [PALETTE.b, PALETTE.g]
const draw = (look: Look, step = 0) => clawdAvatar({ look, step })
const count = (g: Grid) => g.flat().filter(c => c !== null).length
/** The cells of a grid that differ from another, as "x,y". */
const diff = (a: Grid, b: Grid) => a.flatMap((row, y) => row.map((c, x) => (c !== b[y]![x] ? `${x},${y}` : ''))).filter(Boolean)
/** The cells of one colour. */
const where = (g: Grid, color: string | undefined) => g.flatMap((row, y) => row.map((c, x) => (c === color ? `${x},${y}` : ''))).filter(Boolean)

// ---- Which look: mood and break time ----

test('free but recently active is the normal look; free past nap time is asleep', () => {
  const idle = boss({ idleSince: 1000 })
  expect(lookOf(clawdMood(idle, 0, 1, 1000 + NAP_MS - 1), false)).toBe('normal')
  expect(lookOf(clawdMood(idle, 0, 1, 1000 + NAP_MS + 1), false)).toBe('asleep')
})

test('anyone at work, or a turn running, wakes him: the normal working look', () => {
  const idle = boss({ idleSince: 1000 })
  const late = 1000 + NAP_MS + 1
  expect(lookOf(clawdMood(idle, 2, 1, late), false)).toBe('normal')
  expect(lookOf(clawdMood({ ...idle, isBusy: true }, 0, 1, late), false)).toBe('normal')
})

test('a break is the coffee look, and coffee beats asleep', () => {
  expect(lookOf('chill', true)).toBe('coffee')
  expect(lookOf('sleepy', true)).toBe('coffee')
  expect(lookOf('sleepy', false)).toBe('asleep')
})

// ---- How each look is drawn ----

test('asleep: eyes shut for good, no logbook, and a blue z where the logbook was', () => {
  const [still, asleep] = [clawdAvatar(), draw('asleep')]
  // The eyes (rows 10 to 13) lose their upper rows, as in a blink, and stay shut on every step.
  expect(asleep.full[11]![6]).not.toBe(still.full[11]![6])
  expect(draw('asleep', 1).full[11]![6]).toBe(asleep.full[11]![6])
  const zs = where(asleep.full, BLUE).filter(cell => Number(cell.split(',')[0]) >= 17)
  expect(zs.length).toBeGreaterThanOrEqual(5)
  // Nothing of the logbook (yellow cover mark, brown binding) is left on the right.
  expect(where(asleep.full, PALETTE.y)).toEqual([])
  expect(where(asleep.full, PALETTE.t)).toEqual([])
  // His small drawing shuts the eyes too and also loses the logbook for a z.
  expect(diff(still.compact, asleep.compact).length).toBeGreaterThan(0)
  expect(where(asleep.compact, PALETTE.t)).toEqual([])
  expect(where(asleep.compact, BLUE).length).toBeGreaterThanOrEqual(5)
})

test('the z drifts up between steps and loops back, in both drawings', () => {
  for (const pick of [(a: ReturnType<typeof clawdAvatar>) => a.full, (a: ReturnType<typeof clawdAvatar>) => a.compact]) {
    const frames = [0, 1, 2, 3, 4].map(step => pick(draw('asleep', step)))
    expect(diff(frames[0]!, frames[1]!).length).toBeGreaterThan(0)
    expect(diff(frames[1]!, frames[2]!).length).toBeGreaterThan(0)
    // The loop comes round: the full drawing repeats after 4 steps, the small one after 3.
    expect([diff(frames[0]!, frames[4]!).length, diff(frames[0]!, frames[3]!).length].some(n => n === 0)).toBe(true)
  }
})

test('coffee: eyes wide open and alert, a mug instead of the logbook, steam that rises between steps', () => {
  const [still, coffee] = [clawdAvatar(), draw('coffee')]
  // The alert eyes carry a white glint the normal ones lack.
  expect(still.full[11]![6]).toBe(PALETTE.k)
  expect(coffee.full[11]![6]).toBe(PALETTE.w)
  expect(coffee.full[12]![6]).toBe(PALETTE.k)
  expect(where(coffee.full, PALETTE.y)).toEqual([])
  expect(where(coffee.full, GREY).length).toBeGreaterThan(0)
  expect(where(coffee.full, PALETTE.n).length).toBeGreaterThan(0)
  for (const pick of [(a: ReturnType<typeof clawdAvatar>) => a.full, (a: ReturnType<typeof clawdAvatar>) => a.compact]) {
    const [a, b] = [pick(draw('coffee', 0)), pick(draw('coffee', 1))]
    expect(where(a, GREY)).not.toEqual(where(b, GREY))
    // Only the steam moved: the mug and the rest are the same.
    expect(diff(a, b).every(cell => where(a, GREY).includes(cell) || where(b, GREY).includes(cell))).toBe(true)
  }
})

test('the looks keep his navy blazer and red tie', () => {
  const [still, asleep, coffee] = [clawdAvatar(), draw('asleep', 2), draw('coffee', 2)]
  for (const one of [asleep, coffee]) {
    expect(one.full[15]![9]).toBe(PALETTE.r)
    expect(one.full[18]![8]).toBe(PALETTE.r)
    for (const [x, y] of [[7, 6], [8, 6], [7, 7], [8, 7]] as const) expect(one.compact[y]![x]).toBe(PALETTE.r)
    expect(one.full.slice(0, 9).flat().every(c => c === null)).toBe(true)
  }
  expect(still.full[15]![9]).toBe(PALETTE.r)
})

test('every look and step is cut to the still picture\'s size with nothing painted outside it', () => {
  const still = clawdAvatar()
  for (const look of ['normal', 'asleep', 'coffee'] as const) {
    for (const step of [0, 1, 2, 3, 4, 5]) {
      const one = draw(look, step)
      for (const [grid, like] of [[one.full, still.full], [one.compact, still.compact]] as const) {
        const cut = trimLike(grid, like)
        expect(cut.length).toBe(trimLike(like, like).length)
        expect(cut[0]!.length).toBe(trimLike(like, like)[0]!.length)
        // Whatever is drawn is inside the still picture's box: cutting loses no pixel.
        expect(count(cut)).toBe(count(grid))
      }
    }
  }
})

test('without a look he is drawn as before', () => {
  expect(clawdAvatar({ look: 'normal', step: 3 })).toEqual(clawdAvatar())
})

// ---- Steps and words ----

test('the picture steps once every few ticks, not every tick', () => {
  expect(STEP_TICKS).toBeGreaterThanOrEqual(2)
  expect(stepOf(0)).toBe(0)
  expect(stepOf(STEP_TICKS - 1)).toBe(0)
  expect(stepOf(STEP_TICKS)).toBe(1)
})

test('the picture says what he is doing', () => {
  expect(lookAlt('asleep')).toContain(ASLEEP_WORDS)
  expect(lookAlt('asleep')).toMatch(/asleep at his desk$/)
  expect(lookAlt('coffee')).toMatch(/drinking coffee$/)
  expect(COFFEE_WORDS).toBe('drinking coffee')
  expect(lookAlt('normal')).toBe('Clawd, the chief of staff, in a navy blazer and red tie, holding a logbook')
})
