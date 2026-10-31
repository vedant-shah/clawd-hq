// What the scout hands back is untrusted: it is checked against the candidate list and against what it actually read.
import { expect, test } from 'claude-code/testing'
import { scoutPicks } from '../hooks/scout-pick'
import type { Candidate } from '../hooks/team-rules'

const FOLDER = '/home/me/shop'
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, kind: 'agent', source: 'ecc', plugin: id.includes(':') ? id.split(':')[0] : undefined, about: `Does ${id}.`, uses: 0, isNamed: false, isOwn: false, ...over,
})
const cands = [cand('ecc:planner'), cand('ecc:tdd-guide'), cand('ecc:code-reviewer'), cand('other:reviewer'), cand('ecc:reviewer'), cand('shadcn', { kind: 'skill', source: 'your own', isOwn: true }), cand('claude-code-guide', { source: 'built in / not on disk' })]
const reads = ['/home/me/shop/package.json', '/home/me/shop/README.md', '/home/me/shop/src/app.ts']
const report = (picks: unknown, seen: readonly string[] = reads) => ({ picks: { picks }, reads: seen })
const pick = (seat: string, name: string, extra: Record<string, unknown> = {}) => ({ seat, name, ...extra })

test('a good answer becomes seats and names, in the order given', () => {
  const r = scoutPicks(report([pick('Plan', 'ecc:planner'), pick('Make', 'ecc:tdd-guide'), pick('Specialist', 'shadcn')]), cands, FOLDER)
  expect(r.picks).toEqual([{ seat: 'Plan', name: 'ecc:planner' }, { seat: 'Make', name: 'ecc:tdd-guide' }, { seat: 'Specialist', name: 'shadcn' }])
  expect(r.problems).toEqual([])
})

test('a reason counts only with a file the scout really opened; it is shown with that file', () => {
  const r = scoutPicks(report([
    pick('Make', 'ecc:tdd-guide', { reason: 'Tests run with vitest, so tests come first.', evidence: 'package.json' }),
    pick('Plan', 'ecc:planner', { reason: 'The README lists a roadmap.', evidence: '/home/me/shop/README.md' }),
  ]), cands, FOLDER)
  expect(r.picks).toEqual([
    { seat: 'Make', name: 'ecc:tdd-guide', reason: 'Tests run with vitest, so tests come first. (package.json)' },
    { seat: 'Plan', name: 'ecc:planner', reason: 'The README lists a roadmap. (README.md)' },
  ])
})

test('a reason that cites a file the scout never opened is dropped; the pick stays', () => {
  const r = scoutPicks(report([
    pick('Make', 'ecc:tdd-guide', { reason: 'Looks like Python.', evidence: 'pyproject.toml' }),
    pick('Plan', 'ecc:planner', { reason: 'Because.' }),
    pick('Specialist', 'shadcn', { reason: 'Far away.', evidence: '../elsewhere/package.json' }),
  ]), cands, FOLDER)
  expect(r.picks.map(p => [p.name, p.reason])).toEqual([['ecc:tdd-guide', undefined], ['ecc:planner', undefined], ['shadcn', undefined]])
})

test('a pick that cites a secret file is not taken at all, even one the scout opened', () => {
  const opened = [...reads, '/home/me/shop/.env', '/home/me/shop/certs/server.pem']
  const r = scoutPicks(report([
    pick('Check', 'ecc:code-reviewer', { reason: 'The keys are here.', evidence: '.env' }),
    pick('Plan', 'ecc:planner', { reason: 'Signed builds.', evidence: '/home/me/shop/certs/server.pem' }),
    pick('Make', 'ecc:tdd-guide', { reason: 'Tests run with vitest.', evidence: 'package.json' }),
  ], opened), cands, FOLDER)
  expect(r.picks.map(p => p.name)).toEqual(['ecc:tdd-guide'])
  expect(r.problems).toHaveLength(2)
  expect(r.problems.join(' ')).not.toMatch(/keys are here|Signed builds/) // the scout's words are not repeated
})

test('a reason that looks like it holds a secret is dropped; the pick stays', () => {
  const secretish = [
    'The key is sk_live_abc in the config.', 'Uses sk-ant-api03 for the model.', 'AWS access AKIAABCDEFGHIJKLMNOP is set.', 'Token ghp_abcdef is in CI.',
    'Slack xoxb-1234 posts alerts.', 'Has -----BEGIN RSA PRIVATE KEY----- in it.', 'Hash a1b2c3d4e5f6a7b8c9d0e1f2a3b4 is pinned.',
    'Sets API_KEY=hunter2 for the app.', 'Sets password = hunter2 here.',
  ]
  for (const reason of secretish) {
    const r = scoutPicks(report([pick('Make', 'ecc:tdd-guide', { reason, evidence: 'package.json' })]), cands, FOLDER)
    expect([reason, r.picks.map(p => [p.name, p.reason])]).toEqual([reason, [['ecc:tdd-guide', undefined]]])
  }
  const plain = scoutPicks(report([pick('Make', 'ecc:tdd-guide', { reason: 'Tests run with vitest, so tests come first.', evidence: 'package.json' })]), cands, FOLDER)
  expect(plain.picks[0]?.reason).toBe('Tests run with vitest, so tests come first. (package.json)')
})

