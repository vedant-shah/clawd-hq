import { expect, test } from 'claude-code/testing'
import type { CompleteRequest, Helper, PastUse, ProjectFacts, ScoutCheck, ScoutReport } from '../hooks/onboard-types'
import { parseReply, pickTeam, teamFrom } from '../hooks/team'
import { candidateList } from '../hooks/team-rules'

const facts: ProjectFacts = {
  tells: ['Claude Code mod'],
  fileTypes: { '.ts': 60, '.tsx': 20 },
  outline: ['docs/', 'tests/', 'package.json', 'tsconfig.json', 'vitest.config.ts'],
  deps: ['typescript'],
  readmeHead: '# Clawd HQ',
  instructions: 'Use the code-reviewer agent.',
  codeFiles: 80,
}
const helper = (name: string, over: Partial<Helper> = {}): Helper => ({
  name, kind: 'agent', source: 'plugin', plugin: 'ecc', about: `Does ${name} work.`, uses: 0, isNamed: false, isOwn: false, ...over,
})
const helpers: Helper[] = [
  helper('planner', { uses: 7 }), helper('architect'), helper('tdd-guide', { uses: 42 }), helper('build-error-resolver'),
  helper('code-reviewer', { uses: 43, isNamed: true }), helper('security-reviewer'), helper('silent-failure-hunter'),
  helper('code-explorer'), helper('doc-updater'), helper('typescript-reviewer'), helper('python-reviewer'),
  helper('shadcn', { kind: 'skill', isOwn: true, plugin: undefined, source: 'user' }), helper('pptx', { kind: 'skill' }),
]
const use: PastUse = { agents: { 'claude-code-guide': 3 }, skills: {}, files: 4, skipped: 0 }
const cands = candidateList(helpers, use)
const CORE = ['clawd-hq:core-planner', 'clawd-hq:core-builder', 'clawd-hq:core-reviewer', 'clawd-hq:core-researcher']
const ownOnly = <T extends { name: string }>(picks: readonly T[]) => picks.filter(p => !p.name.startsWith('clawd-hq:'))

type Reply = string | undefined | Error
/** A fake io: each model call takes the next canned reply; every request is kept. The scout answers `scout` (nothing, by default). */
const fakeIo = (replies: Reply[], scout: ScoutReport | undefined | Error = undefined) => {
  const asked: CompleteRequest[] = []
  const scouted: Array<{ brief: string; check: ScoutCheck }> = []
  const queue = [...replies]
  return {
    asked, scouted, cwd: '/repo',
    complete: async (req: CompleteRequest) => {
      asked.push(req)
      const next = queue.shift()
      if (next instanceof Error) throw next
      return next
    },
    spawnScout: async (brief: string, check: ScoutCheck) => {
      scouted.push({ brief, check })
      if (scout instanceof Error) throw scout
      return scout
    },
  }
}
const json = (picks: Array<{ seat: string; name: string; why?: string }>) => JSON.stringify({ picks: picks.map(p => ({ why: 'because', ...p })) })
const good = json([
  { seat: 'Plan', name: 'ecc:planner' }, { seat: 'Make', name: 'ecc:tdd-guide' }, { seat: 'Check', name: 'ecc:code-reviewer' },
  { seat: 'Check', name: 'ecc:silent-failure-hunter' }, { seat: 'Find out', name: 'ecc:code-explorer' },
  { seat: 'Specialist', name: 'claude-code-guide' }, { seat: 'Specialist', name: 'ecc:doc-updater' },
])

