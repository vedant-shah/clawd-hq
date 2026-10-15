// Starting values for the office's state, and a pure list helper. (The atoms and helpers that take `$` stay in register.tsx:
// the engine's scan follows `$` and atoms only within one file.)
import type { Boss, ClawdBrief, Employee, Fx, Gauge, Payroll } from '../types'

export const BOSS0: Boss = {
  activity: 'Waiting for the boss…', isBusy: false, waveUntil: 0, turns: 0, proudUntil: 0, oopsUntil: 0,
  lastTitle: '', idleSince: 0, hires: 0, wins: 0, fails: 0,
}
export const FX0: Fx = {}
export const PAYROLL0: Payroll = { laidOff: [], isReviewed: false, stacks: [] }
export const GAUGE0: Gauge = { startedAt: 0, limits: [] }
/** Nothing read yet: the Settings tab fills in Clawd's instructions at session start. */
export const BRIEF0: ClawdBrief = { isOn: true }

export function edit(list: Employee[], id: string, fn: (e: Employee) => Employee): Employee[] {
  return list.map(e => (e.id === id ? fn(e) : e))
}

/** Runs tasks one after another, in the order asked, whatever each one's outcome: for writes many hooks make at the same moment. */
let line: Promise<unknown> = Promise.resolve()
export function inLine<T>(task: () => Promise<T>): Promise<T> {
  const run = line.then(task, task)
  line = run.catch(() => undefined)
  return run
}
