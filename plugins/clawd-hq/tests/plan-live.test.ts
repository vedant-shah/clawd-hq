import { expect, test } from 'claude-code/testing'
import { activeStepIds, blockingFailures, clearNew, goalKey, parseCall, planText, stateFrom, statusOf, tickDue, touchedBy, withReopened } from '../hooks/plan-live'
import { parsePlanLine } from '../hooks/pair-up'
import { rowLook } from '../hooks/quiet'
import type { PlanView } from '../hooks/plan'
import type { Employee, PlanState } from '../types'

// The plan as the session holds it (pure): where a step stands, whether a run that ended ticks it, the marks, the text Clawd is answered with.

/** The goal the tests' state is: its plan file's name and when it started. */
const KEY = 'export:10'
const emp = (over: Partial<Employee> = {}): Employee => ({ id: 'a1', type: 'general-purpose', description: 'Do it', mood: 'working', tools: 0, startedAt: 100, joinedTick: 0, stepId: 's2', planKey: KEY, ...over })
const view = (over: Partial<PlanView> = {}): PlanView => ({
  title: 'Export scores',
  steps: [{ id: 's1', text: 'Find how it works', isDone: true, choices: [] }, { id: 's2', text: 'Build it', isDone: false, choices: ['one file'] }, { id: 's3', text: 'Review', isDone: false, choices: [] }],
  later: [{ id: 'l1', text: 'Add XLSX' }], ...over,
})
const state = (over: Partial<PlanState> = {}): PlanState => ({ ...stateFrom(view(), 'export', 10, null, []), ...over })

// ---- Where a step stands ----

test('a step is done when ticked, now while a linked run works, needs attention when its latest run failed or was lost, and otherwise next', () => {
  const [one, two, three] = state().steps
  expect(statusOf(one!, [], KEY)).toBe('done')
  expect(statusOf(two!, [], KEY)).toBe('next')
  expect(statusOf(two!, [emp()], KEY)).toBe('now')
  expect(statusOf(two!, [emp({ mood: 'thinking' })], KEY)).toBe('now')
  expect(statusOf(two!, [emp({ mood: 'failed', endedAt: 200 })], KEY)).toBe('attention')
  expect(statusOf(two!, [emp({ mood: 'lost', endedAt: 200 })], KEY)).toBe('attention')
  expect(statusOf(two!, [emp({ mood: 'done', endedAt: 200 })], KEY)).toBe('next')
  expect(statusOf(two!, [emp({ mood: 'stopped', endedAt: 200 })], KEY)).toBe('next')
  // The latest run decides: a failure that was rerun and is working again is now; a failure after a success is attention.
  expect(statusOf(two!, [emp({ id: 'a', mood: 'failed', startedAt: 100 }), emp({ id: 'b', startedAt: 300 })], KEY)).toBe('now')
  expect(statusOf(two!, [emp({ id: 'a', mood: 'done', startedAt: 100 }), emp({ id: 'b', mood: 'failed', startedAt: 300 })], KEY)).toBe('attention')
  expect(statusOf(three!, [emp()], KEY)).toBe('next')
})

test('the steps with a specialist at work are those linked runs of this goal that are active', () => {
  expect([...activeStepIds([emp(), emp({ id: 'b', stepId: 's3', mood: 'done' }), emp({ id: 'c', stepId: undefined }), emp({ id: 'd', stepId: 's1', mood: 'arriving' })], KEY)].sort()).toEqual(['s1', 's2'])
})

test('a run of another goal never counts for this goal\'s step with the same id', () => {
  const earlier = emp({ id: 'old', planKey: 'export:5' })
  const [, two] = state().steps
  expect(statusOf(two!, [earlier], KEY)).toBe('next')
  expect(statusOf(two!, [emp({ id: 'old', planKey: 'export:5', mood: 'failed', endedAt: 9 })], KEY)).toBe('next')
  expect([...activeStepIds([earlier], KEY)]).toEqual([])
  expect(goalKey({ slug: 'export', startedAt: 10 })).toBe(KEY)
})

// ---- One rule for the failed card, the status and the tick ----

test('a failure that overlapped a later success still blocks: the card shows, the step needs attention, and nothing is ticked', () => {
  const [, two] = state().steps
  const a = emp({ id: 'a', mood: 'failed', startedAt: 0, endedAt: 10 })
  const b = emp({ id: 'b', mood: 'done', startedAt: 5, endedAt: 20 })
  expect(blockingFailures(two!, [a, b]).map(one => one.id)).toEqual(['a'])
  expect(statusOf(two!, [a, b], KEY)).toBe('attention')
  expect(tickDue(state(), [a, b], b)).toBe(false)
})

