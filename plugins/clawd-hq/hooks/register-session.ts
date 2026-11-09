// The session's life: start (every feature is set up, one step at a time), the frame clock, a move to another folder, attach, and the end.
import type { EngineInterface, On, Timer } from 'claude-code'

import type { Payroll } from '../types'
import { cleanArtifacts, sweepArtifacts } from './artifacts'
import { FRAME_MS } from './constants'
import { rehire } from './hire'
import type { BriefingOptions } from './instructions'
import { forgetKnow, startKnow } from './know-check'
import { leftStart } from './left-io'
import { BRAND } from './office'
import { isLively, isSettling, settle } from './office-state'
import { checkOld } from './old-decisions'
import { checkOnboard, isSetupBusy, savedOf, startOnboard } from './onboard'
import { askOnAttach, openAtStart } from './panes'
import { checkPayroll, resetPayroll } from './payroll'
import { maybeRecap, resetRecap, setRecapOn } from './recap'
import { forgetCoffee } from './register-coffee'
import { artifactIo } from './register-artifacts'
import { enroll, gaugeIo, oldIo, paneIo, payrollIo, recapIo, runIo, showStatus } from './register-io'
import { knowIo } from './register-know'
import { refreshTab } from './register-rules'
import { folderIo, onboardIo, registerScout } from './register-setup'
import { forgetQuiet, getBoss, getFx, readOnboard, readStaff, readTick, ses, setFx, updateArtifacts, updateGauge, updateLeftUndone, updatePayroll, updateStaff, updateTick } from './register-state'
import { reconcile, loadTokens } from './run-io'
import { BYPASS_KEY, REACH0, withNewConversation } from './rules-reach'
import { scoutPromptNow } from './scout-run'
import { followFolder, startFolderWatch } from './session-folder'
import { PAYROLL0, runEach, startNote } from './state'
import { DEMO_SPEC, FIND_HELPERS_SPEC, HIRE_CONTRACTOR_SPEC, OFFER_RULE_SPEC, STEP_SPEC } from './tool-specs'
import { loadSaved, useSaved } from './toggle-store'
import { startGauge } from './usage'

// ---- The frame clock ----

async function onFrame($: EngineInterface, frames: number, opts: BriefingOptions) {
  const [list, f, b, t0] = [await readStaff($), await getFx($), await getBoss($), await readTick($)]
  if (frames % 8 === 0) {
    const followed = followFolder(folderIo($, opts)).catch(() => false) // not waited for: a slow check never holds a frame
    await reconcile(runIo($))
    const isDrawn = (await $.session.surfaces().catch(() => [])).length > 0 // the desktop attaches after session start
    // Setup is looked at once the folder check is done: a move clears the setup card, which this reads. Slow steps never hold a frame.
    if (isDrawn) void followed.then(async () => { if (!(await readOnboard($))) await checkOnboard(await onboardIo($, opts)) }).catch(() => undefined)
  }
  if (frames % 25 === 0) {
    if (!isSetupBusy(await savedOf({ cwd: ses.cwd, get: async key => (await $.store.get(key)) as never }), opts.isAutoOn)) await checkPayroll(payrollIo($), text => void $.ui.toast(text))
    // The model takes its time: the frames go on meanwhile, and a recap that fails is simply not shown.
    void maybeRecap(recapIo($)).catch(() => undefined)
  }
  // A quiet office only needs a frame now and then, for blinking and snoring; nothing is written in between.
  if (!isLively(list, f, b, t0) && frames % 3 !== 0) return
  const t = await updateTick($, n => n + 1)
  if (list.some(one => isSettling(one, t))) await updateStaff($, l => settle(l, t))
  await showStatus($)
}

