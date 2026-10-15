import { expect, test } from 'claude-code/testing'
import { freshHire, isLively, quietBoss, settle, turnEndBoss, withBlurb, withJobs, withLaidOff } from '../hooks/office-state'
import { BOSS0 } from '../hooks/state'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({
  id: 'a1', type: 'ecc:tdd-guide', description: 'Build', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})

// ---- The frame: whether the office has anything moving ----

test('the office is lively with someone at a desk, a cheer still on, Clawd busy, a demo, a quip or a wave; quiet otherwise', () => {
  const quiet = { list: [] as Employee[], fx: {}, boss: BOSS0, tick: 10 }
  expect(isLively(quiet.list, quiet.fx, quiet.boss, quiet.tick)).toBe(false)
  expect(isLively([emp({})], {}, BOSS0, 10)).toBe(true)
  expect(isLively([emp({ mood: 'done', doneTick: 8 })], {}, BOSS0, 10)).toBe(true)
  expect(isLively([emp({ mood: 'done', doneTick: 2 })], {}, BOSS0, 10)).toBe(false)
  expect(isLively([], {}, { ...BOSS0, isBusy: true }, 10)).toBe(true)
  expect(isLively([], { demo: { step: 1, total: 3, caption: 'x' } }, BOSS0, 10)).toBe(true)
  expect(isLively([], {}, { ...BOSS0, quip: { text: 'hi', until: 11 } }, 10)).toBe(true)
  expect(isLively([], {}, { ...BOSS0, quip: { text: 'hi', until: 10 } }, 10)).toBe(false)
  expect(isLively([], {}, { ...BOSS0, waveUntil: 11 }, 10)).toBe(true)
})

test('an arrival of three ticks or more starts thinking; a newer arrival and anyone else are left as they were', () => {
  const list = [emp({ id: 'old', mood: 'arriving', joinedTick: 2 }), emp({ id: 'new', mood: 'arriving', joinedTick: 4 }), emp({ id: 'w', joinedTick: 0 })]
  const next = settle(list, 5)
  expect(next.map(e => e.mood)).toEqual(['thinking', 'arriving', 'working'])
  expect(next[1]).toBe(list[1])
  expect(list[0]!.mood).toBe('arriving')
})

// ---- Clawd's card ----

test('a main-chat turn that ends frees Clawd, notes when, and says how it went', () => {
  const busy = { ...BOSS0, isBusy: true }
  expect(turnEndBoss(busy, 'answer', 900)).toEqual({ ...busy, isBusy: false, idleSince: 900, doneAt: 900, activity: 'All done, boss.' })
  expect(turnEndBoss(busy, 'aborted', 900).activity).toBe('Hmm, that turn stopped early.')
  expect(busy.isBusy).toBe(true)
})

test('the tour goes quiet: not busy, no pride, no oops, no quip, and asleep already', () => {
  const b = { ...BOSS0, isBusy: true, proudUntil: 9, oopsUntil: 9, quip: { text: 'x', until: 9 } }
  expect(quietBoss(b, 1_000_000, 60_000)).toEqual({ ...b, isBusy: false, proudUntil: 0, oopsUntil: 0, quip: undefined, idleSince: 1_000_000 - 60_000 - 1 })
})

// ---- The books ----

test('a new hire arrives with its name and description cut to size, no tools yet, seen now', () => {
  const one = freshHire({ id: 'a1', type: 'ecc:planner', description: 'Plan it', name: 'scout' }, 500, 7)
  expect(one).toEqual({ id: 'a1', type: 'ecc:planner', description: 'Plan it', name: 'scout', mood: 'arriving', tools: 0, startedAt: 500, lastSeen: 500, joinedTick: 7 })
  expect('name' in freshHire({ id: 'a2', type: 't', description: 'd' }, 1, 1)).toBe(false)
  expect(freshHire({ id: 'a3', type: 't', description: 'x'.repeat(400), name: 'n'.repeat(90) }, 1, 1).description.length).toBeLessThan(400)
})

test('a type\'s job count grows by the jobs given and a new type starts at them; the old books are untouched', () => {
  const books = { 'ecc:planner': { jobs: 2 } }
  expect(withJobs(books, 'ecc:planner', 1)).toEqual({ 'ecc:planner': { jobs: 3 } })
  expect(withJobs(books, 'Explore', 0)).toEqual({ 'ecc:planner': { jobs: 2 }, Explore: { jobs: 0 } })
  expect(books).toEqual({ 'ecc:planner': { jobs: 2 } })
})

test('a laid-off type joins the list once and is reviewed; a rehire takes it off', () => {
  const p = { laidOff: ['a', 'b'], isReviewed: false, stacks: [] }
  expect(withLaidOff(p, 'a', true)).toEqual({ laidOff: ['b', 'a'], isReviewed: true, stacks: [] })
  expect(withLaidOff(p, 'b', false)).toEqual({ laidOff: ['a'], isReviewed: true, stacks: [] })
  expect(p.laidOff).toEqual(['a', 'b'])
})

test('a blurb replaces the type\'s old one and goes last; the oldest go past the cap', () => {
  expect(Object.entries(withBlurb({ a: '1', b: '2' }, 'a', 'new'))).toEqual([['b', '2'], ['a', 'new']])
  const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`t${i}`, 'x']))
  const kept = withBlurb(many, 'fresh', 'y')
  expect(Object.keys(kept)).toHaveLength(120)
  expect(kept.t0).toBeUndefined()
  expect(kept.fresh).toBe('y')
})
