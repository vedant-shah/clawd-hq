// Contractors: the agent type a skill is hired under for one job, and how one is told from the team. No `$` and no imports, so the
// labels (hooks/office.ts) and the hire (hooks/contractor.ts) can both use it.

const OWN_PLUGIN = 'clawd-hq'
const PREFIX = 'contractor-'
const NAME_CHARS = 64

/** The agent name a skill is hired under: its whole id (so `a:planner` and `b:planner` stay two agents), safe characters only, at most 64. */
export const contractorName = (skill: string): string =>
  `${PREFIX}${skill.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, NAME_CHARS).replace(/-+$/, '')

/** The agent type the engine lists the contractor under, which the Agent tool hires by. */
export const contractorType = (skill: string): string => `${OWN_PLUGIN}:${contractorName(skill)}`

/** Whether an agent type is one of this plugin's contractors. */
export const isContractorType = (type: string): boolean => type.startsWith(`${OWN_PLUGIN}:${PREFIX}`)

/** The role a contractor was registered with: the words before the first colon of its description (`Designer: what the skill does`). */
export function roleFromBlurb(blurb: string): string {
  const at = blurb.indexOf(':')
  return at < 0 ? '' : blurb.slice(0, at).trim()
}
