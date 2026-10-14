// The usage footer, pure: the model and effort, the one button, and the three rows it opens (context, session, week).
import type { Gauge } from '../types'
import { percentLabel } from './meters'
import { modelLabel } from './panel-model'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// Effort words as Claude shows them. "Extra high" for xhigh is a guess.
const EFFORTS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

export type UsageRow = {
  key: 'context' | 'session' | 'week'
  label: string
  /** The dim text: tokens over the window, or when the limit resets. */
  detail?: string
  /** The bright percent of a limit; the context carries its percent inside the detail. */
  percent?: string
  /** The reading the bar is drawn from. */
  value: number
}

export type UsageView = { model?: string; effort?: string; button: string; rows: UsageRow[] }

/** 169.7k, 3k, 1M, 1.5M: the count as Claude writes it. */
export function tokensShort(n: number): string {
  if (!(n > 0)) return '0'
  if (n < 1000) return String(Math.round(n))
  const k = Math.round(n / 100) / 10
  return k < 1000 ? `${k}k` : `${Math.round(n / 1e5) / 10}M`
}

/** The effort as a word; a number, or a word this does not know, is not shown. */
export const effortLabel = (effort: unknown): string | undefined => (typeof effort === 'string' ? EFFORTS[effort] : undefined)

/** "Resets in 3 hr 52 min"; nothing for a time that has passed. */
export function resetIn(ms: number): string | undefined {
  if (!(ms > 0)) return undefined
  if (ms < MINUTE) return 'Resets in under a minute'
  const minutes = Math.floor(ms / MINUTE)
  const [h, m] = [Math.floor(minutes / 60), minutes % 60]
  return `Resets in ${[h > 0 ? `${h} hr` : '', m > 0 ? `${m} min` : ''].filter(Boolean).join(' ')}`
}

/** "Resets Fri 7:30 AM" at the zone `offsetMinutes` east of UTC. */
export function resetAt(at: number, offsetMinutes: number): string {
  const d = new Date(at + offsetMinutes * MINUTE)
  const hour = d.getUTCHours()
  return `Resets ${DAYS[d.getUTCDay()]} ${hour % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

/** Minutes east of UTC at that moment; nothing where the zone is not known (a sandbox that only says UTC). */
export function localOffset(at: number): number | undefined {
  const offset = -new Date(at).getTimezoneOffset()
  if (!Number.isFinite(offset)) return undefined
  if (offset !== 0) return offset
  let zone: string | undefined
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* no zone information */ }
  return zone === undefined || zone === '' || /^(Etc\/)?(UTC|GMT|UCT|Zulu)$/i.test(zone) ? undefined : 0
}

/** The context as the gauge keeps it; what the engine leaves out stays out. */
export const contextOf = (c: { tokens?: number; window: number; percent?: number }) =>
  ({ contextTokens: c.tokens, contextWindow: c.window, contextPercent: c.percent })

/**
 * The gauge after a request from the main chat: its model, and its effort when it names one in words. A request that
 * names none (or a number) keeps the last known effort. The very same gauge when nothing moved.
 */
export function withRequest(g: Gauge, model: string, effort: string | number | undefined): Gauge {
  const nextModel = model === '' ? g.model : model
  const nextEffort = effortLabel(effort) === undefined ? g.effort : (effort as Gauge['effort'])
  return nextModel === g.model && nextEffort === g.effort ? g : { ...g, model: nextModel, effort: nextEffort }
}

function contextRow(g: Gauge): UsageRow {
  const key = 'context'
  const label = 'Context window'
  if (g.contextPercent === undefined) return { key, label, detail: 'No reading yet', value: 0 }
  const percent = percentLabel(g.contextPercent)
  const counts = g.contextTokens !== undefined && g.contextWindow !== undefined ? `${tokensShort(g.contextTokens)} / ${tokensShort(g.contextWindow)} (${percent})` : percent
  return { key, label, detail: counts, value: g.contextPercent }
}

const LIMITS: Array<{ key: 'session' | 'week'; label: string; kind: string }> = [
  { key: 'session', label: 'Session limit', kind: 'five_hour' },
  { key: 'week', label: 'Weekly · all models', kind: 'seven_day' },
]

/** The weekly time of day in the person's zone; the session, and a weekly in an unknown zone, as time left. */
function resetText(key: 'session' | 'week', at: number, now: number, offsetAt: (at: number) => number | undefined): string | undefined {
  if (!(at > now)) return undefined
  const offset = key === 'week' ? offsetAt(at) : undefined
  return offset === undefined ? resetIn(at - now) : resetAt(at, offset)
}

/** A limit only while its reading is current: with a reset time still to come, or none given. */
function limitRows(g: Gauge, now: number, offsetAt: (at: number) => number | undefined): UsageRow[] {
  return LIMITS.flatMap(({ key, label, kind }): UsageRow[] => {
    const limit = g.limits.find(l => l.kind === kind)
    if (!limit) return []
    const at = limit.resetsAt === undefined ? undefined : Date.parse(limit.resetsAt)
    const detail = at === undefined || Number.isNaN(at) ? undefined : resetText(key, at, now, offsetAt)
    return at !== undefined && !Number.isNaN(at) && detail === undefined ? [] : [{ key, label, detail, percent: percentLabel(limit.percentUsed), value: limit.percentUsed }]
  })
}

/**
 * The button's readings in fixed places, context then session then weekly, so a number is never taken for another: a
 * dash holds the place of one that is missing or hidden. With no limit shown (no subscription) there is the context alone.
 */
function slots(g: Gauge, limits: UsageRow[]): string[] {
  const context = g.contextPercent === undefined ? '–' : percentLabel(g.contextPercent)
  if (limits.length === 0) return [context]
  return [context, ...LIMITS.map(({ key }) => limits.find(r => r.key === key)?.percent ?? '–')]
}

export function usageView(g: Gauge, now: number, offsetAt: (at: number) => number | undefined): UsageView {
  const [context, ...limits] = [contextRow(g), ...limitRows(g, now, offsetAt)]
  const rows = [context!, ...limits]
  return { model: modelLabel(g.model), effort: effortLabel(g.effort), button: `Usage ${slots(g, limits).join(' · ')}`, rows }
}
