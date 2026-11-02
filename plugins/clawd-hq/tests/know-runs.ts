// Fake runs of one specialist that Clawd sent back to work, as the session reads its rows back. Each case is one the
// check got wrong when Clawd's messages of earlier runs were left out of the record and only the first brief was shown.
import type { SessionMessage } from 'claude-code'
import { BRIEF_NOTE } from '../hooks/desk'

type Use = SessionMessage['toolUses'][number]

const sent = (text: string): SessionMessage => ({ role: 'user', text, toolUses: [] })
const said = (text: string, uses: Use[] = []): SessionMessage => ({ role: 'assistant', text, toolUses: uses })
const edit = (id: string, file: string): Use => ({ tool_use_id: id, tool: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' }, text: 'ok' })
const bash = (id: string, command: string, out: string): Use => ({ tool_use_id: id, tool: 'Bash', input: { command }, text: out })

/** Case A: two edits, then three more that Clawd asked for later, then a last run of tests. */
export const CASE_A = {
  brief: 'Make two edits: the title in a.ts and the date in b.ts.',
  later: 'Three more edits: c.ts, d.ts and e.ts.',
  runs: [
    [sent(`Make two edits: the title in a.ts and the date in b.ts.${BRIEF_NOTE}`), said('Editing.', [edit('a1', 'a.ts'), edit('a2', 'b.ts')]), said('Made both edits.')],
    [sent('Three more edits: c.ts, d.ts and e.ts.'), said('', [edit('a3', 'c.ts'), edit('a4', 'd.ts'), edit('a5', 'e.ts')]), said('Made the three edits.')],
    [sent('Now run the tests and report.'), said('', [bash('a6', 'npm test', '12 pass')]), said('All 12 tests pass.')],
  ],
} as const

/** Case B: the brief forbids step 2; Clawd then says go ahead with it, and later to continue it. */
export const CASE_B = {
  brief: 'Plan the move in three steps. Do step 1 only; do not do step 2.',
  goAhead: 'Step 2 decisions. Go ahead.',
  runs: [
    [sent('Plan the move in three steps. Do step 1 only; do not do step 2.'), said('', [edit('b1', 'step1.ts')]), said('Step 1 done.')],
    [sent('Step 2 decisions. Go ahead.'), said('', [edit('b2', 'step2.ts')]), said('Started step 2.')],
    [sent('continue step 2'), said('', [edit('b3', 'step2-more.ts')]), said('Step 2 done.')],
  ],
} as const

/**
 * Case C: the brief says keep the payroll card; Clawd's message to remove it arrives mid-run. Here it is a user row of
 * the run, as if the session listed queued messages; whether it does is not known (the engine's types do not say).
 */
export const CASE_C = {
  later: 'Remove the payroll card after all.',
  runs: [
    [sent('Tidy the dashboard. Keep the payroll card.'), said('', [edit('c1', 'dashboard.tsx')]), sent('Remove the payroll card after all.'), said('', [edit('c2', 'dashboard.tsx')]), said('Tidied; payroll card removed.')],
    [sent('Check the layout once more.'), said('', [{ tool_use_id: 'c3', tool: 'Read', input: { file_path: 'dashboard.tsx' }, text: 'x' }]), said('The layout is fine.')],
  ],
} as const

/** Case D: a resumed run whose own test output fails, while its report says all tests pass. */
export const CASE_D = {
  failing: '786 pass, 602 fail',
  report: 'All tests pass.',
  runs: [
    [sent('Fix the flaky tests.'), said('', [edit('d1', 'flaky.test.ts')]), said('Fixed.')],
    [sent('Run the whole suite now.'), said('', [bash('d2', 'npm test', 'Ran 1388 tests\n786 pass, 602 fail')]), said('All tests pass.')],
  ],
} as const
