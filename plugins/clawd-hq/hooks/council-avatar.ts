// The council's own picture: three robed elders side by side, the middle one taller and holding a gavel. Pure, in the shared palette
// (hooks/avatar-data.ts), in the two small sizes a card uses: the 16 by 12 list icon and the 8 by 8 terminal picture.
// DECIDED: hair and beards are grey, the sides' robes navy, the judge's purple with a gold collar, so it shares no colour layout with a person's orange look.
import { PALETTE } from './avatar-data'
import type { Grid } from './avatars'

/** 16 by 12. Rows are drawn left to right; `.` is empty. */
const ICON = [
  '......gggg..tttt',
  '.....gokkog.tttt',
  '......gggg...t..',
  '.....pyyyyp..t..',
  '.....ppppppppo..',
  '.gg..pppppp..gg.',
  'okko.pppppp.okko',
  'nbbn.pppppp.nbbn',
  'nnnn.pppppp.nnnn',
  'nnnn.pppppp.nnnn',
  'nnnn.pppppp.nnnn',
  'nnnn.pppppp.nnnn',
]

/** 8 by 8: the same three, two dots wide at the sides. */
const TINY = [
  '...gg.tt',
  '...oo..t',
  '..pggppo',
  '..pyyp..',
  'ggppppgg',
  'ooppppoo',
  'nnppppnn',
  'nnppppnn',
]

const paintRows = (rows: string[]): Grid => rows.map(row => [...row].map(ch => (ch === '.' ? null : PALETTE[ch] ?? null)))

/** The 16 by 12 council picture. */
export const councilIcon = (): Grid => paintRows(ICON)

/** The 8 by 8 council picture for a terminal row. */
export const councilTinyIcon = (): Grid => paintRows(TINY)