test('a failure that ended before a later success began is covered: no card, the step is next, and the success ticks it', () => {
  const [, two] = state().steps
  const a = emp({ id: 'a', mood: 'failed', startedAt: 0, endedAt: 10 })
  const b = emp({ id: 'b', mood: 'done', startedAt: 11, endedAt: 20 })
  expect(blockingFailures(two!, [a, b])).toEqual([])
  expect(statusOf(two!, [a, b], KEY)).toBe('next')
  expect(tickDue(state(), [a, b], b)).toBe(true)
})

test('a failure that began before the last reopening is forgotten, by the card, the status and the tick alike; one after it blocks', () => {
  const reopened = withReopened(state(), 's2', 50)
  const [, two] = reopened.steps
  const old = emp({ id: 'old', mood: 'failed', startedAt: 0, endedAt: 10 })
  const run = emp({ id: 'run', mood: 'done', startedAt: 40, endedAt: 70 })
  expect(blockingFailures(two!, [old, run])).toEqual([])
  expect(statusOf(two!, [old], KEY)).toBe('next')
  expect(tickDue(reopened, [old, run], run)).toBe(true)
  const fresh = emp({ id: 'fresh', mood: 'failed', startedAt: 60, endedAt: 80 })
  expect(blockingFailures(two!, [old, fresh]).map(one => one.id)).toEqual(['fresh'])
  expect(statusOf(two!, [old, fresh], KEY)).toBe('attention')
  expect(tickDue(reopened, [old, fresh, run], run)).toBe(false)
})

test('the blocking failures are newest first, and lost contact blocks like a failure', () => {
  const [, two] = state().steps
  const [x, y] = [emp({ id: 'x', mood: 'failed', startedAt: 0, endedAt: 10 }), emp({ id: 'y', mood: 'lost', startedAt: 1, endedAt: 30 })]
  expect(blockingFailures(two!, [x, y]).map(one => one.id)).toEqual(['y', 'x'])
  expect(blockingFailures(two!, [emp({ mood: 'stopped', endedAt: 5 }), emp({ id: 'w' })])).toEqual([])
})

// ---- Whether a run ticks its step ----

test('a run that ended well ticks its open step when nothing else is on it and nothing on it failed', () => {
  const run = emp({ mood: 'done', endedAt: 500 })
  expect(tickDue(state(), [run], run)).toBe(true)
})

test('no tick when the run did not end well, the step is done or not there, or the run is linked to nothing', () => {
  for (const mood of ['failed', 'lost', 'stopped'] as const) { const run = emp({ mood, endedAt: 500 }); expect(tickDue(state(), [run], run)).toBe(false) }
  const done = emp({ stepId: 's1', mood: 'done', endedAt: 500 })
  expect(tickDue(state(), [done], done)).toBe(false)
  const gone = emp({ stepId: 's9', mood: 'done', endedAt: 500 })
  expect(tickDue(state(), [gone], gone)).toBe(false)
  const free = emp({ stepId: undefined, mood: 'done', endedAt: 500 })
  expect(tickDue(state(), [free], free)).toBe(false)
})

test('no tick while another linked run is at work on the step, or when one that overlapped it failed or lost contact', () => {
  const run = emp({ mood: 'done', endedAt: 500 })
  expect(tickDue(state(), [run, emp({ id: 'b' })], run)).toBe(false)
  expect(tickDue(state(), [run, emp({ id: 'b', startedAt: 150, mood: 'failed', endedAt: 400 })], run)).toBe(false)
  expect(tickDue(state(), [run, emp({ id: 'b', startedAt: 150, mood: 'lost', endedAt: 400 })], run)).toBe(false)
  // Another step's runs, and a run that was stopped on purpose, do not count.
  expect(tickDue(state(), [run, emp({ id: 'b', stepId: 's3' }), emp({ id: 'c', mood: 'stopped', endedAt: 400 })], run)).toBe(true)
})

test('a rerun that succeeds ticks the step: a failure that ended before it started no longer blocks', () => {
  const failed = emp({ id: 'first', startedAt: 100, mood: 'failed', endedAt: 200 })
  const rerun = emp({ id: 'second', startedAt: 300, mood: 'done', endedAt: 600 })
  expect(tickDue(state(), [failed, rerun], rerun)).toBe(true)
  // One that was still running when the rerun began, and then failed, does.
  const overlapping = emp({ id: 'third', startedAt: 250, mood: 'failed', endedAt: 400 })
  expect(tickDue(state(), [overlapping, rerun], rerun)).toBe(false)
})

