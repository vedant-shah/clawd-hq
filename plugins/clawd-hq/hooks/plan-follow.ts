// A follow-up Clawd sends a specialist he already hired (the SendMessage tool, which resumes it): a `PLAN: <step id>` line at its start
// says which step of the plan the resumed run is for, as a first brief's does. Pure. register-agents.ts takes the line off and links the run.
import type { Employee } from '../types'
import { parseEffort } from './desk'
import { parsePlanLine } from './pair-up'

/**
 * The step a follow-up names, and the message without the line. The line counts first, or right after an `[effort: …]` line, which stays
 * on the message (the resumed run reads its effort from it). Only a step id makes a plan line, as in a brief (`parsePlanLine`). A message
 * that is nothing but its header lines goes as written: a specialist is never sent an empty message, and the step is still named.
 */
export function parseFollowUp(text: string): { stepId?: string; text: string } {
  const { prompt: unEffort } = parseEffort(text)
  const { stepId, prompt } = parsePlanLine(unEffort)
  if (stepId === undefined) return { text }
  return { stepId, text: prompt.trim() === '' ? text : text.slice(0, text.length - unEffort.length) + prompt }
}

/**
 * The specialist linked to a step by a follow-up. Moved to another step (or another goal's), it leaves its earlier choices behind: they
 * are under the old step already, or belonged to no step, and only the new run's go under the new one. Linked again to the same step, it
 * keeps them, as a resume with no plan line does.
 */
export function movedTo(one: Employee, stepId: string, planKey: string): Employee {
  if (one.stepId === stepId && one.planKey === planKey) return one
  return { ...one, stepId, planKey, choices: undefined }
}

/**
 * The specialist on the books a message is addressed to: by its agent id, else by the name it was hired under. A name two specialists
 * share is nobody's, so nothing is linked by a guess.
 */
export function recipientOf(staff: readonly Employee[], to: string): Employee | undefined {
  const byId = staff.find(one => one.id === to)
  if (byId !== undefined) return byId
  const named = staff.filter(one => one.name !== undefined && one.name === to)
  return named.length === 1 ? named[0] : undefined
}
