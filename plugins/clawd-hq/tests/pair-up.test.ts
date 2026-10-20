import { expect, test } from 'claude-code/testing'
import { parseEffort } from '../hooks/desk'
import { PAIR_WINDOW_MS, finishedSlots, floorSlots, pairGroups, pairLine, pairState, pairTitle, parsePairUp } from '../hooks/pair-up'
import type { Employee } from '../types'

const MIN = 60_000
const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 'a1', type: 'ecc:planner', description: 'Plan it', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})
const paired = (id: string, goal: string, at = 0, over: Partial<Employee> = {}) => emp({ id, pair: { goal, at }, ...over })

// ---- The line Clawd starts a pair-up brief with ----

test('a PAIR-UP line comes off the brief the way the effort line does, and gives the goal', () => {
  expect(parsePairUp('PAIR-UP: Ship the login fix\nYou are the author.')).toEqual({ goal: 'Ship the login fix', prompt: 'You are the author.' })
  // After the effort line is taken off, the pair-up line is the first line.
  const { prompt } = parseEffort('[effort: high]\nPAIR-UP: Ship the login fix\nYou are the critic.')
  expect(parsePairUp(prompt)).toEqual({ goal: 'Ship the login fix', prompt: 'You are the critic.' })
})

test('a brief without the line, or with an empty goal, is left exactly as it was', () => {
  expect(parsePairUp('Review the diff.')).toEqual({ prompt: 'Review the diff.' })
  expect(parsePairUp('PAIR-UP:   \nReview the diff.')).toEqual({ prompt: 'PAIR-UP:   \nReview the diff.' })
  // Only the first line counts: a mention later in the brief is the specialist's to read.
  expect(parsePairUp('Review the diff.\nPAIR-UP: x')).toEqual({ prompt: 'Review the diff.\nPAIR-UP: x' })
})

test('a goal on the line is kept to a size a card can wrap, cut at a word with no mark', () => {
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
  const { goal } = parsePairUp(`PAIR-UP: ${long}\nGo.`)
  expect(goal!.length).toBeLessThanOrEqual(160)
  expect(long.startsWith(goal!)).toBe(true)
  expect(goal).not.toMatch(/…|\.\.\.$/)
})

// ---- Who forms a group ----

test('members hired with the same goal within the window form one group; the others stay apart', () => {
  const staff = [paired('a', 'Ship it', 0), paired('b', 'Ship it', 2 * MIN), emp({ id: 'c' }), paired('d', 'Other job', 1 * MIN)]
  const groups = pairGroups(staff)
  expect(groups).toHaveLength(1)
  expect(groups[0]!.goal).toBe('Ship it')
  expect(groups[0]!.members.map(m => m.id)).toEqual(['a', 'b'])
})

test('the goal is compared without regard to case or spacing; the window is 10 minutes from the first member', () => {
  expect(PAIR_WINDOW_MS).toBe(10 * MIN)
  const inside = pairGroups([paired('a', 'Ship  the fix', 0), paired('b', 'ship the FIX', 10 * MIN)])
  expect(inside.map(g => g.members.map(m => m.id))).toEqual([['a', 'b']])
  const outside = pairGroups([paired('a', 'Ship the fix', 0), paired('b', 'Ship the fix', 10 * MIN + 1)])
  expect(outside).toEqual([])
})

test('one member alone, or hires without the line, make no group, even when they run at the same time', () => {
  expect(pairGroups([paired('a', 'Ship it')])).toEqual([])
  expect(pairGroups([emp({ id: 'a' }), emp({ id: 'b' })])).toEqual([])
})

test('three or more hired together are one group', () => {
  const groups = pairGroups([paired('a', 'Ship it', 0), paired('b', 'Ship it', MIN), paired('c', 'Ship it', 2 * MIN)])
  expect(groups.map(g => g.members.length)).toEqual([3])
})

// ---- The title ----

test('the title joins the names: "A & B", and "A, B & C" for three or more', () => {
  expect(pairTitle(['Author', 'Critic'])).toBe('Author & Critic')
  expect(pairTitle(['Author', 'Critic', 'Judge'])).toBe('Author, Critic & Judge')
  expect(pairTitle(['A', 'B', 'C', 'D'])).toBe('A, B, C & D')
})

// ---- The status ----

