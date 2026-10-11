// The header's gauges, pure: context, and the five-hour and seven-day limits, each with a percent and a bar.
import type { Gauge } from '../types'
import { ACCENT } from './office'

const BAR_CELLS = 7
const TRACK = '#3b3b39'
const BAR_W = 48
const BAR_H = 4
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "62%"; anything above zero reads at least 1%, as the bar shows at least a sliver. */
const percentLabel = (percent: number) => {
  const p = clampPercent(percent)
  return `${p > 0 ? Math.max(1, Math.round(p)) : 0}%`
}

const clampPercent = (percent: number) => (Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0)

/** A short bar: `filled` of `total` cells, at least one once anything is used. */
export function barOf(percent: number): { filled: number; total: number } {
  const p = clampPercent(percent)
  const filled = p === 0 ? 0 : Math.min(BAR_CELLS, Math.max(1, Math.round((p / 100) * BAR_CELLS)))
  return { filled, total: BAR_CELLS }
}

/** The terminal's bar: thin heavy lines for the used part, light lines for the rest. */
export function barGlyphs(percent: number): { on: string; off: string } {
  const { filled, total } = barOf(percent)
  return { on: '━'.repeat(filled), off: '─'.repeat(total - filled) }
}

/** The image bar: a dim rounded track with an accent fill that is never narrower than its own height. */
export function barSvg(percent: number): string {
  const p = clampPercent(percent)
  const fill = p === 0 ? 0 : Math.max(BAR_H, Math.round((BAR_W * p) / 100))
  const rect = (width: number, color: string) => `<rect width="${width}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BAR_W} ${BAR_H}" width="${BAR_W}" height="${BAR_H}">${rect(BAR_W, TRACK)}${fill > 0 ? rect(fill, ACCENT) : ''}</svg>`
}

/** Time left as "48m", "1h 48m" or "3d 4h"; nothing for a time that has passed. */
export function formatLeft(ms: number): string | undefined {
  if (!(ms > 0)) return undefined
  if (ms < MINUTE) return '<1m'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ${Math.floor((ms % HOUR) / MINUTE)}m`
  return `${Math.floor(ms / DAY)}d ${Math.floor((ms % DAY) / HOUR)}h`
}

export type GaugeView = {
  key: 'context' | 'session' | 'week'
  label: string
  /** The reading as the header shows it: "62%", or a dash before the first one. */
  percent: string
  /** The reading the bar is drawn from. */
  value: number
  /** Time until the window resets; the context has none. */
  left?: string
}

const LIMITS: Array<{ key: 'session' | 'week'; label: string; kind: string }> = [
  { key: 'session', label: 'Session', kind: 'five_hour' },
  { key: 'week', label: 'Week', kind: 'seven_day' },
]

/** Context always; a limit only while its reading is current (it has a reset time still to come). */
export function headerGauges(gauge: Gauge, now: number): GaugeView[] {
  const context: GaugeView = {
    key: 'context', label: 'Context', value: gauge.contextPercent ?? 0,
    percent: gauge.contextPercent === undefined ? '–' : percentLabel(gauge.contextPercent),
  }
  const limits = LIMITS.flatMap(({ key, label, kind }): GaugeView[] => {
    const limit = gauge.limits.find(l => l.kind === kind)
    const left = limit?.resetsAt === undefined ? undefined : formatLeft(Date.parse(limit.resetsAt) - now)
    return limit && left ? [{ key, label, value: limit.percentUsed, percent: percentLabel(limit.percentUsed), left }] : []
  })
  return [context, ...limits]
}

/** The limit windows as the gauge keeps them: only the fields it reads. */
export const limitsOf = (list: Array<{ kind: string; percentUsed: number; resetsAt?: string }>) =>
  list.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
