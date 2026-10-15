// Pure changes to the office's state: register.tsx applies them through its atoms. (No `$` and no atoms here: the
// engine's scan follows those only within one file.)
import type { Badge, Boss, Employee, Fx, Payroll } from '../types'
import { CHEER_TICKS, DESCRIPTION_CHARS, MAX_BLURBS, NAME_CHARS } from './constants'
import { fit } from './desk'
import { isActive } from './panel-model'

/** At a desk: at work, or finished so recently that the cheer is still on. */
const isAtDesk = (e: Employee, t: number) => isActive(e) || (e.doneTick !== undefined && t - e.doneTick < CHEER_TICKS)

/** Whether anything in the office moves at tick `t`: a quiet office needs a frame only now and then. */
export const isLively = (list: Employee[], f: Fx, b: Boss, t: number): boolean =>
  list.some(one => isAtDesk(one, t)) || b.isBusy || f.demo !== undefined || (b.quip !== undefined && t < b.quip.until) || t < b.waveUntil

/** An arrival on the floor three ticks or more starts thinking; everyone else is left as they were. */
export const settle = (list: Employee[], t: number): Employee[] =>
  list.map(one => (isSettling(one, t) ? { ...one, mood: 'thinking' } : one))
export const isSettling = (one: Employee, t: number) => one.mood === 'arriving' && t - one.joinedTick >= 3

/** Clawd's card when a main-chat turn ends: free again, since `now`, saying how it went. */
export const turnEndBoss = (b: Boss, reason: string, now: number): Boss => ({
  ...b, isBusy: false, idleSince: now, doneAt: now,
  activity: reason === 'answer' ? 'All done, boss.' : 'Hmm, that turn stopped early.',
})

/** Clawd's card at the tour's quiet step: nothing on, idle long enough (`napMs`) to doze already. */
export const quietBoss = (b: Boss, now: number, napMs: number): Boss =>
  ({ ...b, isBusy: false, proudUntil: 0, oopsUntil: 0, quip: undefined, idleSince: now - napMs - 1 })

/** A specialist just hired, arriving now (`now`, tick `t`), its name and task cut to size. */
export function freshHire(a: { id: string; type: string; description: string; name?: string }, now: number, t: number): Employee {
  const named = a.name ? { name: fit(a.name, NAME_CHARS) } : {}
  return { id: a.id, type: a.type, description: fit(a.description, DESCRIPTION_CHARS), ...named, mood: 'arriving', tools: 0, startedAt: now, lastSeen: now, joinedTick: t }
}

/** The books with `jobs` more for this type; a type not there yet starts at them. */
export function withJobs(books: Record<string, Badge>, type: string, jobs: number): Record<string, Badge> {
  const badge = books[type] ?? { jobs: 0 }
  return { ...books, [type]: { ...badge, jobs: badge.jobs + jobs } }
}

/** The payroll with this type laid off (last on the list) or rehired; either way it counts as reviewed. */
export function withLaidOff(p: Payroll, type: string, isOff: boolean): Payroll {
  const rest = p.laidOff.filter(t => t !== type)
  return { ...p, laidOff: isOff ? [...rest, type] : rest, isReviewed: true }
}

/** The blurbs with this type's new one last; past the cap, the oldest go. */
export const withBlurb = (m: Record<string, string>, type: string, blurb: string): Record<string, string> =>
  Object.fromEntries([...Object.entries(m).filter(([k]) => k !== type), [type, blurb]].slice(-MAX_BLURBS))
