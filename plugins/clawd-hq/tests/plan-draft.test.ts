import { expect, test } from 'claude-code/testing'
import { PLAN_DRAFT_NOTE, draftFrom, draftKey, draftNote, parseSteps } from '../hooks/plan-draft'
import { parsePairUp, parsePlanDraftLine, parsePlanHeader } from '../hooks/pair-up'
import { parseEffort } from '../hooks/desk'
import { planTool, receiveDraft } from '../hooks/plan-run'
import { BASE, FILE } from './plan-disk'
import { office } from './plan-office'

// The Planner's plans: the PLAN-DRAFT: header line, the STEP: lines of a report, and what a real hand-back does with them.

const REPORT = 'I read the code.\n\nSTEP: Find how scores are stored\nSTEP: Write the CSV export\nSTEP: Add a test for it\n\nDone.'
const TITLE = 'Export scores'

// ---- The header line ----

test('PLAN-DRAFT: gives the goal title and comes off the brief, in each header order', () => {
  expect(parsePlanDraftLine('PLAN-DRAFT: Export scores\nPlan the export.')).toEqual({ title: 'Export scores', prompt: 'Plan the export.' })
  expect(parsePlanDraftLine('  plan-draft:   Export scores  \r\nPlan it.')).toEqual({ title: 'Export scores', prompt: 'Plan it.' })
  // [effort], then PLAN-DRAFT:, then the pair-up line.
  const a = parseEffort('[effort: high]\nPLAN-DRAFT: Export scores\nPAIR-UP: Plan and review\nPlan the export.')
  const first = parsePlanHeader(a.prompt)
  expect(first.title).toBe('Export scores')
  expect(parsePairUp(first.prompt)).toMatchObject({ goal: 'Plan and review', prompt: 'Plan the export.' })
  // [effort], then the pair-up line, then PLAN-DRAFT:.
  const b = parseEffort('[effort: high]\nPAIR-UP: Plan and review\nPLAN-DRAFT: Export scores\nPlan the export.')
  const pair = parsePairUp(b.prompt)
  expect(pair.goal).toBe('Plan and review')
  expect(parsePlanHeader(pair.prompt)).toEqual({ title: 'Export scores', prompt: 'Plan the export.' })
})

test('a PLAN: step line is still read, and PLAN-DRAFT: is never taken for one; an empty title or a line in words is no draft and left as it was', () => {
  expect(parsePlanHeader('PLAN: s2\nBuild it.')).toEqual({ stepId: 's2', prompt: 'Build it.' })
  expect(parsePlanHeader('PLAN-DRAFT: Export\nPlan it.')).not.toHaveProperty('stepId')
  for (const brief of ['PLAN-DRAFT:\nPlan it.', 'PLAN-DRAFT:   \nPlan it.', 'Plan-draft your week.', 'Please PLAN-DRAFT: a thing']) expect(parsePlanHeader(brief)).toEqual({ prompt: brief })
})

test('the note that asks for STEP lines says what the Planner must write', () => {
  expect(PLAN_DRAFT_NOTE).toContain('`STEP: <text>`')
  expect(PLAN_DRAFT_NOTE).toMatch(/three to eight steps/)
  expect(PLAN_DRAFT_NOTE).toMatch(/one outcome that one specialist can finish/)
})

// ---- The STEP: lines ----

test('no STEP line gives no steps; one gives one; two or more give them all, in order', () => {
  expect(parseSteps('')).toEqual([])
  expect(parseSteps('A plan in words only. Step 1 of 3: nothing.')).toEqual([])
  expect(parseSteps('STEP: Only one')).toEqual(['Only one'])
  expect(parseSteps('STEP: First\nSTEP: Second')).toEqual(['First', 'Second'])
  expect(parseSteps(REPORT)).toEqual(['Find how scores are stored', 'Write the CSV export', 'Add a test for it'])
})

test('a line may be a bullet, in any case, with spaces; the word must be at the start of the line', () => {
  expect(parseSteps('- STEP: One\n* step:   Two  \n   Step: Three\nNOT A STEP: Four\nmid STEP: Five')).toEqual(['One', 'Two', 'Three'])
})

test('nine or more lines are all kept, up to what a plan holds (40)', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `STEP: Step number ${i + 1}`).join('\n')
  expect(parseSteps(lines(9))).toHaveLength(9)
  expect(parseSteps(lines(12))).toHaveLength(12)
  expect(parseSteps(lines(45))).toHaveLength(40)
})

test('junk is cleaned like a step the plan tool is given: control characters, comment marks and long text cut at a word with no mark; empty lines are dropped', () => {
  const long = 'x'.repeat(300)
  expect(parseSteps(`STEP: A\u0000B‮C <!-- s9 --> D\nSTEP:    \nSTEP: ${long}\nSTEP: --> E`)).toEqual(['ABC s9 D', 'x'.repeat(120), 'E'])
})

test('a step that looks like a key or a token is left out, and the others stay', () => {
  const token = 'sk-abcdefghijklmnopqrstuvwxyz0123'
  expect(parseSteps(`STEP: Use the key ${token}\nSTEP: Write the export\nSTEP: ghp_${'a1B2'.repeat(6)}`)).toEqual(['Write the export'])
})

// ---- What a hand-back does ----