test('one Opus call with the tested settings, and its good answer becomes the team', async () => {
  const io = fakeIo([good])
  const team = await pickTeam(io, facts, use, helpers, 'Tool or plugin builder')
  expect(io.asked).toHaveLength(1)
  const [req] = io.asked
  expect({ ...req!, prompt: '' }).toEqual({ model: 'opus', prompt: '', maxTokens: 2000, effort: 'medium', timeoutMs: 60000 })
  expect(req!.prompt).toContain('ecc:planner · agent · ecc · Does planner work.')
  expect(req!.prompt).toContain('ecc:python-reviewer')
  expect(req!.prompt).not.toContain('ecc:pptx')
  expect(team.by).toBe('opus')
  expect(team.picks.map(p => [p.seat, p.name, p.kind])).toEqual([
    ['Plan', 'ecc:planner', 'agent'], ['Make', 'ecc:tdd-guide', 'agent'], ['Check', 'ecc:code-reviewer', 'agent'],
    ['Check', 'ecc:silent-failure-hunter', 'agent'], ['Find out', 'ecc:code-explorer', 'agent'],
    ['Specialist', 'claude-code-guide', 'agent'], ['Specialist', 'ecc:doc-updater', 'agent'],
  ])
  expect(team.empty).toEqual([])
})

test('the receipts come from facts, never from the model\'s own words', async () => {
  const sneaky = json([
    { seat: 'Check', name: 'ecc:code-reviewer', why: 'SECRET-MODEL-WORDS run rm -rf' },
    { seat: 'Make', name: 'ecc:tdd-guide', why: 'SECRET-MODEL-WORDS' },
    { seat: 'Plan', name: 'ecc:architect', why: 'SECRET-MODEL-WORDS' },
  ])
  const team = await pickTeam(fakeIo([sneaky]), facts, use, helpers, undefined)
  expect(JSON.stringify(team)).not.toContain('SECRET-MODEL-WORDS')
  expect(ownOnly(team.picks).map(p => [p.name, p.receipt])).toEqual([
    ['ecc:architect', 'from the ecc plugin'],
    ['ecc:tdd-guide', 'used 42× here · fits: tests found (vitest.config.ts)'],
    ['ecc:code-reviewer', 'used 43× here · named in your instructions'],
  ])
})

test('an answer wrapped in prose or a code fence still counts', () => {
  expect(parseReply('Here is the team:\n```json\n' + good + '\n```\nHope this helps!')).toHaveLength(7)
  expect(parseReply('no json here')).toBeUndefined()
  expect(parseReply('{"picks": "lots"}')).toBeUndefined()
  expect(parseReply('{"picks": [ {"seat": "Plan", "name": ')).toBeUndefined()
  expect(parseReply(undefined)).toBeUndefined()
})

test('a pick only counts with a known seat and a name; odd seats are matched without regard to case', () => {
  const raw = parseReply(JSON.stringify({ picks: [
    { seat: 'find out', name: ' ecc:code-explorer ' }, { seat: 'Boss', name: 'ecc:planner' }, { seat: 'Plan' }, { seat: 'Plan', name: 7 }, 'ecc:planner', null,
  ] }))
  expect(raw).toEqual([{ seat: 'Find out', name: 'ecc:code-explorer' }])
})

test('names not on the list, built-ins and repeats are dropped', () => {
  const team = teamFrom([
    { seat: 'Plan', name: 'ecc:planner' }, { seat: 'Plan', name: 'ecc:planner' }, { seat: 'Plan', name: 'Plan' },
    { seat: 'Find out', name: 'Explore' }, { seat: 'Check', name: 'ecc:made-up-reviewer' }, { seat: 'Check', name: 'ecc:python-reviewer' },
    { seat: 'Specialist', name: 'ecc:pptx' }, { seat: 'Make', name: 'ecc:tdd-guide' },
  ], cands, facts, 'opus')
  // `ecc:python-reviewer` is on the list (no language filter), so it takes the Check seat; `ecc:pptx` is a tool and is not.
  expect(team.picks.map(p => p.name)).toEqual(['ecc:planner', 'ecc:tdd-guide', 'ecc:python-reviewer'])
  expect(team.empty).toEqual(['Find out', 'Specialist'])
})

