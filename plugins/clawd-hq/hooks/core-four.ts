// The four helpers Clawd HQ ships itself. Their definitions are plain files in agents/ (core-<name>.md), which the engine
// finds on its own and lists as `clawd-hq:core-<name>`; this file says which seat each one fills, and fills the core seats
// a team pick leaves empty with them. No `$` here.
import { SEATS } from './onboard-types'
import type { Pick as SeatPick, Seat, Team } from './onboard-types'

/** One shipped helper: the seat it fills, the agent type the engine lists it under, and its plain name. */
export type CoreHelper = { readonly seat: Seat; readonly type: string; readonly label: string }

const OWN_PLUGIN = 'clawd-hq'

/** Planner, Builder, Reviewer, Researcher: used when no better installed helper fits the seat. */
export const CORE_FOUR: readonly CoreHelper[] = [
  { seat: 'Plan', type: `${OWN_PLUGIN}:core-planner`, label: 'Planner' },
  { seat: 'Make', type: `${OWN_PLUGIN}:core-builder`, label: 'Builder' },
  { seat: 'Check', type: `${OWN_PLUGIN}:core-reviewer`, label: 'Reviewer' },
  { seat: 'Find out', type: `${OWN_PLUGIN}:core-researcher`, label: 'Researcher' },
]

const asPick = (h: CoreHelper): SeatPick => ({ seat: h.seat, name: h.type, kind: 'agent', receipt: `Clawd HQ's own ${h.label} · nothing installed fits` })

/** The team with every core seat that has no pick given its shipped helper, in the card's seat order. The Specialist seat is never filled. */
export function withCoreFour(team: Team): Team {
  const added = CORE_FOUR.filter(h => !team.picks.some(p => p.seat === h.seat))
  if (added.length === 0) return team
  const all = [...team.picks, ...added.map(asPick)]
  return { ...team, picks: SEATS.flatMap(seat => all.filter(p => p.seat === seat)), empty: team.empty.filter(s => !added.some(h => h.seat === s)) }
}
