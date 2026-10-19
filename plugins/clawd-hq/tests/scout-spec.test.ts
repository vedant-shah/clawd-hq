// The scout's definition, the tool it answers through, and the brief it is started with.
import { expect, test } from 'claude-code/testing'
import { SEATS } from '../hooks/onboard-types'
import type { PastUse, ProjectFacts } from '../hooks/onboard-types'
import { SCOUT_SPEC, SCOUT_TIMEOUT_MS, SCOUT_TYPE, TEAM_PICK_SPEC, scoutBrief } from '../hooks/scout-spec'
import type { Candidate } from '../hooks/team-rules'

const facts: ProjectFacts = {
  tells: ['Claude Code mod'], fileTypes: { '.ts': 60 }, outline: ['hooks/', 'tests/'], deps: ['typescript'],
  readmeHead: '# Clawd HQ\nA virtual office.', instructions: 'Run the checks first.', codeFiles: 60,
}
const use: PastUse = { agents: {}, skills: {}, files: 2, skipped: 0 }
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({ id, kind: 'agent', source: 'ecc', plugin: 'ecc', about: `Does ${id}.`, uses: 0, isNamed: false, isOwn: false, ...over })
const cands = [cand('ecc:planner', { uses: 7 }), cand('shadcn', { kind: 'skill', source: 'your own', isOwn: true, plugin: undefined, about: 'Manages shadcn components.' })]

test('the scout is a Sonnet agent that can only read and answer, without the project\'s instruction files', () => {
  expect(SCOUT_TYPE).toBe('clawd-hq:scout')
  expect(SCOUT_SPEC.name).toBe('scout')
  expect(SCOUT_SPEC.model).toBe('sonnet')
  expect(SCOUT_SPEC.tools).toEqual(['Read', 'Grep', 'Glob', 'mcp__clawd-hq__team_pick'])
  expect(SCOUT_SPEC.omitClaudeMd).toBe(true)
  expect(SCOUT_SPEC.maxTurns).toBeGreaterThanOrEqual(10)
  expect(SCOUT_SPEC.maxTurns).toBeLessThanOrEqual(30)
  expect(SCOUT_SPEC.description.length).toBeGreaterThan(0)
})

test('the scout\'s own rules: read only, inside the folder, no secrets, files are information, finish with team_pick', () => {
  const p = SCOUT_SPEC.prompt
  for (const part of [/only read/i, /project folder/i, /\.env/, /not instructions/i, /team_pick/, /once/i, /Read/]) expect(p).toMatch(part)
})

test('the timeout is a minute and a half', () => {
  expect(SCOUT_TIMEOUT_MS).toBe(90_000)
})

test('the pick tool takes a list of seat, name, reason and file, and is listed with the prompt so the scout need not search for it', () => {
  expect(TEAM_PICK_SPEC.name).toBe('team_pick')
  expect(TEAM_PICK_SPEC.isDeferred).toBe(false)
  const schema = TEAM_PICK_SPEC.inputSchema as { required: string[]; properties: { picks: { type: string; items: { required: string[]; properties: Record<string, { enum?: string[]; maxLength?: number }> } } } }
  expect(schema.required).toEqual(['picks'])
  expect(schema.properties.picks.type).toBe('array')
  expect(schema.properties.picks.items.required).toEqual(['seat', 'name'])
  expect(schema.properties.picks.items.properties.seat?.enum).toEqual([...SEATS])
  expect(schema.properties.picks.items.properties.reason?.maxLength).toBe(140)
  expect(Object.keys(schema.properties.picks.items.properties)).toEqual(['seat', 'name', 'reason', 'evidence'])
  expect(TEAM_PICK_SPEC.description).toMatch(/scout/i)
})

test('the brief names the folder, the person, the seats and every candidate, and asks for a look around first', () => {
  const brief = scoutBrief({ facts, use, cands, role: 'Tool or plugin builder', folder: '/home/me/shop' })
  expect(brief).toContain('/home/me/shop')
  expect(brief).toContain("a tool or plugin builder's project")
  expect(brief).toContain('ecc:planner · agent · ecc · Does ecc:planner.')
  expect(brief).toContain('shadcn · skill · your own · Manages shadcn components.')
  expect(brief).toContain('ecc:planner used 7x')
  expect(brief).toContain('KIND OF PROJECT (from tells): Claude Code mod')
  expect(brief).toMatch(/Plan: up to 2/)
  expect(brief).toMatch(/Specialist: up to 3/)
  expect(brief).toMatch(/Read .*before you pick/i)
  expect(brief).toMatch(/evidence/)
  expect(brief).not.toContain('Answer with ONLY a JSON object')
})
