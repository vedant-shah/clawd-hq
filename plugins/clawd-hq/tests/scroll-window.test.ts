import { expect, test } from 'claude-code/testing'
import { STEP, WINDOW, scrolled, startsOf, windowOf } from '../hooks/scroll-window'

/** A file of `n` one-line paragraphs, each followed by a blank line: "Line 1", "", "Line 2", ... */
const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1}`).join('\n\n')
/** A file of `n` list items, with no blank lines: one line each. */
const items = (n: number) => Array.from({ length: n }, (_, i) => `- Item ${i + 1}`).join('\n')
const linesOf = (text: string) => text.split('\n')

test('the window is about 12 lines and the step about 10, so two windows in a row share a little', () => {
  expect(WINDOW).toBe(12)
  expect(STEP).toBe(10)
})

test('a file no longer than the window is shown whole, with nothing to scroll and no count', () => {
  const w = windowOf(items(12), 0)
  expect(w.text).toBe(items(12))
  expect(w.isAll).toBe(true)
  expect(w.count).toBe('')
  expect(windowOf('', 0).isAll).toBe(true)
})

test('a long file opens on its first 12 lines, with the count that says so', () => {
  const text = items(80)
  const w = windowOf(text, 0)
  expect(w.text).toBe(linesOf(text).slice(0, 12).join('\n'))
  expect(w.isAll).toBe(false)
  expect([w.isTop, w.isEnd]).toEqual([true, false])
  expect(w.count).toBe('lines 1–12 of 80')
})

test('down moves the window by 10 lines and up moves it back; both stop at the ends', () => {
  const text = items(80)
  const down = (at: number) => scrolled(undefined, 'rules', text, 1).rules?.at ?? -1
  expect(down(0)).toBe(10)
  let s = scrolled(undefined, 'rules', text, 1)
  expect(windowOf(text, s.rules!.at).count).toBe('lines 11–22 of 80')
  s = scrolled(s, 'rules', text, -1)
  expect(s.rules!.at).toBe(0)
  // Up at the top stays at the top.
  expect(scrolled(s, 'rules', text, -1).rules!.at).toBe(0)
  // Down as far as it goes: the last window ends on the last line and fills the box.
  for (let i = 0; i < 20; i++) s = scrolled(s, 'rules', text, 1)
  const last = windowOf(text, s.rules!.at)
  expect(last.count).toBe('lines 69–80 of 80')
  expect([last.isTop, last.isEnd]).toEqual([false, true])
  expect(scrolled(s, 'rules', text, 1).rules!.at).toBe(s.rules!.at)
})

test('a window never starts on a blank line, and the count names the lines it shows', () => {
  const text = paragraphs(30)
  const w = windowOf(text, 0)
  expect(w.count).toBe('lines 1–11 of 59')
  const next = windowOf(text, scrolled(undefined, 'rules', text, 1).rules!.at)
  expect(next.text.startsWith('Line ')).toBe(true)
})

test('a window is whole lines of the file, in order, never cut and never with a mark', () => {
  const long = `- ${'a very long rule that goes on '.repeat(20)}`
  const text = [long, ...linesOf(items(40))].join('\n')
  const all = linesOf(text)
  let s = scrolled(undefined, 'voice', text, 0)
  for (let i = 0; i < 8; i++) {
    const w = windowOf(text, s.voice!.at)
    const shown = linesOf(w.text)
    const from = all.indexOf(shown[0]!)
    expect(shown).toEqual(all.slice(from, from + shown.length))
    expect(w.text).not.toMatch(/…/)
    s = scrolled(s, 'voice', text, 1)
  }
})

test('moving down then up covers every line of the file: none is skipped', () => {
  const text = [items(7), '', '```', ...Array.from({ length: 9 }, (_, i) => `code ${i}`), '```', '', items(30)].join('\n')
  const total = linesOf(text).length
  const seen = new Set<number>()
  let s = scrolled(undefined, 'rules', text, 0)
  for (let i = 0; i < 15; i++) {
    const at = s.rules!.at
    linesOf(windowOf(text, at).text).forEach((_, k) => seen.add(at + k))
    s = scrolled(s, 'rules', text, 1)
  }
  const blanks = linesOf(text).flatMap((l, i) => (l.trim() === '' ? [i] : []))
  for (let i = 0; i < total; i++) if (!blanks.includes(i)) expect(seen.has(i)).toBe(true)
})

test('a fenced block, a list item with its indented lines, and a table are never split across windows', () => {
  const fence = ['```ts', ...Array.from({ length: 6 }, (_, i) => `const x${i} = ${i}`), '```']
  const text = [...linesOf(items(8)), ...fence, '- Item with', '  a second line', '  and a third', '| a | b |', '| - | - |', '| 1 | 2 |', ...linesOf(items(10))].join('\n')
  const starts = startsOf(linesOf(text))
  const lines = linesOf(text)
  // Inside the fence, its closing line, the indented lines and the rows after a table's first are never a start.
  for (const i of [9, 10, 11, 12, 13, 14, 15, 17, 18, 20, 21]) expect(starts).not.toContain(i)
  for (const i of [0, 8, 16, 19, 22]) expect(starts).toContain(i)
  expect(lines[8]).toBe('```ts')
  // Every window holds the fence whole or not at all.
  let s = scrolled(undefined, 'rules', text, 0)
  for (let i = 0; i < 6; i++) {
    const w = windowOf(text, s.rules!.at).text
    expect(w.includes('```ts')).toBe(w.includes('const x5 = 5'))
    s = scrolled(s, 'rules', text, 1)
  }
})

