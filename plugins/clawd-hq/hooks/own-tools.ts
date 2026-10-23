// The tools the office registers for the model (the tour, the offer of a lasting rule, the step report, the search for helpers, the hire of a contractor) and what a call of each is answered with.
// No `$`: what each does comes in as a closure.
import { CONTRACTOR_TOOL, DEMO_TOOL, FIND_TOOL, RULE_TOOL, STEP_TOOL } from './constants'
import { BRAND } from './office'

/** What the office's own tools may do. */
export type OwnToolIo = {
  /** Opens the office and plays the tour. */
  readonly tour: () => Promise<void>
  /** Clawd's offer of a lasting rule for CLAUDE.md (hooks/rule-io.ts); a specialist's call is refused. */
  readonly offerRule: (agentId: string | undefined, input: Record<string, unknown>) => Promise<{ readonly result: string } | { readonly deny: string }>
  /** A specialist's report of its steps; only one at work here counts. */
  readonly step: (agentId: string | undefined, input: Record<string, unknown>) => Promise<{ readonly result: string } | { readonly deny: string }>
  /** Clawd's search of everything installed for a job (hooks/find-helpers.ts); a specialist's call is refused. */
  readonly find: (agentId: string | undefined, input: Record<string, unknown>) => Promise<{ readonly result: string } | { readonly deny: string }>
  /** Clawd's hire of an off-team skill for one job (hooks/contractor.ts); a specialist's call is refused. */
  readonly contractor: (agentId: string | undefined, input: Record<string, unknown>) => Promise<{ readonly result: string } | { readonly deny: string }>
}

const TOUR_TEXT = `The ${BRAND} tour is playing in the side panel for about a minute. If the panel is not visible, the user can type /office.`

/** The answer to a call of one of the office's own tools, or `undefined` when the tool is not one of them. */
export async function ownToolAnswer(io: OwnToolIo, tool: string, agentId: string | undefined, input: Record<string, unknown>): Promise<{ readonly result: string } | { readonly deny: string } | undefined> {
  if (tool === DEMO_TOOL) {
    await io.tour()
    return { result: TOUR_TEXT }
  }
  if (tool === RULE_TOOL) return io.offerRule(agentId, input)
  if (tool === FIND_TOOL) return io.find(agentId, input)
  if (tool === CONTRACTOR_TOOL) return io.contractor(agentId, input)
  return tool === STEP_TOOL ? io.step(agentId, input) : undefined
}