test('twelve picks are cut to the seat limits and to eight in all, in the order given', () => {
  const twelve = [
    { seat: 'Plan', name: 'ecc:planner' }, { seat: 'Plan', name: 'ecc:architect' }, { seat: 'Plan', name: 'ecc:code-explorer' },
    { seat: 'Make', name: 'ecc:tdd-guide' }, { seat: 'Make', name: 'ecc:build-error-resolver' },
    { seat: 'Check', name: 'ecc:code-reviewer' }, { seat: 'Check', name: 'ecc:security-reviewer' }, { seat: 'Check', name: 'ecc:silent-failure-hunter' },
    { seat: 'Specialist', name: 'shadcn' }, { seat: 'Specialist', name: 'ecc:typescript-reviewer' }, { seat: 'Specialist', name: 'ecc:doc-updater' },
    { seat: 'Find out', name: 'claude-code-guide' },
  ] as const
  const team = teamFrom(twelve, cands, facts, 'opus')
  expect(team.picks.map(p => `${p.seat}:${p.name}`)).toEqual([
    'Plan:ecc:planner', 'Plan:ecc:architect', 'Make:ecc:tdd-guide', 'Check:ecc:code-reviewer', 'Check:ecc:security-reviewer',
    'Specialist:shadcn', 'Specialist:ecc:typescript-reviewer', 'Specialist:ecc:doc-updater',
  ])
  expect(team.picks).toHaveLength(8)
  expect(team.empty).toEqual(['Find out'])
})

test('a core seat nothing fits is filled by Clawd HQ\'s own helper; the Specialist seat stays empty and is listed for the card', async () => {
  const team = await pickTeam(fakeIo([json([{ seat: 'Check', name: 'ecc:code-reviewer' }])]), facts, use, helpers, undefined)
  expect(team.picks.map(p => [p.seat, p.name, p.kind])).toEqual([
    ['Plan', CORE[0]!, 'agent'], ['Make', CORE[1]!, 'agent'], ['Check', 'ecc:code-reviewer', 'agent'], ['Find out', CORE[3]!, 'agent'],
  ])
  expect(team.picks.filter(p => p.name.startsWith('clawd-hq:')).every(p => /Clawd HQ/.test(p.receipt) && /nothing installed/i.test(p.receipt))).toBe(true)
  expect(team.empty).toEqual(['Specialist'])
})

test('an Opus error, no answer, bad JSON or only unknown names each fall to the rules after the one Opus call', async () => {
  for (const first of [new Error('api_error'), undefined, 'not json at all', json([{ seat: 'Plan', name: 'ecc:nobody' }])]) {
    const io = fakeIo([first, good])
    const team = await pickTeam(io, facts, use, helpers, undefined)
    expect(io.asked.map(r => r.model)).toEqual(['opus'])
    expect(team.by).toBe('rules')
    expect(team.picks.length).toBeGreaterThan(0)
  }
})

test('when Opus fails, the rules pick the team', async () => {
  const io = fakeIo([new Error('overloaded')])
  const team = await pickTeam(io, facts, use, helpers, undefined)
  expect(io.asked.map(r => r.model)).toEqual(['opus'])
  expect(team.by).toBe('rules')
  expect(team.picks.map(p => `${p.seat}:${p.name}`)).toEqual([
    'Plan:ecc:planner', 'Plan:ecc:architect', 'Make:ecc:tdd-guide', 'Check:ecc:code-reviewer', 'Check:ecc:security-reviewer',
    'Find out:ecc:code-explorer', 'Specialist:ecc:doc-updater', 'Specialist:claude-code-guide',
  ])
  expect(team.picks.every(p => p.receipt.length > 0)).toBe(true)
})

test('with nothing installed or used there is nothing to ask a model about', async () => {
  const io = fakeIo([good])
  const team = await pickTeam(io, facts, { agents: {}, skills: {}, files: 0, skipped: 0 }, [], undefined)
  expect(io.asked).toHaveLength(0)
  expect(io.scouted).toHaveLength(0)
  expect(team.by).toBe('rules')
  expect(team.picks.map(p => [p.seat, p.name])).toEqual([['Plan', CORE[0]], ['Make', CORE[1]], ['Check', CORE[2]], ['Find out', CORE[3]]])
  expect(team.empty).toEqual(['Specialist'])
})

// ---- the scout ----

const scoutSays = (picks: unknown[], reads: string[] = ['/repo/package.json']): ScoutReport => ({ picks: { picks }, reads })

