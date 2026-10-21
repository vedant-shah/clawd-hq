// The tools the office registers for the model (the tour, remember, the step report) and what a call of each is answered with.
// No `$`: what each does comes in as a closure.
import { DEMO_TOOL, MEM_TOOL, RULE_TOOL, STEP_TOOL } from './constants'
import { BRAND } from './office'

/** What the office's own tools may do. */
export type OwnToolIo = {
  /** Opens the office and plays the tour. */
  readonly tour: () => Promise<void>
  /** Records a decision; the plain answer for the model. */
  readonly remember: (agentId: string | undefined, input: Record<string, unknown>) => Promise<string>
  /** Clawd's offer of a lasting rule for CLAUDE.md (hooks/rule-io.ts); a specialist's call is refused. */
  readonly offerRule: (agentId: string | undefined, input: Record<string, unknown>) => Promise<{ readonly result: string } | { readonly deny: string }>
  /** A specialist's report of its steps; only one at work here counts. */
  readonly step: (agentId: string | undefined, input: Record<string, unknown>) => Promise<{ readonly result: string } | { readonly deny: string }>
}

const TOUR_TEXT = `The ${BRAND} tour is playing in the side panel for about a minute. If the panel is not visible, the user can type /office.`

/** The answer to a call of one of the office's own tools, or `undefined` when the tool is not one of them. */
export async function ownToolAnswer(io: OwnToolIo, tool: string, agentId: string | undefined, input: Record<string, unknown>): Promise<{ readonly result: string } | { readonly deny: string } | undefined> {
  if (tool === DEMO_TOOL) {
    await io.tour()
    return { result: TOUR_TEXT }
  }
  if (tool === MEM_TOOL) return { result: await io.remember(agentId, input) }
  if (tool === RULE_TOOL) return io.offerRule(agentId, input)
  return tool === STEP_TOOL ? io.step(agentId, input) : undefined
}