test('a failure from before the step was last reopened no longer counts; a run that ended before the reopening ticks nothing', () => {
  const run = emp({ id: 'new', startedAt: 600, mood: 'done', endedAt: 700 })
  const old = emp({ id: 'old', startedAt: 100, mood: 'failed', endedAt: 650 })
  const reopened = withReopened(state(), 's2', 500)
  expect(tickDue(state(), [old, run], run)).toBe(false)
  expect(tickDue(reopened, [old, run], run)).toBe(true) // it began before the reopening: it is no run since
  const since = emp({ id: 'since', startedAt: 550, mood: 'failed', endedAt: 650 })
  expect(tickDue(reopened, [since, run], run)).toBe(false)
  const late = emp({ id: 'late', startedAt: 100, mood: 'done', endedAt: 300 })
  expect(tickDue(reopened, [late], late)).toBe(false)
})

test('a run from another goal ticks nothing, and counts for nothing against this goal\'s step', () => {
  const old = emp({ id: 'old', planKey: 'export:5', mood: 'done', endedAt: 500 })
  expect(tickDue(state(), [old], old)).toBe(false)
  const run = emp({ mood: 'done', endedAt: 500 })
  const failed = emp({ id: 'f', planKey: 'export:5', mood: 'failed', endedAt: 400 })
  const working = emp({ id: 'w', planKey: 'export:5' })
  expect(tickDue(state(), [run, failed, working], run)).toBe(true)
})

// ---- The state ----

test('the state is built from the file\'s view: no mark on a fresh load, marks on what is new, and reopenings and marks kept', () => {
  const loaded = stateFrom(view(), 'export', 10, null, [])
  expect(loaded.steps.some(s => s.isNew)).toBe(false)
  expect(loaded).toMatchObject({ slug: 'export', title: 'Export scores', startedAt: 10, later: [{ id: 'l1', text: 'Add XLSX' }] })
  const grown = view({ steps: [...view().steps, { id: 's4', text: 'Docs', isDone: false, choices: [] }] })
  const next = stateFrom(grown, 'export', 99, withReopened(loaded, 's2', 55), ['s1'])
  expect(next.steps.map(s => [s.id, s.isNew === true, s.reopenedAt])).toEqual([['s1', true, undefined], ['s2', false, 55], ['s3', false, undefined], ['s4', true, undefined]])
  expect(next.startedAt).toBe(10)
  // A different goal starts its own.
  expect(stateFrom(grown, 'other', 99, loaded, []).startedAt).toBe(99)
})

test('an operation marks the steps it added or changed: a start all, done and reopen the one that changed, a move the one moved', () => {
  const prev = state()
  expect(touchedBy(null, view(), { op: 'start' })).toEqual(['s1', 's2', 's3'])
  expect(touchedBy(prev, view({ steps: view().steps.map(s => (s.id === 's2' ? { ...s, isDone: true } : s)) }), { op: 'done', id: 's2' })).toEqual(['s2'])
  expect(touchedBy(prev, view(), { op: 'done', id: 's1' })).toEqual([])
  expect(touchedBy(prev, view({ steps: [...view().steps].reverse() }), { op: 'move', id: 's3' })).toEqual(['s3'])
  expect(touchedBy(prev, view(), { op: 'move', id: 's3', after: 's2' })).toEqual([])
  expect(touchedBy(prev, view(), { op: 'later', text: 'x' })).toEqual([])
})

test('the marks are cleared, and a state without any is the very same state', () => {
  const marked = stateFrom(view(), 'export', 10, null, ['s1', 's3'])
  expect(clearNew(marked).steps.some(s => s.isNew)).toBe(false)
  const plain = state()
  expect(clearNew(plain)).toBe(plain)
})

// ---- The text Clawd is answered with ----

test('the answer names the goal, the count, each step with its id and where it stands, and the Later items', () => {
  const run = emp({ stepId: 's2' })
  expect(planText(state(), [run]).split('\n')).toEqual([
    'Plan: Export scores (1 of 3 done)',
    's1 done      Find how it works',
    's2 now       Build it',
    's3 next      Review',
    'l1 later     Add XLSX',
  ])
  expect(planText(state(), [emp({ mood: 'failed', endedAt: 5 })])).toContain('s2 attention Build it')
})

// ---- The tool's input ----

