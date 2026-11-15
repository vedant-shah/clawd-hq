// The goal and the History the tour draws (pure): a stand-in plan and a stand-in finished goal, built from the tour's start time.
// Drawn through the panel's data (hooks/demo-cast.ts `onStage`); nothing here is read from or written to a plan file or a history file.
import type { PlanState } from '../types'
import { HISTORY_V } from './history'
import type { GoalEndRecord } from './history'
import { HISTORY_FOLD } from './history-view'
import { goalKey } from './plan-live'
import { FOLD } from './plan-view'

const SLUG = 'export-scores'
const HOUR = 3_600_000
const MINUTE = 60_000

/** The plan's steps: a stand-in is hired for the first three (hooks/demo-script.ts); the last is still waiting. */
const STEPS: ReadonlyArray<readonly [id: string, text: string]> = [
  ['s1', 'Find how exports work now'],
  ['s2', 'Add the export button'],
  ['s3', 'Style the export button'],
  ['s4', 'Write the release note'],
]

/** The tour's goal, begun at `at`, with the steps in `done` ticked. */
export function demoPlan(at: number, done: readonly string[]): PlanState {
  return {
    slug: SLUG, title: 'Export the scores', summary: 'People can download the scores as a file.', later: [], startedAt: at,
    steps: STEPS.map(([id, text]) => ({ id, text, isDone: done.includes(id), choices: [] })),
  }
}

/** The key the plan's runs are linked by, and the keys of the folds the tour opens. */
export const demoGoalKey = (at: number) => goalKey(demoPlan(at, []))
export const demoDoneFold = (at: number) => FOLD.done(demoGoalKey(at))

const ENDED_SLUG = 'fix-the-login-page'
const ENDED_AT = (at: number) => at - 2 * HOUR

/** The fold of the finished goal on the History tab. */
export const demoGoalFold = (at: number) => HISTORY_FOLD.goal(ENDED_SLUG, ENDED_AT(at))

/** The one goal that ended before the tour, as the History tab reads it from its records. */
export function demoHistory(at: number): GoalEndRecord[] {
  const ended = ENDED_AT(at)
  const step = (id: string, text: string, retries = 0) => ({ id, text, isDone: true, choices: [], retries })
  return [{
    v: HISTORY_V, kind: 'goal_end', at: ended, session: 'demo', goal: ENDED_SLUG, title: 'Fix the login page', outcome: 'done',
    startedAt: ended - 38 * MINUTE, stepsDone: 3, stepsTotal: 3, runs: 5, failedRuns: 1, workMs: 38 * MINUTE, tokens: 210_000,
    steps: [step('s1', 'Find why the login fails'), step('s2', 'Fix the form check', 1), step('s3', 'Add a test for it')],
  }]
}
