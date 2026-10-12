import { expect, test } from 'claude-code/testing'
import type { AgentStatus } from 'claude-code'
import { MAX_STAFF, QUIET_MS, STALE_MS, endOfStatus, endRun, hire, markEngine, restart, touch, verdict, withSaid, withStep, withTool } from '../hooks/staff-model'
import type { Employee } from '../types'

const MIN = 60_000
const emp = (over: Partial<Employee>): Employee => ({
  id: 'a1', type: 'ecc:tdd-guide', description: 'Build', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})
const usage = (over: Partial<Record<'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens', number>>) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...over,
})
const STATUSES: AgentStatus[] = ['pending', 'running', 'waiting', 'idle', 'completed', 'failed', 'killed']

// ---- A new run, or the same run going on ----

test('a specialist resumed after a real stop starts a new run: fresh clock, no end, no old tool count, tokens or peak', () => {
  const ended = emp({
    mood: 'done', startedAt: 10, endedAt: 500, doneTick: 3, tools: 12, tokens: 80_000, outTokens: 900, peakInput: 79_000, context: 70_000,
    activity: 'Reading a.ts', endedBy: 'signal', lastSeen: 480,
  })
  const again = restart(ended, 9_000, 40)
  expect(again).toEqual({
    id: 'a1', type: 'ecc:tdd-guide', description: 'Build', mood: 'working', tools: 0, tokens: 0, outTokens: 0, peakInput: 0, context: 0,
    startedAt: 9_000, endedAt: undefined, doneTick: undefined, joinedTick: 40, lastSeen: 9_000, endedBy: undefined, activity: undefined,
  })
  // The old value was not touched.
  expect(ended).toMatchObject({ mood: 'done', startedAt: 10, endedAt: 500, tools: 12, tokens: 80_000 })
})

test('a failed specialist is restarted the same way, whole', () => {
  const failed = emp({ mood: 'failed', startedAt: 5, endedAt: 50, doneTick: 2, tools: 4, tokens: 900, endedBy: 'signal', activity: 'Reading b.ts' })
  expect(restart(failed, 100, 7)).toEqual({
    id: 'a1', type: 'ecc:tdd-guide', description: 'Build', mood: 'working', tools: 0, tokens: 0, outTokens: 0, peakInput: 0, context: 0,
    startedAt: 100, endedAt: undefined, doneTick: undefined, joinedTick: 7, lastSeen: 100, endedBy: undefined, activity: undefined,
  })
})

test('a run ended by a guess (the engine list, or too long quiet) goes on as the same run: clock, tools and tokens kept', () => {
  for (const endedBy of ['engine', 'stale'] as const) {
    const guessed = emp({
      mood: endedBy === 'stale' ? 'lost' : 'done', startedAt: 10, endedAt: 500, doneTick: 3, tools: 12, tokens: 80_000, outTokens: 900, peakInput: 79_000,
      context: 70_000, endedBy, lastSeen: 480, joinedTick: 2, activity: 'Editing a.ts',
    })
    expect(restart(guessed, 9_000, 40)).toEqual({
      ...guessed, mood: 'working', endedAt: undefined, doneTick: undefined, endedBy: undefined, lastSeen: 9_000,
    })
  }
})

test('a specialist that is already at a desk is returned untouched, tools and tokens included', () => {
  for (const mood of ['arriving', 'working', 'thinking'] as const) {
    const one = emp({ mood, startedAt: 10, tools: 5, tokens: 1_234, outTokens: 34, peakInput: 1_200, lastSeen: 20, activity: 'Thinking' })
    const snapshot = structuredClone(one)
    const out = restart(one, 9_000, 40)
    expect(out).toBe(one)
    expect(out).toEqual(snapshot)
  }
})

test('a sign of life stamps the time and changes nothing else', () => {
  const one = emp({ tools: 3, lastSeen: 10 })
  expect(touch(one, 99)).toEqual({ ...one, lastSeen: 99 })
  expect(one.lastSeen).toBe(10)
})

// ---- Ending a run ----

