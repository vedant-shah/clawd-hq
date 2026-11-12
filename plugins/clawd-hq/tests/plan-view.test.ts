import { expect, test } from 'claude-code/testing'
import { FOLD, SHOWN_AGENTS, SHOWN_STEPS, agentWords, askPrompt, doneInfo, failureLine, foldsOf, goalOf, laterPrompt, planLayout, retryPrompt, statsLine, stoppedAt, withFold } from '../hooks/plan-view'
import type { Employee, PlanState } from '../types'

// What the Office tab draws of the plan, as plain data: the rows, the words, the prompts.

const KEY = 'export:10'
const emp = (over: Partial<Employee> = {}): Employee => ({ id: 'a1', type: 'general-purpose', description: 'Do it', mood: 'working', tools: 0, startedAt: 1_000, joinedTick: 0, stepId: 's4', planKey: KEY, ...over })
const step = (n: number, over: Record<string, unknown> = {}) => ({ id: `s${n}`, text: `Step ${n}`, isDone: false, choices: [], ...over })
const state = (steps = [step(1, { isDone: true }), step(2, { isDone: true }), step(3, { isDone: true }), step(4), step(5), step(6)]): PlanState => ({ slug: 'export', title: 'Export scores', steps, later: [], startedAt: 10 })
const none: ReadonlySet<string> = new Set()
const workers = (n: number, over: Partial<Employee> = {}) => Array.from({ length: n }, (_, i) => emp({ id: `w${i + 1}`, startedAt: 1_000 + i, ...over }))

test('the folds are named, opened and closed as a new list, in the order they were opened', () => {
  expect(withFold(undefined, FOLD.done(KEY))).toEqual([`${KEY}|done`])
  expect(withFold([`${KEY}|done`, `${KEY}|later`], FOLD.done(KEY))).toEqual([`${KEY}|later`])
  expect(withFold([`${KEY}|done`], FOLD.more(KEY, 's4'))).toEqual([`${KEY}|done`, `${KEY}|more:s4`])
  const open = ['done']
  withFold(open, 'later')
  expect(open).toEqual(['done'])
  expect([...foldsOf({ folds: ['later', 'details:a'] })]).toEqual(['later', 'details:a'])
  expect([...foldsOf({})]).toEqual([])
})

test('a fold is named for its goal: one opened in a goal is not open in the next, and a fold with no goal has its own name', () => {
  expect(FOLD.later('export:10')).not.toBe(FOLD.later('export:99'))
  expect(FOLD.details('export:10', 'p1')).not.toBe(FOLD.details('export:10', 'p2'))
  expect(FOLD.later('')).toBe('|later')
  expect(goalOf({ plan: state() })).toBe(KEY)
  expect(goalOf({ plan: null })).toBe('')
  const more = planLayout(state(), workers(6), new Set([FOLD.more(KEY, 's4')])).steps[0]!
  const other = planLayout(state(), workers(6), new Set([FOLD.more('export:99', 's4')])).steps[0]!
  expect([more.isMoreOpen, other.isMoreOpen]).toEqual([true, false])
})

test('the done steps fold, the first open step is now with its agents, the rest are next, and the counts are right', () => {
  const layout = planLayout(state(), workers(2), none)
  expect(layout).toMatchObject({ title: 'Export scores', done: 3, total: 6, extraSteps: 0, isStepsOpen: false })
  expect(layout.doneSteps.map(s => s.id)).toEqual(['s1', 's2', 's3'])
  // The last finished step in plan order stands alone; only the ones before it are folded.
  expect(layout.lastDone?.id).toBe('s3')
  expect(layout.earlierDone.map(s => s.id)).toEqual(['s1', 's2'])
  expect(layout.steps.map(b => [b.step.id, b.status, b.atWork, b.shown.length, b.hidden])).toEqual([['s4', 'now', 2, 2, 0], ['s5', 'next', 0, 0, 0], ['s6', 'next', 0, 0, 0]])
})

test('six agents on a step: three are drawn, the rest are counted, and the fold shows them all', () => {
  const six = workers(6)
  const [folded] = planLayout(state(), six, none).steps
  expect(folded).toMatchObject({ atWork: 6, hidden: 6 - SHOWN_AGENTS, isMoreOpen: false })
  expect(folded!.shown.map(slot => (slot.kind === 'one' ? slot.one.id : '')).join()).toBe('w1,w2,w3')
  const [open] = planLayout(state(), six, new Set([FOLD.more(KEY, 's4')])).steps
  expect(open).toMatchObject({ atWork: 6, hidden: 0, isMoreOpen: true })
  expect(open!.shown).toHaveLength(6)
})

