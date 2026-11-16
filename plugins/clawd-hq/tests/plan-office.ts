// The plan at work, on a project held in memory and a state kept in a variable (shared by the plan's tests).
import type { GoalEnd, PlanRunIo } from '../hooks/plan-run'
import type { PlanDraft } from '../hooks/plan-draft'
import type { Employee, PlanState } from '../types'
import { ROOT, disk } from './plan-disk'

/** The goal of a plan loaded from the fake disk: its file's name and the file's modified time (0 there). */
export const KEY = 'fix-login:0'
export const emp = (over: Partial<Employee> = {}): Employee => ({ id: 'a1', type: 'general-purpose', description: 'Do it', mood: 'working', tools: 0, startedAt: 100, joinedTick: 0, planKey: KEY, ...over })

export function office(files: Record<string, string> = {}, isOn = true) {
  const d = disk(files)
  const mine = { state: null as PlanState | null, drafts: new Map<string, PlanDraft | null>(), get draft() { return this.drafts.get(ROOT) ?? null }, started: [] as Array<{ title: string; steps: number; by: string }>, staff: [] as Employee[], isOn, later: [] as string[][], ended: [] as GoalEnd[], keepFails: false, seamFails: false, at: 1_000, setDelays: [] as number[], getFails: false }
  const io: PlanRunIo = {
    isOn: () => mine.isOn, root: () => ROOT, files: d.io, now: async () => mine.at,
    get: async () => { if (mine.getFails) throw new Error('the state is shut'); return mine.state },
    // A write that is slow lands late: what is set in the wrong order shows.
    set: async fn => { for (let i = mine.setDelays.shift() ?? 0; i > 0; i -= 1) await Promise.resolve(); mine.state = fn(mine.state); return mine.state },
    staff: async () => mine.staff,
    keepLater: async texts => { if (mine.keepFails) throw new Error('the list refused'); mine.later.push(texts) },
    draft: { get: async folder => mine.drafts.get(folder) ?? null, set: async (folder, fn) => { const next = fn(mine.drafts.get(folder) ?? null); mine.drafts.set(folder, next); return next } },
    goalStarted: async start => { mine.started.push({ title: start.title, steps: start.steps, by: start.by }) },
    goalStartedAt: async () => undefined,
    goalEnded: async end => { if (mine.seamFails) throw new Error('the record refused'); mine.ended.push(end) },
  }
  return { io, d, mine }
}
