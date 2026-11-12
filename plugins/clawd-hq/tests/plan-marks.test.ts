import { expect, test } from 'claude-code/testing'
import { GLYPH, MARK_COLOR, MARK_HEIGHT, MARK_WIDTH, MUTED_GREEN, RAIL_COLOR, RAIL_REACH, RAIL_WIDTH, markSvg, railSvg } from '../hooks/plan-marks'
import type { MarkKind } from '../hooks/plan-marks'

const KINDS: MarkKind[] = ['done', 'now', 'attention', 'next']

test('each state has a shape of its own, so the list reads when the colours are poor', () => {
  expect(KINDS.map(k => GLYPH[k])).toEqual(['✓', '●', '✗', '○'])
  expect(new Set(KINDS.map(k => markSvg(k))).size).toBe(4)
})

test('the marks are the design board\'s: 16 by 20 images, the circle at (8, 10), done and now at radius 6, next at radius 5', () => {
  for (const kind of KINDS) expect(markSvg(kind)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 16 20" width="16" height="20" aria-hidden="true">.*<\/svg>$/)
  expect([MARK_WIDTH, MARK_HEIGHT]).toEqual([16, 20])
  expect(markSvg('done')).toContain('<circle cx="8" cy="10" r="6" fill="#2f4a35"/><path d="M5 10l2.2 2.2L11 8" fill="none" stroke="#6bbf7a" stroke-width="1.6"/>')
  expect(markSvg('now')).toContain('<circle cx="8" cy="10" r="6" fill="#e0a83a"/>')
  expect(markSvg('next')).toContain('<circle cx="8" cy="10" r="5" fill="#1a1a19" stroke="#8f8d86" stroke-width="1.5"/>')
  expect(markSvg('attention')).toContain('#e05d5d')
  expect(MARK_COLOR).toEqual({ done: MUTED_GREEN, now: '#e0a83a', attention: '#e05d5d', next: undefined })
})

test('the line joining the marks is 2 pixels wide, in the board\'s colours: green for done, dark amber for now, grey for next', () => {
  expect(RAIL_WIDTH).toBe(2)
  expect(RAIL_COLOR).toEqual({ done: '#3f6a48', now: '#6a5a33', attention: '#6b3a3a', next: '#454542' })
})

test('the line\'s picture is a plain strip down a mark\'s middle, top to foot, with no clear top, kept 2 pixels wide however it is scaled', () => {
  expect(RAIL_REACH).toBe(4000)
  expect(railSvg('#6a5a33')).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 4000" width="16" height="4000" preserveAspectRatio="none" aria-hidden="true"><rect x="7" y="0" width="2" height="4000" fill="#6a5a33"/></svg>')
})