test('a failed run is listed first and never folded, until the step is rerun well or reopened', () => {
  const failed = emp({ id: 'f1', mood: 'failed', startedAt: 900, endedAt: 1_200, reason: 'no test database' })
  const layout = planLayout(state(), [failed, ...workers(4)], none)
  expect(layout.steps[0]).toMatchObject({ status: 'now', atWork: 4 })
  expect(layout.steps[0]!.failed.map(one => one.id)).toEqual(['f1'])
  // Alone, with nobody working: the step needs attention.
  expect(planLayout(state(), [failed], none).steps[0]).toMatchObject({ status: 'attention', atWork: 0 })
  // A later run that ended well covers it; a reopening forgets it.
  expect(planLayout(state(), [failed, emp({ id: 'ok', mood: 'done', startedAt: 1_300, endedAt: 1_400 })], none).steps[0]!.failed).toEqual([])
  const reopened = state([step(4, { reopenedAt: 1_500 })])
  expect(planLayout(reopened, [failed], none).steps[0]!.failed).toEqual([])
  expect(planLayout(state(), [emp({ mood: 'lost', endedAt: 1_100 })], none).steps[0]!.failed).toHaveLength(1)
})

test('only the latest blocking failure gets a card; the others are counted as "N earlier failed"', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((id, i) => emp({ id, mood: 'failed', startedAt: 100 + i, endedAt: 200 + i * 10, reason: id }))
  const block = planLayout(state(), [a!, b!, c!], none).steps[0]!
  expect(block.failed.map(one => one.id)).toEqual(['c'])
  expect(block.earlierFailed).toBe(2)
  expect(planLayout(state(), [a!], none).steps[0]).toMatchObject({ earlierFailed: 0 })
})

test('a failure that overlapped a later success is still listed, and the step needs attention', () => {
  const failed = emp({ id: 'a', mood: 'failed', startedAt: 0, endedAt: 10 })
  const ok = emp({ id: 'b', mood: 'done', startedAt: 5, endedAt: 20 })
  expect(planLayout(state(), [failed, ok], none).steps[0]).toMatchObject({ status: 'attention', failed: [failed] })
  const rerun = emp({ id: 'c', mood: 'done', startedAt: 11, endedAt: 20 })
  expect(planLayout(state(), [failed, rerun], none).steps[0]).toMatchObject({ status: 'next', failed: [] })
})

test('a pair-up with one member finished is still one block, counting only the member at work', () => {
  const pair = [emp({ id: 'p1', mood: 'done', endedAt: 1_500, pair: { goal: 'Ship it', at: 1_000 } }), emp({ id: 'p2', pair: { goal: 'Ship it', at: 1_000 } })]
  const [block] = planLayout(state(), [...pair, ...workers(2)], none).steps
  expect(block!.shown.map(slot => slot.kind)).toEqual(['pair', 'one', 'one'])
  expect(block!.shown[0]!.kind === 'pair' && block!.shown[0]!.group.members.map(one => one.id)).toEqual(['p1', 'p2'])
  expect(block).toMatchObject({ atWork: 3, hidden: 0 })
  // Both members done: the block is gone.
  const done = pair.map(one => ({ ...one, mood: 'done' as const, endedAt: 1_500 }))
  expect(planLayout(state(), done, none).steps[0]).toMatchObject({ atWork: 0, shown: [] })
})

test('a pair-up member that failed is shown once: in its block while the other works, not also as a failed card', () => {
  const pair = [emp({ id: 'p1', mood: 'failed', endedAt: 1_500, pair: { goal: 'Ship it', at: 1_000 } }), emp({ id: 'p2', pair: { goal: 'Ship it', at: 1_000 } })]
  const [block] = planLayout(state(), pair, none).steps
  expect(block!.failed).toEqual([])
  expect(block!.shown).toHaveLength(1)
})

test('the next steps: three are drawn, the others are counted and shown when their fold is open; a step now is always drawn', () => {
  const many = state([step(1), step(2), step(3), step(4), step(5), step(6), step(7)])
  const folded = planLayout(many, [], none)
  expect(folded.steps.map(b => b.step.id)).toEqual(['s1', 's2', 's3'])
  expect(folded.extraSteps).toBe(7 - SHOWN_STEPS)
  expect(planLayout(many, [], new Set([FOLD.steps(KEY)])).steps).toHaveLength(7)
  const late = planLayout(many, [emp({ stepId: 's7' })], none)
  expect(late.steps.map(b => b.step.id)).toEqual(['s1', 's2', 's3', 's7'])
  expect(late.extraSteps).toBe(3)
})

