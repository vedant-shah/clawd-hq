import { expect, test } from 'claude-code/testing'
import { clearNewMarks, loadPlan, planTool, settleRun, takeOver, takeOverPrompt } from '../hooks/plan-run'
import type { PlanRunIo } from '../hooks/plan-run'
import { goalKey } from '../hooks/plan-live'
import { BASE, DIR, FILE, LEGACY } from './plan-disk'
import { emp, office } from './plan-office'

// A goal belongs to the session that started it: two sessions in one folder, the same session coming back, a takeover through Resume, and a
// plan file from before plan files named their session.

const A = 'session-a'
const B = 'session-b'
const call = (io: PlanRunIo, input: Record<string, unknown>) => planTool(io, undefined, input)
const result = (a: { result?: string; deny?: string }) => a.result ?? `DENIED: ${a.deny}`
const SECOND = `${DIR}/fix-login-2.md`

/** Two sessions in one project folder: each has its own state, staff and drafts, and they share the files. */
function two() {
  const a = office({}, true, { session: A })
  const b = office({}, true, { session: B, d: a.d })
  return { a, b, d: a.d }
}
const STEPS = { op: 'start', goal: 'Fix login', steps: ['Find the bug', 'Fix it'] }

// ---- Two sessions in one folder ----

test('a goal is stamped with the session that started it, in its file and in the state', async () => {
  const { a, d } = two()
  await call(a.io, STEPS)
  expect(d.held.get(FILE)).toContain(`<!-- session: ${A} -->`)
  expect(a.mine.state?.session).toBe(A)
})

test('a fresh session in the same folder starts with no goal in hand, though the other session\'s goal is open and the newest', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  const before = d.held.get(FILE)
  await loadPlan(b.io)
  expect(b.mine.state).toBeNull()
  expect(await call(b.io, { op: 'add', text: 'More' })).toMatchObject({ deny: expect.stringContaining('There is no goal in hand') })
  expect(await call(b.io, { op: 'done', id: 's1' })).toMatchObject({ deny: expect.stringContaining('There is no goal in hand') })
  expect(d.held.get(FILE)).toBe(before)
})

test('the other session starts a goal of its own while this one is open, and each session loads only its own', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  expect(result(await call(b.io, { ...STEPS, steps: ['Other work'] }))).toContain('Plan: Fix login (0 of 1 done)')
  expect(d.held.get(SECOND)).toContain(`<!-- session: ${B} -->`)
  expect(await call(b.io, { op: 'start', goal: 'Third', steps: ['x'] })).toMatchObject({ deny: expect.stringContaining('finish the current goal first') })
  // Each one's process starts again over the same folder: B's file is the newest, and A still gets its own.
  const a2 = office({}, true, { session: A, d })
  const b2 = office({}, true, { session: B, d })
  await Promise.all([loadPlan(a2.io), loadPlan(b2.io)])
  expect([a2.mine.state?.slug, b2.mine.state?.slug]).toEqual(['fix-login', 'fix-login-2'])
})

// ---- The same session coming back ----

test('the same session coming back (a resume or a restart keeps its id) keeps its goal, with its ticks', async () => {
  const { a, d } = two()
  await call(a.io, STEPS)
  await call(a.io, { op: 'done', id: 's1' })
  const back = office({}, true, { session: A, d })
  await loadPlan(back.io)
  expect(back.mine.state).toMatchObject({ slug: 'fix-login', session: A, steps: [{ id: 's1', isDone: true }, { id: 's2', isDone: false }] })
})

test('after a /clear the id changes and the process keeps its goal: the file follows the new id at the next plan call', async () => {
  const { a, d } = two()
  await call(a.io, STEPS)
  a.mine.session = 'a-2'
  expect(result(await call(a.io, { op: 'done', id: 's1' }))).toContain('(1 of 2 done)')
  expect(d.held.get(FILE)).toContain('<!-- session: a-2 -->')
  expect(d.held.get(FILE)).not.toContain(`session: ${A}`)
  expect(a.mine.state?.session).toBe('a-2')
  const back = office({}, true, { session: 'a-2', d })
  await loadPlan(back.io)
  expect(back.mine.state?.slug).toBe('fix-login')
})

test('the person\'s next message after a /clear moves the file to the new id too', async () => {
  const { a, d } = two()
  await call(a.io, STEPS)
  a.mine.session = 'a-2'
  await clearNewMarks(a.io)
  expect(d.held.get(FILE)).toContain('<!-- session: a-2 -->')
})

// ---- A takeover through Resume ----

test('taking a goal over moves it: its file names the new session, and the new session holds it with its ticks', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  await call(a.io, { op: 'done', id: 's1' })
  const taken = await takeOver(b.io, 'fix-login')
  expect(taken).toMatchObject({ ok: true })
  expect(d.held.get(FILE)).toContain(`<!-- session: ${B} -->`)
  expect(d.held.get(FILE)).not.toContain(`session: ${A}`)
  expect(b.mine.state).toMatchObject({ slug: 'fix-login', session: B, steps: [{ id: 's1', isDone: true }, { id: 's2', isDone: false }] })
  expect(result(await call(b.io, { op: 'done', id: 's2' }))).toContain('is complete and closed')
})

