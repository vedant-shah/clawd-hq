// How a specialist joins the books, shows signs of life and leaves them, and how the books are matched with the engine's agent list.
// No `$` and no atoms: register.tsx hands in what each step may do as closures (`RunIo`).
import type { AgentStatus } from 'claude-code'
import type { Boss, EndedBy, Employee, Mood } from '../types'
import { labelOf, roleOf } from './office'
import { freshHire } from './office-state'
import { DEMO, isActive } from './panel-model'
import { SCOUT_TYPE } from './scout-spec'
import { edit } from './state'
import { QUIET_MS, endOfStatus, endRun, finishedBoss, finishedText, hire, markEngine, quietFor, restart, touch, verdict } from './staff-model'

/** An agent as the engine lists it. */
export type ListedAgent = { id: string; type: string; description: string; name?: string; status: AgentStatus }

/** What the books of specialists may do. */
export type RunIo = {
  readonly now: () => Promise<number>
  readonly tick: () => Promise<number>
  readonly staff: () => Promise<Employee[]>
  /** Changes the books in one write; the change may run more than once, so it must be repeatable. */
  readonly changeStaff: (fn: (list: Employee[]) => Employee[]) => Promise<unknown>
  readonly blurbs: () => Promise<Record<string, string>>
  /** Puts a type on the books with how often it was hired. */
  readonly enroll: (type: string, jobs: number) => Promise<void>
  readonly setBoss: (fn: (b: Boss) => Boss) => Promise<void>
  readonly toast: (text: string) => void
  readonly agents: () => Promise<readonly ListedAgent[]>
}

/** Puts a specialist on the books. One already there keeps its progress and takes the new facts; a new one is counted as a hire and Clawd waves. */
export async function newHire(io: RunIo, id: string, type: string, description: string, name?: string) {
  const [now, t] = [await io.now(), await io.tick()]
  const fresh = freshHire({ id, type, description, name }, now, t)
  if ((await io.staff()).some(e => e.id === id)) {
    await io.changeStaff(list => hire(list, fresh))
    return
  }
  await io.enroll(type, id.startsWith(DEMO) ? 0 : 1)
  await io.changeStaff(list => hire(list, fresh))
  const role = roleOf(type, (await io.blurbs())[type] ?? '')
  await io.setBoss(b => ({ ...b, activity: role.hello, waveUntil: t + 6, hires: b.hires + 1 }))
}

/** An agent the engine lists that no spawn announced (it started before this mod loaded) joins the books. */
export const hireListed = (io: RunIo, a: { id: string; type: string; description: string; name?: string }) => newHire(io, a.id, a.type, a.description, a.name)

/**
 * Ends one specialist's run. The check sits inside the write, so two signals for one stop (turn.complete,
 * SubagentStop, the reconcile) end it once; a guess from the engine or the clock also checks it is still quiet.
 */
export async function clockOut(io: RunIo, id: string, mood: Mood, how: EndedBy = 'signal') {
  const [now, t] = [await io.now(), await io.tick()]
  let ended: Employee | undefined
  await io.changeStaff(l => {
    ended = undefined
    return edit(l, id, one => {
      if (!isActive(one) || (how !== 'signal' && quietFor(one, now) <= QUIET_MS)) return one
      ended = one
      return endRun(one, mood, how, now, t)
    })
  })
  const e = ended as Employee | undefined
  // Lost contact is neither a win nor a failure: no toast, no cheer.
  if (!e || mood === 'lost') return
  const blurb = (await io.blurbs())[e.type] ?? ''
  const [role, label] = [roleOf(e.type, blurb), labelOf(e, blurb)]
  await io.setBoss(b => finishedBoss(b, mood, t, label))
  io.toast(finishedText(mood, role.prop, label, e, now))
}

/** Any sign of life from a specialist (a tool call, a model step): it is heard from now, and a finished one is back at work. */
export async function signOfLife(io: RunIo, id: string, activity?: string) {
  const [now, t] = [await io.now(), await io.tick()]
  await io.changeStaff(l => edit(l, id, one => {
    const back = touch(restart(one, now, t), now)
    return activity === undefined ? back : { ...back, activity }
  }))
}

/** The specialist of this id on the books. One the engine lists that no spawn has announced yet (its first call can beat the hire) joins first. */
export async function specialistOf(io: RunIo, id: string): Promise<Employee | undefined> {
  const known = (await io.staff()).find(one => one.id === id)
  if (known) return known
  const listed = (await io.agents()).find(one => one.id === id)
  if (!listed) return undefined
  await hireListed(io, listed)
  return (await io.staff()).find(one => one.id === id)
}

/**
 * The engine's own list catches agents spawned before this mod loaded and stops nobody saw; the clock catches
 * runs that went silent. Only silence ends a run (see verdict), so a long step is never cut short.
 */
export async function reconcile(io: RunIo) {
  const [agents, list, now] = [await io.agents(), await io.staff(), await io.now()]
  for (const a of agents) if (!list.some(e => e.id === a.id) && a.type !== SCOUT_TYPE && endOfStatus(a.status) === undefined) await hireListed(io, a) // the scout is no hire
  for (const e of list) {
    const status = agents.find(a => a.id === e.id)?.status
    const seen = status !== undefined && status !== e.engine ? markEngine(e, status, now) : e
    if (seen !== e) await io.changeStaff(l => edit(l, e.id, one => markEngine(one, status!, now)))
    const end = verdict(seen, status, now)
    if (end) await clockOut(io, e.id, end.mood, end.how)
  }
}
