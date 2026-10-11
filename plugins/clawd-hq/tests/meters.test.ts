import { expect, test } from 'claude-code/testing'
import { barGlyphs, barOf, barSvg, formatLeft, headerGauges } from '../hooks/meters'
import { ACCENT } from '../hooks/office'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const inMs = (ms: number) => new Date(NOW + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

test('time left reads as minutes, hours and minutes, or days and hours', () => {
  expect(formatLeft(48 * MIN)).toBe('48m')
  expect(formatLeft(HOUR + 48 * MIN)).toBe('1h 48m')
  expect(formatLeft(3 * DAY + 4 * HOUR + 59 * MIN)).toBe('3d 4h')
  expect(formatLeft(24 * HOUR)).toBe('1d 0h')
  expect(formatLeft(59 * HOUR + 59 * MIN)).toBe('2d 11h')
  expect(formatLeft(30_000)).toBe('<1m')
})

test('a time that has passed, or is not a number, shows nothing', () => {
  expect(formatLeft(0)).toBeUndefined()
  expect(formatLeft(-5 * MIN)).toBeUndefined()
  expect(formatLeft(Number.NaN)).toBeUndefined()
})

test('the bar is 7 cells, shows at least a sliver when anything is used, and never overflows', () => {
  expect(barOf(0)).toEqual({ filled: 0, total: 7 })
  expect(barOf(1)).toEqual({ filled: 1, total: 7 })
  expect(barOf(21)).toEqual({ filled: 1, total: 7 })
  expect(barOf(50)).toEqual({ filled: 4, total: 7 })
  expect(barOf(100)).toEqual({ filled: 7, total: 7 })
  expect(barOf(180)).toEqual({ filled: 7, total: 7 })
  expect(barOf(-4)).toEqual({ filled: 0, total: 7 })
  expect(barOf(Number.NaN)).toEqual({ filled: 0, total: 7 })
})

test('the terminal bar is thin line glyphs: heavy for the used part, light for the rest', () => {
  expect(barGlyphs(50)).toEqual({ on: '━━━━', off: '───' })
  expect(barGlyphs(0)).toEqual({ on: '', off: '───────' })
  expect(barGlyphs(100)).toEqual({ on: '━━━━━━━', off: '' })
})

test('the image bar is 48 by 4 with rounded ends, a dim track and an accent fill that is at least a rounded dot', () => {
  const half = barSvg(50)
  expect(half).toContain('width="48" height="4"')
  expect(half.match(/rx="2"/g)).toHaveLength(2)
  expect(half).toContain(`<rect width="24" height="4" rx="2" fill="${ACCENT}"/>`)
  expect(barSvg(1)).toContain(`<rect width="4" height="4" rx="2" fill="${ACCENT}"/>`)
  expect(barSvg(100)).toContain(`<rect width="48" height="4" rx="2" fill="${ACCENT}"/>`)
  expect(barSvg(400)).toContain(`<rect width="48" height="4" rx="2" fill="${ACCENT}"/>`)
  // Nothing used: the track alone.
  expect(barSvg(0).match(/<rect/g)).toHaveLength(1)
  expect(barSvg(Number.NaN).match(/<rect/g)).toHaveLength(1)
})

test('the header has context, then session and week with their percent and time left', () => {
  const gauges = headerGauges({
    startedAt: 0, contextPercent: 20.6,
    limits: [
      { kind: 'five_hour', percentUsed: 62.4, resetsAt: inMs(HOUR + 15 * MIN) },
      { kind: 'seven_day', percentUsed: 33.6, resetsAt: inMs(4 * DAY + 22 * HOUR) },
    ],
  }, NOW)
  expect(gauges.map(g => g.key)).toEqual(['context', 'session', 'week'])
  expect(gauges.map(g => g.label)).toEqual(['Context', 'Session', 'Week'])
  expect(gauges.map(g => g.percent)).toEqual(['21%', '62%', '34%'])
  expect(gauges.map(g => g.value)).toEqual([20.6, 62.4, 33.6])
  expect(gauges.map(g => g.left)).toEqual([undefined, '1h 15m', '4d 22h'])
})

test('with no rate limits (no subscription) session and week are hidden, context stays', () => {
  const gauges = headerGauges({ startedAt: 0, contextPercent: 4, limits: [] }, NOW)
  expect(gauges.map(g => g.key)).toEqual(['context'])
  expect(gauges[0]!.percent).toBe('4%')
})

test('a window with no reset time, or one already past, is hidden; other kinds are ignored', () => {
  const gauges = headerGauges({
    startedAt: 0, limits: [
      { kind: 'five_hour', percentUsed: 5 },
      { kind: 'seven_day', percentUsed: 5, resetsAt: inMs(-MIN) },
      { kind: 'spend_limit', percentUsed: 5, resetsAt: inMs(HOUR) },
    ],
  }, NOW)
  expect(gauges.map(g => g.key)).toEqual(['context'])
})

test('one window can show while the other is hidden, and a percent past 100 reads as 100', () => {
  const gauges = headerGauges({ startedAt: 0, contextPercent: 140, limits: [{ kind: 'seven_day', percentUsed: 99.6, resetsAt: inMs(2 * HOUR) }] }, NOW)
  expect(gauges.map(g => g.key)).toEqual(['context', 'week'])
  expect(gauges.map(g => g.percent)).toEqual(['100%', '100%'])
})

test('before the first reading context shows a dash and an empty bar', () => {
  const [context] = headerGauges({ startedAt: 0, limits: [] }, NOW)
  expect(context!.percent).toBe('–')
  expect(context!.value).toBe(0)
})
