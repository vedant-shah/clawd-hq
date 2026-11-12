import { expect, test } from 'claude-code/testing'
import { DENY_OFF, DENY_SPECIALIST, PLAN_DEBUG_KEY, clearNewMarks, linkStep, loadPlan, planTool, settleRun, withPlanNote } from '../hooks/plan-run'
import type { GoalEnd, PlanRunIo } from '../hooks/plan-run'
import { goalKey, stateFrom, withReopened } from '../hooks/plan-live'
import type { Employee, PlanState } from '../types'
import { BASE, DIR, FILE, ROOT, disk } from './plan-disk'

// The plan at work, on a project held in memory and a state kept in a variable: the tool's answers, loading, linking and ticking.

/** The goal of a plan loaded from the fake disk: its file's name and the file's modified time (0 there). */
const KEY = 'fix-login:0'
const emp = (over: Partial<Employee> = {}): Employee => ({ id: 'a1', type: 'general-purpose', description: 'Do it', mood: 'working', tools: 0, startedAt: 100, joinedTick: 0, planKey: KEY, ...over })

function office(files: Record<string, string> = {}, isOn = true) {
  const d = disk(files)
  const mine = { state: null as PlanState | null, staff: [] as Employee[], isOn, later: [] as string[][], ended: [] as GoalEnd[], keepFails: false, seamFails: false, at: 1_000, setDelays: [] as number[], getFails: false }
  const io: PlanRunIo = {
    isOn: () => mine.isOn, root: () => ROOT, files: d.io, now: async () => mine.at,
    get: async () => { if (mine.getFails) throw new Error('the state is shut'); return mine.state },
    // A write that is slow lands late: what is set in the wrong order shows.
    set: async fn => { for (let i = mine.setDelays.shift() ?? 0; i > 0; i -= 1) await Promise.resolve(); mine.state = fn(mine.state); return mine.state },
    staff: async () => mine.staff,
    keepLater: async texts => { if (mine.keepFails) throw new Error('the list refused'); mine.later.push(texts) },
    goalEnded: async end => { if (mine.seamFails) throw new Error('the record refused'); mine.ended.push(end) },
  }
  return { io, d, mine }
}
const call = (io: PlanRunIo, input: Record<string, unknown>, agentId?: string) => planTool(io, agentId, input)
const result = (a: { result?: string; deny?: string }) => a.result ?? `DENIED: ${a.deny}`
const LATER = `${BASE}\n## Later\n\n- [ ] Put off  <!-- l1 -->\n- [x] Done later  <!-- l2 -->\n`

// ---- Who may ask ----

test('a specialist\'s call is refused with a sentence for it, and touches nothing', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  expect(await call(io, { op: 'done', id: 's1' }, 'agent-7')).toEqual({ deny: DENY_SPECIALIST })
  expect(d.calls).toEqual([])
  expect(mine.state).toBeNull()
})

test('with Clawd off the tool is refused, and nothing is read', async () => {
  const { io, d } = office({ [FILE]: BASE }, false)
  expect(await call(io, { op: 'start', goal: 'G', steps: ['a'] })).toEqual({ deny: DENY_OFF })
  expect(await call(io, { op: 'done', id: 's1' })).toEqual({ deny: DENY_OFF })
  expect(d.calls).toEqual([])
})

test('a call the tool cannot read is refused with a plain sentence and changes nothing', async () => {
  const { io, d } = office({ [FILE]: BASE })
  expect(await call(io, { op: 'explode' })).toMatchObject({ deny: expect.stringContaining('The op must be one of') })
  expect(await call(io, { op: 'drop' })).toEqual({ deny: 'Give the id of the step, such as s2.' })
  expect(d.writes).toHaveLength(0)
})

// ---- Starting, changing, finishing ----

test('start makes the file, holds the goal and answers with the plan and each step\'s id; every step is marked new', async () => {
  const { io, d, mine } = office()
  const a = await call(io, { op: 'start', goal: 'Fix login', steps: ['Find the bug', 'Fix it'] })
  expect(result(a)).toBe('Plan: Fix login (0 of 2 done)\ns1 next      Find the bug\ns2 next      Fix it')
  expect(d.held.get(FILE)).toContain('- [ ] Find the bug  <!-- s1 -->')
  expect(mine.state).toMatchObject({ slug: 'fix-login', title: 'Fix login', startedAt: 1_000, steps: [{ id: 's1', isNew: true }, { id: 's2', isNew: true }] })
})

