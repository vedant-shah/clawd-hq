// What the side panel shows, as pure functions: who is at work, who finished, Clawd's status line, the people on the books.
import type { Badge, Employee } from '../types'
import { READING_BRIEF } from './activity'
import { isContractorType } from './contractor-name'
import { ago, bareType, labelOf, roleOf, typeTag } from './office'
import type { PanelData } from './panel-types'
import { withoutStepPrefix } from './steps'

/** Stand-in employees of the tour have ids that start with this. */
export const DEMO = 'demo-'

export const isActive = (e: Employee) => e.mood === 'arriving' || e.mood === 'working' || e.mood === 'thinking'

/** 22K, 1.3M, or the plain count under a thousand. */
export function tokensLabel(n = 0): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  return n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n)
}

/** "Tester", or "Designer" for one given that name: what this specialist is called, in one or two plain words. */
export const titled = (one: Employee, data: Pick<PanelData, 'blurbs'>) => labelOf(one, data.blurbs[one.type] ?? '')

/** DECIDED: an ID badge glyph marks a contractor on its card. It is the one the toasts already use for the People Team, and it reads as a visitor's pass. */
const VISITOR_BADGE = '🪪'

/** The dim second part of a desk card's title, or nothing: " · Builder" for a hire given another name. */
export const tagged = (one: Employee, data: Pick<PanelData, 'blurbs'>): string | undefined => {
  const tag = typeTag(one, data.blurbs[one.type] ?? '')
  if (tag === undefined) return undefined
  // A contractor wears a visitor badge: an ID badge in front of the word.
  return isContractorType(one.type) ? ` · ${VISITOR_BADGE} ${tag}` : ` · ${tag}`
}

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

const MODEL_CHARS = 24
const FAMILY = /(opus|sonnet|haiku|fable)/i
/** "5.5" from "…-5-5", wherever the numbers sit; a date or a build stamp is not a version. */
const versionOf = (id: string, family: string): string => {
  const after = new RegExp(`${family}-(\\d{1,2})(?:-(\\d{1,2}))?(?!\\d)`, 'i').exec(id)
  const before = new RegExp(`(\\d{1,2})(?:-(\\d{1,2}))?-${family}`, 'i').exec(id)
  const [major, minor] = (after ?? before ?? []).slice(1)
  return major === undefined ? '' : ` ${major}${minor === undefined ? '' : `.${minor}`}`
}

/** A model id as a person reads it: "claude-opus-5-5" is "Opus 5.5". An id that is not Claude's is shown as it is. */
export function modelLabel(id: string | undefined): string | undefined {
  if (id === undefined || id.trim() === '') return undefined
  const family = FAMILY.exec(id)?.[1]
  // Untrusted text on its way to the panel: control characters and line breaks become spaces before the cut.
  if (family === undefined) return id.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MODEL_CHARS) || undefined
  return `${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()}${versionOf(id, family)}`
}

/**
 * The lines of a row at work, apart from its name: what it said in its last step; the sentence for what it does now,
 * which stands in until it has said anything; and the dim model, effort level (when recorded), run time and tokens used so far.
 */
export function workLine(one: Employee, now: number): { said?: string; sentence: string; stats: string } {
  const tokens = one.tokens ? ` · ${tokensLabel(one.tokens)} tokens` : ''
  const hiring = [modelLabel(one.model), one.effort].filter(Boolean).map(part => `${part} · `).join('')
  return { said: one.said, sentence: one.activity ?? READING_BRIEF, stats: `· ${hiring}${ago(now - one.startedAt)}${tokens}` }
}

/**
 * What a row at work says about itself: its last words in italics, or else the sentence that stands in. A note from the step tool is newer
 * than any words before it and replaces them. Once a bar is drawn its count is beside the bar, so a leading "Step N of M" is taken off the
 * words; where nothing is left, the existing sentence stands in.
 */
