// The plan (hooks/plan-run.ts): the calls it is built from, per use. The state is an atom in register-state.ts; the plan files are in the
// project, read and written through `$.fs`; a failure that was swallowed leaves a line under `debug:plan` in the store.
import type { EngineInterface } from 'claude-code'

import { leftAddItems } from './left-io'
import type { BriefingOptions } from './instructions'
import type { PlanIo } from './plan-io'
import { PLAN_DEBUG_KEY, withPlanNote } from './plan-run'
import type { PlanRunIo } from './plan-run'
import { goalStartedAt, logGoalEnd, logGoalStart } from './register-history'
import { draftFrom, draftKey } from './plan-draft'
import type { PlanDraft } from './plan-draft'
import { readPlan, readStaff, ses, updateLeftUndone, updatePlan } from './register-state'

/** The plan files' calls. `stat` resolves where a path really lands, so a link out of the plans folder is refused. */
export function planFiles($: EngineInterface): PlanIo {
  return {
    exists: path => $.fs.exists(path), read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), list: path => $.fs.list(path),
    stat: path => $.fs.stat(path, { resolve: true }),
    // NOT queued, on purpose: this is called from inside the plan's own queue (`inLine`), and waiting on that queue again from within it would hold it for ever. A note lost to a race is acceptable: the record is only a way to look.
    debug: async line => { const at = await $.clock.now(); await $.store.set(PLAN_DEBUG_KEY, withPlanNote(await $.store.get(PLAN_DEBUG_KEY), line, at)) },
  }
}

/** The draft this process holds, for one folder: a plain variable (it is not a plan, and nothing draws it), replaced and never changed in place. */
let held: PlanDraft | null = null

/**
 * The Planner's plan waiting for Clawd, for this project folder: held in memory, and kept in the plugin's store so a reload does not lose it.
 * What the store holds is read for the folder the session is in now, and only when it is a draft.
 */
export function planDraftIo($: EngineInterface): PlanRunIo['draft'] {
  const get = async (): Promise<PlanDraft | null> => {
    if (held !== null && held.folder === ses.cwd) return held
    held = draftFrom(await $.store.get(draftKey(ses.cwd)).catch(() => undefined), ses.cwd)
    return held
  }
  return {
    get,
    set: async fn => {
      const next = fn(await get())
      held = next
      await $.store.set(draftKey(ses.cwd), next)
      return next
    },
  }
}

/** What the plan may do. `opts.isOn` is read live: with Clawd off the tool is refused and nothing is loaded. */
export function planRunIo($: EngineInterface, opts: Pick<BriefingOptions, 'isOn'>): PlanRunIo {
  return {
    isOn: () => opts.isOn, root: () => ses.cwd, files: planFiles($), now: () => $.clock.now(),
    get: () => readPlan($), set: fn => updatePlan($, fn), staff: () => readStaff($),
    keepLater: texts => leftAddItems({ folder: () => ses.cwd, now: () => $.clock.now(), change: fn => updateLeftUndone($, fn), save: (folder, list) => $.store.set(`leftUndone:${folder}`, list) }, texts, 'Clawd'),
    draft: planDraftIo($),
    goalStarted: start => logGoalStart($, start), goalEnded: end => logGoalEnd($, end), goalStartedAt: slug => goalStartedAt($, slug), // the history's goal records (hooks/register-history.ts)
  }
}
