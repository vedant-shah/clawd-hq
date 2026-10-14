import { expect, test } from 'claude-code/testing'
import { barGlyphs, barOf, barSvg, limitsOf, percentLabel } from '../hooks/meters'
import { ACCENT } from '../hooks/office'

test('the bar is 20 cells, shows at least a sliver when anything is used, and never overflows', () => {
  expect(barOf(0)).toEqual({ filled: 0, total: 20 })
  expect(barOf(1)).toEqual({ filled: 1, total: 20 })
  expect(barOf(17)).toEqual({ filled: 3, total: 20 })
  expect(barOf(50)).toEqual({ filled: 10, total: 20 })
  expect(barOf(100)).toEqual({ filled: 20, total: 20 })
  expect(barOf(180)).toEqual({ filled: 20, total: 20 })
  expect(barOf(-4)).toEqual({ filled: 0, total: 20 })
  expect(barOf(Number.NaN)).toEqual({ filled: 0, total: 20 })
})

test('the terminal bar is thin line glyphs: heavy for the used part, light for the rest', () => {
  expect(barGlyphs(50)).toEqual({ on: '━'.repeat(10), off: '─'.repeat(10) })
  expect(barGlyphs(0)).toEqual({ on: '', off: '─'.repeat(20) })
  expect(barGlyphs(100)).toEqual({ on: '━'.repeat(20), off: '' })
})

test('the image bar is 200 by 4 with rounded ends, a dim track and an accent fill that is at least a rounded dot', () => {
  const half = barSvg(50)
  expect(half).toContain('width="200" height="4"')
  expect(half.match(/rx="2"/g)).toHaveLength(2)
  expect(half).toContain(`<rect width="100" height="4" rx="2" fill="${ACCENT}"/>`)
  expect(barSvg(1)).toContain(`<rect width="4" height="4" rx="2" fill="${ACCENT}"/>`)
  expect(barSvg(100)).toContain(`<rect width="200" height="4" rx="2" fill="${ACCENT}"/>`)
  expect(barSvg(400)).toContain(`<rect width="200" height="4" rx="2" fill="${ACCENT}"/>`)
  // Nothing used: the track alone.
  expect(barSvg(0).match(/<rect/g)).toHaveLength(1)
  expect(barSvg(Number.NaN).match(/<rect/g)).toHaveLength(1)
})

test('a percent reads whole, at most 100, and anything above zero reads at least 1 so the label and the bar agree', () => {
  expect(percentLabel(62.4)).toBe('62%')
  expect(percentLabel(99.6)).toBe('100%')
  expect(percentLabel(140)).toBe('100%')
  expect(percentLabel(0.3)).toBe('1%')
  expect(percentLabel(0)).toBe('0%')
  expect(percentLabel(Number.NaN)).toBe('0%')
  expect(barOf(0.3).filled).toBe(1)
  expect(barSvg(0.3)).toContain('<rect width="4"')
  expect(barGlyphs(0.3).on).toBe('━')
})

test('the limits are kept as the gauge reads them: kind, percent and reset time, nothing else', () => {
  const engine = [{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-10-11T13:00:00Z', label: 'extra' }, { kind: 'seven_day', percentUsed: 3 }]
  expect(limitsOf(engine)).toEqual([{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-10-11T13:00:00Z' }, { kind: 'seven_day', percentUsed: 3, resetsAt: undefined }])
  expect(limitsOf([])).toEqual([])
})