test('the session that lost the goal is told at its next call, writes nothing, and is cleared; it cannot end the goal either', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  await takeOver(b.io, 'fix-login')
  const before = d.held.get(FILE)
  expect(await call(a.io, { op: 'add', text: 'More' })).toMatchObject({ deny: expect.stringContaining('taken over by another session') })
  expect(a.mine.state).toBeNull()
  expect(d.held.get(FILE)).toBe(before)
  // It has no goal now, and may start one of its own.
  expect(result(await call(a.io, { ...STEPS, goal: 'Mine', steps: ['x'] }))).toContain('Plan: Mine')
})

test('a session holding a goal that another took over cannot finish it, and a hand-back or a dismiss does not write to it', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  a.mine.staff = [emp({ id: 'r1', stepId: 's2', planKey: goalKey(a.mine.state!), mood: 'done', endedAt: 500, choices: ['one file'] })]
  await takeOver(b.io, 'fix-login')
  const before = d.held.get(FILE)
  d.writes.length = 0
  await settleRun(a.io, 'r1')
  expect(d.writes).toHaveLength(0)
  expect(a.mine.state).toBeNull()
  const held = office({}, true, { session: A, d })
  held.mine.state = { slug: 'fix-login', title: 'Fix login', steps: [], later: [], startedAt: 0, session: A }
  expect(await call(held.io, { op: 'finish', outcome: 'stopped' })).toMatchObject({ deny: expect.stringContaining('taken over by another session') })
  expect(d.held.get(FILE)).toBe(before)
})

test('a takeover is refused while this session has a goal in hand, and with Clawd off', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  await call(b.io, { op: 'start', goal: 'Other', steps: ['x'] })
  const before = d.held.get(FILE)
  expect(await takeOver(b.io, 'fix-login')).toMatchObject({ ok: false })
  expect(d.held.get(FILE)).toBe(before)
  const off = office({}, false, { session: B, d })
  expect(await takeOver(off.io, 'fix-login')).toMatchObject({ ok: false })
  expect(d.held.get(FILE)).toBe(before)
})

test('a takeover of a goal that is not there says so', async () => {
  const { b } = two()
  expect(await takeOver(b.io, 'nothing-here')).toMatchObject({ ok: false })
  expect(b.mine.state).toBeNull()
})

test('what a takeover puts in the prompt box names the goal and its open steps only', async () => {
  const { a, b } = two()
  await call(a.io, STEPS)
  await call(a.io, { op: 'done', id: 's1' })
  const taken = await takeOver(b.io, 'fix-login')
  expect(taken.ok && takeOverPrompt(taken.state)).toBe('Please carry on with the goal "Fix login", which I took over from another session. Its open steps:\n- Fix it')
})

// ---- A plan file from before plan files named their session ----

test('a plan file with no session is owned by no one: not adopted at start, not by a call, and it does not block a new goal', async () => {
  const { io, mine, d } = office({ [FILE]: LEGACY }, true, { session: B })
  await loadPlan(io)
  expect(mine.state).toBeNull()
  expect(await call(io, { op: 'add', text: 'More' })).toMatchObject({ deny: expect.stringContaining('There is no goal in hand') })
  expect(d.held.get(FILE)).toBe(LEGACY)
  expect(result(await call(io, { ...STEPS, goal: 'Fresh start', steps: ['x'] }))).toContain('Plan: Fresh start')
  expect(d.held.get(FILE)).toBe(LEGACY)
})

test('Resume takes an old plan file over: it is stamped with the session, and its steps and ticks come with it', async () => {
  const { io, mine, d } = office({ [FILE]: LEGACY.replace('- [ ] Find', '- [x] Find') }, true, { session: B })
  expect(await takeOver(io, 'fix-login')).toMatchObject({ ok: true })
  expect(d.held.get(FILE)).toContain(`<!-- session: ${B} -->`)
  expect(mine.state).toMatchObject({ slug: 'fix-login', session: B, steps: [{ isDone: true }, { isDone: false }] })
})

test('a plan file of a session this folder never saw before is just another session\'s', async () => {
  const { io, mine } = office({ [FILE]: BASE }, true, { session: 'someone-else' })
  await loadPlan(io)
  expect(mine.state).toBeNull()
})

// ---- The loss is not silent ----

test('with no goal in hand, a plan call names the goals left open in the folder (another session\'s and an old plan file) and says Resume in History takes one over', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  d.held.set(`${DIR}/old-goal.md`, '# Old plan\n\n- [ ] x  <!-- s1 -->\n')
  const answer = await call(b.io, { op: 'add', text: 'More' })
  expect(answer).toMatchObject({ deny: expect.stringContaining('There is no goal in hand') })
  const text = result(answer)
  expect(text).toContain('"Fix login"')
  expect(text).toContain('"Old plan"')
  expect(text).toMatch(/Resume[\s\S]*History/)
  expect(text).toContain('does not take them over by itself')
})

