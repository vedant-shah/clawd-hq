import { expect, test } from 'claude-code/testing'
import { PANES, paneOf, pinHeight } from '../hooks/panes'

test('the four panes, in the order the host shows them as tabs, with the office keeping its old id', () => {
  expect(PANES.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-decisions', 'clawd-hq-people', 'clawd-hq-log'])
  expect(PANES.map(p => p.view)).toEqual(['office', 'decisions', 'people', 'log'])
  expect(PANES.map(p => p.title(0))).toEqual(['Office', 'Decisions', 'People', 'Log'])
})

test('the Decisions title carries the count of what the project remembers, and only that one', () => {
  expect(PANES.map(p => p.title(44))).toEqual(['Office', 'Decisions 44', 'People', 'Log'])
  expect(PANES[1]!.title(1)).toBe('Decisions 1')
})

test('every view has its pane', () => {
  for (const pane of PANES) expect(paneOf(pane.view)).toBe(pane)
})

test('the footer is pinned by filling the room: in rows on a docked terminal, by percent elsewhere, and not at all inline on the terminal', () => {
  expect(pinHeight('terminal', 'dock', 40)).toBe(40)
  expect(pinHeight('terminal', 'inline', 12)).toBeUndefined()
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) expect(pinHeight(surface, 'dock', 40)).toBe('100%')
  expect(pinHeight('desktop', 'inline', 12)).toBe('100%')
  // A room that is not a positive whole number is no room to fill.
  expect(pinHeight('terminal', 'dock', 0)).toBeUndefined()
  expect(pinHeight('terminal', 'dock', Number.NaN)).toBeUndefined()
})
