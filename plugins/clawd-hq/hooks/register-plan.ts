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

/**
 * The Planner's plan waiting for Clawd in a project folder: kept in the plugin's store, and read from it again each time (a write reads it
 * again too), so a draft another session spent cannot come back from a copy held here. `held` is only what was last seen, for a store that
 * cannot be read right now.
 */
let held: ReadonlyMap<string, PlanDraft | null> = new Map()

export function planDraftIo($: EngineInterface): PlanRunIo['draft'] {
  const read = async (folder: string): Promise<PlanDraft | null> => {
    const fresh = await $.store.get(draftKey(folder)).then(raw => ({ draft: draftFrom(raw, folder) }), () => undefined)
    const draft = fresh === undefined ? held.get(folder) ?? null : fresh.draft
    held = new Map([...held, [folder, draft]])
    return draft
  }
  return {
    get: read,
    set: async (folder, fn) => {
      const next = fn(await read(folder))
      held = new Map([...held, [folder, next]])
      await $.store.set(draftKey(folder), next)
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
