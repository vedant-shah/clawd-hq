// The turns of the main chat and the hand-backs of specialists: what each prompt carries, and what happens when a turn begins and ends.
import type { On } from 'claude-code'

import { READING_BRIEF } from './activity'
import { isNotification, isPersonMessage, withHandBack, withNotice, withPersonSpoke, withTurnEnd } from './checkpoint'
import { editNote, editPartOf } from './clawd-edit'
import { withTurnStarted } from './coffee-break'
import { keepCoffeeRecord } from './coffee-debug'
import { withVoiceNotes } from './council'
import { parseChoices } from './desk'
import type { BriefingOptions } from './instructions'
import { checkHandback, checkOwnTurn, knowPrompt, knowTurnStart } from './know-check'
import { leftAnswer, leftAsked, leftOwnTurn, leftTurnStart } from './left-io'
import { labelOf } from './office'
import { turnEndBoss } from './office-state'
import { askAgain } from './panes'
import { DEMO } from './panel-model'
import { noteThreshold } from './usage'
import { noteRecapTurn } from './recap'
import { coffeeDebugIo } from './register-coffee'
import { gaugeIo, paneIo, runIo, showStatus } from './register-io'
import { knowIo } from './register-know'
import { leftIo } from './register-left'
import { homeOf, refreshTab, rulesRide } from './register-rules'
import { getFx, readBlurbs, readStaff, ses, setBoss, setFx, updateStaff } from './register-state'
import { clockOut } from './run-io'
import { scoutHandoff } from './scout-run'
import { edit } from './state'

export function registerTurns(on: On, brief: BriefingOptions) {
  // The person's prompts: the latest ride along with the check on finished work, and the second passes a note over.
  // An edit request from the Settings tab carries a note of its own: the file to edit, and what must not be touched.
  on('prompt.submit', async ($, e, next) => {
    leftAsked(e)
    if (isPersonMessage(e)) await setBoss($, b => withPersonSpoke(b, e.origin?.kind)) // what closed before it is behind us: the coffee break button waits for the next checkpoint
    else if (isNotification(e)) await setBoss($, b => withNotice(b, e.turnId !== undefined)) // a job's notification starts or joins a turn: which one reports a hand-back
    if (brief.isKnowOn) await knowPrompt(knowIo($), e as { text: string })
    const note = await editNote(e.text, brief.voiceFile, $.plugin.root, () => homeOf($))
    const added = [...(note === undefined ? [] : [note]), ...(await rulesRide($, brief, e)), ...[scoutHandoff.note()].filter((n): n is string => n !== undefined)]
    return next(added.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...added] })
  })

  on('turn.start', async ($, e, next) => {
    // Since 2.1.299 specialists' turns start here too: all of this is about Clawd's own, in the main chat.
    if (e.agentId !== undefined) return next(e)
    // Work goes on, so a recap of the pause before it is out of date.
    noteRecapTurn()
    knowTurnStart(e.text ?? '')
    leftTurnStart()
    ses.isEditTurn = editPartOf(e.text ?? '') !== undefined
    await setBoss($, b => ({ ...b, isBusy: true, turns: b.turns + 1, recap: undefined, activity: e.text ? READING_BRIEF : 'Back at it' }))
    const effects = await getFx($) // a turn after a compaction's own ends the coffee break button's wait for a fresh reading
    if (withTurnStarted(effects, e.text ?? '') !== effects) await setFx($, f => withTurnStarted(f, e.text ?? ''))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const asker = (await readStaff($)).find(one => one.id === e.agentId)
      // Key choices the agent made itself go on its own record, for this session. Its questions stay in its report, for Clawd.
      if (asker && !asker.id.startsWith(DEMO)) {
        if (e.reason === 'answer') await setBoss($, withHandBack) // work handed back: a checkpoint once Clawd has reported it
        const by = labelOf(asker, (await readBlurbs($))[asker.type] ?? '')
        const choices = parseChoices(e.answer ?? '')
        if (choices.length > 0 || asker.pair?.isCouncil) await updateStaff($, l => edit(l, asker.id, one => withVoiceNotes(one, choices, e.reason === 'answer' ? e.answer ?? '' : '')))
        // After each hand-back, a check of the work against its report; a note may join Clawd's card.
        if (brief.isKnowOn) void checkHandback(knowIo($), { ...e, agentId: asker.id }, by)
        void leftAnswer(leftIo($), e, by)
      }
      await clockOut(runIo($), e.agentId, e.reason === 'answer' ? 'done' : 'failed')
      await showStatus($)
    } else {
      if (brief.isKnowOn) void checkOwnTurn(knowIo($), e)
      void leftOwnTurn(leftIo($), e, brief.isLeftOn)
      ses.isEditTurn = false
      await askAgain(paneIo($))
      const now = await $.clock.now()
      await setBoss($, b => withTurnEnd(turnEndBoss(b, e.reason, now), e))
      // The point Claude Code compacts at can move with the model: read again, never waited for. The record of the button follows it.
      void noteThreshold(gaugeIo($)).then(() => keepCoffeeRecord(coffeeDebugIo($), 'turn'))
      // An edit Claude just made shows in the Settings tab, marked as waiting for the next session.
      await refreshTab($, brief, true)
    }
    return next(e)
  })
}
