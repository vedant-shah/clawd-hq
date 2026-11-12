// The marks of the plan (pure): one for each state of a step, as a glyph on the terminal and as a small image elsewhere. Each state has its own
// shape, so the list still reads when the colours are poor.
import { AMBER, GREEN, RED } from './office'

export type MarkKind = 'done' | 'now' | 'attention' | 'next'

/** DECIDED: the done steps and their rail are GREEN at about three quarters, muted next to the working amber. */
export const MUTED_GREEN = '#4f8a5b'
const GREY = '#8a8a85'

export const GLYPH: Record<MarkKind, string> = { done: '✓', now: '●', attention: '✗', next: '○' }
export const MARK_COLOR: Record<MarkKind, string | undefined> = { done: MUTED_GREEN, now: AMBER, attention: RED, next: undefined }

const SIZE = 14
const wrap = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${body}</svg>`

/** A tick, a filled dot, a cross, and a hollow ring. */
export function markSvg(kind: MarkKind): string {
  if (kind === 'done') return wrap(`<path d="M3 7.5 6 10.5 11.5 4" fill="none" stroke="${GREEN}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`)
  if (kind === 'now') return wrap(`<circle cx="7" cy="7" r="4.5" fill="${AMBER}"/>`)
  if (kind === 'attention') return wrap(`<path d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5" fill="none" stroke="${RED}" stroke-width="2" stroke-linecap="round"/>`)
  return wrap(`<circle cx="7" cy="7" r="4" fill="none" stroke="${GREY}" stroke-width="1.5"/>`)
}

/** The colour of the thin line that joins the marks, beside each kind of step. */
export const RAIL_COLOR: Record<MarkKind, string> = { done: MUTED_GREEN, now: AMBER, attention: RED, next: '#4a4a47' }
