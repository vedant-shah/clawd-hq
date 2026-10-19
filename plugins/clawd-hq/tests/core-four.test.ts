// The four helpers Clawd HQ ships itself. Their definitions are the files in agents/, which the engine finds with no
// manifest line. A test cannot read files (its sandbox has no file access, and a .md import is refused), so the files
// are checked live: `claude --plugin-dir . plugin details clawd-hq` lists Agents (4). What a test can pin is in code.
import { expect, test } from 'claude-code/testing'
import { CORE_FOUR } from '../hooks/core-four'
import { parkList, skillHires } from '../hooks/hire'
import type { Pick as SeatPick, Team } from '../hooks/onboard-types'
import { SEATS } from '../hooks/onboard-types'

const pick = (seat: SeatPick['seat'], name: string, kind: SeatPick['kind'] = 'agent'): SeatPick => ({ seat, name, kind, receipt: 'used 3× here' })
const teamOf = (picks: readonly SeatPick[]): Team => ({ picks, empty: [], by: 'rules' })
const types = CORE_FOUR.map(h => h.type)

test('the four are Planner, Builder, Reviewer and Researcher, one for each of Plan, Make, Check and Find out', () => {
  expect(CORE_FOUR.map(h => h.seat)).toEqual(['Plan', 'Make', 'Check', 'Find out'])
  expect(types).toEqual(['clawd-hq:core-planner', 'clawd-hq:core-builder', 'clawd-hq:core-reviewer', 'clawd-hq:core-researcher'])
  expect(CORE_FOUR.every(h => SEATS.includes(h.seat))).toBe(true)
})

test('parking never parks the four, whether or not the team holds them', () => {
  expect(parkList(['ecc:architect', ...types], teamOf([pick('Plan', 'ecc:planner')]))).toEqual(['ecc:architect'])
  expect(parkList(types, teamOf([]))).toEqual([])
})

test('the four are not mistaken for built-ins or taken for the team\'s own picks', () => {
  expect(parkList(['Plan', 'general-purpose', ...types], teamOf([pick('Plan', types[0] ?? '')]))).toEqual([])
})

test('a skill hire cannot take a core helper\'s name: a skill called planner is hired as planner', () => {
  const team = teamOf([pick('Plan', 'anthropic-skills:planner', 'skill')])
  const { hires } = skillHires(team, [{ name: 'anthropic-skills:planner', about: 'Plans.' }])
  const hired = hires.map(h => `clawd-hq:${h.name}`)
  expect(hired).toEqual(['clawd-hq:planner'])
  expect(types).not.toContain(hired[0])
})
