// Specialists Clawd hires together as a pair-up for one job: which of them share a card on the Office tab and in the finished list,
// what that card is titled, and its one status line. Pure. A hire joins a pair-up through a `PAIR-UP: <goal>` first line in its brief.
import type { Employee } from '../types'
import { fit } from './desk'
import { ago } from './office'
import { atWork, doneLine, doneThisSession, isActive, tokensLabel } from './panel-model'

/** DECIDED: members hired with the same goal within 10 minutes of the first one share a card; a longer gap makes a separate job. */
export const PAIR_WINDOW_MS = 10 * 60_000

/** A goal is kept to a size a card can wrap, cut at a word and with no mark. */
const GOAL_CHARS = 160

const PAIR_LINE = /^\s*PAIR-UP:[ \t]*(\S[^\r\n]*?)[ \t]*(?:\r?\n|$)/i

/** The `PAIR-UP: <goal>` line Clawd starts a pair-up member's brief with (after its effort line is taken off), and the brief without it. An empty goal is no pair-up. */
export function parsePairUp(prompt: string): { goal?: string; prompt: string } {
  const m = prompt.match(PAIR_LINE)
  const goal = m ? fit(m[1] ?? '', GOAL_CHARS) : ''
  return m && goal !== '' ? { goal, prompt: prompt.slice(m[0].length) } : { prompt }
}

/** Two or more specialists hired together for one goal, in the order they were hired. */
export type PairGroup = { goal: string; members: Employee[] }

const sameGoal = (a: string, b: string) => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

/** Every pair-up on the books: members with the same goal, hired within the window of the first of them. One alone is no pair-up. */
export function pairGroups(staff: Employee[]): PairGroup[] {
  const hires = staff.filter((e): e is Employee & { pair: NonNullable<Employee['pair']> } => e.pair !== undefined).sort((a, b) => a.pair.at - b.pair.at)
  const groups = hires.reduce<Array<{ goal: string; at: number; members: Employee[] }>>((all, one) => {
    const open = all.find(g => sameGoal(g.goal, one.pair.goal) && one.pair.at - g.at <= PAIR_WINDOW_MS)
    return open
      ? all.map(g => (g === open ? { ...g, members: [...g.members, one] } : g))
      : [...all, { goal: one.pair.goal, at: one.pair.at, members: [one] }]
  }, [])
  return groups.filter(g => g.members.length >= 2).map(({ goal, members }) => ({ goal, members }))
}

const groupOf = (groups: PairGroup[], id: string) => groups.find(g => g.members.some(m => m.id === id))

/** "A & B", and "A, B & C" for three or more. */
export function pairTitle(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

export type PairState = 'working' | 'failed' | 'lost' | 'stopped' | 'done'

/** Working while any member works; then failed if one failed, lost contact if one did, stopped if one was stopped on purpose; otherwise done. */
export function pairState(members: Employee[]): PairState {
  if (members.some(isActive)) return 'working'
  return (['failed', 'lost', 'stopped'] as const).find(mood => members.some(m => m.mood === mood)) ?? 'done'
}

/** The group's one status line: the state, how long since the first member started (or how long the job took), and everyone's tokens. */
export function pairLine(members: Employee[], now: number): { state: PairState; text: string } {
  const state = pairState(members)
  const start = Math.min(...members.map(m => m.startedAt))
  const span = ago(Math.max(...members.map(m => m.endedAt ?? now)) - start)
  const sum = members.reduce((n, m) => n + (m.tokens ?? 0), 0)
  const tokens = sum > 0 ? ` · ${tokensLabel(sum)} tokens` : ''
  if (state === 'working') return { state, text: `Working · ${ago(now - start)}${tokens}` }
  if (state === 'lost') return { state, text: doneLine(members.find(m => m.mood === 'lost')!, now).took }
  if (state === 'done') return { state, text: `Done · took ${span}${tokens}` }
  return { state, text: `${state === 'failed' ? 'Failed' : 'Stopped'} after ${span}` }
}

/** One card on a tab: a specialist alone, or a pair-up. */
export type Slot = { kind: 'one'; one: Employee } | { kind: 'pair'; group: PairGroup }

/** The Office tab's floor: each specialist at work gets a card, but a pair-up gets one, at the place of its first member at work, with all its members. */
export function floorSlots(staff: Employee[]): Slot[] {
  const groups = pairGroups(staff)
  return atWork(staff).flatMap((one): Slot[] => {
    const group = groupOf(groups, one.id)
    if (group === undefined) return [{ kind: 'one', one }]
    return group.members.find(isActive) === one ? [{ kind: 'pair', group }] : []
  })
}

const slotTime = (s: Slot) => (s.kind === 'one' ? s.one.endedAt ?? 0 : Math.max(...s.group.members.map(m => m.endedAt ?? 0)))

/** The finished list, newest first: a pair-up is one card once none of its members works; while one does, its finished members stay on the floor's card. */
export function finishedSlots(staff: Employee[], since: number): Slot[] {
  const groups = pairGroups(staff)
  const singles = doneThisSession(staff, since).filter(one => groupOf(groups, one.id) === undefined).map((one): Slot => ({ kind: 'one', one }))
  const over = groups
    .filter(g => !g.members.some(isActive) && g.members.some(m => (m.endedAt ?? -1) >= since))
    .map((group): Slot => ({ kind: 'pair', group }))
  return [...singles, ...over].sort((a, b) => slotTime(b) - slotTime(a))
}