export function registerSession(on: On, brief: BriefingOptions) {
  let timer: Timer | undefined
  let isFraming = false

  on('session.start', async ($, e, next) => {
    ses.cwd = (await $.session.root().catch(() => '')) || e.cwd // the root, as the folder checks later read it, so one folder is never two spellings
    startFolderWatch()
    ses.briefing = undefined
    ses.reach = REACH0
    ses.isEditTurn = false
    resetPayroll()
    ses.isArtifactsWarned = false
    ses.artifactPrefix = undefined
    forgetQuiet()
    // The setting only: whether anything is drawn is read at each frame's ask, since the desktop app attaches after this.
    setRecapOn(() => brief.isRecapOn)
    // Each step stands on its own: one that fails stops none after it (the Settings tab still fills), and the person is told which.
    const failed = await runEach([
      ['saved switches', async () => useSaved(await loadSaved(key => $.store.get(key)))],
      ['instructions road', async () => { const v = await $.store.get(BYPASS_KEY); ses.wasBypassed = typeof v === 'boolean' ? v : undefined }],
      ['recap', () => resetRecap(recapIo($))],
      ['check on finished work', () => startKnow(knowIo($), ses.cwd)],
      // A review made for an earlier session is not this one's: it is made again within a few seconds if it still stands.
      ['payroll review', async () => { if ((await getFx($)).layoffs) await setFx($, f => ({ ...f, layoffs: undefined })) }],
      ['coffee break', () => forgetCoffee($)],
      ['/office', () => $.command.register({ name: 'office', description: `Open ${BRAND}, the virtual office of this session’s agents` })],
      ['/office-council', () => $.command.register({ name: 'office-council', description: 'Ask a few independent voices about a hard choice: /office-council <question>' })],
      ['/office-demo', () => $.command.register({ name: 'office-demo', description: `Play a 90-second tour of ${BRAND}’s features` })],
      ['demo tool', () => $.tool.register(DEMO_SPEC)],
      ['payroll', async () => { const saved = (await $.store.get(`payroll:${ses.cwd}`)) as Payroll | undefined; if (saved) await updatePayroll($, () => ({ ...PAYROLL0, ...saved })) }],
      // This project's pages only: a list left by another folder is replaced, and what the store holds is checked.
      ['artifacts', async () => { const pages = cleanArtifacts(await $.store.get(`artifacts:${ses.cwd}`)); await updateArtifacts($, () => pages) }],
      ['left undone', async () => { const items = leftStart(await $.store.get(`leftUndone:${ses.cwd}`)); await updateLeftUndone($, () => items) }],
      ['project tokens', () => loadTokens(runIo($))], // this folder's totals only: a new project shows none
      ['offer rule tool', () => $.tool.register(OFFER_RULE_SPEC)],
      ['old decisions card', () => checkOld(oldIo($))],
      ['step tool', () => $.tool.register(STEP_SPEC)],
      ['find helpers tool', () => $.tool.register(FIND_HELPERS_SPEC)],
      ['contractor tool', () => $.tool.register(HIRE_CONTRACTOR_SPEC)],
      ['setup scout', () => registerScout($, scoutPromptNow())], // an ask to Clawd still open keeps its brief
      ['setup', async () => startOnboard(await onboardIo($, brief))], // looked for again on the frames
      ['skill hires', async () => rehire(await onboardIo($, brief))], // the engine forgets registered agents each session
      ['/office-setup', () => $.command.register({ name: 'office-setup', description: `Set up ${BRAND} for this project: a starting team, with no questions: /office-setup [folder]` })],
      ['roster', () => enroll($, 'general-purpose', 0)],
      ['meters', () => startGauge(gaugeIo($))],
      ['instructions', () => refreshTab($, brief, true)],
    ])

    let frames = 0
    timer?.cancel()
    timer = $.clock.every(FRAME_MS, () => {
      frames += 1
      // A frame that is still running (a slow agent list) is not stacked on.
      if (isFraming) return
      isFraming = true
      void onFrame($, frames, brief).finally(() => { isFraming = false })
    })

    const all = [...failed, ...(await runEach([['agent list', () => reconcile(runIo($))]]))]
    if (all.length > 0) $.ui.toast(startNote(all))
    void sweepArtifacts(artifactIo($), ses.cwd).catch(() => undefined) // not waited for: session start never holds on it

    // Once the engine has the session's surfaces, Office opens and is asked to the front; with none yet, on attach (hooks/panes.ts).
    return next(e).finally(() => void openAtStart(paneIo($)))
  })

  // The host moved the session (the desktop app can start it in a spare folder): what is kept per folder follows (issue #5).
  // The host's own handling (the settings hooks beneath) goes first; the move is followed after it.
  on('classic.CwdChanged', async ($, e, next) => {
    const result = await next(e)
    await followFolder(folderIo($, brief)).catch(() => undefined)
    return result
  })

  // The desktop app starts the session before it draws anything: when it attaches, Office is asked to the front (hooks/panes.ts).
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    void askOnAttach(paneIo($))
    return result
  })

  // A /clear ends the session without a session.start: from here the list of finished work starts over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      ses.briefing = undefined
      const now = await $.clock.now()
      await updateGauge($, g => ({ ...g, startedAt: now, contextPercent: undefined, contextTokens: undefined }))
    }
    // Another conversation takes over this process without a session.start: its recap and its turns are its own.
    if (e.reason === 'clear' || e.reason === 'resume') { ses.reach = withNewConversation(ses.reach); forgetQuiet(); await resetRecap(recapIo($)); await forgetCoffee($) }
    await forgetKnow(knowIo($))
    return next(e)
  })
}