test('a block longer than the window is shown whole, never cut, and down still moves past it', () => {
  const fence = ['```', ...Array.from({ length: 30 }, (_, i) => `line ${i}`), '```']
  const text = [...fence, ...linesOf(items(20))].join('\n')
  const w = windowOf(text, 0)
  expect(linesOf(w.text)).toHaveLength(32)
  const s = scrolled(undefined, 'rules', text, 1)
  expect(s.rules!.at).toBe(32)
})

test('the place is kept for each file on its own, and goes back to the top when the file changes', () => {
  const text = items(80)
  let s = scrolled(undefined, 'rules', text, 1)
  s = scrolled(s, 'voice', items(40), 1)
  s = scrolled(s, 'voice', items(40), 1)
  expect([s.rules!.at, s.voice!.at]).toEqual([10, 20])
  // An offset kept for a text that is no longer there reads as the top.
  expect(windowOf(text + '\n- One more', s.rules!.at, s.rules!.of).count).toBe('lines 1–12 of 81')
  expect(windowOf(text, s.rules!.at, s.rules!.of).count).toBe('lines 11–22 of 80')
  // A press on a changed file starts again from the top.
  expect(scrolled(s, 'rules', text + '\n- One more', 1).rules!.at).toBe(10)
})

test('an offset past the end, or not on a line where a window may start, is brought back to one that is', () => {
  const text = items(30)
  expect(windowOf(text, 500).count).toBe('lines 19–30 of 30')
  const fence = ['```', 'a', 'b', '```']
  const fenced = [...fence, ...linesOf(items(20))].join('\n')
  expect(windowOf(fenced, 2).text.startsWith('```')).toBe(true)
})

test('a file of 10,000 lines is windowed and moved quickly', () => {
  const text = items(10_000)
  const t0 = Date.now()
  let s = scrolled(undefined, 'rules', text, 1)
  for (let i = 0; i < 50; i++) s = scrolled(s, 'rules', text, 1)
  expect(windowOf(text, s.rules!.at, s.rules!.of).count).toBe('lines 511–522 of 10000')
  // Work that grows with the square of the lines took 20 s here; this catches that, not a busy machine.
  expect(Date.now() - t0).toBeLessThan(5000)
})
