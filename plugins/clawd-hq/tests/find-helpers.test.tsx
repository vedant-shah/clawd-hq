// find_helpers, the tool: Clawd searches every installed agent and skill for a job and gets the top five with where each stands.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FIND_TOOL } from '../hooks/constants'
import { START } from './host'
import { CWD, HOME, offerAgents, onboardHost } from './onboard-host'

const TEAM = {
  picks: [
    { seat: 'Plan', name: 'ecc:planner', kind: 'agent', receipt: 'used 3× here' },
    { seat: 'Make', name: 'ecc:tdd-workflow', kind: 'skill', receipt: 'used 3× here' },
  ],
  empty: [],
  by: 'rules',
  hires: [{ name: 'tdd-workflow', description: 'Make: Writes tests first.', prompt: 'p', skills: ['ecc:tdd-workflow'] }],
}
const PAYROLL = { laidOff: ['ecc:go-reviewer'], isReviewed: true, stacks: [] }
type Match = { name: string; kind: string; about: string; status: string; next: string }

/** A project with a saved team, one agent laid off, and a skill on disk that is not on the team. */
async function office(on: Parameters<typeof onboardHost>[0]) {
  const h = onboardHost(on, { [`team:${CWD}`]: TEAM, [`payroll:${CWD}`]: PAYROLL })
  h.files.set(`${HOME}/.claude/skills/pitch-deck/SKILL.md`, '---\nname: pitch-deck\ndescription: Builds investor pitch decks and slide stories.\n---\nBody.\n')
  return h
}

const find = ($: Engine, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: FIND_TOOL, ...input, ...(agentId ? { agentId } : {}) } as never) as Promise<{ result?: string; deny?: string }>
const matchesOf = async ($: Engine, job: string) => (JSON.parse((await find($, { job })).result ?? '{}') as { matches: Match[] }).matches

test('the tool is registered for Clawd in the prompt\'s own list, so he needs no search to find it', async ($, on) => {
  const h = await office(on)
  await $.session.start(START)
  expect(h.tools).toContain('find_helpers')
  expect(h.toolSpecs.find(t => t.name === 'find_helpers')?.isDeferred).toBe(false)
})

test('a helper on the team is staff, with how to hire it', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  const [top] = await matchesOf($, 'plan the work')
  expect(top).toMatchObject({ name: 'ecc:planner', kind: 'agent', status: 'staff' })
  expect(top?.about).toBe('Plans work before anyone builds.')
  expect(top?.next).toContain('ecc:planner')
})

test('a skill on the team is staff, and its hire is named', async ($, on) => {
  await office(on)
  await $.session.start(START)
  const [top] = await matchesOf($, 'write tests first')
  expect(top).toMatchObject({ name: 'ecc:tdd-workflow', kind: 'skill', status: 'staff' })
  expect(top?.next).toContain('clawd-hq:tdd-workflow')
})

test('an agent laid off for this project is still found, and marked laid off', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  const [top] = await matchesOf($, 'review my go code')
  expect(top).toMatchObject({ name: 'ecc:go-reviewer', kind: 'agent', status: 'laid off' })
  expect(top?.next).toMatch(/hire it anyway|bring/i)
})

test('an installed skill that was not picked is "not on team", and the way to hire it is a contractor', async ($, on) => {
  await office(on)
  await $.session.start(START)
  const [top] = await matchesOf($, 'make an investor pitch deck')
  expect(top).toMatchObject({ name: 'pitch-deck', kind: 'skill', status: 'not on team', about: 'Builds investor pitch decks and slide stories.' })
  expect(top?.next).toContain('hire_contractor')
})

test('the shipped four are always staff, and the plugin\'s own skill hires are not listed beside their skill', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await $.agent.offer({ agent: 'clawd-hq:core-builder', description: 'Clawd HQ\'s Builder. Carries out one scoped change.' } as never)
  await $.agent.offer({ agent: 'clawd-hq:tdd-workflow', description: 'Make: Writes tests first, then the code.' } as never)
  const found = await matchesOf($, 'build the feature and write tests first')
  expect(found.find(m => m.name === 'clawd-hq:core-builder')).toMatchObject({ kind: 'agent', status: 'staff' })
  expect(found.some(m => m.name === 'clawd-hq:tdd-workflow')).toBe(false)
})

test('at most five come back, and a job nothing fits says so and points to the general agent', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  expect((await matchesOf($, 'review plan test code contract go')).length).toBeLessThanOrEqual(5)
  const none = JSON.parse((await find($, { job: 'knit a sweater' })).result ?? '{}') as { matches: Match[]; note: string }
  expect(none.matches).toEqual([])
  expect(none.note).toMatch(/general-purpose/)
})

test('a specialist cannot search: its call is refused with where to put the need instead', async ($, on) => {
  await office(on)
  await $.session.start(START)
  const asked = await find($, { job: 'plan the work' }, 'a1')
  expect(asked.result).toBeUndefined()
  expect(asked.deny).toMatch(/Clawd/)
})

test('a call with no job, or a job that is not text, is refused with why', async ($, on) => {
  await office(on)
  await $.session.start(START)
  for (const input of [{}, { job: '' }, { job: '   ' }, { job: 7 }]) {
    const answer = await find($, input)
    expect(answer.deny).toMatch(/job/)
  }
})

test('the search reads the lists from the engine, not the cut list the model sees: a skill past the cut is found', async ($, on) => {
  const h = await office(on)
  h.session.loaded = { ...h.session.loaded, skills: { totalSkills: 40, includedSkills: 1, tokens: 10, skillFrontmatter: [{ name: 'ecc:tdd-workflow', source: 'plugin', pluginName: 'ecc', tokens: 10 }] } }
  h.commandList.push({ name: 'marketing:seo-audit', description: 'Audits a site for search ranking problems.', source: 'plugin' })
  await $.session.start(START)
  const [top] = await matchesOf($, 'audit the site for search ranking')
  expect(top).toMatchObject({ name: 'marketing:seo-audit', kind: 'skill', status: 'not on team' })
})
