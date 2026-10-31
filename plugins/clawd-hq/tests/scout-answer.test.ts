// The scout's final answer, read: the team block in it, one line per pick, and the files the scout opened, from its transcript.
import { expect, test } from 'claude-code/testing'
import type { ProjectFacts } from '../hooks/onboard-types'
import { TEAM_END, TEAM_START, answerEntries, scoutReport } from '../hooks/scout-answer'
import { scoutPicks } from '../hooks/scout-pick'
import { teamFrom } from '../hooks/team'
import type { Candidate } from '../hooks/team-rules'

const ROOT = '/repo'
const block = (...lines: string[]) => `I looked around the project.\n${TEAM_START}\n${lines.join('\n')}\n${TEAM_END}\nThat is the team.`
const said = (text: string, reads: string[] = []) => ({ role: 'assistant' as const, text, toolUses: reads.map(file_path => ({ tool: 'Read', input: { file_path } })) })

test('each line of the team block is seat | name | evidence | reason; the words around the block are not read', () => {
  expect(answerEntries(block('Plan | ecc:planner | README.md | The README lists features not built yet.'))).toEqual([
    { seat: 'Plan', name: 'ecc:planner', evidence: 'README.md', reason: 'The README lists features not built yet.' },
  ])
})

test('spaces around each field are trimmed, and a bar inside the reason stays part of it', () => {
  expect(answerEntries(block('  Check|ecc:code-reviewer |src/auth.ts|  Logins here | so reviews matter.  '))).toEqual([
    { seat: 'Check', name: 'ecc:code-reviewer', evidence: 'src/auth.ts', reason: 'Logins here | so reviews matter.' },
  ])
})

test('a line that is not four fields is dropped; the good lines around it are kept', () => {
  const entries = answerEntries(block('Plan | ecc:planner | README.md | Plans first.', 'just some words', 'Make | ecc:tdd-guide', '', 'Check | ecc:code-reviewer | src/auth.ts | Logins.'))
  expect(entries?.map(e => e.name)).toEqual(['ecc:planner', 'ecc:code-reviewer'])
})

test('no block, a start with no end, or an end before the start gives nothing', () => {
  expect(answerEntries('Plan | ecc:planner | README.md | Plans first.')).toBeUndefined()
  expect(answerEntries(`${TEAM_START}\nPlan | ecc:planner | README.md | Plans first.`)).toBeUndefined()
  expect(answerEntries(`${TEAM_END}\nPlan | ecc:planner | README.md | Plans first.\n${TEAM_START}`)).toBeUndefined()
})

test('an empty block is a block with no picks', () => {
  expect(answerEntries(block())).toEqual([])
})

test('only the first forty lines of the block are looked at', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `Plan | p${i} | README.md | Reason ${i}.`)
  expect(answerEntries(block(...lines))).toHaveLength(40)
})

test('the report: the block in the scout\'s final answer, and the files it opened with Read (not Glob or Grep)', () => {
  const messages = [
    { role: 'user' as const, text: `BRIEF that shows the format:\n${block('Plan | example | README.md | An example.')}`, toolUses: [] },
    { role: 'assistant' as const, text: '', toolUses: [{ tool: 'Read', input: { file_path: '/repo/README.md' } }, { tool: 'Glob', input: { pattern: '**/*' } }, { tool: 'Grep', input: { pattern: 'auth', path: 'src' } }] },
    said('Looking at the manifest.', ['package.json']),
    said(block('Plan | ecc:planner | README.md | Plans first.')),
  ]
  expect(scoutReport(messages)).toEqual({
    picks: { picks: [{ seat: 'Plan', name: 'ecc:planner', evidence: 'README.md', reason: 'Plans first.' }] },
    reads: ['/repo/README.md', 'package.json'],
  })
})

test('only the final answer counts: a block followed by more work, or one in a message that still calls tools, is not taken', () => {
  expect(scoutReport([said(block('Plan | ecc:old | README.md | An early try.')), said('Let me check one more file.', ['package.json'])])).toBeUndefined()
  expect(scoutReport([said(block('Plan | ecc:planner | README.md | Plans first.'), ['package.json'])])).toBeUndefined()
})

