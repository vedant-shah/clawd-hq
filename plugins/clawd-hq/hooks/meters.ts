// The footer's bars and percents, pure: a percent label, and a bar as line glyphs or a small image.
import { ACCENT } from './office'

/** A bar is `wide` (the footer's) or `small` (a specialist's progress): its cells on the terminal, its width as an image. */
export type BarSize = 'wide' | 'small'
const CELLS: Record<BarSize, number> = { wide: 20, small: 10 }
export const WIDTH: Record<BarSize, number> = { wide: 200, small: 100 }
const TRACK = '#3b3b39'
export const BAR_H = 4

const clampPercent = (percent: number) => (Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0)

/** "62%"; anything above zero reads at least 1%, as the bar shows at least a sliver. */
export const percentLabel = (percent: number) => {
  const p = clampPercent(percent)
  return `${p > 0 ? Math.max(1, Math.round(p)) : 0}%`
}

/** A bar: `filled` of `total` cells, at least one once anything is used. */
export function barOf(percent: number, size: BarSize = 'wide'): { filled: number; total: number } {
  const [p, total] = [clampPercent(percent), CELLS[size]]
  const filled = p === 0 ? 0 : Math.min(total, Math.max(1, Math.round((p / 100) * total)))
  return { filled, total }
}

/** The terminal's bar: thin heavy lines for the used part, light lines for the rest. */
export function barGlyphs(percent: number, size: BarSize = 'wide'): { on: string; off: string } {
  const { filled, total } = barOf(percent, size)
  return { on: '━'.repeat(filled), off: '─'.repeat(total - filled) }
}

/** The image bar: a dim rounded track with an accent fill that is never narrower than its own height. */
export function barSvg(percent: number, size: BarSize = 'wide'): string {
  const [p, width] = [clampPercent(percent), WIDTH[size]]
  const fill = p === 0 ? 0 : Math.max(BAR_H, Math.round((width * p) / 100))
  const rect = (w: number, color: string) => `<rect width="${w}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${BAR_H}" width="${width}" height="${BAR_H}">${rect(width, TRACK)}${fill > 0 ? rect(fill, ACCENT) : ''}</svg>`
}

/** The limit windows as the gauge keeps them: only the fields it reads. */
export const limitsOf = (list: Array<{ kind: string; percentUsed: number; resetsAt?: string }>) =>
  list.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