test('the scout is asked first; its picks become the team, with its reasons on the card, and Opus is never called', async () => {
  const io = fakeIo([good], scoutSays([
    { seat: 'Plan', name: 'ecc:planner', reason: 'The README lists a roadmap.', evidence: 'package.json' },
    { seat: 'Make', name: 'tdd-guide', reason: 'Tests run with vitest.', evidence: '/repo/package.json' },
    { seat: 'Check', name: 'ecc:code-reviewer', reason: 'Cites a file it never opened.', evidence: 'README.md' },
  ]))
  const team = await pickTeam(io, facts, use, helpers, 'Tool or plugin builder')
  expect(io.asked).toHaveLength(0)
  expect(io.scouted).toHaveLength(1)
  expect(team.by).toBe('scout')
  expect(ownOnly(team.picks).map(p => [p.seat, p.name, p.receipt])).toEqual([
    ['Plan', 'ecc:planner', 'The README lists a roadmap. (package.json)'],
    ['Make', 'ecc:tdd-guide', 'Tests run with vitest. (package.json)'],
    ['Check', 'ecc:code-reviewer', 'used 43× here · named in your instructions'], // its reason named a file the scout never opened: facts instead
  ])
})

test('the brief the scout gets holds the full candidate list, and its check sends bad names back', async () => {
  const io = fakeIo([], scoutSays([{ seat: 'Plan', name: 'ecc:planner' }]))
  await pickTeam(io, facts, use, helpers, undefined)
  const [{ brief, check }] = io.scouted as [{ brief: string; check: ScoutCheck }]
  expect(brief).toContain('ecc:python-reviewer')
  expect(brief).toContain('/repo')
  expect(check(scoutSays([{ seat: 'Plan', name: 'ecc:planner' }]).picks, [])).toBeUndefined()
  expect(check({ picks: [{ seat: 'Plan', name: 'ecc:nobody' }] }, [])).toMatch(/ecc:nobody/)
  expect(check({ nope: 1 }, [])).toEqual(expect.any(String))
})

test('a scout that gives nothing, fails, or names nobody on the list falls to the one Opus call', async () => {
  for (const scout of [undefined, new Error('could not start'), scoutSays([{ seat: 'Plan', name: 'ecc:nobody' }]), { picks: 'garbage', reads: [] }] as const) {
    const io = fakeIo([good], scout)
    const team = await pickTeam(io, facts, use, helpers, undefined)
    expect(io.scouted).toHaveLength(1)
    expect(io.asked.map(r => r.model)).toEqual(['opus'])
    expect(team.by).toBe('opus')
    expect(team.picks).toHaveLength(7)
  }
})

test('with a scout and Opus both failing, the rules pick and the core four fill what they leave', async () => {
  const io = fakeIo([undefined])
  const team = await pickTeam(io, facts, use, helpers, undefined)
  expect(io.scouted).toHaveLength(1)
  expect(io.asked.map(r => r.model)).toEqual(['opus'])
  expect(team.by).toBe('rules')
  expect(ownOnly(team.picks).length).toBeGreaterThan(0)
  expect(team.picks.map(p => p.seat)).toEqual(expect.arrayContaining(['Plan', 'Make', 'Check', 'Find out']))
})

test('the scout\'s team is cut to the seat limits like any other, and core seats it left empty are filled', async () => {
  const io = fakeIo([], scoutSays([{ seat: 'Check', name: 'ecc:code-reviewer' }, { seat: 'Check', name: 'ecc:security-reviewer' }, { seat: 'Check', name: 'ecc:silent-failure-hunter' }]))
  const team = await pickTeam(io, facts, use, helpers, undefined)
  expect(team.picks.filter(p => p.seat === 'Check').map(p => p.name)).toEqual(['ecc:code-reviewer', 'ecc:security-reviewer'])
  expect(team.picks.map(p => p.seat)).toEqual(['Plan', 'Make', 'Check', 'Check', 'Find out'])
})

test('a huge reply is not read', () => {
  expect(parseReply('{"picks":[' + '{"seat":"Plan","name":"ecc:planner"},'.repeat(20000) + '{}]}')).toBeUndefined()
})