test('a final answer handed back with the hand-back tool counts, as a background scout gives it', () => {
  const messages = [
    said('Looking around.', ['/repo/README.md']),
    { role: 'assistant' as const, text: '', toolUses: [{ tool: 'SubagentHandback', input: { message: block('Plan | ecc:planner | README.md | Plans first.') } }] },
    { role: 'user' as const, text: '', toolUses: [] }, // the hand-back's own result
  ]
  expect(scoutReport(messages)).toEqual({ picks: { picks: [{ seat: 'Plan', name: 'ecc:planner', evidence: 'README.md', reason: 'Plans first.' }] }, reads: ['/repo/README.md'] })
})

test('a read that failed is not counted as opened', () => {
  const messages = [
    { role: 'assistant' as const, text: '', toolUses: [{ tool: 'Read', input: { file_path: '/repo/README.md' }, isError: true }, { tool: 'Read', input: { file_path: '/repo/package.json' } }] },
    said(block('Plan | ecc:planner | README.md | Plans first.')),
  ]
  expect(scoutReport(messages)?.reads).toEqual(['/repo/package.json'])
})

test('a transcript with no team block in the scout\'s own words gives no report', () => {
  expect(scoutReport([said('I could not decide.', ['/repo/README.md'])])).toBeUndefined()
  expect(scoutReport([{ role: 'user', text: block('Plan | ecc:planner | README.md | Plans first.'), toolUses: [] }])).toBeUndefined()
  expect(scoutReport([])).toBeUndefined()
})

// ---- checked as the team step checks it ----

const facts: ProjectFacts = { tells: [], fileTypes: { '.ts': 10 }, outline: ['src/'], deps: [], readmeHead: '# Shop', instructions: '', codeFiles: 10 }
const cand = (id: string): Candidate => ({ id, kind: 'agent', source: 'ecc', plugin: 'ecc', about: `Does ${id}.`, uses: 0, isNamed: false, isOwn: false })
const CANDS = ['ecc:planner', 'ecc:architect', 'ecc:tdd-guide', 'ecc:code-reviewer', 'ecc:security-reviewer', 'ecc:docs-lookup', 'ecc:a11y', 'ecc:seo', 'ecc:langfuse'].map(cand)
const teamOf = (text: string, reads: string[]) => {
  const report = scoutReport([said('Looking around.', reads), said(text)])
  return report === undefined ? undefined : teamFrom(scoutPicks(report, CANDS, ROOT).picks, CANDS, facts, 'scout')
}

test('checked against the list: an unknown name or a seat that is no seat is dropped, the good lines are kept', () => {
  const team = teamOf(block(
    'Plan | ecc:planner | README.md | Plans first.',
    'Plan | ecc:nobody | README.md | Not installed.',
    'Boss | ecc:architect | README.md | No such seat.',
    'Check | ecc:code-reviewer | src/auth.ts | Logins here.',
  ), ['/repo/README.md', '/repo/src/auth.ts'])
  expect(team?.picks.map(p => p.name)).toEqual(['ecc:planner', 'ecc:code-reviewer'])
  expect(team?.picks[0]?.receipt).toBe('Plans first. (README.md)')
})

test('a reason over 140 characters, or one resting on a file the scout never opened, is not shown; the pick stays', () => {
  const team = teamOf(block(`Plan | ecc:planner | README.md | ${'x'.repeat(141)}`, 'Check | ecc:code-reviewer | src/auth.ts | Logins here.'), ['/repo/README.md'])
  expect(team?.picks.map(p => p.name)).toEqual(['ecc:planner', 'ecc:code-reviewer'])
  expect(team?.picks.map(p => p.receipt).join('\n')).not.toMatch(/xxx|Logins here/)
})

test('at most eight make the team, however many good lines there are', () => {
  const seats = ['Plan', 'Plan', 'Make', 'Check', 'Check', 'Find out', 'Specialist', 'Specialist', 'Specialist']
  const lines = CANDS.map((c, i) => `${seats[i]} | ${c.id} | README.md | Fits.`)
  expect(teamOf(block(...lines), ['/repo/README.md'])?.picks).toHaveLength(8)
})
