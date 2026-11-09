// The quiet chat: filler rows are not drawn (hooks/quiet.ts says which); the full view shows everything.
import type { EngineInterface, On } from 'claude-code'

import type { BriefingOptions } from './instructions'
import { isBackgroundHint, isHandback, isNoUpdate, needsAgentList, rowLook } from './quiet'
import { blank, smallRow } from './quiet-rows'
import type { Resolve } from './quiet-rows'
import { readStaff, ses } from './register-state'

/** The drawing table of a render event, handed to the quiet rows (hooks/quiet-rows.tsx) as a closure. */
const resolver = ($: EngineInterface): Resolve => e => $.ui.resolve(e)

export function registerQuiet(on: On, brief: BriefingOptions) {
  // Only while Clawd runs the chat: his rules are what make him report on what is hidden. Read at each row: a press applies at once.
  const isQuiet = () => brief.isQuiet && brief.isOn
  {
    on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
      const p = e.props
      // Most rows are the person's own: nothing is read for them. A notification may be a merged line (no task), a peer message may come with no sender.
      const isOwn = !p.task && !p.from && !['task-notification', 'peer-send-message', 'peer'].includes(p.origin.kind)
      if (!isQuiet() || isOwn) return next(e)
      const row = { isExpanded: p.isExpanded, originKind: p.origin.kind, text: p.text, task: p.task, from: p.from }
      const books = await readStaff($)
      // A hand-back whose sender the books do not name may be known to the session's agent list, read at most once a short while.
      const agents = needsAgentList(row, books) ? await ses.agentList(await $.clock.now(), () => $.agent.list()) : []
      const isHidden = !row.isExpanded && isHandback(row, books, agents)
      // What it decided for peer and notification rows, kept at `debug:quiet` without a word of the row; never waited for.
      ses.quietLog.keep({ now: () => $.clock.now(), get: key => $.store.get(key), save: (key, value) => $.store.set(key, value) }, row, isHidden ? 'hide' : 'show')
      return isHidden ? blank(resolver($), e) : next(e)
    })
    on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => (isQuiet() && isNoUpdate(e.props.text) ? blank(resolver($), e) : next(e)))
    // Small rows: the office's own bookkeeping calls are hidden or dimmed (hooks/quiet.ts says which). Errors always show.
    on('ui.render', { component: 'ToolUse' }, async ($, e, next) => (isQuiet() ? smallRow(resolver($), e, rowLook(e.props, await readStaff($)), () => next(e)) : next(e)))
    on('ui.render', { component: 'ToolResult' }, async ($, e, next) => (isQuiet() ? smallRow(resolver($), e, rowLook(e.props, await readStaff($)), () => next(e)) : next(e)))
    on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => (isQuiet() && isBackgroundHint(e.props.kind) ? blank(resolver($), e) : next(e)))
  }
}
