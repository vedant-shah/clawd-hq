// The four helpers Clawd HQ ships itself. Their definitions are plain files in agents/ (core-<name>.md), which the engine
// finds on its own and lists as `clawd-hq:core-<name>`; this file only says which seat each one fills. No `$` here.
import type { Seat } from './onboard-types'

/** One shipped helper: the seat it fills, and the agent type the engine lists it under. */
export type CoreHelper = { readonly seat: Seat; readonly type: string }

const OWN_PLUGIN = 'clawd-hq'

/** Planner, Builder, Reviewer, Researcher: used when no better installed helper fits the seat. */
export const CORE_FOUR: readonly CoreHelper[] = [
  { seat: 'Plan', type: `${OWN_PLUGIN}:core-planner` },
  { seat: 'Make', type: `${OWN_PLUGIN}:core-builder` },
  { seat: 'Check', type: `${OWN_PLUGIN}:core-reviewer` },
  { seat: 'Find out', type: `${OWN_PLUGIN}:core-researcher` },
]
