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
  /** Each piece's left edge, how many steps ahead of the others it is in the loop, and its own shape if it is not the climb's. */
  pieces: ReadonlyArray<{ x: number; ahead: number; shape?: string[] }>
  /** The piece leans one dot right on every other step, for a floating look. */
  isSwaying: boolean
}

/** The pieces of a climb at `step`, as parts to paint. */
function climbing(c: Climb, step: number): Part[] {
  return c.pieces.map(({ x, ahead, shape }) => {
    const at = (step + ahead) % c.steps
    return { x: x + (c.isSwaying ? at % 2 : 0), y: c.y - c.rise * at, rows: shape ?? c.shape }
  })
}

// Real Z's: a bar on top, a slanting stroke, a bar at the bottom. The big drawing has room for two sizes; the small one fits a 3 by 4 Z.
const BIG_Z = ['bbbbb', '...b.', '..b..', '.b...', 'bbbbb']
const MID_Z = ['bbbb', '..b.', '.b..', 'bbbb']
const TINY_Z = ['bbb', '..b', '.b.', 'bbb']

// Where the logbook was: the z's take its place in both drawings; the mug takes it too. (DECIDED: the logbook is put down for a nap or a break.)
// The big drawing's z's sit in the 5 free columns right of the body (no sway: a 5-wide z would leave the picture), a larger and a smaller one.
const FULL_Z: Climb = { shape: BIG_Z, y: 17, rise: 3, steps: 4, pieces: [{ x: 19, ahead: 0 }, { x: 20, ahead: 2, shape: MID_Z }], isSwaying: false }
const SMALL_Z: Climb = { shape: TINY_Z, y: 8, rise: 2, steps: 3, pieces: [{ x: 13, ahead: 0 }], isSwaying: false }

/**
 * Eyes shut for a nap: each eye a flat dark line, wider than tall and lower in the face than an open eye's top, so it cannot read as open.
 * The big drawing's line is a gentle smile (ends up, middle down) four dots wide; the small one is a flat three-dot line, one dot tall.
 */
export const CLOSED_EYES: Part = { x: 4, y: 10, rows: ['............', '.k..k..k..k.', '..kk....kk..', '............'] }
export const CLOSED_EYES_ICON: Part = { x: 0, y: 5, rows: ['....kkk..kkk....', '.....o....o.....'] }
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
