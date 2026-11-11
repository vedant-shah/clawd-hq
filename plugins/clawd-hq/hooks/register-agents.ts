// The specialists: what is offered, how they are hired and resumed, each of their requests, and when they stop.
import type { EngineInterface, On } from 'claude-code'

import { THINKING, narrationOf } from './activity'
import { withNewWork } from './checkpoint'
import { BLURB_CHARS } from './constants'
import { BRIEF_NOTE, HANDOVER_NOTE, STAFFING_NOTE, fit, parseEffort } from './desk'
import type { Effort } from './desk'
import type { BriefingOptions } from './instructions'
import { keepBrief } from './know-check'
import { freshHire, withBlurb } from './office-state'
import { isActive } from './panel-model'
import { parsePairUp } from './pair-up'
import { holdBack } from './payroll'
import { enrollNow, gaugeIo, payrollIo, runIo, showStatus } from './register-io'
import { judgeReach } from './register-rules'
import { efforts, readBlurbs, readRoster, readStaff, readTick, ses, setBoss, updateBlurbs, updateStaff } from './register-state'
import { resumedEffort } from './resume-effort'
import { clockOut, newHire, signOfLife } from './run-io'
import { withRequest } from './rules-reach'
import { handScoutSpawn, scoutHandoff, spawnTypeOf } from './scout-run'
import { SCOUT_TYPE } from './scout-spec'
import { hire, withSaid, withStep } from './staff-model'
import { edit, inLine } from './state'
import { noteRequest } from './usage'

/** A resumed specialist is at work again, on a new run; one the books lost (from before a reload) joins them, not counted as a hire. */
async function rejoin<R extends { agentId?: string }>($: EngineInterface, r: R, e: { subagentType: string; description: string; name?: string; resume?: { agentId: string } }, said?: Effort) {
  if (!r.agentId) return r
  const [now, t] = [await $.clock.now(), await readTick($)]
  if (!(await readStaff($)).some(one => one.id === r.agentId)) await updateStaff($, l => hire(l, freshHire({ ...e, id: r.agentId!, type: e.subagentType, folder: ses.cwd }, now, t)))
  // The level it was hired with (or the follow-up's new one) goes on; the books are the copy that outlives a reload.
  const level = resumedEffort(said, [r.agentId, e.resume?.agentId], await readStaff($), efforts)
  if (level) { efforts.set(r.agentId, level); await updateStaff($, l => edit(l, r.agentId!, one => ({ ...one, effort: level }))) }
  await signOfLife(runIo($), r.agentId)
  await showStatus($)
  return r
}