test('ending a run records how it ended; done and failed get a cheer tick, lost contact does not', () => {
  const one = emp({ activity: 'Reading a.ts', lastSeen: 70 })
  expect(endRun(one, 'done', 'signal', 100, 6)).toEqual({ ...one, mood: 'done', activity: undefined, endedAt: 100, doneTick: 6, endedBy: 'signal' })
  expect(endRun(one, 'failed', 'engine', 100, 6)).toMatchObject({ mood: 'failed', endedBy: 'engine', doneTick: 6 })
  const lost = endRun(one, 'lost', 'stale', 100, 6)
  expect(lost).toMatchObject({ mood: 'lost', endedBy: 'stale', endedAt: 100, lastSeen: 70 })
  expect(lost.doneTick).toBeUndefined()
})

test('an engine status change to a running one is a sign of life; a change to an ended one is not', () => {
  const one = emp({ lastSeen: 10 })
  expect(markEngine(one, 'running', 500)).toEqual({ ...one, engine: 'running', lastSeen: 500 })
  expect(markEngine(one, 'completed', 500)).toEqual({ ...one, engine: 'completed', lastSeen: 10 })
  expect(markEngine(one, 'waiting', 500)).toMatchObject({ engine: 'waiting', lastSeen: 500 })
})

test('the engine status maps every status to how it ends a run', () => {
  expect(Object.fromEntries(STATUSES.map(s => [s, endOfStatus(s)]))).toEqual({
    pending: undefined, running: undefined, waiting: undefined, idle: 'done', completed: 'done', failed: 'failed', killed: 'failed',
  })
})

test('an engine status ends a run only after the specialist has been quiet for 15 seconds', () => {
  const one = emp({ startedAt: 0, lastSeen: 100_000 })
  for (const [status, mood] of [['completed', 'done'], ['idle', 'done'], ['failed', 'failed'], ['killed', 'failed']] as const) {
    expect(verdict(one, status, 100_000 + QUIET_MS)).toBeUndefined()
    expect(verdict(one, status, 100_000 + QUIET_MS + 1)).toEqual({ mood, how: 'engine' })
  }
  // A long step is not an end: started long ago, but seen a moment ago.
  expect(verdict(emp({ startedAt: 0, lastSeen: 600_000 }), 'completed', 600_000 + 5_000)).toBeUndefined()
})

test('a specialist the engine no longer lists has finished once it has been quiet for 15 seconds', () => {
  const one = emp({ lastSeen: 1_000 })
  expect(verdict(one, undefined, 1_000 + QUIET_MS)).toBeUndefined()
  expect(verdict(one, undefined, 1_000 + QUIET_MS + 1)).toEqual({ mood: 'done', how: 'engine' })
})

test('a run still going by the engine but silent for 30 minutes is lost, and one the engine says is waiting is never lost', () => {
  const one = emp({ lastSeen: 0 })
  for (const status of ['running', 'pending'] as const) {
    expect(verdict(one, status, STALE_MS)).toBeUndefined()
    expect(verdict(one, status, STALE_MS + 1)).toEqual({ mood: 'lost', how: 'stale' })
  }
  expect(verdict(one, 'waiting', 5 * 60 * MIN)).toBeUndefined()
  expect(STALE_MS).toBe(30 * MIN)
})

test('quiet time counts from the start for a specialist never seen since, and demos and ended ones are never judged', () => {
  expect(verdict(emp({ startedAt: 0 }), 'running', STALE_MS + 1)).toEqual({ mood: 'lost', how: 'stale' })
  expect(verdict(emp({ id: 'demo-arch', lastSeen: 0 }), 'running', STALE_MS * 2)).toBeUndefined()
  expect(verdict(emp({ mood: 'done', lastSeen: 0 }), 'completed', STALE_MS * 2)).toBeUndefined()
  expect(verdict(emp({ mood: 'lost', lastSeen: 0 }), 'running', STALE_MS * 2)).toBeUndefined()
})

// ---- What a run spends ----

test('the token figure is the largest request input of the run plus the output of every request', () => {
  const first = withStep(emp({}), usage({ input_tokens: 10, cache_read_input_tokens: 80_000, output_tokens: 500 }), 'm', 50)
  const second = withStep(first, usage({ input_tokens: 20, cache_read_input_tokens: 81_000, cache_creation_input_tokens: 400, output_tokens: 600 }), 'm', 60)
  expect(second.peakInput).toBe(81_420)
  expect(second.tokens).toBe(81_420 + 1_100)
  expect(second.outTokens).toBe(1_100)
  // The context is how full the window is now: the latest input and the output.
  expect(second.context).toBe(81_420 + 600)
  expect(second.model).toBe('m')
  expect(second.lastSeen).toBe(60)
  expect(first.tokens).toBe(80_010 + 500)
})

