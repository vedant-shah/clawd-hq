// The marks of the plan (pure): one for each state of a step, as a glyph on the terminal and as a small image elsewhere. Each state has its own
// shape, so the list still reads when the colours are poor.
import { AMBER, GREEN, RED } from './office'

export type MarkKind = 'done' | 'now' | 'attention' | 'next'

/** DECIDED: the done steps and their rail are GREEN at about three quarters, muted next to the working amber. */
export const MUTED_GREEN = '#4f8a5b'
const GREY = '#8f8d86'

export const GLYPH: Record<MarkKind, string> = { done: '✓', now: '●', attention: '✗', next: '○' }
export const MARK_COLOR: Record<MarkKind, string | undefined> = { done: MUTED_GREEN, now: AMBER, attention: RED, next: undefined }

// The desktop's marks and rail are the design board's (design/DesktopBusy.dc.html and Main.dc.html), value for value.

/** A mark is a 16 by 20 image, its circle centred at (8, 10). */
export const MARK_WIDTH = 16
export const MARK_HEIGHT = 20
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_WIDTH} ${MARK_HEIGHT}" width="${MARK_WIDTH}" height="${MARK_HEIGHT}" aria-hidden="true">${body}</svg>`

/**
 * Done: a dark green disc (r 6) with a green tick; now: an amber disc (r 6); next: a ring (r 5, 1.5 line) on the page colour. The board has no
 * mark for a step needing attention: this one is a dark red disc (r 6) with a red cross, in the same shapes and sizes.
 */
export function markSvg(kind: MarkKind): string {
  if (kind === 'done') return wrap(`<circle cx="8" cy="10" r="6" fill="#2f4a35"/><path d="M5 10l2.2 2.2L11 8" fill="none" stroke="${GREEN}" stroke-width="1.6"/>`)
  if (kind === 'now') return wrap(`<circle cx="8" cy="10" r="6" fill="${AMBER}"/>`)
  if (kind === 'attention') return wrap(`<circle cx="8" cy="10" r="6" fill="#4a2626"/><path d="M5.5 7.5l5 5M10.5 7.5l-5 5" fill="none" stroke="${RED}" stroke-width="1.6"/>`)
  return wrap(`<circle cx="8" cy="10" r="5" fill="#1a1a19" stroke="${GREY}" stroke-width="1.5"/>`)
}

/** The other colours and sizes of the design board's plan (DesktopBusy.dc.html), read from it. */
export const BOARD = {
  card: '#454542',
  failedCard: '#6b3a3a',
  failedWords: '#ee8a8a',
  nowTitle: '#f1c463',
  doneWords: '#8fb597',
  barWidth: 120,
  barTrack: '#3a3a37',
} as const

/** The line joining the marks is 2 pixels wide. */
export const RAIL_WIDTH = 2

/** The colour of the line beside each kind of step. The board has none for a step needing attention: this is its failed card's border. */
export const RAIL_COLOR: Record<MarkKind, string> = { done: '#3f6a48', now: '#6a5a33', attention: '#6b3a3a', next: '#454542' }

/** How tall the line's picture is, in pixels: past the tallest step the folds let through, whether the desktop clips it or scales it to the step. */
export const RAIL_REACH = 4000

/**
 * The line's picture: a mark's width, a 2 pixel strip down its middle from top to foot, clear only at its sides. It has no clear top: the
 * desktop scales the picture to its box, so a clear top shrank to nothing and the line ran through the mark. The box starts a cell below the
 * mark instead (see `line` in panel-plan-desk.tsx). `preserveAspectRatio="none"` keeps the strip 2 pixels wide however tall it is drawn.
 */
export function railSvg(color: string): string {
  const x = (MARK_WIDTH - RAIL_WIDTH) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_WIDTH} ${RAIL_REACH}" width="${MARK_WIDTH}" height="${RAIL_REACH}" preserveAspectRatio="none" aria-hidden="true"><rect x="${x}" y="0" width="${RAIL_WIDTH}" height="${RAIL_REACH}" fill="${color}"/></svg>`
}
