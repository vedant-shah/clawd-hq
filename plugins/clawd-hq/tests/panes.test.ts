import { expect, test } from 'claude-code/testing'
import { PANES, askAgain, openAtStart, openPanes, paneOf, pinHeight, type PaneIo } from '../hooks/panes'

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

/**
 * The engine's own rule for which tab is in front (its pane store, Claude Code 2.1.299): a new id is appended to the tab
 * strip and shown; opening an id that is already open only retitles it and leaves the shown tab where it was; a `focus`
 * request the surface honours (the prompt box empty and idle) shows the pane and gives it the keyboard.
 */
function engineIo() {
  const strip: string[] = []
  const state = { shown: undefined as string | undefined, focused: undefined as string | undefined, isRefusing: false, isUnplaced: false }
  const io: PaneIo = {
    open: async a => {
      if (!strip.includes(a.id)) { strip.push(a.id); state.shown = state.focused ?? a.id }
      if (a.focus === true && !state.isRefusing) { state.shown = a.id; state.focused = a.id }
    },
    list: async () => strip.map(id => ({ id, title: id, isShown: state.shown === id, isFocused: state.focused === id, isPlaced: !state.isUnplaced })),
    decisions: async () => 0,
  }
  return { io, strip, state }
}

test('the cause: in the engine a pane opened again without focus stays behind, so the newest tab is the one shown', async () => {
  const { io, state } = engineIo()
  for (const p of PANES) await io.open({ id: p.id, title: p.title(0), columns: 60 })
  await io.open({ id: 'clawd-hq', title: 'Office', columns: 60 })
  expect(state.shown).toBe('clawd-hq-clawd')
})

test('asked to focus (the /office command, a desktop session start), Office ends up shown, the strip keeps its order and Office holds the keyboard', async () => {
  const { io, strip, state } = engineIo()
  await openPanes(io, true)
  expect(strip).toEqual(PANES.map(p => p.id))
  expect(state.shown).toBe('clawd-hq')
  expect(state.focused).toBe('clawd-hq')
})

test('not asked to focus, each pane is opened once in tab order and nothing takes the keyboard', async () => {
  const { io, opened } = fakeIo()
  await openPanes(io, false)
  // A second Office open without focus would change nothing in the engine (see the cause above), so none is made.
  expect(opened.map(o => o.title)).toEqual(['Office', 'Decisions 3', 'People', 'Log', 'Clawd'])
  expect(opened.some(o => o.focus === true)).toBe(false)
})

test('when asked to focus (the /office command), only the final Office open takes the keyboard', async () => {
  const { io, opened } = fakeIo()
  await openPanes(io, true)
  expect(opened.filter(o => o.focus === true).map(o => o.id)).toEqual(['clawd-hq'])
  expect(opened[opened.length - 1]!.focus).toBe(true)
})

// ---- The session start: the same request, and one more try if the surface refused it. ----

const focusOpens = (opened: Array<{ id: string; focus?: true }>) => opened.filter(o => o.focus === true).map(o => o.id)

/** A host that records every open, answers the list from the engine's rule, and can refuse the focus request. */
function recordingEngine() {
  const engine = engineIo()
  const opened: Array<{ id: string; focus?: true }> = []
  const open = engine.io.open
  const io: PaneIo = { ...engine.io, open: async a => { opened.push(a); await open(a) } }
  return { ...engine, io, opened }
}

test('at session start Office is asked for once and, when granted, never asked for again', async () => {
  const { io, state, opened } = recordingEngine()
  await openAtStart(io)
  expect(state.shown).toBe('clawd-hq')
  expect(focusOpens(opened)).toEqual(['clawd-hq'])
  await askAgain(io)
  expect(focusOpens(opened)).toEqual(['clawd-hq'])
})

test('a refused request at session start is made once more, after the first reply, and never a third time', async () => {
  const { io, state, opened } = recordingEngine()
  state.isRefusing = true
  await openAtStart(io)
  expect(state.shown).toBe('clawd-hq-clawd')
  expect(focusOpens(opened)).toEqual(['clawd-hq'])

  // Nothing happens before the first reply ends; then the surface is ready and grants it.
  state.isRefusing = false
  await askAgain(io)
  expect(state.shown).toBe('clawd-hq')
  expect(focusOpens(opened)).toEqual(['clawd-hq', 'clawd-hq'])

  state.shown = 'clawd-hq-people'
  await askAgain(io)
  expect(state.shown).toBe('clawd-hq-people')
  expect(focusOpens(opened)).toHaveLength(2)
})

test('the second request is also used up when it is refused too', async () => {
  const { io, state, opened } = recordingEngine()
  state.isRefusing = true
  await openAtStart(io)
  await askAgain(io)
  await askAgain(io)
  expect(focusOpens(opened)).toHaveLength(2)
  expect(state.shown).toBe('clawd-hq-clawd')
})

test('with no request made at session start there is nothing to ask again', async () => {
  const { io, state, opened } = recordingEngine()
  state.isRefusing = true
  await askAgain(io)
  expect(opened).toEqual([])
})

test('a new session start forgets the old one: a granted request leaves nothing owed from a refused one', async () => {
  const { io, state, opened } = recordingEngine()
  state.isRefusing = true
  await openAtStart(io)
  state.isRefusing = false
  await openAtStart(io)
  const before = opened.length
  await askAgain(io)
  expect(opened).toHaveLength(before)
})

test('an Office the person closed, or one the terminal has not placed, is not asked for again', async () => {
  const closed = recordingEngine()
  closed.state.isRefusing = true
  await openAtStart(closed.io)
  closed.strip.splice(closed.strip.indexOf('clawd-hq'), 1)
  const before = closed.opened.length
  await askAgain(closed.io)
  expect(closed.opened).toHaveLength(before)

  const narrow = recordingEngine()
  narrow.state.isRefusing = true
  narrow.state.isUnplaced = true
  await openAtStart(narrow.io)
  const count = narrow.opened.length
  await askAgain(narrow.io)
  expect(narrow.opened).toHaveLength(count)
})

test('a host that cannot list its panes breaks neither the start nor the second try', async () => {
  const { io } = recordingEngine()
  const broken: PaneIo = { ...io, list: async () => { throw new Error('the host cannot list panes') } }
  await expect(openAtStart(broken)).resolves.toBeUndefined()
  await expect(askAgain(broken)).resolves.toBeUndefined()
})