test('one goal only: a second start is refused while one is in hand, and while a plan file is there that this session has not loaded', async () => {
  const { io, mine } = office()
  await call(io, { op: 'start', goal: 'First', steps: ['a'] })
  const second = await call(io, { op: 'start', goal: 'Second', steps: ['b'] })
  expect(second).toMatchObject({ deny: expect.stringContaining('finish the current goal first (done or stopped)') })
  mine.state = null
  expect(await call(io, { op: 'start', goal: 'Third', steps: ['c'] })).toMatchObject({ deny: expect.stringContaining('finish the current goal first') })
})

test('two starts at the same moment make one plan', async () => {
  const { io, d } = office()
  const both = await Promise.all([call(io, { op: 'start', goal: 'First', steps: ['a'] }), call(io, { op: 'start', goal: 'Second', steps: ['b'] })])
  expect(both.filter(a => 'result' in a)).toHaveLength(1)
  expect(d.writes).toHaveLength(1)
})

test('with no goal, an operation is refused and says how to start one', async () => {
  const { io } = office()
  expect(await call(io, { op: 'add', text: 'x' })).toMatchObject({ deny: expect.stringContaining('op "start"') })
})

test('a goal left in the project is picked up by the first call that needs it', async () => {
  const { io, mine } = office({ [FILE]: BASE })
  const a = await call(io, { op: 'add', text: 'Review' })
  expect(result(a)).toContain('s3 next      Review')
  expect(mine.state?.slug).toBe('fix-login')
})

test('an operation changes the file and the state, answers with the plan, and marks what changed', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  await loadPlan(io)
  const a = await call(io, { op: 'done', id: 's1' })
  expect(result(a)).toContain('Plan: Fix login (1 of 2 done)\ns1 done')
  expect(d.held.get(FILE)).toContain('- [x] Find the bug  <!-- s1 -->')
  expect(mine.state?.steps.map(s => s.isNew === true)).toEqual([true, false])
})

test('a step with a specialist at work on it is not dropped, and the refusal says so', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  await loadPlan(io)
  mine.staff = [emp({ stepId: 's2' })]
  expect(await call(io, { op: 'drop', id: 's2' })).toMatchObject({ deny: expect.stringContaining('specialist at work') })
  expect(await call(io, { op: 'split', id: 's2', steps: ['a', 'b'] })).toMatchObject({ deny: expect.stringContaining('specialist at work') })
  expect(d.writes).toHaveLength(0)
  expect(result(await call(io, { op: 'drop', id: 's1' }))).toContain('(0 of 1 done)')
})

test('reopen notes when, so older failures stop counting against ticking', async () => {
  const { io, mine } = office({ [FILE]: BASE.replace('- [ ] Find', '- [x] Find') })
  await loadPlan(io)
  mine.at = 4_000
  await call(io, { op: 'reopen', id: 's1' })
  expect(mine.state?.steps[0]).toMatchObject({ isDone: false, reopenedAt: 4_000 })
})

test('finish hands the unticked Later items over, writes the seam, empties the file and clears the goal', async () => {
  const { io, d, mine } = office({ [FILE]: LATER })
  await loadPlan(io)
  mine.at = 9_000
  const a = await call(io, { op: 'finish', outcome: 'done' })
  expect(result(a)).toContain('is over (done)')
  expect(result(a)).toContain('1 put-off item was moved to the project')
  expect(mine.later).toEqual([['Put off']])
  expect(mine.ended).toMatchObject([{ slug: 'fix-login', title: 'Fix login', outcome: 'done', endedAt: 9_000, steps: [{ id: 's1' }, { id: 's2' }] }])
  expect(d.held.get(FILE)).toBe('')
  expect(mine.state).toBeNull()
  // The ended goal's file is no plan: a new goal may start, and a restart finds none.
  expect(result(await call(io, { op: 'start', goal: 'Fix login', steps: ['again'] }))).toContain('Plan: Fix login')
})

test('finish leaves everything as it was when the Later items cannot be kept; a seam that fails does not stop it', async () => {
  const a = office({ [FILE]: LATER })
  await loadPlan(a.io)
  a.mine.keepFails = true
  expect(await call(a.io, { op: 'finish', outcome: 'stopped' })).toMatchObject({ deny: expect.stringContaining('the list refused') })
  expect(a.d.held.get(FILE)).toBe(LATER)
  expect(a.mine.state).not.toBeNull()
  const b = office({ [FILE]: LATER })
  await loadPlan(b.io)
  b.mine.seamFails = true
  expect(result(await call(b.io, { op: 'finish', outcome: 'stopped' }))).toContain('is over (stopped)')
  expect(b.d.notes.some(n => n.includes('the record refused'))).toBe(true)
  expect(b.d.held.get(FILE)).toBe('')
})

