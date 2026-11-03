// Who is on every team: the built-ins and the agent types this plugin ships, never a skill hire of another project.
// A test cannot read files, so the shipped list is pinned here against agents/ (checked by hand: contractor.md and the four core-*.md)
// and against the one agent the plugin registers itself, the setup scout.
import { expect, test } from 'claude-code/testing'
import { SCOUT_TYPE } from '../hooks/scout-spec'
import { SHIPPED_TYPES, isHireType, isStanding } from '../hooks/standing'

const AGENT_FILES = ['contractor', 'core-builder', 'core-planner', 'core-researcher', 'core-reviewer']

test('the shipped types are the files in agents/ and the registered scout, listed under clawd-hq:', () => {
  expect([...SHIPPED_TYPES].sort()).toEqual([...AGENT_FILES.map(f => `clawd-hq:${f}`), SCOUT_TYPE].sort())
  expect(SCOUT_TYPE).toBe('clawd-hq:scout')
})

test('a shipped type is always on the team and is no hire', () => {
  for (const type of SHIPPED_TYPES) {
    expect(isHireType(type)).toBe(false)
    expect(isStanding(type, new Set())).toBe(true)
  }
})

test('another Clawd HQ type is on the team only as one of this folder\'s own hires', () => {
  expect(isHireType('clawd-hq:tdd-workflow')).toBe(true)
  expect(isStanding('clawd-hq:tdd-workflow', new Set())).toBe(false)
  expect(isStanding('clawd-hq:tdd-workflow', new Set(['clawd-hq:tdd-workflow']))).toBe(true)
  expect(isHireType('ecc:planner')).toBe(false)
})
