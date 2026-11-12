import { expect, test } from 'claude-code/testing'
import { GLYPH, MARK_COLOR, MUTED_GREEN, RAIL_COLOR, markSvg } from '../hooks/plan-marks'
import type { MarkKind } from '../hooks/plan-marks'

const KINDS: MarkKind[] = ['done', 'now', 'attention', 'next']

test('each state has a shape of its own, so the list reads when the colours are poor', () => {
  expect(KINDS.map(k => GLYPH[k])).toEqual(['✓', '●', '✗', '○'])
  expect(new Set(KINDS.map(k => markSvg(k))).size).toBe(4)
})

test('the marks are valid images of one size, and the colours are the office\'s: green for done, amber for now, red for failed, none for next', () => {
  for (const kind of KINDS) expect(markSvg(kind)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 14 14" width="14" height="14">.*<\/svg>$/)
  expect(markSvg('done')).toContain('#6bbf7a')
  expect(markSvg('now')).toContain('#e0a83a')
  expect(markSvg('attention')).toContain('#e05d5d')
  expect(MARK_COLOR).toEqual({ done: MUTED_GREEN, now: '#e0a83a', attention: '#e05d5d', next: undefined })
  expect(RAIL_COLOR.done).toBe(MUTED_GREEN)
})
