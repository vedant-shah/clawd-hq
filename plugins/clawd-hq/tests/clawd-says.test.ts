import { expect, test } from 'claude-code/testing'
import { NAP_MS, clawdMood, isBlinking, quipOf } from '../hooks/clawd-says'
import { CLAWD_LINES } from '../hooks/office'
import type { Boss } from '../types'

const boss = (over: Partial<Boss> = {}): Boss => ({
  activity: '', isBusy: false, waveUntil: 0, turns: 0, proudUntil: 0, oopsUntil: 0, lastName: '', lastTitle: '', idleSince: 0, hires: 0, wins: 0, fails: 0, ...over,
})

test('Clawd feels what the office feels: oops beats proud beats stress beats the rest', () => {
  expect(clawdMood(boss({ oopsUntil: 5, proudUntil: 5 }), 0, 0, 1, 0)).toBe('oops')
  expect(clawdMood(boss({ proudUntil: 5 }), 4, 0, 1, 0)).toBe('proud')
  expect(clawdMood(boss(), 4, 0, 1, 0)).toBe('stressed')
  expect(clawdMood(boss({ isBusy: true }), 0, 0, 1, 0)).toBe('focused')
  expect(clawdMood(boss(), 0, 2, 1, 0)).toBe('waiting')
  expect(clawdMood(boss(), 2, 0, 1, 0)).toBe('delegating')
  expect(clawdMood(boss(), 0, 0, 1, 0)).toBe('chill')
})

test('after two quiet minutes Clawd gets sleepy', () => {
  expect(clawdMood(boss({ idleSince: 1000 }), 0, 0, 1, 1000 + NAP_MS + 1)).toBe('sleepy')
  expect(clawdMood(boss({ idleSince: 1000 }), 0, 0, 1, 1000 + NAP_MS - 1)).toBe('chill')
})

test('a fresh quip wins; otherwise one of the mood lines, with the blanks filled in', () => {
  const b = boss({ quip: { text: 'Noted.', until: 10 } })
  expect(quipOf(b, 'chill', 3, {})).toBe('Noted.')
  expect(CLAWD_LINES.chill).toContain(quipOf(boss(), 'chill', 3, {}))
  expect(quipOf(boss(), 'waiting', 0, { q: 2 })).toContain('2')
  expect(quipOf(boss({ quip: { text: 'Old', until: 3 } }), 'chill', 3, {})).not.toBe('Old')
})

test('Clawd blinks now and then, not constantly', () => {
  const blinks = Array.from({ length: 110 }, (_, t) => isBlinking(t)).filter(Boolean).length
  expect(blinks).toBe(10)
  expect(isBlinking(1)).toBe(false)
})
