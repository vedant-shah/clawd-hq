// Clawd's two extra looks, pure: asleep when the office has been quiet, and a coffee mug at a break. This file holds the pieces (z's, mug,
// steam) and which look fits the moment; hooks/avatars.ts paints them. Every piece lies inside the box of his still picture, so a look
// never changes the size of his card.
import type { Part } from './avatar-data'
import type { ClawdMood } from './office'

export type Look = 'normal' | 'asleep' | 'coffee'

/** Coffee wins over sleep; sleep is the mood that already waits for the nap time; anything else is the normal look. */
export const lookOf = (mood: ClawdMood, isBreak: boolean): Look => (isBreak ? 'coffee' : mood === 'sleepy' ? 'asleep' : 'normal')

/**
 * The z's and the steam move one step every this many ticks. A quiet office ticks about every 1.2 seconds (hooks/register.tsx writes a
 * tick on every third frame even when nothing else moves), so a step is a slow drift of a few seconds and no extra redraw is made.
 */
export const STEP_TICKS = 2
export const stepOf = (tick: number): number => Math.floor(Math.max(0, tick) / STEP_TICKS)

export const ASLEEP_WORDS = 'asleep at his desk'
export const COFFEE_WORDS = 'drinking coffee'
const HOLDING_WORDS = 'in a navy blazer and red tie, holding a logbook'
const NAME_WORDS = 'Clawd, the chief of staff'

/** What the picture says to a screen reader. */
export const lookAlt = (look: Look): string =>
  look === 'asleep' ? `${NAME_WORDS}, ${ASLEEP_WORDS}` : look === 'coffee' ? `${NAME_WORDS}, ${COFFEE_WORDS}` : `${NAME_WORDS}, ${HOLDING_WORDS}`

// ---- Pieces that rise: a z, a wisp of steam ----

/** Where pieces start and how they climb: each piece is at its own place in a loop of `steps`, `rise` dots higher each step. */
type Climb = {
  shape: string[]
  /** The top row of a piece at the bottom of its loop. */
  y: number
  rise: number
  steps: number
  /** Each piece's left edge, and how many steps ahead of the others it is in the loop. */
  pieces: ReadonlyArray<{ x: number; ahead: number }>
  /** The piece leans one dot right on every other step, for a floating look. */
  isSwaying: boolean
}

/** The pieces of a climb at `step`, as parts to paint. */
function climbing(c: Climb, step: number): Part[] {
  return c.pieces.map(({ x, ahead }) => {
    const at = (step + ahead) % c.steps
    return { x: x + (c.isSwaying ? at % 2 : 0), y: c.y - c.rise * at, rows: c.shape }
  })
}

const Z = ['bbb', '.b.', 'bbb']

// Where the logbook was: the z's take its place in both drawings; the mug takes it too. (DECIDED: the logbook is put down for a nap or a break.)
const FULL_Z: Climb = { shape: Z, y: 15, rise: 2, steps: 4, pieces: [{ x: 19, ahead: 0 }, { x: 19, ahead: 2 }], isSwaying: true }
const SMALL_Z: Climb = { shape: Z, y: 8, rise: 2, steps: 3, pieces: [{ x: 13, ahead: 0 }], isSwaying: false }
const FULL_STEAM: Climb = { shape: ['g', 'g'], y: 11, rise: 1, steps: 4, pieces: [{ x: 17, ahead: 0 }, { x: 19, ahead: 2 }], isSwaying: true }
const SMALL_STEAM: Climb = { shape: ['g'], y: 6, rise: 1, steps: 3, pieces: [{ x: 13, ahead: 0 }, { x: 15, ahead: 1 }], isSwaying: false }

export const fullZ = (step: number): Part[] => climbing(FULL_Z, step)
export const smallZ = (step: number): Part[] => climbing(SMALL_Z, step)
export const fullSteam = (step: number): Part[] => climbing(FULL_STEAM, step)
export const smallSteam = (step: number): Part[] => climbing(SMALL_STEAM, step)

/** The mug in his hand (blue, dark rim, coffee showing) and its small twin. */
export const FULL_MUG: Part = {
  x: 16, y: 13,
  rows: ['ntttn..', 'bbbbbnn', 'bwbbb.n', 'bbbbbnn', 'bbbbb..', 'nnnnn..'],
}
export const SMALL_MUG: Part = { x: 13, y: 7, rows: ['ttt', 'bbb', 'nnn'] }
