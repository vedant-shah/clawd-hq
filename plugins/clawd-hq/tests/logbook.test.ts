import { expect, test } from 'claude-code/testing'
import { LOGBOOK_FILE, fromMarkdown, mergeMarkdown, toMarkdown } from '../hooks/logbook'
import type { Memory } from '../types'

const AT = Date.UTC(2026, 9, 10, 14, 3)
const mem = (over: Partial<Memory> = {}): Memory => ({ id: 'M1', kind: 'decision', text: 'Use Postgres', by: 'CEO', at: AT, source: 'desk', ...over })

test('the decisions live in a plain file inside the project\'s .clawd-hq folder', () => {
  expect(LOGBOOK_FILE).toBe('.clawd-hq/decisions.md')
})

test('an empty logbook is a short readable file that explains itself', () => {
  const text = toMarkdown([])
  expect(text).toMatch(/^# Clawd HQ decisions/)
  expect(text).toMatch(/edit this file by hand/i)
  expect(fromMarkdown(text, AT)).toEqual([])
})

test('each entry is one readable line: id, date, kind, who, where it came from, then the words', () => {
  const text = toMarkdown([mem(), mem({ id: 'M2', kind: 'choice', by: 'Tester', source: 'report', text: 'Quiet mode first', at: AT + 3_600_000 })])
  expect(text).toContain('- M1 · 2026-10-10 14:03 · decision · CEO · desk · Use Postgres')
  expect(text).toContain('- M2 · 2026-10-10 15:03 · choice · Tester · report · Quiet mode first')
})

test('what is written reads back the same, to the minute, in order', () => {
  const list = [mem(), mem({ id: 'M7', kind: 'choice', by: 'Planner', source: 'clawd', text: 'Dots · and commas, and “quotes”', at: AT + 60_000 })]
  expect(fromMarkdown(toMarkdown(list), 0)).toEqual(list)
})

test('a line you add by hand becomes a decision of yours, with a new id after the highest', () => {
  const text = `${toMarkdown([mem({ id: 'M4' })])}- Never use tabs\n`
  const [first, added] = fromMarkdown(text, AT + 5)
  expect(first!.id).toBe('M4')
  expect(added).toEqual({ id: 'M5', kind: 'decision', by: 'CEO', source: 'desk', text: 'Never use tabs', at: AT + 5 })
})

test('headings, blank lines, notes and a line that is not a list item are ignored', () => {
  const text = '# Title\n\nSome note.\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep this\nnot a list line\n*  \n-\n'
  expect(fromMarkdown(text, AT).map(m => m.text)).toEqual(['Keep this'])
})

test('a line with an unknown kind or source is still kept, as a decision of yours', () => {
  const [m] = fromMarkdown('- M3 · 2026-10-10 14:03 · wish · CEO · email · Ship it\n', AT)
  expect(m).toMatchObject({ kind: 'decision', by: 'CEO', source: 'desk' })
  expect(m!.text).toContain('Ship it')
})

test('a long line is read whole: only a runaway one is cut, at a word, with no mark', () => {
  const long = 'word '.repeat(200).trim()
  expect(fromMarkdown(`- ${long}\n`, AT)[0]!.text).toBe(long)
  expect(fromMarkdown(`- M1 · 2026-10-10 14:03 · decision · CEO · desk · ${long}\n`, AT)[0]!.text).toBe(long)
  const [m] = fromMarkdown(`- ${'word '.repeat(900)}\n`, AT)
  expect(m!.text.length).toBeLessThanOrEqual(3000)
  expect(m!.text.length).toBeGreaterThan(2500)
  expect(m!.text).not.toMatch(/…|\n/)
})

test('two entries with the same id keep the later one\'s place but not a clash', () => {
  const ids = fromMarkdown('- M1 · 2026-10-10 14:03 · decision · CEO · desk · A\n- M1 · 2026-10-10 14:04 · decision · CEO · desk · B\n', AT).map(m => m.id)
  expect(new Set(ids).size).toBe(2)
})

// ---- A save changes only the decision lines it has to; everything else you wrote stays ----

const FULL_LINE = '- M1 · 2026-10-10 14:03 · decision · CEO · desk · Use Postgres'
const merge = (existing: string, after: Memory[]) => mergeMarkdown(existing, after, AT)

test('a save keeps notes, headings, other list styles and indented lines exactly where they were', () => {
  const existing = `# My decisions\n\nSome notes for the team.\n\n${FULL_LINE}\n* a star bullet\n  - indented line\n1. numbered line\nlast words\n`
  const out = merge(existing, [mem(), mem({ id: 'M2', text: 'Add a second', at: AT + 60_000 })])
  expect(out).toContain('# My decisions\n\nSome notes for the team.\n\n')
  expect(out).toContain(`${FULL_LINE}\n* a star bullet\n  - indented line\n1. numbered line\nlast words\n`)
  expect(out.endsWith('- M2 · 2026-10-10 14:04 · decision · CEO · desk · Add a second\n')).toBe(true)
})

test('a forgotten entry loses only its own line', () => {
  const existing = `# Notes\n${FULL_LINE}\n- M2 · 2026-10-10 14:05 · decision · CEO · desk · Second\nA note\n`
  const out = merge(existing, [mem({ id: 'M2', text: 'Second', at: AT + 120_000 })])
  expect(out).toBe('# Notes\n- M2 · 2026-10-10 14:05 · decision · CEO · desk · Second\nA note\n')
})

test('an entry that did not change is kept character for character, even a long hand-written one', () => {
  const long = `- M1 · 2026-10-10 14:03 · decision · CEO · desk · ${'long words '.repeat(60)}end`
  const entries = fromMarkdown(`${long}\n`, AT)
  expect(merge(`${long}\n`, entries)).toBe(`${long}\n`)
})

test('an entry that changed is rewritten in place', () => {
  const existing = `${FULL_LINE}\nnote\n`
  expect(merge(existing, [mem({ text: 'Use MySQL' })])).toBe('- M1 · 2026-10-10 14:03 · decision · CEO · desk · Use MySQL\nnote\n')
})

test('a line you added by hand gets its id and date written in the first time the file is saved', () => {
  const existing = `${FULL_LINE}\n- Never use tabs\n`
  const after = fromMarkdown(existing, AT + 9 * 60_000)
  expect(merge(existing, after)).toBe(`${FULL_LINE}\n- M2 · 2026-10-10 14:12 · decision · CEO · desk · Never use tabs\n`)
})

test('a save never drops entries because there are many: 250 lines stay', () => {
  const lines = Array.from({ length: 250 }, (_, i) => `- M${i + 1} · 2026-10-10 14:03 · decision · CEO · desk · Entry ${i + 1}`)
  const existing = `# Notes\n${lines.join('\n')}\n`
  const after = [...fromMarkdown(existing, AT), mem({ id: 'M251', text: 'New one' })]
  const out = merge(existing, after)
  expect(out.split('\n').filter(l => l.startsWith('- M')).length).toBe(251)
  expect(out).toContain('Entry 1\n')
})

test('a line the parser reads as no entry (a well-formed line with no words) is left alone', () => {
  const blank = '- M9 · 2026-10-10 14:03 · decision · CEO · desk · '
  const out = merge(`${blank}\n${FULL_LINE}\n`, [mem()])
  expect(out).toBe(`${blank}\n${FULL_LINE}\n`)
})

test('an empty or missing file becomes the readable header and the entries', () => {
  expect(merge('', [mem()])).toBe(toMarkdown([mem()]))
  expect(merge('  \n', [])).toBe(toMarkdown([]))
})

test('a "who" with the separator in it cannot break its line apart', () => {
  const text = toMarkdown([mem({ by: 'A · B', source: 'report', text: 'T' })])
  const [back] = fromMarkdown(text, AT)
  expect(back).toMatchObject({ by: 'A - B', source: 'report', text: 'T' })
})