test('the group works while any member works', () => {
  expect(pairState([emp({ mood: 'done' }), emp({ mood: 'thinking' })])).toBe('working')
  expect(pairState([emp({ mood: 'arriving' }), emp({ mood: 'failed' })])).toBe('working')
})

test('once none works: failed only if one failed, then lost contact, then stopped on purpose, else done', () => {
  expect(pairState([emp({ mood: 'done' }), emp({ mood: 'failed' })])).toBe('failed')
  expect(pairState([emp({ mood: 'failed' }), emp({ mood: 'stopped' })])).toBe('failed')
  expect(pairState([emp({ mood: 'done' }), emp({ mood: 'lost' })])).toBe('lost')
  expect(pairState([emp({ mood: 'done' }), emp({ mood: 'stopped' })])).toBe('stopped')
  expect(pairState([emp({ mood: 'done' }), emp({ mood: 'done' })])).toBe('done')
})

test('the status line says the state in one line with the time since the first start and all the tokens', () => {
  const working = pairLine([emp({ startedAt: 0, tokens: 20_000 }), emp({ startedAt: 60_000, tokens: 11_500 })], 5 * MIN)
  expect(working).toEqual({ state: 'working', text: 'Working · 5m · 32K tokens' })
  const done = pairLine([emp({ mood: 'done', startedAt: 0, endedAt: 3 * MIN, tokens: 22_000 }), emp({ mood: 'done', startedAt: MIN, endedAt: 4 * MIN })], 9 * MIN)
  expect(done.state).toBe('done')
  expect(done.text).toBe('Done · took 4m · 22K tokens')
  expect(pairLine([emp({ mood: 'failed', startedAt: 0, endedAt: MIN }), emp({ mood: 'done', startedAt: 0, endedAt: MIN })], 2 * MIN).text).toBe('Failed after 1m')
  expect(pairLine([emp({ mood: 'stopped', startedAt: 0, endedAt: MIN }), emp({ mood: 'done', startedAt: 0, endedAt: MIN })], 2 * MIN).text).toBe('Stopped after 1m')
  expect(pairLine([emp({ mood: 'lost', startedAt: 0, lastSeen: 2 * MIN, endedAt: 5 * MIN }), emp({ mood: 'done', startedAt: 0, endedAt: MIN })], 6 * MIN).text).toBe('Lost contact after 3m')
})

// ---- Where the cards go ----

test('the floor gets one slot per group at the place of its first working member, and one per specialist not in a group', () => {
  const staff = [emp({ id: 'solo1' }), paired('a', 'Ship it', 0), emp({ id: 'solo2' }), paired('b', 'Ship it', MIN), emp({ id: 'gone', mood: 'done', endedAt: 5 })]
  const slots = floorSlots(staff)
  expect(slots.map(s => (s.kind === 'pair' ? `pair:${s.group.members.map(m => m.id).join('+')}` : s.one.id))).toEqual(['solo1', 'pair:a+b', 'solo2'])
})

test('a group with one member still at work is on the floor with all its members; with none at work it is not', () => {
  const half = [paired('a', 'Ship it', 0, { mood: 'done', endedAt: 5 }), paired('b', 'Ship it', MIN)]
  expect(floorSlots(half)).toHaveLength(1)
  const over = [paired('a', 'Ship it', 0, { mood: 'done', endedAt: 5 }), paired('b', 'Ship it', MIN, { mood: 'done', endedAt: 6 })]
  expect(floorSlots(over)).toEqual([])
})

test('the finished list gets one slot for a group that is over, newest first, and none for members of a group still working', () => {
  const staff = [
    emp({ id: 'old', mood: 'done', endedAt: 100 }),
    paired('a', 'Ship it', 0, { mood: 'done', endedAt: 500 }), paired('b', 'Ship it', MIN, { mood: 'failed', endedAt: 900 }),
    emp({ id: 'solo', mood: 'done', endedAt: 700 }),
    paired('c', 'Other', 0, { mood: 'done', endedAt: 800 }), paired('d', 'Other', MIN),
  ]
  const slots = finishedSlots(staff, 200)
  expect(slots.map(s => (s.kind === 'pair' ? `pair:${s.group.members.map(m => m.id).join('+')}` : s.one.id))).toEqual(['pair:a+b', 'solo'])
})
