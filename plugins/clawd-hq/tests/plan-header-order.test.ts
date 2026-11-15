// The brief's header lines, in the one order Clawd is told to write them: [effort: …], PAIR-UP:/COUNCIL:, PLAN:, then the contractor's line.
import { expect, test } from 'claude-code/testing'
import { parseEffort } from '../hooks/desk'
import { parsePairUp, parsePlanLine } from '../hooks/pair-up'
import { PLAN_SPEC } from '../hooks/tool-specs'

const CONTRACTOR_LINE = 'Load the skill ecc:pm2 with the Skill tool before anything else. Then give the one job. It does that job and leaves.'
const BRIEF = `[effort: medium]\nPAIR-UP: Ship the export\nPLAN: s2\n${CONTRACTOR_LINE}\nDone test: the export has a header row.`

test('a brief in that order is read whole: the effort, the pair-up goal and the plan step come off, and the contractor line is left first', () => {
  const effort = parseEffort(BRIEF)
  expect(effort.effort).toBe('medium')
  const pair = parsePairUp(effort.prompt)
  expect(pair.goal).toBe('Ship the export')
  // The plan line is read by the caller after the pair-up line (it tries before as well); it must sit before the contractor line.
  const plan = parsePlanLine(pair.prompt)
  expect(plan.stepId).toBe('s2')
  expect(plan.prompt.startsWith(CONTRACTOR_LINE)).toBe(true)
})

test('a contractor line put before the PLAN: line hides the step: the order matters, so the tool says it', () => {
  const wrong = parsePlanLine(`${CONTRACTOR_LINE}\nPLAN: s2\nDone test: x`)
  expect(wrong.stepId).toBeUndefined()
  expect(PLAN_SPEC.description).toContain('starting its brief with the line PLAN: <id>, after the PAIR-UP: line if there is one, and before the line hire_contractor gave you')
})
