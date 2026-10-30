// Contractors: the agent type every contractor is hired under, and how one is told from the team. No `$` and no imports, so the
// labels (hooks/office.ts) and the hire (hooks/contractor.ts) can both use it.

/**
 * The one contractor agent the plugin ships (agents/contractor.md). A file in agents/ is known to the Agent tool from the session's
 * start; a type registered with `$.agent.register` only from the next turn, too late for a hire in the same turn.
 */
export const CONTRACTOR_TYPE = 'clawd-hq:contractor'

/** Whether an agent type is this plugin's contractor. */
export const isContractorType = (type: string): boolean => type === CONTRACTOR_TYPE
