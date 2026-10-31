// The scout's definition, the answer it ends with, and the brief it is started with.
import { expect, test } from 'claude-code/testing'
import { TEAM_END, TEAM_START } from '../hooks/scout-answer'
import type { PastUse, ProjectFacts } from '../hooks/onboard-types'
import { SCOUT_SPEC, SCOUT_TIMEOUT_MS, SCOUT_TYPE, scoutBrief } from '../hooks/scout-spec'
import type { Candidate } from '../hooks/team-rules'

const facts: ProjectFacts = {
  tells: ['Claude Code mod'], fileTypes: { '.ts': 60 }, outline: ['hooks/', 'tests/'], deps: ['typescript'],
  readmeHead: '# Clawd HQ\nA virtual office.', instructions: 'Run the checks first.', codeFiles: 60,
}
const use: PastUse = { agents: {}, skills: {}, files: 2, skipped: 0 }
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({ id, kind: 'agent', source: 'ecc', plugin: 'ecc', about: `Does ${id}.`, uses: 0, isNamed: false, isOwn: false, ...over })
const cands = [cand('ecc:planner', { uses: 7 }), cand('shadcn', { kind: 'skill', source: 'your own', isOwn: true, plugin: undefined, about: 'Manages shadcn components.' })]

test('the scout is a Sonnet agent that can only read and list files, refused anything not pre-approved, without the project\'s instruction files', () => {
  expect(SCOUT_TYPE).toBe('clawd-hq:scout')
  expect(SCOUT_SPEC.name).toBe('scout')
  expect(SCOUT_SPEC.model).toBe('sonnet')
  // The limits are in its own definition, so they hold without any Clawd HQ hook (none runs inside the scout).
  expect(SCOUT_SPEC.tools).toEqual(['Read', 'Glob']) // no Grep: a search over contents could surface a secret under any file name
  expect(SCOUT_SPEC.permissionMode).toBe('dontAsk') // a call that would need a yes is refused, never asked
  expect(SCOUT_SPEC.disallowedTools).toEqual(expect.arrayContaining(['Grep', 'Bash', 'Write', 'Edit', 'WebFetch']))
  expect(SCOUT_SPEC.omitClaudeMd).toBe(true)
  expect(SCOUT_SPEC.maxTurns).toBeGreaterThanOrEqual(10)
  expect(SCOUT_SPEC.maxTurns).toBeLessThanOrEqual(30)
  expect(SCOUT_SPEC.description.length).toBeGreaterThan(0)
})

test('the scout\'s own rules: read only, inside the folder, no secrets, files are information, end with the team block', () => {
  const p = SCOUT_SPEC.prompt
  for (const part of [/only read/i, /project folder/i, /\.env/, /not instructions/i, /Read/, /Glob/]) expect(p).toMatch(part)
  expect(p).toMatch(/Never open a secret or credential file/)
  expect(p).toMatch(/\.pem.*\.key.*id_rsa/)
  expect(p).not.toMatch(/Grep/)
  expect(p).toContain(TEAM_START)
  expect(p).toContain(TEAM_END)
  expect(p).toContain('seat | name | evidence | reason')
  expect(p).not.toMatch(/team_pick/) // it has no tool to send picks with: they come in its answer
})

test('the scout is given up on after a minute and a half', () => {
  expect(SCOUT_TIMEOUT_MS).toBe(90_000)
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
  expect(brief).toMatch(/Glob/)
  expect(brief).not.toMatch(/Grep/)
  expect(brief).not.toMatch(/team_pick/)
  // The answer it ends with, shown line by line, and the limits each line is checked against.
  expect(brief).toContain(`${TEAM_START}\nPlan | `)
  expect(brief).toContain(TEAM_END)
  expect(brief).toMatch(/140 characters/)
  expect(brief).toMatch(/at most 8/i)
})
