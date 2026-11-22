import { expect, test } from 'claude-code/testing'
import { LEFT_KEEP, LEFT_SHOWN, cleanLeft, isSimilar, leftShown, markerLine, noteOf, promptOf, splitMarkers, withLeft } from '../hooks/left-list'
import type { LeftItem } from '../types'

const item = (over: Partial<LeftItem> = {}): LeftItem => ({ id: 'l1', text: 'Add rate limiting', source: 'check', by: 'Clawd', at: 10, ...over })
const fresh = (text: string, over: Record<string, unknown> = {}) => ({ text, source: 'check' as const, by: 'Clawd', ...over })

test('new items go on top, newest first, each with an id and the time', () => {
  const first = withLeft([], [fresh('Add rate limiting')], 100)
  const both = withLeft(first, [fresh('Write the docs'), fresh('Tidy the tests')], 200)
  expect(both.map(i => i.text)).toEqual(['Write the docs', 'Tidy the tests', 'Add rate limiting'])
  expect(both.map(i => i.at)).toEqual([200, 200, 100])
  expect(new Set(both.map(i => i.id)).size).toBe(3)
})

test('near-identical items are one: spelling, case, punctuation and small wording changes', () => {
  expect(isSimilar('Add rate limiting.', 'add rate limiting')).toBe(true)
  expect(isSimilar('I skipped the end-to-end tests', 'I skipped the end to end tests.')).toBe(true)
  expect(isSimilar('Add rate limiting to the API', 'Add rate limiting to the API now')).toBe(true)
  expect(isSimilar('Add rate limiting', 'Write the docs')).toBe(false)
  expect(isSimilar('Add rate limiting to the login route', 'Add pagination to the login route')).toBe(false)
  expect(isSimilar('', '')).toBe(false)
})

test('a repeat replaces the older copy, moves to the top and takes the new time', () => {
  const list = withLeft(withLeft([], [fresh('Add rate limiting.')], 100), [fresh('Write the docs')], 150)
  const next = withLeft(list, [fresh('add rate limiting')], 300)
  expect(next.map(i => [i.text, i.at])).toEqual([['add rate limiting', 300], ['Write the docs', 150]])
})

test('the same note in the same file is one item even when its line moved; the same text in two files is two', () => {
  const a = withLeft([], [fresh('TODO: handle empty list', { source: 'file', file: 'src/a.ts', line: 4 })], 100)
  const moved = withLeft(a, [fresh('TODO: handle empty list', { source: 'file', file: 'src/a.ts', line: 9 })], 200)
  expect(moved.map(i => i.line)).toEqual([9])
  const other = withLeft(moved, [fresh('TODO: handle empty list', { source: 'file', file: 'src/b.ts', line: 2 })], 300)
  expect(other.map(i => i.file)).toEqual(['src/b.ts', 'src/a.ts'])
})

test('only the newest 10 are kept', () => {
  let list: LeftItem[] = []
  for (let n = 0; n < LEFT_KEEP + 5; n += 1) list = withLeft(list, [fresh(`Distinct job number ${n} about thing${n}x`)], n)
  expect(list.length).toBe(LEFT_KEEP)
  expect(list[0]!.text).toContain(`number ${LEFT_KEEP + 4} `)
  expect(LEFT_KEEP).toBe(10)
})

test('the panel draws the newest 3 and counts the rest', () => {
  const list = Array.from({ length: 7 }, (_, n) => item({ id: `l${n}`, text: `Job ${n}` }))
  expect(LEFT_SHOWN).toBe(3)
  expect(leftShown(list)).toEqual({ rows: list.slice(0, LEFT_SHOWN), more: 4 })
  expect(leftShown(list.slice(0, 2))).toEqual({ rows: list.slice(0, 2), more: 0 })
  expect(leftShown([])).toEqual({ rows: [], more: 0 })
})

test('the note under an item names its source, and for a file the file and line', () => {
  expect(noteOf(item())).toBe('Second check · Clawd')
  expect(noteOf(item({ source: 'file', by: 'Builder', file: 'src/a.ts', line: 12 }))).toBe('File · src/a.ts:12 · Builder')
  expect(noteOf(item({ source: 'file', by: 'Builder', file: 'src/a.ts' }))).toBe('File · src/a.ts · Builder')
})

test('Do it now fills the box with the exact sentence; a file item names where, and a closing stop is not doubled', () => {
  expect(promptOf(item())).toBe('You left this undone: Add rate limiting. Do it now.')
  expect(promptOf(item({ text: 'Add rate limiting.' }))).toBe('You left this undone: Add rate limiting. Do it now.')
  expect(promptOf(item({ source: 'file', text: 'TODO: handle empty list', file: 'src/a.ts', line: 12 }))).toBe('You left this undone: TODO: handle empty list (src/a.ts:12). Do it now.')
})

