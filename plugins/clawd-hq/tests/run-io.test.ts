import { expect, test } from 'claude-code/testing'
import { clockOut, loadTokens, newHire, signOfLife } from '../hooks/run-io'
import type { RunIo } from '../hooks/run-io'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({
  id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})

/** The books as a fake: the staff list, and every toast, enrolment and change to Clawd that a stop makes; the session's folder and the store. */
function books(start: Employee[], folder = '/a') {
  const seen = { staff: start, toasts: [] as string[], enrolled: [] as unknown[][], bossChanges: 0, folder, saved: new Map<string, unknown>() }
  const io: RunIo = {
    folder: () => seen.folder,
    get: async key => seen.saved.get(key),
    set: async (key, value) => { seen.saved.set(key, value) },
    showTokens: async () => undefined,
    now: async () => 120_000, tick: async () => 7,
    staff: async () => seen.staff,
    changeStaff: async fn => { seen.staff = fn(seen.staff) },
    blurbs: async () => ({}),
    enroll: async (type, jobs, tokens) => { seen.enrolled.push([type, jobs, tokens]) },
    setBoss: async () => { seen.bossChanges += 1 },
    toast: text => { seen.toasts.push(text) },
    agents: async () => [],
  }
  return { io, seen }
}

// Two signals come for one stop (turn.complete and SubagentStop, in either order); each calls clockOut.
test('a second stop for the same agent ends nothing more: one end, one toast, and its tokens counted once', async () => {
  const { io, seen } = books([emp({ tokens: 5_000 })])
  await clockOut(io, 't1', 'done')
  const once = seen.staff
  expect(once[0]).toMatchObject({ mood: 'done', endedBy: 'signal' })
  await clockOut(io, 't1', 'done')
  expect(seen.staff).toEqual(once)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.bossChanges).toBe(1)
  expect(seen.enrolled).toEqual([['ecc:tdd-guide', 0, 5_000]])
})

test('a stop for an agent nobody knows changes nothing: the books, Clawd and the toasts stay as they were', async () => {
  const start = [emp({})]
  const { io, seen } = books(start)
  await clockOut(io, 'ghost', 'done')
  expect(seen.staff).toEqual(start)
  expect(seen.staff[0]).toMatchObject({ mood: 'working' })
  expect(seen.toasts).toEqual([])
  expect(seen.bossChanges).toBe(0)
  expect(seen.enrolled).toEqual([])
})

// ---- Tokens per project: a run's tokens go to the folder it ran in ----

test('a new hire is stamped with the folder the session is in', async () => {
  const { io, seen } = books([], '/a')
  await newHire(io, 't1', 'ecc:tdd-guide', 'Build')
  expect(seen.staff[0]).toMatchObject({ id: 't1', folder: '/a' })
})

test('a run whose session moved to another folder before it ended still counts for the folder it ran in', async () => {
  const { io, seen } = books([], '/a')
  await newHire(io, 't1', 'ecc:tdd-guide', 'Build')
  seen.staff = seen.staff.map(e => ({ ...e, tokens: 5_000 }))
  seen.folder = '/b'
  await clockOut(io, 't1', 'done')
  expect(seen.saved.get('tokens:/a')).toEqual({ 'ecc:tdd-guide': 5_000 })
  expect(seen.saved.get('tokens:/b')).toBeUndefined()
  // The machine-wide record still gets its count as before.
  expect(seen.enrolled).toContainEqual(['ecc:tdd-guide', 0, 5_000])
})

test('a stop heard twice counts its tokens for the project once', async () => {
  const { io, seen } = books([emp({ tokens: 5_000, folder: '/a' })])
  await clockOut(io, 't1', 'done')
  await clockOut(io, 't1', 'done')
  expect(seen.saved.get('tokens:/a')).toEqual({ 'ecc:tdd-guide': 5_000 })
})

test('a run on the books from before folders were kept counts for the folder the session is in', async () => {
  const { io, seen } = books([emp({ tokens: 2_000 })], '/c')
  await clockOut(io, 't1', 'done')
  expect(seen.saved.get('tokens:/c')).toEqual({ 'ecc:tdd-guide': 2_000 })
})

test('a finished specialist sent back to work in another folder starts a run there', async () => {
  const { io, seen } = books([emp({ mood: 'done', endedAt: 50, endedBy: 'signal', tokens: 5_000, counted: 5_000, folder: '/a' })], '/b')
  await signOfLife(io, 't1')
  expect(seen.staff[0]).toMatchObject({ mood: 'working', folder: '/b' })
  seen.staff = seen.staff.map(e => ({ ...e, tokens: 700 }))
  await clockOut(io, 't1', 'done')
  expect(seen.saved.get('tokens:/b')).toEqual({ 'ecc:tdd-guide': 700 })
  expect(seen.saved.get('tokens:/a')).toBeUndefined()
})

test('a run that goes on after a guessed end keeps its folder', async () => {
  const { io, seen } = books([emp({ mood: 'done', endedAt: 50, endedBy: 'engine', tokens: 5_000, counted: 5_000, folder: '/a' })], '/b')
  await signOfLife(io, 't1')
  expect(seen.staff[0]).toMatchObject({ mood: 'working', folder: '/a' })
})

test('a store that refuses the token write never blocks the end of a run: it ends, Clawd reacts, and the finished toast shows', async () => {
  const { io, seen } = books([emp({ tokens: 5_000, folder: '/a' })])
  const refusing: RunIo = { ...io, set: async () => { throw new Error('the store refused the write') } }
  await loadTokens(refusing) // a session starts: its first refused write is told
  await clockOut(refusing, 't1', 'done')
  expect(seen.staff[0]).toMatchObject({ mood: 'done', endedBy: 'signal' })
  expect(seen.bossChanges).toBe(1)
  expect(seen.toasts).toContainEqual(expect.stringMatching(/^Could not save this project's token totals/))
  expect(seen.toasts.filter(text => !text.startsWith('Could not save'))).toHaveLength(1)
})

test('a stand-in of the tour keeps no tokens for the project', async () => {
  const { io, seen } = books([emp({ id: 'demo-1', tokens: 5_000, folder: '/a' })])
  await clockOut(io, 'demo-1', 'done')
  expect([...seen.saved.keys()]).toEqual([])
})
