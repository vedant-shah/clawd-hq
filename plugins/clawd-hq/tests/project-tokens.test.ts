import { expect, test } from 'claude-code/testing'
import { keepTokens, loadTokens, tokensKey, tokensOf, withTokens } from '../hooks/project-tokens'
import type { TokensIo } from '../hooks/project-tokens'

/** The store as a fake, the session's folder (which a test can move), and what the People tab was last shown. */
function store(start: Record<string, unknown> = {}, folder = '/a') {
  const seen = {
    saved: new Map<string, unknown>(Object.entries(start)), folder, shown: undefined as Record<string, number> | undefined,
    shows: [] as Record<string, number>[], toasts: [] as string[], isSetFailing: false, held: undefined as Promise<void> | undefined,
  }
  const io: TokensIo = {
    folder: () => seen.folder,
    get: async key => seen.saved.get(key),
    set: async (key, value) => {
      if (seen.held) await seen.held
      if (seen.isSetFailing) throw new Error('the store refused the write')
      seen.saved.set(key, value)
    },
    showTokens: async m => { seen.shown = m; seen.shows.push(m) },
    toast: text => { seen.toasts.push(text) },
  }
  return { io, seen }
}

test('a store that refuses the write throws nothing: the person is told once a session, and the next session tells again', async () => {
  const { io, seen } = store()
  await loadTokens(io) // a session starts
  seen.isSetFailing = true
  await keepTokens(io, '/a', 'ecc:planner', 5_000)
  await keepTokens(io, '/a', 'ecc:planner', 3_000)
  expect(seen.toasts).toEqual(['Could not save this project\'s token totals, so the People tab may show fewer tokens than were used.'])
  expect(seen.shows).toEqual([{}])
  await loadTokens(io)
  await keepTokens(io, '/a', 'ecc:planner', 1_000)
  expect(seen.toasts).toHaveLength(2)
})

test('a session start waits for a run that is being counted, so it never shows the total from before it', async () => {
  const { io, seen } = store()
  let release = () => {}
  seen.held = new Promise<void>(done => { release = done })
  const kept = keepTokens(io, '/a', 'ecc:planner', 5_000)
  const loaded = loadTokens(io)
  release()
  await Promise.all([kept, loaded])
  expect(seen.shows).toEqual([{ 'ecc:planner': 5_000 }, { 'ecc:planner': 5_000 }])
})

test('the store key is per folder', () => {
  expect(tokensKey('/a')).toBe('tokens:/a')
  expect(tokensKey('/b')).not.toBe(tokensKey('/a'))
})

test('what the store holds is checked: only positive whole counts per type are kept', () => {
  expect(tokensOf(undefined)).toEqual({})
  expect(tokensOf('junk')).toEqual({})
  expect(tokensOf([1, 2])).toEqual({})
  expect(tokensOf({ 'ecc:planner': 5_000, bad: 'x', neg: -3, zero: 0, frac: 1.5, inf: Infinity })).toEqual({ 'ecc:planner': 5_000 })
})

test('tokens are added to a type, and the old totals are left as they were', () => {
  const before = { 'ecc:planner': 100 }
  expect(withTokens(before, 'ecc:planner', 50)).toEqual({ 'ecc:planner': 150 })
  expect(withTokens(before, 'ecc:architect', 7)).toEqual({ 'ecc:planner': 100, 'ecc:architect': 7 })
  expect(before).toEqual({ 'ecc:planner': 100 })
})

test('tokens from project A do not show in project B', async () => {
  const { io, seen } = store()
  await keepTokens(io, '/a', 'ecc:planner', 5_000)
  expect(seen.saved.get('tokens:/a')).toEqual({ 'ecc:planner': 5_000 })
  expect(seen.saved.get('tokens:/b')).toBeUndefined()
  seen.folder = '/b'
  await loadTokens(io)
  expect(seen.shown).toEqual({})
})

test('two runs in the same project add up, and the People tab is shown the new total', async () => {
  const { io, seen } = store()
  await keepTokens(io, '/a', 'ecc:planner', 5_000)
  await keepTokens(io, '/a', 'ecc:planner', 3_000)
  expect(seen.saved.get('tokens:/a')).toEqual({ 'ecc:planner': 8_000 })
  expect(seen.shown).toEqual({ 'ecc:planner': 8_000 })
})

test('two runs ending at the same moment both count', async () => {
  const { io, seen } = store()
  await Promise.all([keepTokens(io, '/a', 'ecc:planner', 5_000), keepTokens(io, '/a', 'ecc:planner', 3_000)])
  expect(seen.saved.get('tokens:/a')).toEqual({ 'ecc:planner': 8_000 })
})

test('a run kept for a folder the session has left goes to that folder, and the tab of the folder now open is not changed', async () => {
  const { io, seen } = store({ 'tokens:/b': { 'ecc:planner': 10 } }, '/b')
  await loadTokens(io)
  expect(seen.shown).toEqual({ 'ecc:planner': 10 })
  await keepTokens(io, '/a', 'ecc:planner', 5_000)
  expect(seen.saved.get('tokens:/a')).toEqual({ 'ecc:planner': 5_000 })
  expect(seen.saved.get('tokens:/b')).toEqual({ 'ecc:planner': 10 })
  expect(seen.shown).toEqual({ 'ecc:planner': 10 })
})

test('a new project shows no tokens, and nothing is kept for no folder or no tokens', async () => {
  const { io, seen } = store({}, '/new')
  await loadTokens(io)
  expect(seen.shown).toEqual({})
  await keepTokens(io, '', 'ecc:planner', 5_000)
  await keepTokens(io, '/new', 'ecc:planner', 0)
  expect([...seen.saved.keys()]).toEqual([])
})
