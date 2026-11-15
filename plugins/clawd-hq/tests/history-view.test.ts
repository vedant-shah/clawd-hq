import { expect, test } from 'claude-code/testing'
import type { Employee, PlanState } from '../types'
import { goalEndRecord, runTokens } from '../hooks/history'
import type { GoalEndRecord, HistoryRecord, RunRecord } from '../hooks/history'
import { HISTORY_FOLD, historyLayout, prepared, resumePrompt, safeHistoryLayout } from '../hooks/history-view'
import type { HistoryInput } from '../hooks/history-view'

// The History tab's content (pure): the tokens a goal line counts, which runs are Other work, when Resume shows, the layout kept while the
// records are the same, and a record that breaks the layout falling back to the empty tab.

const HOUR = 3_600_000
const NOW = 100 * HOUR
const run = (id: string, startedAt: number, over: Partial<RunRecord> = {}): RunRecord => ({
  v: 1, at: startedAt + 60_000, kind: 'run', session: 'old', run: id, type: 'clawd-hq:core-researcher', name: 'Researcher', task: `Task of ${id}`,
  startedAt, endedAt: startedAt + 60_000, outcome: 'done', endedBy: 'signal', tools: 3, tokens: { inPeak: 0, out: 0 }, choices: 0, questions: 0, notes: 0, isRetry: false, ...over,
})
const end = (over: Partial<GoalEndRecord> = {}): GoalEndRecord => ({
  v: 1, at: NOW - HOUR, kind: 'goal_end', session: 'old', goal: 'move-scores', title: 'Move scores', outcome: 'stopped', startedAt: NOW - 3 * HOUR,
  stepsDone: 1, stepsTotal: 2, runs: 2, failedRuns: 1, workMs: 60_000,
  steps: [{ id: 's1', text: 'Plan the move', isDone: true, choices: [], retries: 0 }, { id: 's2', text: 'Copy the scores', isDone: false, choices: [], retries: 0, lastOutcome: 'failed' }],
  ...over,
})
const agent = (id: string, startedAt: number, over: Partial<Employee> = {}): Employee => ({
  id, type: 'clawd-hq:core-builder', description: `Work of ${id}`, name: 'Builder', mood: 'done', tools: 2, startedAt, endedAt: startedAt + 60_000, joinedTick: 0, ...over,
} as Employee)
const PLAN: PlanState = { slug: 'export-scores', title: 'Export scores', steps: [], later: [], startedAt: NOW - HOUR } as PlanState
const input = (records: readonly HistoryRecord[], over: Partial<HistoryInput> = {}): HistoryInput =>
  ({ records, staff: [], sessionStart: NOW - 2 * HOUR, plan: null, isOn: true, folds: [], ...over })
const otherIds = (layout: ReturnType<typeof historyLayout>) => layout.other.lines.map(line => line.id)

// ---- Tokens (fix 3, fix 11) ----

test('a goal line counts tokens as the cards and People do (peak input plus output, added up), not the true sums kept in the file', () => {
  const runs = [
    run('a', NOW - 2 * HOUR, { goal: 'move-scores', tokens: { inPeak: 20_000, out: 2_000, in: 90_000, cached: 70_000, cacheWrite: 1_000 } }),
    run('b', NOW - 2 * HOUR + 1, { goal: 'move-scores', tokens: { inPeak: 30_000, out: 3_000, in: 140_000, cached: 100_000, cacheWrite: 0 } }),
  ]
  const people = runs.reduce((n, r) => n + runTokens(r), 0)
  expect(people).toBe(55_000)
  // An older goal_end, written before it kept its tokens: added up from its runs, as every tab counts them.
  const [line] = historyLayout(input([...runs, end()])).goals
  expect(line!.stats).toContain('55K tokens')
  expect(line!.stats).not.toMatch(/23[0-9]K|2[0-9][0-9]K/)
  // The true sums stay on the run records.
  expect(runs.map(r => r.tokens.in)).toEqual([90_000, 140_000])
})

test('a goal_end keeps the goal\'s token estimate when it is written, and the goal line reads it from there over its runs', () => {
  const runs = [run('a', NOW - 2 * HOUR, { goal: 'move-scores', tokens: { inPeak: 20_000, out: 2_000, in: 90_000, cached: 70_000, cacheWrite: 0 } })]
  const written = goalEndRecord({ at: NOW - HOUR, session: 'old', goal: 'move-scores' }, { title: 'Move scores', outcome: 'done', startedAt: NOW - 3 * HOUR, steps: [], runs })
  expect(written.tokens).toBe(22_000)
  // Its runs' records may be gone (an older file past the read): the figure on the goal_end stands.
  const [line] = historyLayout(input([end({ tokens: 41_000 })])).goals
  expect(line!.stats).toContain('41K tokens')
})

