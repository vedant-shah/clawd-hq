// How a specialist's run starts, spends and ends, as pure functions over one employee.
import type { AgentStatus } from 'claude-code'
import type { Employee, Mood } from '../types'
import { isActive } from './panel-model'

export type StepUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** The last few lines of what an employee did. */
export const note = (log: string[], line: string) => [...log, line].slice(-6)

/** A finished specialist that runs again (a message resumed it): a new run with its own clock, tool count and tokens. */
export function restart(one: Employee, now: number, tick: number): Employee {
  if (isActive(one)) return one
  return {
    ...one, mood: 'working', tool: undefined, target: undefined, tools: 0, tokens: 0, outTokens: 0, context: 0,
    startedAt: now, endedAt: undefined, doneTick: undefined, joinedTick: tick, log: note(one.log, 'back at it'),
  }
}

/**
 * One model request's cost. A request re-reads the whole prompt, so adding every request's context
 * up counts the cached prompt once per step: the figure is the latest request's input plus all output.
 */
export function withStep(one: Employee, u: StepUsage, model: string): Employee {
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const output = u.output_tokens || 0
  const outTokens = (one.outTokens ?? 0) + output
  return { ...one, model: model || one.model, context: input + output, outTokens, tokens: input + outTokens }
}

/** How the engine's status for an agent ends its time at a desk: undefined while it is still going. */
export function endOfStatus(status: AgentStatus): Mood | undefined {
  if (status === 'completed' || status === 'idle') return 'done'
  return status === 'failed' || status === 'killed' ? 'failed' : undefined
}