test('the goals it names are the folder\'s other open goals only: none, and the answer is the plain one; many, and the rest are counted', async () => {
  const { a, b, d } = two()
  expect(result(await call(b.io, { op: 'add', text: 'More' }))).not.toContain('Resume')
  await call(a.io, STEPS) // this goal is A's, and B names it; A's own call never names its own
  for (const n of [2, 3, 4]) d.held.set(`${DIR}/old-${n}.md`, `# Old ${n}\n\n- [ ] x  <!-- s1 -->\n`)
  const text = result(await call(b.io, { op: 'add', text: 'More' }))
  expect(['"Fix login"', '"Old 2"', '"Old 3"'].every(title => text.includes(title))).toBe(true)
  expect(text).not.toContain('"Old 4"')
  expect(text).toContain('and 1 more')
  const mine = office({}, true, { session: A, d })
  await loadPlan(mine.io)
  expect(result(await call(mine.io, { op: 'add', text: 'More' }))).not.toContain('There is no goal in hand')
})

/** A run of the goal in hand that has handed back, on this session's books. */
const handedBack = (a: ReturnType<typeof two>['a'], over: Partial<ReturnType<typeof emp>> = {}) => {
  // The goal's key: while it is in hand, its own; after it ended, what it was (`start` at the office's time, 1,000).
  const key = a.mine.state === null ? 'fix-login:1000' : goalKey(a.mine.state)
  a.mine.staff = [emp({ id: 'r1', stepId: 's2', planKey: key, mood: 'done', endedAt: 500, ...over })]
}
const LOST = 'The specialist on step s2 finished, but its goal isn\'t in this session'

test('a hand-back that finds no goal (the goal was ended meanwhile) is told to Clawd once, at his next plan call', async () => {
  const { a } = two()
  await call(a.io, STEPS)
  handedBack(a)
  await call(a.io, { op: 'finish', outcome: 'stopped' })
  await settleRun(a.io, 'r1')
  await settleRun(a.io, 'r1') // however many signals come, one line
  expect(result(await call(a.io, { op: 'add', text: 'More' }))).toContain(LOST)
  expect(result(await call(a.io, { op: 'add', text: 'More' }))).not.toContain('finished, but')
})

test('a hand-back for a goal another session took over is told the same way, in whatever the next answer is', async () => {
  const { a, b } = two()
  await call(a.io, STEPS)
  handedBack(a)
  await takeOver(b.io, 'fix-login')
  await settleRun(a.io, 'r1')
  expect(a.mine.state).toBeNull()
  const next = result(await call(a.io, { ...STEPS, goal: 'Mine', steps: ['x'] }))
  expect(next).toContain('Plan: Mine')
  expect(next).toContain(LOST)
})

test('a run that was not on a plan, or one that failed, or with Clawd off, leaves no line', async () => {
  const { a } = two()
  await call(a.io, STEPS)
  handedBack(a)
  await call(a.io, { op: 'finish', outcome: 'stopped' })
  for (const over of [{ planKey: undefined, stepId: undefined }, { mood: 'failed' as const }]) {
    handedBack(a, over)
    await settleRun(a.io, 'r1')
  }
  a.mine.isOn = false
  handedBack(a)
  await settleRun(a.io, 'r1')
  expect(a.mine.notes).toEqual([])
})

// ---- Two quick Resumes ----

test('two quick Resumes on two goals leave exactly one taken over: the other is refused, and its file is not stamped', async () => {
  const { a, b, d } = two()
  await call(a.io, STEPS)
  const c = office({}, true, { session: 'session-c', d })
  await call(c.io, { ...STEPS, goal: 'Other goal' })
  const both = await Promise.all([takeOver(b.io, 'fix-login'), takeOver(b.io, 'other-goal')])
  expect(both.filter(one => one.ok)).toHaveLength(1)
  expect(both.find(one => !one.ok)).toMatchObject({ reason: expect.stringContaining('already has a goal in hand') })
  const stamped = [FILE, `${DIR}/other-goal.md`].filter(path => d.held.get(path)!.includes(`session: ${B}`))
  expect(stamped).toHaveLength(1)
  expect(b.mine.state?.session).toBe(B)
})

// ---- A session id the file cannot hold ----

test('an id that cannot be written in a plan file does not block the plan calls after start: the goal simply has no owner', async () => {
  const { io, mine, d } = office({}, true, { session: 'two words' })
  expect(result(await call(io, STEPS))).toContain('Plan: Fix login')
  expect(d.held.get(FILE)).not.toContain('session:')
  expect(result(await call(io, { op: 'done', id: 's1' }))).toContain('(1 of 2 done)')
  await clearNewMarks(io)
  expect(result(await call(io, { op: 'add', text: 'More' }))).toContain('s3 next')
  expect(mine.state?.slug).toBe('fix-login')
})