// ---- Other work: which runs (fix 4) ----

test('a resumed agent\'s earlier run, failed in an earlier session, still shows beside the run it finished this session', () => {
  const earlier = run('a1', NOW - 5 * HOUR, { outcome: 'failed' })
  const layout = historyLayout(input([earlier], { staff: [agent('a1', NOW - HOUR)] }))
  expect(otherIds(layout)).toEqual([`a1@${NOW - HOUR}`, `a1@${NOW - 5 * HOUR}`])
  expect(layout.other.lines.map(l => l.outcome)).toEqual(['done', 'failed'])
})

test('a run of this session already written to the history is one line, not two; one from before a /clear is read from the history', () => {
  const now = agent('a2', NOW - HOUR)
  const written = run('a2', NOW - HOUR)
  const beforeClear = run('a3', NOW - 10 * HOUR)
  const layout = historyLayout(input([written, beforeClear], { staff: [now, agent('a3', NOW - 10 * HOUR)], sessionStart: NOW - 2 * HOUR }))
  expect(otherIds(layout)).toEqual([`a2@${NOW - HOUR}`, `a3@${NOW - 10 * HOUR}`])
})

test('an agent at work now is on the floor: none of its earlier runs is Other work', () => {
  const layout = historyLayout(input([run('a4', NOW - 5 * HOUR, { outcome: 'failed' })], { staff: [agent('a4', NOW - 60_000, { mood: 'working', endedAt: undefined })] }))
  expect(otherIds(layout)).toEqual([])
})

// ---- Resume (fix 7) ----

const resumeOf = (layout: ReturnType<typeof historyLayout>) => layout.goals[0]?.resume

test('a set-aside goal with an unfinished step, Clawd on and no goal in hand: Resume', () => {
  expect(resumeOf(historyLayout(input([end()])))).toMatch(/Copy the scores/)
})

test('with Clawd off the finished goals still show, but Resume is hidden', () => {
  const layout = historyLayout(input([end()], { isOn: false }))
  expect(layout.goals.map(g => g.title)).toEqual(['Move scores'])
  expect(resumeOf(layout)).toBeUndefined()
})

test('while a goal is in hand Resume is hidden (one goal at a time)', () => {
  expect(resumeOf(historyLayout(input([end()], { plan: PLAN })))).toBeUndefined()
})

test('a set-aside goal with no unfinished step has no Resume', () => {
  const allDone = end({ steps: [{ id: 's1', text: 'Plan the move', isDone: true, choices: [], retries: 0 }] })
  expect(resumeOf(historyLayout(input([allDone])))).toBeUndefined()
})

test('Resume asks with the clean step words only, and never more than 2,000 characters, cut at a whole line', () => {
  const steps = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, text: `${'Step words '.repeat(10)}${i}`, isDone: false, choices: [], retries: 0 }))
  const prompt = resumePrompt(end({ steps }))
  expect(prompt.length).toBeLessThanOrEqual(2_000)
  expect(prompt.split('\n').every(line => line.startsWith('Please start') || /^- Step words .* \d+$/.test(line))).toBe(true)
})

// ---- Kept while the records are the same (fix 5) ----

test('what the tab derives from the records is made once per list, and again for a new list', () => {
  const records = [run('a', NOW - HOUR), end()]
  const first = prepared(records)
  expect(prepared(records)).toBe(first)
  expect(prepared([...records])).not.toBe(first)
})

// ---- A record that breaks the layout (fix 2) ----

test('a record no check foresaw cannot break the tab: the empty state, the goal in hand still shown, and a word about why', () => {
  const broken = { ...end(), steps: null } as unknown as GoalEndRecord
  const why: string[] = []
  const layout = safeHistoryLayout(input([broken], { plan: { ...PLAN, steps: [{ id: 's1', text: 'A', isDone: true, choices: [] }] } as PlanState }), w => why.push(w))
  expect(layout.isEmpty).toBe(true)
  expect(layout.goals).toEqual([])
  expect(layout.inProgress).toEqual({ title: 'Export scores', done: 1, total: 1 })
  expect(why).toHaveLength(1)
  // A layout that works says nothing.
  safeHistoryLayout(input([end()]), w => why.push(w))
  expect(why).toHaveLength(1)
  expect(HISTORY_FOLD.other).toBe('history|other')
})
