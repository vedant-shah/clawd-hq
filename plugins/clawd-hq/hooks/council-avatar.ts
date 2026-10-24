// The council's own picture: three Clawds as judges on a bench. Each is the same orange Clawd body as every person avatar (two black eyes,
// the darker hem and the little legs, hooks/avatar-data.ts) in a grey-and-white judge's wig with curled sides and a dark robe band. The middle
// one is bigger and holds a brown gavel at its side. Pure, in the shared palette, in the two small sizes a card uses: the list icon and the terminal picture.
import { PALETTE } from './avatar-data'
import type { Grid } from './avatars'

/** Rows of palette keys; `.` is empty. */
type Rows = readonly string[]
/** A figure, and where its top left corner sits on the picture. */
type Placed = { rows: Rows; x: number; y: number }

const blank = (width: number, height: number): Grid => Array.from({ length: height }, () => Array.from({ length: width }, () => null))

/** A new picture with the figure painted over the old one; `.` leaves what is under it. */
function paint(grid: Grid, { rows, x, y }: Placed): Grid {
  return grid.map((row, gy) => row.map((cell, gx) => {
    const ch = rows[gy - y]?.[gx - x]
    return ch === undefined || ch === '.' ? cell : PALETTE[ch] ?? cell
  }))
}

const compose = (width: number, height: number, figures: Placed[]): Grid => figures.reduce(paint, blank(width, height))

// ---- The list icon: 23 by 12 ----

/** A judge at the sides: 6 wide, 8 tall. */
const SIDE: Rows = ['.gwwg.', 'gwwwwg', 'goooog', 'gkookg', 'okooko', 'nnnnnn', 'o.dd.o', 'o.dd.o']

/** The judge in the middle: 8 wide, 11 tall, its legs the Clawd body's own. */
const MIDDLE: Rows = ['..gwwg..', '.gwwwwg.', 'gwwwwwwg', 'goooooog', 'gokookog', 'ookookoo', 'oooooooo', 'nnnnnnnn', 'nnnnnnnn', 'o.d..d.o', 'o.d..d.o']

/** The gavel: its head over the right-hand judge's gap, the handle down to the middle judge's hand. */
const GAVEL: Placed[] = [
  { rows: ['ttt', 'ttt'], x: 15, y: 1 },
  { rows: ['t', 't', 't'], x: 16, y: 3 },
  { rows: ['o'], x: 15, y: 5 },
]

const BENCH_ICON: Placed = { rows: ['m'.repeat(23)], x: 0, y: 11 }

/** The 23 by 12 council picture. */
export const councilIcon = (): Grid => compose(23, 12, [
  { rows: SIDE, x: 0, y: 3 }, { rows: SIDE, x: 17, y: 3 }, { rows: MIDDLE, x: 7, y: 0 }, ...GAVEL, BENCH_ICON,
])

// ---- The tiny picture: 18 by 7, for a terminal row, where a picture cannot be scaled ----

const TINY_SIDE: Rows = ['gwwwg', 'okoko', 'nnnnn', 'o.d.o']
const TINY_MIDDLE: Rows = ['.gwg.', 'gwwwg', 'okoko', 'ooooo', 'nnnnn', 'o.d.o']
const TINY_GAVEL: Placed[] = [
  { rows: ['ttt'], x: 11, y: 0 },
  { rows: ['t', 't'], x: 12, y: 1 },
  { rows: ['o'], x: 11, y: 2 },
]

/** The 18 by 7 council picture for a terminal row. */
export const councilTinyIcon = (): Grid => compose(18, 7, [
  { rows: TINY_SIDE, x: 0, y: 2 }, { rows: TINY_SIDE, x: 13, y: 2 }, { rows: TINY_MIDDLE, x: 6, y: 0 }, ...TINY_GAVEL, { rows: ['m'.repeat(18)], x: 0, y: 6 },
])
