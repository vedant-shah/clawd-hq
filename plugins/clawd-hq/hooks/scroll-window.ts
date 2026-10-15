// The window of a long Markdown file that the Settings tab shows in its box, since no surface scrolls inside a box:
// about 12 lines at a time, moved about 10 at a press. A window starts only where a block may start, so a fenced block,
// a list item with its indented lines and a table are never split, and a line is never cut. Pure.
import type { Fx } from '../types'
import type { BriefPart } from './instructions'
import { hash } from './office'

/** About how many lines of the file the box shows. A block longer than this is shown whole, never cut. */
export const WINDOW = 12
/** About how many lines a press of ▲ or ▼ moves the window. */
export const STEP = 10

/** Where the box of each file is, kept with the panel's display flags. */
export type Scroll = NonNullable<Fx['scroll']>

const FENCE = /^\s*(```|~~~)/
const isBlank = (line: string) => line.trim() === ''

/** The lines a window may start on: not blank, not inside a fence or its closing line, not indented (a list item's own lines), not a table's later rows. */
export function startsOf(lines: readonly string[]): number[] {
  const starts: number[] = []
  let isFenced = false
  lines.forEach((line, i) => {
    const wasFenced = isFenced
    if (FENCE.test(line)) isFenced = !isFenced
    if (wasFenced || isBlank(line) || /^\s/.test(line)) return
    if (line.startsWith('|') && (lines[i - 1] ?? '').startsWith('|')) return
    starts.push(i)
  })
  return starts.length === 0 || starts[0] === 0 ? starts : [0, ...starts]
}

type Layout = { lines: string[]; starts: number[] }

const layoutOf = (text: string): Layout => {
  const lines = text === '' ? [] : text.split('\n')
  return { lines, starts: startsOf(lines) }
}

/** Where the window that starts at `s` ends (the line after it): whole blocks while they fit, at least one. */
function endOf({ lines, starts }: Layout, s: number): number {
  const k = starts.indexOf(s)
  let end = starts[k + 1] ?? lines.length
  for (let j = k + 2; j <= starts.length && (starts[j] ?? lines.length) - s <= WINDOW; j++) end = starts[j] ?? lines.length
  return end
}

/** The last place a window starts: the first from which the rest of the file fits, else the last block. */
const lastOf = ({ lines, starts }: Layout) => starts.find(s => lines.length - s <= WINDOW) ?? starts[starts.length - 1] ?? 0

/** Any offset brought to a place a window starts: the nearest start at or before it, never past the last. */
function snap(l: Layout, at: number): number {
  const limit = Math.min(at, lastOf(l))
  return l.starts.findLast(s => s <= limit) ?? 0
}

/** About 10 lines on, never past a line the window now ends before, so nothing is skipped. */
function down(l: Layout, s: number): number {
  const reach = Math.min(s + STEP, endOf(l, s))
  const on = l.starts.filter(u => u > s && u <= reach)
  const next = on[on.length - 1] ?? l.starts.find(u => u > s) ?? s
  return Math.min(next, Math.max(s, lastOf(l)))
}

/** About 10 lines back, to a window that still reaches the one before, so nothing is skipped. */
function up(l: Layout, s: number): number {
  const back = l.starts.find(u => u < s && u >= s - STEP && endOf(l, u) >= s)
  const before = l.starts.filter(u => u < s)
  return back ?? before[before.length - 1] ?? 0
}

/** The place kept for this text, or the top when it was kept for another one. */
const placeOf = (text: string, at: number, of?: number) => (of === undefined || of === hash(text) ? at : 0)

/** The text the box shows from `at` (its `of` is checked against the text when given), and the count beside ▲ ▼. */
export function windowOf(text: string, at: number, of?: number) {
  const l = layoutOf(text)
  if (l.lines.length <= WINDOW) return { text, isAll: true, isTop: true, isEnd: true, count: '' }
  const s = snap(l, placeOf(text, at, of))
  const end = endOf(l, s)
  const all = l.lines.slice(s, end)
  // Blank lines that close the window are not shown or counted; it never starts on one.
  const shown = all.slice(0, Math.max(1, all.findLastIndex(line => !isBlank(line)) + 1))
  return { text: shown.join('\n'), isAll: false, isTop: s === 0, isEnd: end >= l.lines.length, count: `lines ${s + 1}–${s + shown.length} of ${l.lines.length}` }
}

/** The places after a press on one file's box: down (`dir` above 0), up (below 0), or where it is (0). */
export function scrolled(scroll: Scroll | undefined, part: BriefPart, text: string, dir: number): Scroll {
  const l = layoutOf(text)
  const kept = scroll?.[part]
  const s = snap(l, placeOf(text, kept?.at ?? 0, kept?.of))
  const at = dir > 0 ? down(l, s) : dir < 0 ? up(l, s) : s
  return { ...scroll, [part]: { at, of: hash(text) } }
}