test('a list read back from the store is cleaned: bad entries go, text is one clean line, repeats and the surplus go', () => {
  const good = item({ id: 'a', text: 'Keep me' })
  const raw = [
    good, null, 'junk', { id: 'x' }, item({ id: 'b', source: 'nope' as never }), item({ id: 'c', at: Number.NaN }), item({ id: 'd', text: '' }),
    item({ id: 'e', text: 'TODO: Two\nlines\u0007 here', source: 'file', file: 'src/a.ts', line: 3 }), item({ id: 'f', text: 'keep me.' }), item({ id: 'g', file: 7 as never, line: -1 }),
  ]
  const clean = cleanLeft(raw)
  expect(clean.map(i => i.id)).toEqual(['a', 'e', 'g'])
  expect(clean[1]).toEqual(expect.objectContaining({ text: 'TODO: Two lines here', file: 'src/a.ts', line: 3 }))
  expect(clean[2]).toEqual({ id: 'g', text: 'Add rate limiting', source: 'check', by: 'Clawd', at: 10 })
  for (const odd of [undefined, null, 7, 'x', {}]) expect(cleanLeft(odd)).toEqual([])
  expect(cleanLeft(Array.from({ length: 50 }, (_, n) => item({ id: `i${n}`, text: `Unique job ${n} thing${n}z` }))).length).toBe(LEFT_KEEP)
})

test('on load, what an earlier version saved and this one no longer lists is dropped: answer items, files that are not code, files outside the project', () => {
  const old = [
    { id: 'a1', text: "I'll do that later", source: 'answer', by: 'Clawd', at: 9 },
    { id: 'a2', text: 'whether a TODO you write shows up with the right line', source: 'answer', by: 'Clawd', at: 9 },
    { id: 'f1', text: '- It keeps a "Left undone" list on the Office tab', source: 'file', by: 'Generalist', at: 8, file: 'README.md', line: 69 },
    { id: 'f2', text: 'TODO: from a note', source: 'file', by: 'Generalist', at: 8, file: 'docs/plan.mdx', line: 2 },
    { id: 'f3', text: 'TODO: in the docs folder', source: 'file', by: 'Generalist', at: 8, file: 'docs/example.ts', line: 2 },
    { id: 'f4', text: 'TODO: full local path', source: 'file', by: 'Generalist', at: 8, file: '/Users/me/project/src/a.ts', line: 2 },
    { id: 'f5', text: 'TODO: outside', source: 'file', by: 'Generalist', at: 8, file: '../other/a.ts', line: 2 },
    { id: 'f6', text: 'TODO: no file', source: 'file', by: 'Generalist', at: 8 },
    { id: 'k1', text: 'Add the tests', source: 'check', by: 'Clawd', at: 7 },
    { id: 'f7', text: 'TODO: real one', source: 'file', by: 'Builder', at: 6, file: 'src/a.ts', line: 4 },
  ]
  expect(cleanLeft(old).map(i => i.id)).toEqual(['k1', 'f7'])
  expect(cleanLeft(old.slice(0, 7))).toEqual([])
  // Loading again changes nothing more.
  expect(cleanLeft(cleanLeft(old))).toEqual(cleanLeft(old))
})

test('on load, saved file items the scanner would no longer report are dropped: template text, and lines that are no marker', () => {
  const file = (id: string, text: string, name = 'src/a.ts') => ({ id, text, source: 'file', by: 'Builder', at: 5, file: name, line: 2 })
  const old = [
    file('j1', 'TODO: ${text}\\n`), { result: \'ok\' })'), file('j2', 'TODO: ${text}`, ...(agentId === undefined ? {} : { agentId }) } as never)'),
    file('j3', 'TODO: ${text}\\n` } as never)'), file('j4', 'just some words'), file('j5', 'FIXME: real', 'a.py'), file('j6', "it.skip('x', f)"),
    file('j7', 'throw new Error(\'Not implemented\')'), file('j8', 'TODO: it\'s fine'),
  ]
  expect(cleanLeft(old).map(i => i.id)).toEqual(['j5', 'j6', 'j7', 'j8'])
})

// ---- Code markers are one side line ----

const mark = (id: string, text: string, over: Partial<LeftItem> = {}) => item({ id, text, source: 'file', file: 'src/a.ts', line: 1, ...over })

test('TODO, FIXME and XXX file items are split from the rest; skipped tests, not-implemented, plan and check items stay as rows', () => {
  const list = [
    mark('a', 'TODO: one'), mark('b', "it.skip('x', f)"), mark('c', 'FIXME: two'), mark('d', 'raise NotImplementedError'), mark('e', 'XXX: three'),
    item({ id: 'f', text: 'TODO: put off in a plan', source: 'plan' }), item({ id: 'g', text: 'TODO: from the old check' }),
  ]
  const { rows, markers } = splitMarkers(list)
  expect(markers.map(i => i.id)).toEqual(['a', 'c', 'e'])
  expect(rows.map(i => i.id)).toEqual(['b', 'd', 'f', 'g'])
})

test('the side line counts the markers and names the kinds present, in a fixed order', () => {
  expect(markerLine([mark('a', 'TODO: one')])).toBe('1 code marker (TODO)')
  expect(markerLine([mark('a', 'FIXME: x'), mark('b', 'TODO: y'), mark('c', 'TODO: z')])).toBe('3 code markers (TODO, FIXME)')
  expect(markerLine([mark('a', 'XXX: x'), mark('b', 'FIXME: y'), mark('c', 'TODO: z')])).toBe('3 code markers (TODO, FIXME, XXX)')
})