test('a call is read from the input: each op with its fields, ids in lower case, and a plain sentence for what is missing', () => {
  expect(parseCall({ op: 'start', goal: 'G', steps: ['a', 'b', 3] })).toEqual({ call: { kind: 'start', goal: 'G', steps: ['a', 'b'] } })
  expect(parseCall({ op: 'add', text: 'x', after: 'S2' })).toEqual({ call: { kind: 'op', op: { op: 'add', text: 'x', after: 's2' } } })
  expect(parseCall({ op: 'add', text: 'x', after: '' })).toEqual({ call: { kind: 'op', op: { op: 'add', text: 'x' } } })
  expect(parseCall({ op: 'move', id: ' s3 ' })).toEqual({ call: { kind: 'op', op: { op: 'move', id: 's3' } } })
  expect(parseCall({ op: 'split', id: 's1', steps: ['a', 'b'] })).toEqual({ call: { kind: 'op', op: { op: 'split', id: 's1', steps: ['a', 'b'] } } })
  expect(parseCall({ op: 'later', text: 'x' })).toEqual({ call: { kind: 'op', op: { op: 'later', text: 'x' } } })
  for (const op of ['drop', 'done', 'reopen', 'move', 'split']) expect(parseCall({ op })).toEqual({ error: 'Give the id of the step, such as s2.' })
  expect(parseCall({ op: 'finish', outcome: 'done' })).toEqual({ call: { kind: 'finish', outcome: 'done' } })
  expect(parseCall({ op: 'finish' })).toMatchObject({ error: expect.stringContaining('outcome') })
  expect(parseCall({ op: 'finish', outcome: 'maybe' })).toMatchObject({ error: expect.stringContaining('outcome') })
})

test('an op the tool does not have is refused, and the office\'s own decide and forget ops cannot be asked for', () => {
  for (const op of ['explode', 'decide', 'forget', 'park', '', undefined, 5]) expect(parseCall({ op, id: 's1', choices: ['x'] })).toMatchObject({ error: expect.stringContaining('The op must be one of') })
})

// ---- The PLAN line ----

test('a PLAN line gives the step id and comes off the brief; any case, leading space, closing mark are all fine', () => {
  expect(parsePlanLine('PLAN: s2\nYou are the tester.')).toEqual({ stepId: 's2', prompt: 'You are the tester.' })
  expect(parsePlanLine('  plan:   S12  \r\nGo.')).toEqual({ stepId: 's12', prompt: 'Go.' })
  expect(parsePlanLine('PLAN: s2.\nGo.')).toEqual({ stepId: 's2', prompt: 'Go.' })
  expect(parsePlanLine('PLAN: s2')).toEqual({ stepId: 's2', prompt: '' })
  expect(parsePlanLine('PLAN: s123456\nGo.')).toEqual({ stepId: 's123456', prompt: 'Go.' })
})

test('words after the step id stay as the first line of the brief', () => {
  expect(parsePlanLine('PLAN: s2 build the tests\nGo.')).toEqual({ stepId: 's2', prompt: 'build the tests\nGo.' })
  expect(parsePlanLine('PLAN: s2: build the tests\r\nGo.')).toEqual({ stepId: 's2', prompt: 'build the tests\r\nGo.' })
  expect(parsePlanLine('PLAN: s2 build the tests')).toEqual({ stepId: 's2', prompt: 'build the tests' })
})

test('only a real step id makes a plan line: any other "Plan:" line is the brief\'s own words, left exactly as it was', () => {
  for (const prompt of [
    'Plan: update the docs\nThen go.', 'PLAN: s\nGo.', 'PLAN: s2abc\nGo.', 'PLAN: s1234567\nGo.', 'PLAN: step2\nGo.', 'PLAN: S-2\nGo.', 'PLAN: 2\nGo.', 'PLAN: s2,build\nGo.',
    'PLAN: the s2 step\nGo.',
  ]) expect(parsePlanLine(prompt)).toEqual({ prompt })
})

test('a brief without a PLAN line, or with an empty one, or with a mention later in the brief, is left exactly as it was', () => {
  for (const prompt of ['Review the diff.', 'PLAN:   \nReview.', 'PLAN-DRAFT: Export\nPlan it.', 'Review.\nPLAN: s2', 'The PLAN: s2 is next', '']) expect(parsePlanLine(prompt)).toEqual({ prompt })
})

// ---- In the quiet chat ----

test('the plan tool\'s calls are dimmed like the other bookkeeping calls, and shown when they errored', () => {
  const tool = 'mcp__clawd-hq__plan'
  expect(rowLook({ tool, input: { op: 'done', id: 's1' }, isErrored: false }, [])).toBe('dim')
  expect(rowLook({ tool, isErrored: true }, [])).toBe('show')
  expect(rowLook({ tool: 'mcp__other__plan', isErrored: false }, [])).toBe('show')
})