export function registerAgents(on: On, brief: BriefingOptions) {
  // The agent's own stop signal, beside turn.complete: whichever comes first ends the run, the second finds it ended.
  on('classic.SubagentStop', async ($, e, next) => {
    await clockOut(runIo($), e.agent_id, 'done')
    return next(e)
  })

  // Instruction-aware: remember what each agent type is for, put it on the books, and keep laid-off types off the listing.
  on('agent.offer', async ($, e, next) => {
    if (e.agent === SCOUT_TYPE) return { isOffered: scoutHandoff.isOpen() } // the plugin's own, never on the books: offered only while Clawd is asked to hire it
    const blurb = fit(e.description, BLURB_CHARS) // cut at a word with no mark: the People row wraps it, and an ellipsis would only hide words
    // The engine offers every agent type at the same moment when a session starts. Their writes go one at a time:
    // the state refuses a write that lost the race too often, and the hook was then skipped for that type.
    await inLine(async () => {
      if ((await readBlurbs($))[e.agent] !== blurb) {
        await updateBlurbs($, m => withBlurb(m, e.agent, blurb))
      }
      if (!(await readRoster($))[e.agent]) await enrollNow($, e.agent, 0)
    })
    // With Clawd off, the list is the engine's own: nobody is hidden, and no layoff is made.
    if (brief.isOn && (await inLine(() => holdBack(payrollIo($), e.agent)))) return { isOffered: false }
    return next(e)
  })

  // While Clawd runs the chat, he learns to pick each hire's model and effort, and that handing work over needs no asking. Off: the tool's text is left alone.
  for (const tool of ['Agent', 'Task']) {
    on('tool.describe', { tool }, async ($, e, next) => {
      const r = await next(e)
      return brief.isOn ? { ...r, description: r.description + STAFFING_NOTE + HANDOVER_NOTE } : r
    })
  }

  on('agent.spawn', async ($, e, next) => {
    if (spawnTypeOf(e) === SCOUT_TYPE) return handScoutSpawn(scoutHandoff, next.origin.plugin === 'clawd-hq', () => next(e)) as never // the setup scout: no brief notes, no desk
    // A resumed run keeps its first brief (the engine takes no change to it) and its place on the books: no hire is counted again.
    // Clawd's [effort: …] line comes off the brief; every agent learns how to report its questions and choices.
    // A pair-up member's `PAIR-UP: <goal>` line (hooks/pair-up.ts) comes off the same way, right after it.
    const { effort, prompt: unEffort } = parseEffort(e.prompt)
    const { goal, isCouncil, prompt } = parsePairUp(unEffort)
    await setBoss($, withNewWork) // a hire or a resume is new work: the coffee break checkpoint is over
    if (e.resume) return rejoin($, await next(e), e, effort) // the engine takes no change to a resumed message, so its effort line stays on it
    // A workflow's agent keeps the script's prompt (2.1.300 applies a rewrite there): its answer is the script's to read.
    const sent = e.workflow ? e.prompt : prompt + BRIEF_NOTE
    const r = await next({ ...e, prompt: sent })
    if (r.agentId) {
      keepBrief(r.agentId, sent)
      if (effort) efforts.set(r.agentId, effort)
      await newHire(runIo($), r.agentId, e.subagentType, e.description, e.name)
      const pair = goal !== undefined && !e.workflow ? { goal, at: await $.clock.now(), ...(isCouncil ? { isCouncil } : {}) } : undefined // a workflow keeps its script's prompt, so its line was never taken off
      await updateStaff($, l => edit(l, r.agentId!, one => ({ ...one, ...(effort ? { effort } : {}), ...(pair ? { pair } : {}), model: one.model || r.model })))
      await showStatus($)
    }
    return r
  })

  // Each model request of an agent: what it has spent, and how full its context is.
  on('turn.step', async function* ($, e, next) {
    // Not waited for: the store's answer never holds a request back (noteRequest keeps its own errors).
    if (!e.agentId) void noteRequest(gaugeIo($), e.model, e.effort)
    const me = e.agentId ? (await readStaff($)).find(one => one.id === e.agentId) : undefined
    // A request is a sign of life, and a resumed specialist's first can come before any tool call.
    if (me) await signOfLife(runIo($), me.id, THINKING)
    const effort = e.agentId ? efforts.get(e.agentId) ?? me?.effort : undefined
    if (!e.agentId) ses.reach = withRequest(ses.reach, e.messageCount)
    const result = yield* next(effort ? { ...e, effort } : e)
    // The request's system prompt was composed on the way: whether the rules reached it is known now.
    if (!e.agentId && brief.isOn) await judgeReach($).catch(() => undefined) // a store that refuses only means it is learnt again next session
    const [u, said] = [result.usage, narrationOf(result.answer ?? '')]
    if (!e.agentId || (!u && !said)) return result
    const now = await $.clock.now()
    await updateStaff($, l => edit(l, e.agentId!, one => {
      const stepped = u ? withStep(one, u, u.model || e.model, now) : one
      // A request that comes back after the run was sent home says nothing: its words would outlive the run.
      return said && isActive(one) ? withSaid(stepped, said) : stepped
    }))
    return result
  })
}