test('runs of another goal, or linked to nothing, are not under a step: they are at work "also"', () => {
  const staff = [emp({ id: 'mine' }), emp({ id: 'old', planKey: 'export:5' }), emp({ id: 'free', stepId: undefined, planKey: undefined }), emp({ id: 'ondone', stepId: 's1' }), emp({ id: 'gone', mood: 'done' })]
  const layout = planLayout(state(), staff, none)
  expect(layout.steps[0]!.atWork).toBe(1)
  expect(layout.outsiders.map(one => one.id)).toEqual(['old', 'free', 'ondone'])
})

test('a pair-up on a step is one block, and counts as its members', () => {
  const pair = [emp({ id: 'p1', pair: { goal: 'Ship it', at: 1_000 } }), emp({ id: 'p2', pair: { goal: 'Ship it', at: 1_000 } })]
  const [block] = planLayout(state(), [...pair, ...workers(4)], none).steps
  expect(block!.shown.map(slot => slot.kind)).toEqual(['pair', 'one', 'one'])
  expect(block).toMatchObject({ atWork: 6, hidden: 2 })
})

test('an agent states its model, how long and its tokens; a run that ended is timed to its end', () => {
  expect(statsLine(emp({ model: 'claude-sonnet-5-5', startedAt: 0, tokens: 41_000, effort: 'high' }), 120_000)).toBe('Sonnet 5.5 · 2m · 41K')
  expect(statsLine(emp({ startedAt: 0 }), 5_000)).toBe('5s')
  expect(statsLine(emp({ mood: 'failed', startedAt: 0, endedAt: 60_000, tokens: 900 }), 9_999_999)).toBe('1m · 900')
})

test('its words are what it last said, or the sentence for what it does now', () => {
  expect(agentWords(emp({ said: 'Writing the file.' }), 5)).toEqual({ text: 'Writing the file.', isSaid: true })
  expect(agentWords(emp({ activity: 'Reading the code' }), 5)).toEqual({ text: 'Reading the code', isSaid: false })
})

test('a failure reads how long it took and why; the reason is cut to a line; where it stopped comes from its step report', () => {
  const failed = emp({ mood: 'failed', startedAt: 0, endedAt: 60_000, reason: 'there is no test database' })
  expect(failureLine(failed, 70_000)).toBe('Failed after 1m: there is no test database')
  expect(failureLine({ ...failed, reason: undefined }, 70_000)).toBe('Failed after 1m')
  expect(failureLine({ ...failed, reason: 'x '.repeat(100) }, 70_000).length).toBeLessThan(120)
  expect(stoppedAt(emp({ stepDone: 2, stepTotal: 5, stepNote: 'Writing the file' }))).toBe('Stopped at step 2 of 5: Writing the file')
  expect(stoppedAt(emp({ stepDone: 9, stepTotal: 5 }))).toBe('Stopped at step 5 of 5')
  expect(stoppedAt(emp())).toBeUndefined()
})

test('a done step reads who did it, how long and the tokens; several runs read as their count and totals; one done by hand says nothing', () => {
  const label = (one: Employee) => (one.id === 'r1' ? 'Researcher' : 'Builder')
  const done = (id: string, over: Partial<Employee> = {}) => emp({ id, stepId: 's1', mood: 'done', startedAt: 0, endedAt: 120_000, tokens: 18_000, ...over })
  const s1 = step(1, { isDone: true })
  expect(doneInfo(s1, [done('r1')], KEY, label)).toBe('Researcher · 2m · 18K')
  expect(doneInfo(s1, [done('r1'), done('r2'), done('r3', { tokens: undefined })], KEY, label)).toBe('3 agents · 6m · 36K')
  expect(doneInfo(s1, [done('r1', { planKey: 'export:5' }), done('r2', { mood: 'failed' })], KEY, label)).toBe('')
  expect(doneInfo(s1, [], KEY, label)).toBe('')
})

test('the prompts the buttons fill in name the agent and the reason, and say what is asked', () => {
  const failed = emp({ reason: 'There is no test database.' })
  expect(retryPrompt('Tester 5', failed)).toBe('Tester 5 failed: There is no test database. Hire it again once that is fixed.')
  expect(askPrompt('Tester 5', failed)).toBe('Tester 5 failed: There is no test database. What went wrong, and what should we do about it?')
  expect(retryPrompt('Tester 5', emp())).toBe('Tester 5 failed: it did not say why. Hire it again once that is fixed.')
  expect(laterPrompt('Add an XLSX option.')).toBe('You put this off: Add an XLSX option. Do it now.')
})
