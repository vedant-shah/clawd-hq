// The plan (hooks/plan-run.ts): the calls it is built from, per use. The state is an atom in register-state.ts; the plan files are in the
// project, read and written through `$.fs`; a failure that was swallowed leaves a line under `debug:plan` in the store.
import type { EngineInterface } from 'claude-code'

import { leftAddItems } from './left-io'
import type { BriefingOptions } from './instructions'
import type { OpenGoal } from './history-view'
import { loadGoals } from './plan-io'
import type { PlanIo } from './plan-io'
import { PLAN_DEBUG_KEY, withPlanNote } from './plan-run'
import type { PlanRunIo } from './plan-run'
import { goalStartedAt, logGoalEnd, logGoalStart } from './register-history'
import { draftFrom, draftKey } from './plan-draft'
import type { PlanDraft } from './plan-draft'
import { readPlan, readPlanNotes, readStaff, ses, updateLeftUndone, updatePlan, updatePlanNotes } from './register-state'

/** The plan files' calls. `stat` resolves where a path really lands, so a link out of the plans folder is refused. */
export function planFiles($: EngineInterface): PlanIo {
  return {
    exists: path => $.fs.exists(path), read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), list: path => $.fs.list(path),
    stat: path => $.fs.stat(path, { resolve: true }),
    // NOT queued, on purpose: this is called from inside the plan's own queue (`inLine`), and waiting on that queue again from within it would hold it for ever. A note lost to a race is acceptable: the record is only a way to look.
    debug: async line => { const at = await $.clock.now(); await $.store.set(PLAN_DEBUG_KEY, withPlanNote(await $.store.get(PLAN_DEBUG_KEY), line, at)) },
  }
}

/**
 * The Planner's plan waiting for Clawd in a project folder: kept in the plugin's store, and read from it again each time (a write reads it
 * again too), so a draft another session spent cannot come back from a copy held here. `held` is only what was last seen, for a store that
 * cannot be read right now.
 */
let held: ReadonlyMap<string, PlanDraft | null> = new Map()

/** The id the engine gives this session; "unknown" where it cannot say (a goal and a draft then belong to "unknown"). */
export function sessionIdOf($: EngineInterface): Promise<string> {
  return $.session.id().catch(() => 'unknown')
}

export function planDraftIo($: EngineInterface): PlanRunIo['draft'] {
  // The draft is this session's: its slot is named by the folder and the session, so another session's draft is never read.
  const slot = async (folder: string) => draftKey(folder, await sessionIdOf($))
  const read = async (folder: string): Promise<PlanDraft | null> => {
    const key = await slot(folder)
    const fresh = await $.store.get(key).then(raw => ({ draft: draftFrom(raw, folder) }), () => undefined)
    const draft = fresh === undefined ? held.get(key) ?? null : fresh.draft
    held = new Map([...held, [key, draft]])
    return draft
  }
  return {
    get: read,
    set: async (folder, fn) => {
      const next = fn(await read(folder))
      const key = await slot(folder)
      held = new Map([...held, [key, next]])
      await $.store.set(key, next)
      return next
    },
  }
}

/**
 * The goals in this folder that another session owns, and the plan files of no session (saved before plan files named one), for the History
 * tab's Resume. Read only when that tab is drawn. With Clawd off, none.
 */
export async function openGoalsOf($: EngineInterface, opts: Pick<BriefingOptions, 'isOn'>): Promise<readonly OpenGoal[]> {
  if (!opts.isOn) return []
  const me = await sessionIdOf($)
  return (await loadGoals(planFiles($), ses.cwd)).filter(goal => goal.plan.session !== me)
}

/** What the plan may do. `opts.isOn` is read live: with Clawd off the tool is refused and nothing is loaded. */
export function planRunIo($: EngineInterface, opts: Pick<BriefingOptions, 'isOn' | 'isChiefOn'>): PlanRunIo {
  return {
    isOn: () => opts.isOn, isKept: () => opts.isChiefOn, root: () => ses.cwd, files: planFiles($), now: () => $.clock.now(), session: () => sessionIdOf($),
    get: () => readPlan($), set: fn => updatePlan($, fn), staff: () => readStaff($),
    keepLater: texts => leftAddItems({ folder: () => ses.cwd, now: () => $.clock.now(), change: fn => updateLeftUndone($, fn), save: (folder, list) => $.store.set(`leftUndone:${folder}`, list) }, texts, 'Clawd'),
    draft: planDraftIo($), notes: { get: () => readPlanNotes($), set: fn => updatePlanNotes($, fn) },
    goalStarted: start => logGoalStart($, start), goalEnded: end => logGoalEnd($, end), goalStartedAt: slug => goalStartedAt($, slug), // the history's goal records (hooks/register-history.ts)
  }
}
