import { expect, test } from 'claude-code/testing'
import { PANES, openPanes, paneOf, pinHeight, type PaneIo } from '../hooks/panes'

test('the five panes, in the order the host shows them as tabs, with the office keeping its old id and Clawd last', () => {
  expect(PANES.map(p => p.id)).toEqual(['clawd-hq', 'clawd-hq-decisions', 'clawd-hq-people', 'clawd-hq-log', 'clawd-hq-clawd'])
  expect(PANES.map(p => p.view)).toEqual(['office', 'decisions', 'people', 'log', 'clawd'])
  expect(PANES.map(p => p.title(0))).toEqual(['Office', 'Decisions', 'People', 'Log', 'Clawd'])
})

test('the Decisions title carries the count of what the project remembers, and only that one', () => {
  expect(PANES.map(p => p.title(44))).toEqual(['Office', 'Decisions 44', 'People', 'Log', 'Clawd'])
  expect(PANES[1]!.title(1)).toBe('Decisions 1')
})

test('every view has its pane', () => {
  for (const pane of PANES) expect(paneOf(pane.view)).toBe(pane)
})

test('the footer is pinned by filling the room: in rows where the surface gave them, by percent when it did not, and not at all inline on the terminal', () => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) expect(pinHeight(surface, 'dock', 40)).toBe(40)
  expect(pinHeight('terminal', 'inline', 12)).toBeUndefined()
  expect(pinHeight('desktop', 'inline', 12)).toBe(12)
  // A room that is not a positive whole number is no room to fill: the terminal fits its tree, the others ask for their whole body.
  expect(pinHeight('terminal', 'dock', 0)).toBeUndefined()
  expect(pinHeight('terminal', 'dock', Number.NaN)).toBeUndefined()
  expect(pinHeight('desktop', 'dock', 0)).toBe('100%')
  expect(pinHeight('desktop', 'dock', Number.NaN)).toBe('100%')
})

// ---- Opening: which tab is in front, and whether it takes the keyboard. ----

function fakeIo() {
  const opened: Array<{ id: string; title: string; focus?: true }> = []
  const io: PaneIo = {
    open: async a => { opened.push(a) },
    list: async () => [],
    decisions: async () => 3,
  }
  return { io, opened }
}

test('at session start the tabs are opened in order and Office is opened last, so it is the one in front', async () => {
  const { io, opened } = fakeIo()
  await openPanes(io, false)
  expect(opened.slice(0, 5).map(o => o.title)).toEqual(['Office', 'Decisions 3', 'People', 'Log', 'Clawd'])
  expect(opened[opened.length - 1]!.id).toBe('clawd-hq')
})

test('without being asked to focus, no open takes the keyboard, so the person can type straight away', async () => {
  const { io, opened } = fakeIo()
  await openPanes(io, false)
  expect(opened.some(o => o.focus === true)).toBe(false)
})

test('when asked to focus (the /office command), only the final Office open takes the keyboard', async () => {
  const { io, opened } = fakeIo()
  await openPanes(io, true)
  expect(opened.filter(o => o.focus === true).map(o => o.id)).toEqual(['clawd-hq'])
  expect(opened[opened.length - 1]!.focus).toBe(true)
})
