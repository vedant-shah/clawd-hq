// Who is on the team in every project, and who only in the project that hired them. No `$` here.
// A skill hire (`clawd-hq:<skill>`) is registered each session from the folder's own saved team, so one made in another project
// cannot be used here and is not a team member here. Built-ins, the shipped agents and the generic contractor are in every project.
import { CONTRACTOR_TYPE } from './contractor-name'
import { CORE_FOUR } from './core-four'
import { isBuiltIn } from './helpers'
import { SCOUT_TYPE } from './scout-spec'

const OWN_PREFIX = 'clawd-hq:'

/** The agent types of this plugin that every project has: the core helpers, the generic contractor and the setup scout (tests/standing.test.ts pins them to agents/). */
export const SHIPPED_TYPES: ReadonlySet<string> = new Set([...CORE_FOUR.map(h => h.type), CONTRACTOR_TYPE, SCOUT_TYPE])

/** Whether an agent type is one of this plugin's, other than a shipped one: a skill hire, which belongs to the project that made it. */
export const isHireType = (type: string): boolean => type.startsWith(OWN_PREFIX) && !SHIPPED_TYPES.has(type)

/** Whether an agent type is always on the team here: a built-in, a shipped agent, or one of this folder's own hires (`ownHires`, as listed: `clawd-hq:<name>`). */
export const isStanding = (type: string, ownHires: ReadonlySet<string>): boolean =>
  isBuiltIn(type) || SHIPPED_TYPES.has(type) || ownHires.has(type)
