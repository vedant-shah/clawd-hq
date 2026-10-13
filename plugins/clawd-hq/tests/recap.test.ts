import { expect, test } from 'claude-code/testing'
import { RECAP_AFTER_MS, RECAP_CHARS, RECAP_MIN_TURNS, RECAP_PROMPT, isRecapDue, recapLine } from '../hooks/recap'

const MIN = 60_000
const quiet = { isOn: true, isBusy: false, idleSince: 1_000, now: 1_000 + 3 * MIN, turns: 3, lastFor: 0 }

test('a recap is due after three quiet minutes, once three turns are done', () => {
  expect([RECAP_AFTER_MS, RECAP_MIN_TURNS, RECAP_CHARS]).toEqual([3 * MIN, 3, 280])
  expect(isRecapDue(quiet)).toBe(true)
  expect(isRecapDue({ ...quiet, now: quiet.now - 1 })).toBe(false)
  expect(isRecapDue({ ...quiet, turns: 2 })).toBe(false)
})

test('no recap while Clawd works, when it is switched off, or before any turn has ended', () => {
  expect(isRecapDue({ ...quiet, isBusy: true })).toBe(false)
  expect(isRecapDue({ ...quiet, isOn: false })).toBe(false)
  expect(isRecapDue({ ...quiet, idleSince: 0 })).toBe(false)
})

test('a recap is never made twice in a row: one per pause, and again only after another turn', () => {
  expect(isRecapDue({ ...quiet, lastFor: 3 })).toBe(false)
  expect(isRecapDue({ ...quiet, now: quiet.now + 60 * MIN, lastFor: 3 })).toBe(false)
  expect(isRecapDue({ ...quiet, turns: 4, lastFor: 3 })).toBe(true)
})

test('the recap is one line of at most 280 characters, cut at a word with no mark', () => {
  expect(recapLine('  Fixed the login bug.\n\nNext: add the tests.  ')).toBe('Fixed the login bug. Next: add the tests.')
  const long = recapLine('The scoring work is done and reviewed. '.repeat(30))!
  expect(long.length).toBeLessThanOrEqual(280)
  expect(long.endsWith('…')).toBe(false)
  expect(long.endsWith(' ')).toBe(false)
  expect(recapLine('   \n ')).toBeUndefined()
  // Control characters in a reply never reach the panel.
  expect(recapLine('Done\u001b[2J.\u0007 Next: x')).toBe('Done [2J. Next: x')
})

test('the question asks for two short sentences: what we are working on, then the next step, and nothing already done', () => {
  expect(RECAP_PROMPT).toMatch(/two short sentences/)
  expect(RECAP_PROMPT).toMatch(/200 characters/)
  expect(RECAP_PROMPT).toMatch(/what we are working on/)
  expect(RECAP_PROMPT).toMatch(/the next step/)
  expect(RECAP_PROMPT).toMatch(/Leave out what is already done/)
  expect(RECAP_PROMPT).toMatch(/no line breaks/)
})