test('a goal whose file is gone (ended elsewhere) is cleared, with a sentence that says why', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  await loadPlan(io)
  d.held.set(FILE, '')
  expect(await call(io, { op: 'add', text: 'x' })).toMatchObject({ deny: expect.stringContaining('another session may have ended it') })
  expect(mine.state).toBeNull()
})

test('a call that throws is an answer and a debug record, never a crash', async () => {
  const { io, d } = office({ [FILE]: BASE })
  await loadPlan(io)
  io.staff = async () => { throw new Error('the books are shut') }
  expect(await call(io, { op: 'done', id: 's1' })).toMatchObject({ deny: expect.stringContaining('the books are shut') })
  expect(d.notes.some(n => n.includes('the books are shut'))).toBe(true)
})

// ---- Loading ----

test('loading holds the newest plan and saves the ids that were provisional first', async () => {
  const { io, d, mine } = office({ [FILE]: '# Hand\n- [ ] By hand\n- [ ] A  <!-- s4 -->\n' })
  await loadPlan(io)
  expect(d.held.get(FILE)).toBe('# Hand\n- [ ] By hand  <!-- s5 -->\n- [ ] A  <!-- s4 -->\n<!-- next: s6 l1 -->\n')
  expect(mine.state?.steps.map(s => s.id)).toEqual(['s5', 's4'])
})

test('loading with Clawd off holds nothing and reads nothing; with no plan it holds none', async () => {
  const off = office({ [FILE]: BASE }, false)
  off.mine.state = stateFrom({ title: 'Old', steps: [], later: [] }, 'old', 1, null, [])
  await loadPlan(off.io)
  expect(off.mine.state).toBeNull()
  expect(off.d.calls).toEqual([])
  const none = office()
  await loadPlan(none.io)
  expect(none.mine.state).toBeNull()
})

test('a load that fails is a debug record, not a crash, and holds none', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  io.set = async () => { throw new Error('the state refused') }
  await loadPlan(io)
  expect(mine.state).toBeNull()
  expect(d.notes.some(n => n.includes('the state refused'))).toBe(true)
})

// ---- Linking a run to a step ----

test('a PLAN line that names a step of the plan links to the goal; one that does not is booked off-plan with a debug record', async () => {
  const { io, d } = office({ [FILE]: BASE })
  await loadPlan(io)
  expect(await linkStep(io, 's2')).toBe(KEY)
  expect(d.notes).toHaveLength(0)
  expect(await linkStep(io, 's9')).toBeUndefined()
  expect(d.notes).toHaveLength(1)
  expect(d.notes[0]).toContain('s9')
  const empty = office()
  expect(await linkStep(empty.io, 's1')).toBeUndefined()
  expect(empty.d.notes[0]).toContain('there is none')
})

test('with Clawd off nothing is linked and nothing is recorded, also when it was turned off after the plan was loaded', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  await loadPlan(io)
  mine.isOn = false
  expect(await linkStep(io, 's2')).toBeUndefined()
  expect(await linkStep(io, 's9')).toBeUndefined()
  expect(d.notes).toHaveLength(0)
})

test('a plan that cannot be read to link a run leaves a debug record, and the run is off-plan', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  await loadPlan(io)
  mine.getFails = true
  expect(await linkStep(io, 's2')).toBeUndefined()
  expect(d.notes).toHaveLength(1)
  expect(d.notes[0]).toContain('the state is shut')
})

// ---- Ticking ----

async function running(over: Partial<Employee> = {}, files: Record<string, string> = { [FILE]: BASE }) {
  const o = office(files)
  await loadPlan(o.io)
  const run = emp({ id: 'r1', stepId: 's2', mood: 'done', endedAt: 500, planKey: goalKey(o.mine.state!), ...over })
  o.mine.staff = [run]
  return { ...o, run }
}

test('a run that ended well ticks its step in the file and in the state', async () => {
  const { io, d, mine } = await running()
  await settleRun(io, 'r1')
  expect(d.held.get(FILE)).toContain('- [x] Fix it  <!-- s2 -->')
  expect(mine.state?.steps[1]?.isDone).toBe(true)
})

test('a run that failed, was lost or stopped leaves the step unticked and the file unwritten', async () => {
  for (const mood of ['failed', 'lost', 'stopped'] as const) {
    const { io, d, mine } = await running({ mood })
    await settleRun(io, 'r1')
    expect(d.writes).toHaveLength(0)
    expect(mine.state?.steps[1]?.isDone).toBe(false)
  }
})

