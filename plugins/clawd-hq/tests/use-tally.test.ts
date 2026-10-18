import { expect, test } from 'claude-code/testing'
import { MAX_SESSIONS, cleanTally, noted, recordUse, savedTally, tallyKey } from '../hooks/use-tally'
import type { SessionTally, TallyIo } from '../hooks/use-tally'
import { isCountedTool } from '../hooks/usage-count'

const folder = '/work/proj'

/** A store in memory that logs its writes. */
function fakeStore(start: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = { ...start }
  const log = { sets: 0 }
  const io: TallyIo = {
    get: async <T>(key: string) => data[key] as T | undefined,
    set: async (key, value) => { log.sets += 1; data[key] = value },
  }
  return { io, data, log }
}

test('only the tools that start an agent or run a skill are counted', () => {
  for (const tool of ['Agent', 'Task', 'Skill']) expect(isCountedTool(tool)).toBe(true)
  for (const tool of ['Bash', 'Read', 'AskUserQuestion', undefined, 7]) expect(isCountedTool(tool)).toBe(false)
})

test('a tool call adds one to the session\'s agent or skill, by name, in a new object', () => {
  const start: SessionTally = Object.freeze({})
  const a = noted(start, 's1', 'Agent', { subagent_type: 'ecc:planner', prompt: 'private words' })
  const b = noted(a, 's1', 'Skill', { skill: 'ecc:plan', args: 'private words' })
  const c = noted(b, 's1', 'Task', { subagent_type: 'ecc:planner' })
  expect(c).toEqual({ s1: { agents: { 'ecc:planner': 2 }, skills: { 'ecc:plan': 1 } } })
  expect(JSON.stringify(c)).not.toContain('private')
  expect(start).toEqual({})
  expect(a).not.toBe(b)
})

test('a call that is not an agent or skill use, or names nothing, leaves the tally as it was', () => {
  const t: SessionTally = { s1: { agents: { a: 1 }, skills: {} } }
  expect(noted(t, 's1', 'Bash', { command: 'ls' })).toBe(t)
  expect(noted(t, 's1', 'Agent', {})).toBe(t)
  expect(noted(t, 's1', 'Skill', { skill: '' })).toBe(t)
  expect(noted(t, 's1', 'Skill', undefined)).toBe(t)
})

test('past 100 sessions the oldest go, and the session just used counts as the newest', () => {
  const full = Object.fromEntries(Array.from({ length: MAX_SESSIONS }, (_, i) => [`s${i}`, { agents: { a: 1 }, skills: {} }]))
  const next = noted(full, 'new', 'Skill', { skill: 'x' })
  expect(Object.keys(next)).toHaveLength(MAX_SESSIONS)
  expect(Object.keys(next)[MAX_SESSIONS - 1]).toBe('new')
  expect(next.s0).toBeUndefined()
  const again = noted(next, 's5', 'Skill', { skill: 'y' })
  expect(Object.keys(again).at(-1)).toBe('s5')
  expect(again.s5).toEqual({ agents: { a: 1 }, skills: { y: 1 } })
})

test('a saved tally is read as data we trust: odd shapes, bad counts and long names are dropped', () => {
  expect(cleanTally(undefined)).toEqual({})
  expect(cleanTally('x')).toEqual({})
  expect(cleanTally({ s1: { agents: { ok: 2.9, zero: 0, neg: -1, str: '3', nan: NaN, [`${'n'.repeat(101)}`]: 1 }, skills: [] }, s2: null, s3: 4 })).toEqual({
    s1: { agents: { ok: 2 }, skills: {} }, s2: { agents: {}, skills: {} }, s3: { agents: {}, skills: {} },
  })
})

test('recording writes the tally under the project\'s key, and only for a call that counts', async () => {
  const s = fakeStore()
  await recordUse(s.io, folder, 's1', 'Bash', { command: 'ls' })
  expect(s.log.sets).toBe(0)
  await recordUse(s.io, folder, 's1', 'Agent', { subagent_type: 'ecc:tdd-guide' })
  expect(s.data[tallyKey(folder)]).toEqual({ s1: { agents: { 'ecc:tdd-guide': 1 }, skills: {} } })
  expect(tallyKey(folder)).toBe('tally:/work/proj')
  expect(await savedTally(s.io, folder)).toEqual({ s1: { agents: { 'ecc:tdd-guide': 1 }, skills: {} } })
})

test('agents started at the same moment are all counted', async () => {
  const s = fakeStore()
  await Promise.all(Array.from({ length: 6 }, () => recordUse(s.io, folder, 's1', 'Agent', { subagent_type: 'worker' })))
  expect((s.data[tallyKey(folder)] as SessionTally).s1?.agents).toEqual({ worker: 6 })
})

test('a store that fails loses that count and never throws or stops the next one', async () => {
  let fail = true
  const s = fakeStore()
  const io: TallyIo = { get: s.io.get, set: async (k, v) => { if (fail) throw new Error('disk full'); await s.io.set(k, v) } }
  await recordUse(io, folder, 's1', 'Skill', { skill: 'a' })
  fail = false
  await recordUse(io, folder, 's1', 'Skill', { skill: 'b' })
  expect((s.data[tallyKey(folder)] as SessionTally).s1?.skills).toEqual({ b: 1 })
  const noRead: TallyIo = { get: async () => { throw new Error('boom') }, set: s.io.set }
  await recordUse(noRead, folder, 's2', 'Skill', { skill: 'c' })
  expect(s.data[tallyKey(folder)]).toEqual({ s1: { agents: {}, skills: { b: 1 } } })
  expect(await savedTally(noRead, folder)).toEqual({})
})
