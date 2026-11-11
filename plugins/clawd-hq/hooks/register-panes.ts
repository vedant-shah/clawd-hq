// The office panes, one per host tab: drawn by panel.tsx from a snapshot of the state, and what the panels may ask for.
import type { EngineInterface, On } from 'claude-code'

import { hideArtifact } from './artifacts'
import { clawdActions } from './clawd-edit'
import { takeCoffeeBreak } from './coffee-break'
import { ROWS_KEY, setToggle } from './configs'
import type { ConfigField, ConfigIo } from './configs'
import { contractorActions } from './contractor'
import { onStage } from './demo'
import type { BriefingOptions } from './instructions'
import { knowActions } from './know-check'
import { leftActions } from './left-io'
import { oldActions } from './old-decisions'
import { chooseOnboard } from './onboard'
import { PANES, pinHeight } from './panes'
import { renderPanel } from './panel'
import type { PanelTools } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { setLaidOff } from './payroll'
import { coffeeIo } from './register-coffee'
import { artifactIo } from './register-artifacts'
import { knowIo } from './register-know'
import { leftIo } from './register-left'
import { oldIo, payrollIo, ruleIo, showLog } from './register-io'
import { clawdIo } from './register-rules'
import { contractorIo, onboardIo, setupCard } from './register-setup'
import { getBoss, getFx, getPayroll, readArtifacts, readBlurbs, readClawdBrief, readContractorOffers, readGauge, readLeftUndone, readProjectTokens, readRoster, readRuleOffers, readStaff, readTick, ses, setFx } from './register-state'
import { ruleActions } from './rule-io'
import { scrolled } from './scroll-window'
import { BRIEF0, reasonOf } from './state'

// ---- The side panel: a snapshot to draw, and what it may ask for ----

async function panelData($: EngineInterface, options: BriefingOptions): Promise<PanelData> {
  return onStage({
    staff: await readStaff($), boss: await getBoss($), fx: await getFx($), tick: await readTick($), blurbs: await readBlurbs($),
    roster: await readRoster($), projectTokens: await readProjectTokens($), payroll: await getPayroll($),
    artifacts: await readArtifacts($), leftUndone: await readLeftUndone($), ruleOffers: await readRuleOffers($), contractorOffers: await readContractorOffers($), gauge: await readGauge($), now: await $.clock.now(), know: await knowIo($).card(),
    brief: { ...BRIEF0, ...(await readClawdBrief($)) }, options, onboard: await setupCard($),
  })
}

/** The settings rows for `setToggle` (hooks/configs.ts): the Settings switch's, and the one to hand any other caller (onboarding). */
const configIo = ($: EngineInterface): ConfigIo => ({
  plugin: $.plugin.name, list: () => $.config.list(), keepKeys: record => $.store.set(ROWS_KEY, record),
  save: (key, value) => $.store.set(key, value), refresh: async () => $.ui.invalidate('tool.describe'), // the Agent tool's text follows Clawd's switch
})

/** A config's toggle pressed: kept in the plugin's own store, never in the settings (hooks/configs.ts). A refusal, or a call that fails, is shown plainly. */
async function setConfig($: EngineInterface, field: ConfigField, value: boolean) {
  // A toggle drawn before Clawd's turn began: the reload would lose what the turn holds, so nothing changes (the tab says why).
  if ((await getBoss($)).isBusy) return
  const note = await setToggle(configIo($), field, value)
  await setFx($, f => ({ ...f, configNote: note }))
}

function panelActions($: EngineInterface, opts: BriefingOptions): PanelActions {
  return {
    editClawd: async (target, isTerminal) => clawdActions(await clawdIo($, opts)).editClawd(target, isTerminal),
    resetClawd: async part => clawdActions(await clawdIo($, opts)).resetClawd(part),
    setFind: (tab, text) => setFx($, f => ({ ...f, finds: { ...f.finds, [tab]: text } })),
    hideArtifact: url => hideArtifact(artifactIo($), ses.cwd, url),
    layOff: type => setLaidOff(payrollIo($), type, true),
    layoffDismiss: () => setFx($, f => ({ ...f, layoffNotice: undefined })),
    hire: type => setLaidOff(payrollIo($), type, false),
    toggleUsage: () => setFx($, f => ({ ...f, isUsageOpen: !f.isUsageOpen })),
    coffeeBreak: isTerminal => takeCoffeeBreak(coffeeIo($), isTerminal).catch((err: unknown) => $.ui.toast(`Couldn't compact the chat: ${reasonOf(err)}.`)),
    showLog: isOpen => showLog($, isOpen),
    setConfig: (field, value) => setConfig($, field, value),
    scrollClawd: async (part, dir) => { const text = (await readClawdBrief($))[part]?.text ?? ''; await setFx($, f => ({ ...f, scroll: scrolled(f.scroll, part, text, dir) })) },
    choose: async button => { void chooseOnboard(await onboardIo($, opts), button) }, // a step can wait on the question box or a model: the press does not
    ...knowActions(knowIo($)),
    ...leftActions(leftIo($)),
    ...ruleActions(ruleIo($)),
    ...contractorActions(() => contractorIo($, opts)),
    ...oldActions(oldIo($)),
  }
}

export function registerPanes(on: On, brief: BriefingOptions) {
  // ---- The office panes, one per host tab: drawn by panel.tsx from a snapshot of the state ----
  for (const pane of PANES) {
    on('ui.render', { component: 'Pane', requestId: pane.id }, async ($, e) => {
      const ui = $.ui.resolve(e)
      // Picked by `e.surface`: the resolved table does not answer an `in` check. Input is missing on mobile, Raster is the terminal's, Svg the others'.
      const tools: PanelTools = {
        Box: ui.Box, Text: ui.Text, Button: ui.Button, Link: ui.Link, Markdown: ui.Markdown,
        Input: e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input,
        Raster: e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined,
        Svg: e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg,
      }
      const layout = { columns: e.props.bodyColumns, minHeight: pinHeight(e.surface, e.props.placement, e.props.scroll.bodyRows) }
      return renderPanel(tools, layout, await panelData($, brief), panelActions($, brief), pane.view)
    })
  }
}
