import { expect, test } from 'claude-code/testing'
import type { Employee } from '../types'
import { MAX_PLAN, NOTE_CHARS, parseStep, withProgress } from '../hooks/steps'
import { endRun, restart, withSaid } from '../hooks/staff-model'
import { barGlyphs, barOf, barSvg } from '../hooks/meters'

const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 'a1', type: 'ecc:planner', description: 'Plan it', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})

test('a report is a whole done from 0 and a whole total from 1 to 12', () => {
  expect(parseStep({ done: 0, total: 5 })).toEqual({ report: { done: 0, total: 5 } })
  expect(parseStep({ done: 2, total: 5, note: 'Writing the tests' })).toEqual({ report: { done: 2, total: 5, note: 'Writing the tests' } })
  expect(parseStep({ done: 12, total: MAX_PLAN })).toEqual({ report: { done: 12, total: 12 } })
  expect(parseStep({ done: 0, total: 1 })).toEqual({ report: { done: 0, total: 1 } })
})

test('done above the total is brought down to it', () => {
  expect(parseStep({ done: 9, total: 5 })).toEqual({ report: { done: 5, total: 5 } })
})

test('a total or a done that is missing, not whole, out of range or not a number is refused with a plain reason', () => {
  for (const input of [
    { done: 0 }, { done: 0, total: 0 }, { done: 0, total: 13 }, { done: 0, total: 2.5 }, { done: 0, total: '5' },
    { done: 0, total: Number.NaN }, { done: 0, total: Number.POSITIVE_INFINITY }, { done: 0, total: null },
  ]) {
    const parsed = parseStep(input)
    expect('error' in parsed && parsed.error).toMatch(/total must be a whole number from 1 to 12/)
  }
  for (const input of [{ total: 5 }, { done: -1, total: 5 }, { done: 1.5, total: 5 }, { done: '2', total: 5 }, { done: null, total: 5 }]) {
    const parsed = parseStep(input)
    expect('error' in parsed && parsed.error).toMatch(/done must be a whole number, 0 or more/)
  }
})

test('a note of at most 80 characters is kept whole; a longer one is refused, never cut', () => {
  const edge = 'x'.repeat(NOTE_CHARS)
  expect(parseStep({ done: 1, total: 3, note: edge })).toEqual({ report: { done: 1, total: 3, note: edge } })
  const over = parseStep({ done: 1, total: 3, note: 'x'.repeat(NOTE_CHARS + 1) })
  expect('error' in over && over.error).toMatch(/note is 81 characters; the most is 80/)
  // Counted in whole characters, so an emoji is one.
  expect(parseStep({ done: 1, total: 3, note: '🦀'.repeat(NOTE_CHARS) })).toEqual({ report: { done: 1, total: 3, note: '🦀'.repeat(NOTE_CHARS) } })
  expect('error' in parseStep({ done: 1, total: 3, note: 7 })).toBe(true)
})

test('a note is made plain: control characters and line breaks become single spaces, and an empty note is none', () => {
  const parsed = parseStep({ done: 1, total: 3, note: '  Fixing\u0000 the\nbug\t\u001b[31mnow\u007f  ' })
  expect(parsed).toEqual({ report: { done: 1, total: 3, note: 'Fixing the bug [31mnow' } })
  expect(parseStep({ done: 1, total: 3, note: ' \n\u0000 ' })).toEqual({ report: { done: 1, total: 3 } })
  // Invisible characters that reorder or hide text are dropped too.
  expect(parseStep({ done: 1, total: 3, note: 'a‮b​c' })).toEqual({ report: { done: 1, total: 3, note: 'a b c' } })
  // The count is made on the clean text: a note padded with line breaks is not punished for them.
  expect('report' in parseStep({ done: 1, total: 3, note: `ok${'\n'.repeat(200)}fine` })).toBe(true)
})

test('a report lands on a copy of the specialist; a new total replaces the old, and a note left out clears the old one', () => {
  const start = emp()
  const first = withProgress(start, { done: 0, total: 5, note: 'Reading the code' })
  expect(first).toMatchObject({ stepDone: 0, stepTotal: 5, stepNote: 'Reading the code' })
  expect(start.stepTotal).toBeUndefined()
  const replanned = withProgress(first, { done: 2, total: 8 })
  expect(replanned).toMatchObject({ stepDone: 2, stepTotal: 8, stepNote: undefined })
  expect(first.stepTotal).toBe(5)
})

test('what the specialist says next takes the place of an older note, and keeps the count', () => {
  const noted = emp({ stepDone: 2, stepTotal: 5, stepNote: 'Writing the tests' })
  const talking = withSaid(noted, 'Checking the rules.')
  expect(talking).toMatchObject({ said: 'Checking the rules.', stepDone: 2, stepTotal: 5, stepNote: undefined })
})

test('a run that ends, or a new run after a stop, starts with no progress', () => {
  const going = emp({ stepDone: 3, stepTotal: 5, stepNote: 'Almost' })
  expect(endRun(going, 'done', 'signal', 10, 1)).toMatchObject({ stepDone: undefined, stepTotal: undefined, stepNote: undefined })
  const ended = endRun(emp(), 'done', 'signal', 10, 1)
  expect(restart({ ...ended, stepDone: 3, stepTotal: 5 }, 20, 2)).toMatchObject({ stepDone: undefined, stepTotal: undefined })
})

test('the small bar is 10 cells and 100 wide, the same shapes as the wide one', () => {
  expect(barOf(50, 'small')).toEqual({ filled: 5, total: 10 })
  expect(barOf(1, 'small')).toEqual({ filled: 1, total: 10 })
  expect(barOf(100, 'small')).toEqual({ filled: 10, total: 10 })
  expect(barGlyphs(40, 'small')).toEqual({ on: '━'.repeat(4), off: '─'.repeat(6) })
  expect(barGlyphs(50)).toEqual({ on: '━'.repeat(10), off: '─'.repeat(10) })
  const half = barSvg(50, 'small')
  expect(half).toContain('width="100" height="4"')
  expect(half).toContain('<rect width="50" height="4" rx="2"')
  expect(barSvg(1, 'small')).toContain('<rect width="4" height="4" rx="2"')
  expect(barSvg(50)).toContain('width="200" height="4"')
})
