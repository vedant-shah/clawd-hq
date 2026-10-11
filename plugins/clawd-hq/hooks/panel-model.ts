// What the side panel shows, as pure functions: who is at work, who finished, what is waiting, how decisions group.
import type { Ask, Badge, Employee, Memory } from '../types'
import { ago, displayName, looksOf, roleOf } from './office'
import type { PanelData } from './panel-types'

/** Stand-in employees of the tour have ids that start with this. */
export const DEMO = 'demo-'

export const isActive = (e: Employee) => e.mood === 'arriving' || e.mood === 'working' || e.mood === 'thinking'
export const isWaiting = (a: Ask) => a.status === 'open' || a.status === 'live'

/** 22K, 1.3M, or the plain count under a thousand. */
export function tokensLabel(n = 0): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

/** "Taro the Tester": the name this type goes by and the role its description and brief suggest. */
export const titled = (one: Employee, data: Pick<PanelData, 'staff' | 'roster' | 'blurbs'>) =>
  `${displayName(one, data.staff, data.roster)} the ${roleOf(one.type, `${data.blurbs[one.type] ?? ''} ${one.prompt}`).title}`

export const atWork = (staff: Employee[]): Employee[] => staff.filter(isActive)

/** The specialists that finished since the session began, newest first. */
export function doneThisSession(staff: Employee[], since: number): Employee[] {
  return staff
    .filter(e => !isActive(e) && e.endedAt !== undefined && e.endedAt >= since)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
}

/** Real specialists that failed within `withinMs`, newest first: Clawd's status line names them. */
export function recentFailures(staff: Employee[], now: number, withinMs: number): Employee[] {
  return staff
    .filter(e => e.mood === 'failed' && !e.id.startsWith(DEMO) && now - (e.endedAt ?? 0) < withinMs)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
}

/** "Working · 4m", or "Waiting on you · 1m" while a question of theirs sits on the CEO desk. */
export function workState(one: Employee, asks: Ask[], now: number): { isWaiting: boolean; label: string } {
  const held = asks.filter(a => a.fromId === one.id && isWaiting(a))
  if (held.length === 0) return { isWaiting: false, label: `Working · ${ago(now - one.startedAt)}` }
  const since = Math.min(...held.map(a => a.askedAt))
  return { isWaiting: true, label: `Waiting on you · ${ago(now - since)}` }
}

/** The right-hand lines of a finished row. */
export function doneLine(one: Employee, now: number): { when: string; took: string; isFailed: boolean } {
  const ended = one.endedAt ?? now
  const span = ago(ended - one.startedAt)
  const when = `${ago(now - ended)} ago`
  if (one.mood === 'failed') return { when, took: `Failed after ${span}`, isFailed: true }
  return { when, took: `took ${span}${one.tokens ? ` · ${tokensLabel(one.tokens)} tokens` : ''}`, isFailed: false }
}

/** Clawd's one status line: all clear, how many need the CEO, and who failed. */
export function statusOf(waiting: number, failed: string[]): { isClear: boolean; text: string } {
  const parts = [
    waiting > 0 ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : '',
    failed[0] !== undefined ? `${failed[0]} failed${failed.length > 1 ? ` +${failed.length - 1}` : ''}` : '',
  ].filter(Boolean)
  return parts.length === 0 ? { isClear: true, text: 'All clear' } : { isClear: false, text: parts.join(' · ') }
}

/** "Sage" from "Sage the Guard". */
export const firstName = (from: string) => from.split(' the ')[0] ?? from

/** The label of the button that opens the CEO desk. */
export function seeNeedsLabel(waiting: Ask[]): string {
  const names = [...new Set(waiting.map(a => firstName(a.from)))]
  if (names.length === 1) return `See what ${names[0]} needs`
  return names.length === 2 ? `See what ${names[0]} and ${names[1]} need` : `See what ${names.length} people need`
}

// ---- Decisions ----

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

export function dayLabel(at: number, now: number): string {
  const [d, n] = [new Date(at), new Date(now)]
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === n.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

const idNumber = (m: Memory) => Number(m.id.slice(1)) || 0
/** Newest first; entries made in the same instant keep the order they were made in, the last one first. */
const byNewest = (a: Memory, b: Memory) => b.at - a.at || idNumber(b) - idNumber(a)

/** Entries newest first, grouped by the day they were made. */
export function groupByDay(entries: Memory[], now: number): Array<{ label: string; entries: Memory[] }> {
  const groups: Array<{ label: string; entries: Memory[] }> = []
  for (const m of [...entries].sort(byNewest)) {
    const label = dayLabel(m.at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) groups[groups.length - 1] = { label, entries: [...last.entries, m] }
    else groups.push({ label, entries: [m] })
  }
  return groups
}

/** The newest `limit` entries, newest first. */
export const newestFirst = (entries: Memory[], limit: number): Memory[] => [...entries].sort(byNewest).slice(0, limit)

const match = (haystack: string[], query: string) => {
  const q = query.trim().toLowerCase()
  return q === '' || haystack.some(h => h.toLowerCase().includes(q))
}

export const filterMemory = (entries: Memory[], query: string): Memory[] => entries.filter(m => match([m.text, m.by], query))

// ---- People ----

export type Person = { type: string; name: string; plugin: string; jobs: number; blurb: string; isOff: boolean }

export const pluginOf = (type: string) => (type.includes(':') ? type.split(':')[0]! : 'built in')

/** Built-in agents are never laid off. */
export const canLayOff = (type: string) => type.includes(':')

export function splitPeople(people: Person[], query: string): { team: Person[]; pool: Person[] } {
  const found = people.filter(p => match([p.name, p.type, p.plugin, p.blurb], query))
  return { team: found.filter(p => !p.isOff), pool: found.filter(p => p.isOff) }
}

/** Every agent type on the books, as a person: "Pip the Planner", where it comes from, how often it was hired. */
export function buildPeople(types: string[], blurbs: Record<string, string>, roster: Record<string, Badge>, laidOff: string[]): Person[] {
  const off = new Set(laidOff)
  return [...new Set(types)].sort().map(type => {
    const blurb = blurbs[type] ?? ''
    return {
      type, blurb, plugin: pluginOf(type), jobs: roster[type]?.jobs ?? 0, isOff: off.has(type),
      name: `${looksOf(type, roster).name} the ${roleOf(type, blurb).title}`,
    }
  })
}