export function deskWords(one: Employee, line: { said?: string; sentence: string }): { said?: string; sentence: string } {
  const tidy = (text: string): string | undefined => (one.stepTotal === undefined ? text : withoutStepPrefix(text)) || undefined
  if (one.stepNote !== undefined) return { sentence: tidy(one.stepNote) ?? line.sentence }
  const said = line.said === undefined ? undefined : tidy(line.said)
  return said === undefined ? { sentence: line.sentence } : { said, sentence: line.sentence }
}

/** The right-hand lines of a finished row. Lost contact reads how long it was silent, not how long the run lasted. */
export function doneLine(one: Employee, now: number): { when: string; took: string; isFailed: boolean; isLost: boolean } {
  const ended = one.endedAt ?? now
  const when = `${ago(now - ended)} ago`
  if (one.mood === 'lost') return { when, took: `Lost contact after ${ago(ended - (one.lastSeen ?? one.startedAt))}`, isFailed: false, isLost: true }
  const span = ago(ended - one.startedAt)
  if (one.mood === 'failed') return { when, took: `Failed after ${span}`, isFailed: true, isLost: false }
  if (one.mood === 'stopped') return { when, took: `Stopped after ${span}`, isFailed: false, isLost: false }
  return { when, took: `took ${span}${one.tokens ? ` · ${tokensLabel(one.tokens)} tokens` : ''}`, isFailed: false, isLost: false }
}

/**
 * Clawd's one status line: who failed, else what he is doing. The count at work is not repeated here. Questions for the
 * person are not counted here: they reach the person in Clawd's question box.
 */
export function statusOf(isBusy: boolean, working: number, failed: string[]): { tone: 'clear' | 'busy' | 'alert'; text: string } {
  // How many are at work is told by the section below, not here: working only decides between "Free" and "All clear".
  if (failed[0] !== undefined) return { tone: 'alert', text: `${failed[0]} failed${failed.length > 1 ? ` +${failed.length - 1}` : ''}` }
  if (isBusy) return { tone: 'busy', text: 'Working' }
  return { tone: 'clear', text: working > 0 ? 'Free' : 'All clear' }
}

// ---- People ----

const match = (haystack: string[], query: string) => {
  const q = query.trim().toLowerCase()
  return q === '' || haystack.some(h => h.toLowerCase().includes(q))
}

export type Person = { type: string; name: string; plugin: string; jobs: number; blurb: string; isOff: boolean; /** Everything its runs have used. */ tokens?: number }

/** The first sentence of a blurb, whole: what a People row says someone does. A blurb with no full stop is kept as it is. */
export const firstSentence = (text: string) => /^.*?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim()

export const pluginOf = (type: string) => (type.includes(':') ? type.split(':')[0]! : 'built in')

/** Built-in agents are never laid off. */
export const canLayOff = (type: string) => type.includes(':')

export function splitPeople(people: Person[], query: string): { team: Person[]; pool: Person[] } {
  const found = people.filter(p => match([p.name, p.type, p.plugin, p.blurb], query))
  return { team: found.filter(p => !p.isOff), pool: found.filter(p => p.isOff) }
}

/** Every agent type on the books, as a person: "Planner", where it comes from, how often it was hired. */
export function buildPeople(types: string[], blurbs: Record<string, string>, roster: Record<string, Badge>, laidOff: string[]): Person[] {
  const off = new Set(laidOff)
  const roles = [...new Set(types)].sort().map(type => ({ type, title: roleOf(type, blurbs[type] ?? '').title }))
  return roles.map(({ type, title }) => {
    // A role two types share is told apart by the type (or, if that only repeats the role, by its plugin).
    const shared = roles.filter(r => r.title === title).length > 1
    const bare = bareType(type)
    const tag = bare.toLowerCase() === title.toLowerCase() ? pluginOf(type) : bare
    return {
      type, blurb: blurbs[type] ?? '', plugin: pluginOf(type), jobs: roster[type]?.jobs ?? 0, tokens: roster[type]?.tokens, isOff: off.has(type),
      name: shared ? `${title} (${tag})` : title,
    }
  })
}