test('a reason is one clean line of reasonable length: marks and breaks are cleaned, a long one is dropped', () => {
  const r = scoutPicks(report([
    pick('Plan', 'ecc:planner', { reason: 'Plans\nbefore\tbuilding\u202e  here\u200b.', evidence: 'package.json' }),
    pick('Make', 'ecc:tdd-guide', { reason: 'x'.repeat(141), evidence: 'package.json' }),
    pick('Check', 'ecc:code-reviewer', { reason: '   ', evidence: 'package.json' }),
    pick('Specialist', 'shadcn', { reason: 7, evidence: ['package.json'] }),
  ]), cands, FOLDER)
  expect(r.picks.map(p => p.reason)).toEqual(['Plans before building here . (package.json)', undefined, undefined, undefined])
})

test('a name without its plugin is repaired when exactly one candidate has that short name', () => {
  const r = scoutPicks(report([pick('Plan', 'planner'), pick('Make', 'TDD-Guide'), pick('Check', 'reviewer'), pick('Specialist', 'code-reviewer')]), cands, FOLDER)
  // `reviewer` fits three candidates, so it is nobody; the others have one match each.
  expect(r.picks).toEqual([{ seat: 'Plan', name: 'ecc:planner' }, { seat: 'Make', name: 'ecc:tdd-guide' }, { seat: 'Specialist', name: 'ecc:code-reviewer' }])
  expect(r.problems.join(' ')).toContain('reviewer')
})

test('an exact name always wins over a repair, and a made-up name is dropped and reported', () => {
  const r = scoutPicks(report([pick('Specialist', 'shadcn'), pick('Plan', 'ecc:nobody'), pick('Check', 'nobody'), pick('Plan', 'other:planner')]), cands, FOLDER)
  expect(r.picks).toEqual([{ seat: 'Specialist', name: 'shadcn' }])
  expect(r.problems.join(' ')).toMatch(/ecc:nobody.*nobody.*other:planner/)
})

test('a built-in helper is not repaired into a pick, and odd entries are skipped', () => {
  const r = scoutPicks(report([pick('Plan', 'Plan'), pick('Find out', 'Explore'), pick('Boss', 'ecc:planner'), { seat: 'Plan', name: 7 }, null, 'ecc:planner', { seat: 'Make' }, pick(' find out ', ' claude-code-guide ')]), cands, FOLDER)
  expect(r.picks).toEqual([{ seat: 'Find out', name: 'claude-code-guide' }])
})

test('no picks list, or one that is not a list, gives nothing and says why', () => {
  for (const picks of [undefined, 'lots', { a: 1 }, 7]) {
    const r = scoutPicks({ picks: { picks }, reads }, cands, FOLDER)
    expect(r.picks).toEqual([])
    expect(r.problems.length).toBeGreaterThan(0)
  }
  expect(scoutPicks({ picks: 'not an object', reads }, cands, FOLDER).picks).toEqual([])
  expect(scoutPicks({ picks: null, reads }, cands, FOLDER).picks).toEqual([])
})

test('only the first forty entries are looked at', () => {
  const many = Array.from({ length: 100 }, (_, i) => pick('Specialist', i === 90 ? 'shadcn' : 'ecc:nobody'))
  expect(scoutPicks(report(many), cands, FOLDER).picks).toEqual([])
})

test('the file shown beside a reason must be a clean one-line path; one with control, escape or direction marks is left off (the reason stays)', () => {
  const odd = ['src/a‮b.ts', 'src/a⁦b.ts', 'src/a\u001b[31mb.ts', 'src/a\nb.ts', 'src/a\tb.ts', 'src/a​b.ts', 'src/a  b.ts', 'src/a⁩b.ts']
  const r = scoutPicks(report(odd.map(file => pick('Plan', 'ecc:planner', { reason: 'It has a plan.', evidence: file })), odd.map(file => `/home/me/shop/${file}`)), cands, FOLDER)
  expect(r.picks.map(p => p.reason)).toEqual(odd.map(() => 'It has a plan.'))
  const clean = scoutPicks(report([pick('Plan', 'ecc:planner', { reason: 'It has a plan.', evidence: 'src/my file.ts' })], ['/home/me/shop/src/my file.ts']), cands, FOLDER)
  expect(clean.picks[0]?.reason).toBe('It has a plan. (src/my file.ts)')
})

test('a path too long to show leaves the reason without it', () => {
  const long = `src/${'d/'.repeat(40)}file.ts`
  const r = scoutPicks(report([pick('Plan', 'ecc:planner', { reason: 'It has a plan.', evidence: long })], [`/home/me/shop/${long}`]), cands, FOLDER)
  expect(r.picks[0]?.reason).toBe('It has a plan.')
})

test('Windows-style spellings of a file the scout read still match', () => {
  const r = scoutPicks(report([pick('Make', 'ecc:tdd-guide', { reason: 'Uses vitest.', evidence: 'src\\app.ts' })], ['C:/work/shop/src/app.ts']), cands, 'C:\\work\\shop')
  expect(r.picks[0]?.reason).toBe('Uses vitest. (src/app.ts)')
})