test('tokens never go down: after a compaction the input shrinks but the run keeps its peak', () => {
  const big = withStep(emp({}), usage({ input_tokens: 10, cache_read_input_tokens: 80_000, output_tokens: 500 }), 'm', 1)
  const compacted = withStep(big, usage({ input_tokens: 5, cache_read_input_tokens: 20_000, output_tokens: 300 }), 'm', 2)
  expect(compacted.tokens).toBe(80_010 + 800)
  expect(compacted.tokens).toBeGreaterThan(big.tokens!)
  // How full the window is now does follow the compaction.
  expect(compacted.context).toBe(20_005 + 300)
  expect(compacted.peakInput).toBe(80_010)
})

test('a request with no usage numbers adds nothing, keeps the model, and is still a sign of life', () => {
  const one = withStep(emp({ model: 'old' }), usage({}), '', 5)
  expect(one).toMatchObject({ tokens: 0, outTokens: 0, context: 0, model: 'old', lastSeen: 5 })
})

// ---- What a specialist is doing ----

test('a tool call puts a specialist to work, counts the tool and keeps the sentence; one still arriving stays arriving', () => {
  const idle = emp({ mood: 'thinking', tools: 2, activity: 'Thinking' })
  expect(withTool(idle, 'Reading a.ts')).toEqual({ ...idle, mood: 'working', tools: 3, activity: 'Reading a.ts' })
  expect(withTool(emp({ mood: 'arriving' }), 'Reading a.ts')).toMatchObject({ mood: 'arriving', tools: 1, activity: 'Reading a.ts' })
  expect(idle.tools).toBe(2)
})

// ---- The books ----

test('hiring appends; the same id again keeps its progress and takes the spawn\'s facts', () => {
  const one = emp({ id: 'a1', type: 'Explore', description: '', tools: 3, activity: 'Reading a.ts' })
  const list = [one]
  const again = hire(list, emp({ id: 'a1', type: 'ecc:planner', description: 'Plan it', name: 'planner-one', tools: 0 }))
  expect(again).toEqual([{ ...one, type: 'ecc:planner', description: 'Plan it', name: 'planner-one' }])
  // A spawn that gives no name leaves a name already known alone.
  expect(hire(again, emp({ id: 'a1', type: 'ecc:planner', description: 'Plan it' }))[0]!.name).toBe('planner-one')
  expect(hire(list, emp({ id: 'b2' })).map(e => e.id)).toEqual(['a1', 'b2'])
  expect(list).toEqual([one])
})

test('over the cap the longest-gone finishers leave first, and a running specialist is never dropped', () => {
  const finished = Array.from({ length: MAX_STAFF }, (_, i) => emp({ id: `f${i}`, mood: 'done', endedAt: i }))
  const crowded = [emp({ id: 'busy', mood: 'working' }), ...finished]
  const out = hire(crowded, emp({ id: 'new', mood: 'arriving' }))
  expect(out).toHaveLength(MAX_STAFF)
  expect(out.map(e => e.id)).toContain('busy')
  expect(out.map(e => e.id)).toContain('new')
  expect(out.map(e => e.id)).not.toContain('f0')
  expect(out.map(e => e.id)).not.toContain('f1')
})

// ---- The specialist's own words ----

test('what a specialist says is kept on its record, and the end of a run or a new run clears it', () => {
  const talking = withSaid(emp({ activity: 'Reading a.ts' }), 'Checking the rules.')
  expect(talking.said).toBe('Checking the rules.')
  expect(withTool(talking, 'Editing b.ts').said).toBe('Checking the rules.')
  expect(withStep(talking, usage({ input_tokens: 5 }), 'm', 10).said).toBe('Checking the rules.')
  expect(endRun(talking, 'done', 'signal', 500, 3).said).toBeUndefined()
  expect(restart(endRun(talking, 'done', 'signal', 500, 3), 9_000, 40).said).toBeUndefined()
})
