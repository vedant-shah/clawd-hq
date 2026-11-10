// Every tool call, for Clawd and for his specialists: counted, guarded, answered when it is one of the office's own, and noted on the books.
import type { On } from 'claude-code'

import { sentenceOf } from './activity'
import { withToolUsed } from './checkpoint'
import { SHIPPED_DENY, guardOnCrash, isShippedWrite } from './clawd-edit'
import { PAUSE_TOOL, STEP_TOOL } from './constants'
import type { BriefingOptions } from './instructions'
import { knowToolUsed } from './know-check'
import { leftToolUsed } from './left-io'
import { ownToolAnswer } from './own-tools'
import { runIo } from './register-io'
import { ownToolIo } from './register-setup'
import { readStaff, ses, setBoss, updateStaff } from './register-state'
import { hireListed, signOfLife } from './run-io'
import { SCOUT_TYPE } from './scout-spec'
import { withTool } from './staff-model'
import { edit } from './state'
import { isCountedTool } from './usage-count'
import { recordUse } from './use-tally'

export function registerTools(on: On, brief: BriefingOptions) {
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.agentId
    // The running tally of agent and skill use (hooks/use-tally.ts): names and counts only, for what session files are too big to show. Never waited for.
    if (isCountedTool(tool)) void (async () => recordUse({ get: async key => (await $.store.get(key)) as never, set: (key, value) => $.store.set(key, value) }, ses.cwd, await $.session.id(), tool, input))().catch(() => undefined)
    if (ses.isEditTurn && isShippedWrite(tool, input)) return { deny: SHIPPED_DENY } as never
    // Every tool Clawd uses himself counts towards a long turn of his own (hooks/know-check.ts), but a step report and the pause before a question are no work.
    if (id === undefined && tool !== STEP_TOOL && tool !== PAUSE_TOOL) { knowToolUsed(); leftToolUsed(tool); await setBoss($, b => withToolUsed(b, tool)) } // editing files himself ends a coffee break checkpoint at the turn's end
    const own = await ownToolAnswer(ownToolIo($, brief), tool, id, input) // the tour, the offer of a rule, a specialist's step report, and Clawd's search
    if (own) return own as never
    // What the person answers in Clawd's question box settles the job at hand only: nothing is saved, and his status line stays as it was.
    if (tool === 'AskUserQuestion' && id === undefined) return next(e)
    if (id === undefined) {
      if (tool !== 'Agent' && tool !== 'Task') await setBoss($, b => ({ ...b, activity: sentenceOf(tool, input) }))
      return next(e)
    }
    // An id no spawn announced and the engine does not list is no one of ours: no hire, no revival. The setup scout is no hire either.
    const known = (await readStaff($)).find(one => one.id === id)
    const listed = known ? undefined : (await $.agent.list()).find(one => one.id === id && one.type !== SCOUT_TYPE)
    if (!known && !listed) return next(e)
    if (listed) await hireListed(runIo($), listed)
    else await signOfLife(runIo($), id)
    await updateStaff($, l => edit(l, id, one => withTool(one, sentenceOf(tool, input))))
    try { return await next(e) } finally { await updateStaff($, l => edit(l, id, one => (one.mood === 'working' ? { ...one, mood: 'thinking' } : one))) }
  }).catch((_$, e, next) => {
    return !next.called && guardOnCrash(ses.isEditTurn, String(e.tool), e as unknown as Record<string, unknown>) === 'deny' ? { deny: SHIPPED_DENY } as never : next(e)
  })
}