test('two or more steps and no goal in hand make the plan exactly as start would, with no summary, recorded as the Planner\'s', async () => {
  const { io, d, mine } = office()
  await receiveDraft(io, TITLE, REPORT)
  expect(mine.state?.title).toBe(TITLE)
  expect(mine.state?.summary).toBeUndefined()
  expect(mine.state?.steps.map(s => s.text)).toEqual(['Find how scores are stored', 'Write the CSV export', 'Add a test for it'])
  expect(d.writes).toHaveLength(1)
  expect(mine.started).toEqual([{ title: TITLE, steps: 3, by: 'planner' }])
  expect(mine.draft).toBeNull()
})

test('Clawd\'s own start is recorded as his', async () => {
  const { io, mine } = office()
  await planTool(io, undefined, { op: 'start', goal: 'Mine', steps: ['a', 'b'] })
  expect(mine.started).toEqual([{ title: 'Mine', steps: 2, by: 'clawd' }])
})

test('one step, or no steps, is not made into a plan: one is kept as a draft, none is nothing', async () => {
  const { io, d, mine } = office()
  await receiveDraft(io, TITLE, 'STEP: Just this')
  expect(mine.state).toBeNull()
  expect(d.writes).toHaveLength(0)
  expect(mine.draft).toMatchObject({ title: TITLE, steps: ['Just this'], isTold: false })
  const none = office()
  await receiveDraft(none.io, TITLE, 'No lines here.')
  expect(none.mine.draft).toBeNull()
  expect(none.mine.state).toBeNull()
})

test('with a goal in hand the steps wait as a draft, no file is written, and Clawd is told once, in the answer of his next plan call', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  await planTool(io, undefined, { op: 'done', id: 's1' }) // loads the goal in hand
  const writes = d.writes.length
  await receiveDraft(io, TITLE, REPORT)
  expect(d.writes).toHaveLength(writes)
  expect(mine.started).toEqual([])
  expect(mine.draft).toMatchObject({ title: TITLE, isTold: false })
  const first = await planTool(io, undefined, { op: 'reopen', id: 's1' })
  expect(first).toHaveProperty('result')
  expect((first as { result: string }).result).toContain('A plan from the Planner is waiting: Export scores, 3 steps.')
  const second = await planTool(io, undefined, { op: 'done', id: 's1' })
  expect((second as { result: string }).result).not.toContain('waiting')
  expect(mine.draft).toMatchObject({ isTold: true })
})

test('the note rides on a refused call too, so it is not lost', async () => {
  const { io } = office({ [FILE]: BASE })
  await planTool(io, undefined, { op: 'done', id: 's1' })
  await receiveDraft(io, TITLE, REPORT)
  const refused = await planTool(io, undefined, { op: 'drop', id: 's99' })
  expect((refused as { deny: string }).deny).toContain('A plan from the Planner is waiting')
})

test('a newer draft replaces the older, and is told again', async () => {
  const { io, mine } = office({ [FILE]: BASE })
  await planTool(io, undefined, { op: 'done', id: 's1' })
  await receiveDraft(io, 'Old plan', 'STEP: a\nSTEP: b')
  await planTool(io, undefined, { op: 'reopen', id: 's1' })
  expect(mine.draft?.isTold).toBe(true)
  await receiveDraft(io, 'New plan', 'STEP: c\nSTEP: d\nSTEP: e')
  expect(mine.draft).toMatchObject({ title: 'New plan', steps: ['c', 'd', 'e'], isTold: false })
  expect(draftNote(mine.draft!)).toBe('A plan from the Planner is waiting: New plan, 3 steps. Its STEP lines are in the Planner\'s report. Start it with a plain start once the current goal is finished.')
})

test('Clawd starting a plan uses the draft up, and finishing the goal first leaves it waiting for that start', async () => {
  const { io, mine } = office({ [FILE]: BASE })
  await planTool(io, undefined, { op: 'done', id: 's1' })
  await receiveDraft(io, TITLE, REPORT)
  await planTool(io, undefined, { op: 'finish', outcome: 'done' })
  expect(mine.draft).not.toBeNull()
  await planTool(io, undefined, { op: 'start', goal: TITLE, steps: ['x', 'y'] })
  expect(mine.draft).toBeNull()
})

test('with Clawd off nothing is made and nothing is kept', async () => {
  const { io, d, mine } = office({}, false)
  await receiveDraft(io, TITLE, REPORT)
  expect(mine.state).toBeNull()
  expect(mine.draft).toBeNull()
  expect(d.writes).toHaveLength(0)
  expect(d.calls).toEqual([])
})

test('a title that is empty or looks like a key makes nothing', async () => {
  const { io, mine } = office()
  await receiveDraft(io, '   ', REPORT)
  await receiveDraft(io, 'sk-abcdefghijklmnopqrstuvwxyz0123', REPORT)
  expect(mine.state).toBeNull()
  expect(mine.draft).toBeNull()
})

test('a draft read back from the store is checked: the right folder, a title, and some steps', () => {
  expect(draftKey('/repo')).toBe('planDraft:/repo')
  const ok = { folder: '/repo', title: 'T', steps: ['a'], at: 5, isTold: true }
  expect(draftFrom(ok, '/repo')).toEqual(ok)
  expect(draftFrom({ ...ok, folder: '/other' }, '/repo')).toBeNull()
  for (const bad of [null, undefined, 'x', 7, {}, { ...ok, title: '' }, { ...ok, steps: [] }, { ...ok, steps: [1, 2] }]) expect(draftFrom(bad, '/repo')).toBeNull()
})
