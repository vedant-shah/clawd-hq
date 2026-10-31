import { expect, test } from 'claude-code/testing'
import { clockOut } from '../hooks/run-io'
import type { RunIo } from '../hooks/run-io'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({
  id: 't1', type: 'ecc:tdd-guide', description: 'Build redesigned panel', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})

/** The books as a fake: the staff list, and every toast, enrolment and change to Clawd that a stop makes. */
function books(start: Employee[]) {
  const seen = { staff: start, toasts: [] as string[], enrolled: [] as unknown[][], bossChanges: 0 }
  const io: RunIo = {
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