test('a step with another linked run at work, or one that failed, is not ticked; the goal is never ended', async () => {
  const busy = await running()
  busy.mine.staff = [busy.run, emp({ id: 'r2', stepId: 's2', startedAt: 150 })]
  await settleRun(busy.io, 'r1')
  expect(busy.d.writes).toHaveLength(0)
  const failed = await running()
  failed.mine.staff = [failed.run, emp({ id: 'r2', stepId: 's2', startedAt: 150, mood: 'failed', endedAt: 300 })]
  await settleRun(failed.io, 'r1')
  expect(failed.d.writes).toHaveLength(0)
  const last = await running({}, { [FILE]: BASE.replace('- [ ] Find the bug', '- [x] Find the bug') })
  await settleRun(last.io, 'r1')
  expect(last.d.held.get(FILE)).toContain('- [x] Fix it')
  expect(last.mine.state).not.toBeNull()
})

test('a finished run\'s choices go under its step, once each and five at most, also when the step is not ticked', async () => {
  const { io, d, mine } = await running({ choices: ['use one file', 'keep it flat', 'USE one file'] })
  mine.staff = [mine.staff[0]!, emp({ id: 'r2', stepId: 's2' })]
  await settleRun(io, 'r1')
  expect(d.held.get(FILE)).toContain('- [ ] Fix it  <!-- s2 -->\n  - Decided: use one file\n  - Decided: keep it flat\n')
  expect(mine.state?.steps[1]?.choices).toEqual(['use one file', 'keep it flat'])
  await settleRun(io, 'r1')
  expect(d.writes).toHaveLength(1) // said again, nothing more is written
  const many = await running({ choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
  await settleRun(many.io, 'r1')
  expect(many.d.held.get(FILE)!.match(/Decided:/g)).toHaveLength(5)
})

test('settling a run twice, or a run that is off-plan, writes nothing more', async () => {
  const { io, d, mine } = await running()
  await settleRun(io, 'r1')
  const written = d.writes.length
  await settleRun(io, 'r1')
  expect(d.writes).toHaveLength(written)
  mine.staff = [emp({ id: 'r3', mood: 'done', endedAt: 5 })]
  await settleRun(io, 'r3')
  await settleRun(io, 'nobody')
  expect(d.writes).toHaveLength(written)
})

test('a signal for a stop that came after the step was reopened ticks nothing', async () => {
  const { io, d, mine } = await running({ endedAt: 300 })
  mine.state = { ...mine.state!, steps: mine.state!.steps.map(s => (s.id === 's2' ? { ...s, reopenedAt: 400 } : s)) }
  await settleRun(io, 'r1')
  expect(d.writes).toHaveLength(0)
})

test('a plan that cannot be written leaves a debug record and no crash', async () => {
  const { io, d, mine } = await running()
  d.fail.write = true
  await settleRun(io, 'r1')
  expect(mine.state?.steps[1]?.isDone).toBe(false)
  expect(d.notes.length).toBeGreaterThan(0)
  const noGoal = office()
  noGoal.mine.staff = [emp({ stepId: 's2', mood: 'done', endedAt: 5 })]
  await settleRun(noGoal.io, 'a1')
})

// ---- The marks and the record ----

test('the person\'s message clears the new marks; nothing is written when there are none', async () => {
  const { io, mine } = office({ [FILE]: BASE })
  await loadPlan(io)
  await call(io, { op: 'add', text: 'Review' })
  expect(mine.state?.steps.some(s => s.isNew)).toBe(true)
  await clearNewMarks(io)
  expect(mine.state?.steps.some(s => s.isNew)).toBe(false)
  const before = mine.state
  await clearNewMarks(io)
  expect(mine.state).toBe(before)
})

test('the debug record keeps the newest twenty lines and reads a damaged store as empty', () => {
  const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`).reduce<unknown>((list, line, i) => withPlanNote(list, line, i), undefined) as Array<{ note: string }>
  expect(lines).toHaveLength(20)
  expect(lines[19]!.note).toBe('line 24')
  expect(withPlanNote('damaged', 'x', 1)).toEqual([{ at: 1, note: 'x' }])
  expect(withPlanNote([{ bad: true }, { at: 1, note: 'ok' }], 'y', 2)).toEqual([{ at: 1, note: 'ok' }, { at: 2, note: 'y' }])
  expect(PLAN_DEBUG_KEY).toBe('debug:plan')
  expect(DIR).toContain('plans')
})

// ---- A new goal starts clean ----

test('an earlier goal\'s runs never count for the new goal\'s steps, even with the same ids: its s2 is next, can be dropped, and is not ticked by the old run', async () => {
  const { io, d, mine } = office()
  mine.at = 1_000
  await call(io, { op: 'start', goal: 'Fix login', steps: ['Find the bug', 'Fix it'] })
  const first = goalKey(mine.state!)
  mine.staff = [
    emp({ id: 'failed', stepId: 's2', planKey: first, mood: 'failed', startedAt: 1_100, endedAt: 1_200 }),
    emp({ id: 'working', stepId: 's2', planKey: first, startedAt: 1_100 }),
  ]
  await call(io, { op: 'finish', outcome: 'stopped' })
  mine.at = 5_000
  const second = await call(io, { op: 'start', goal: 'Fix login', steps: ['Find the bug', 'Fix it'] })
  expect(goalKey(mine.state!)).not.toBe(first)
  expect(result(second)).toContain('s2 next')
  // The old run ends well and hands back: nothing of the new goal changes.
  mine.staff = [emp({ id: 'working', stepId: 's2', planKey: first, mood: 'done', startedAt: 1_100, endedAt: 6_000, choices: ['one file'] })]
  const written = d.writes.length
  await settleRun(io, 'working')
  expect(d.writes).toHaveLength(written)
  expect(d.held.get(FILE)).not.toContain('[x]')
  expect(d.held.get(FILE)).not.toContain('Decided')
  // And it was never at work on the new s2: the step is dropped without a refusal.
  mine.staff = [emp({ id: 'working', stepId: 's2', planKey: first })]
  expect(result(await call(io, { op: 'drop', id: 's2' }))).toContain('(0 of 1 done)')
})

// ---- The state follows the files, in order ----

test('a hand-back settling a step while Clawd adds one leaves both in the state, whichever is slow', async () => {
  const six = `# Fix login\n\n${[1, 2, 3, 4, 5, 6].map(n => `- [ ] Step ${n}  <!-- s${n} -->`).join('\n')}\n`
  const { io, mine } = office({ [FILE]: six })
  await loadPlan(io)
  mine.staff = [emp({ id: 'r1', stepId: 's2', mood: 'done', endedAt: 500 })]
  mine.setDelays = [40, 0, 0, 0]
  const [, added] = await Promise.all([settleRun(io, 'r1'), call(io, { op: 'add', text: 'Seventh' })])
  expect(result(added)).toContain('s7 ')
  expect(mine.state?.steps.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7'])
  expect(mine.state?.steps[1]?.isDone).toBe(true)
})

test('a reload of the goal in hand keeps what only the session knows: reopenings, new marks and the start time', async () => {
  const { io, d, mine } = office({ [FILE]: BASE })
  d.mtimes.set(FILE, 100)
  await loadPlan(io)
  mine.state = withReopened({ ...mine.state!, steps: mine.state!.steps.map(s => (s.id === 's1' ? { ...s, isNew: true } : s)) }, 's2', 55)
  d.mtimes.set(FILE, 900)
  await loadPlan(io)
  expect(mine.state?.startedAt).toBe(100)
  expect(mine.state?.steps.map(s => [s.id, s.isNew === true, s.reopenedAt])).toEqual([['s1', true, undefined], ['s2', false, 55]])
  // Another goal takes none of it.
  d.held.delete(FILE)
  d.held.set(`${DIR}/other.md`, '# Other\n- [ ] x  <!-- s1 -->\n')
  await loadPlan(io)
  expect(mine.state).toMatchObject({ slug: 'other', startedAt: 0 })
})

// ---- Clawd off, read live ----

test('turning Clawd off after the plan was loaded stops ticking: a linked run that ends well changes nothing', async () => {
  const { io, d, mine, run } = await running()
  mine.isOn = false
  await settleRun(io, run.id)
  expect(d.writes).toHaveLength(0)
  expect(mine.state?.steps[1]?.isDone).toBe(false)
  mine.isOn = true
  await settleRun(io, run.id)
  expect(mine.state?.steps[1]?.isDone).toBe(true)
})

// ---- Ticking asks the books in the queue ----

test('a rerun that succeeds ticks a step whose earlier run failed', async () => {
  const { io, mine } = await running({ id: 'second', startedAt: 300, endedAt: 600 })
  mine.staff = [...mine.staff, emp({ id: 'first', stepId: 's2', mood: 'failed', startedAt: 100, endedAt: 200 })]
  await settleRun(io, 'second')
  expect(mine.state?.steps[1]?.isDone).toBe(true)
})

test('ending a goal with nothing put off says so', async () => {
  const { io } = office({ [FILE]: BASE })
  await loadPlan(io)
  expect(result(await call(io, { op: 'finish', outcome: 'done' }))).toContain('There were no put-off items to move.')
})
