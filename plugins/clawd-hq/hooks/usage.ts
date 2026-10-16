// The usage footer, pure: the model and effort, the one button, and the three rows it opens (context, session, week).
import type { Gauge } from '../types'
import { limitsOf, percentLabel } from './meters'
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

/** One number on the button: its text, and the reading it comes from (none for a dash). */
export type UsageReading = { text: string; value?: number }

export type UsageView = { model?: string; effort?: string; button: string; readings: UsageReading[]; rows: UsageRow[] }

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
 * names none (or a number) keeps the last known effort while the model is the same, and has none once the model changes.
 * The very same gauge when nothing moved.
 */
export function withRequest(g: Gauge, model: string, effort: string | number | undefined): Gauge {
  const nextModel = model === '' ? g.model : model
  const kept = nextModel === g.model ? g.effort : undefined
  const nextEffort = effortLabel(effort) === undefined ? kept : (effort as Gauge['effort'])
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
function slots(g: Gauge, limits: UsageRow[]): UsageReading[] {
  const context: UsageReading = g.contextPercent === undefined ? { text: '–' } : { text: percentLabel(g.contextPercent), value: g.contextPercent }
  if (limits.length === 0) return [context]
  return [context, ...LIMITS.map(({ key }): UsageReading => {
    const r = limits.find(l => l.key === key)
    return r?.percent === undefined ? { text: '–' } : { text: r.percent, value: r.value }
  })]
}

export function usageView(g: Gauge, now: number, offsetAt: (at: number) => number | undefined): UsageView {
  const [context, ...limits] = [contextRow(g), ...limitRows(g, now, offsetAt)]
  const rows = [context!, ...limits]
  const readings = slots(g, limits)
  return { model: modelLabel(g.model), effort: effortLabel(g.effort), button: `Usage ${readings.map(r => r.text).join(' · ')}`, readings, rows }
}

// ---- Keeping the gauge, through plain calls register.tsx hands in (`$` never leaves that file) ----

export type GaugeIo = {
  now: () => Promise<number>
  usage: () => Promise<{ startedAt: number; context: { tokens?: number; window: number; percent?: number }; rateLimits: Array<{ kind: string; percentUsed: number; resetsAt?: string }> }>
  model: () => Promise<string>
  /** The token count at which Claude Code compacts by itself; none when its auto-compact is off. */
  threshold: () => Promise<number | undefined>
  get: () => Promise<Gauge>
  set: (fn: (g: Gauge) => Gauge) => Promise<unknown>
}

/** Reads the meters once at session start; where the engine cannot say, the session began now. */
export async function startGauge(io: GaugeIo) {
  const now = await io.now()
  try {
    const u = await io.usage()
    await io.set(g => ({ ...g, startedAt: u.startedAt, ...contextOf(u.context), limits: limitsOf(u.rateLimits) }))
  } catch {
    await io.set(g => ({ ...g, startedAt: now }))
  }
  try {
    const model = await io.model()
    await io.set(g => withRequest(g, model, g.effort))
  } catch { /* the footer names the model from the first request instead */ }
  await noteThreshold(io)
}

/**
 * Keeps where Claude Code compacts by itself (the coffee break button's second mark), written only when it moved. A read that fails keeps
 * the last one known: the button's own 300k mark stands either way, so this never gets in the way.
 */
export async function noteThreshold(io: GaugeIo) {
  try {
    const [at, g] = [await io.threshold(), await io.get()]
    if (g.autoCompactAt !== at) await io.set(one => ({ ...one, autoCompactAt: at }))
  } catch { /* the last known point stays; the 300k mark needs none */ }
}

/** A request of the main chat names the model and effort in use: kept only when either moved, and never in the request's way. */
export async function noteRequest(io: GaugeIo, model: string, effort: string | number | undefined) {
  try {
    const g = await io.get()
    if (withRequest(g, model, effort) !== g) await io.set(one => withRequest(one, model, effort))
  } catch { /* a label missed in the footer; the request goes on */ }
}
