import { expect, test } from 'claude-code/testing'
import { ALERT_AT, WARN_AT, usageTint } from '../hooks/usage-tint'
import { AMBER, RED } from '../hooks/office'

test('the thresholds are 70 and 90', () => {
  expect([WARN_AT, ALERT_AT]).toEqual([70, 90])
})

test('below 70 stays the normal colour, 70 is amber, 90 is red, at the edges', () => {
  expect(usageTint(0)).toBeUndefined()
  expect(usageTint(69)).toBeUndefined()
  expect(usageTint(70)).toBe(AMBER)
  expect(usageTint(89)).toBe(AMBER)
  expect(usageTint(90)).toBe(RED)
  expect(usageTint(100)).toBe(RED)
})

test('the colour follows the percent as it reads (rounded), not the hidden decimals', () => {
  expect(usageTint(69.4)).toBeUndefined()
  expect(usageTint(69.6)).toBe(AMBER)
  expect(usageTint(89.4)).toBe(AMBER)
  expect(usageTint(89.6)).toBe(RED)
})

test('a missing or unreadable value stays plain, and a value past the ends is held to them', () => {
  expect(usageTint(undefined)).toBeUndefined()
  expect(usageTint(Number.NaN)).toBeUndefined()
  expect(usageTint(Number.POSITIVE_INFINITY)).toBeUndefined()
  expect(usageTint(-5)).toBeUndefined()
  expect(usageTint(250)).toBe(RED)
})
