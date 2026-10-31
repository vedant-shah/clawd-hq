// The team the People tab shows while the tour plays: five stand-ins with a short line each and a token total, in place of the real books.
// Nothing here is saved; the panel's data is dressed on its way to the drawing (hooks/register.tsx), and the real books are untouched.
import type { Badge } from '../types'
import type { PanelData } from './panel-types'

const CAST: ReadonlyArray<readonly [type: string, blurb: string, tokens: number]> = [
  ['ecc:planner', 'Plans the work before any code is touched, with the risks and a test for done.', 412_000],
  ['ecc:architect', 'Designs how the parts fit together, and how hard each choice is to undo.', 268_000],
  ['ecc:code-reviewer', 'Reviews a change for bugs and silent failures, ranked by how bad they are.', 530_000],
  ['ecc:tdd-guide', 'Writes the test first, then just enough code to make it pass.', 177_000],
  ['ecc:security-reviewer', 'Looks for holes in code that handles secrets, input or money.', 96_000],
]

const BLURBS: Record<string, string> = Object.fromEntries(CAST.map(([type, blurb]) => [type, blurb]))
const ROSTER: Record<string, Badge> = Object.fromEntries(CAST.map(([type, , tokens], i) => [type, { jobs: 3 + i, tokens }]))

/** The panel's data while the tour plays: the stand-in team stands in for the real one. Outside the tour, the data as it is. */
export function onStage(data: PanelData): PanelData {
  if (data.fx.demo === undefined) return data
  return { ...data, blurbs: BLURBS, roster: ROSTER, payroll: { ...data.payroll, laidOff: [] } }
}
