// Setup (hooks/onboard.ts), its scout, the session's folder, and the office's own tools: the calls each is built from, per use.
import type { EngineInterface } from 'claude-code'

import type { Payroll } from '../types'
import { cleanArtifacts, sweepArtifacts } from './artifacts'
import { hireContractor } from './contractor'
import type { ContractorIo } from './contractor'
import { startDemo } from './demo'
import { findHelpers } from './find-helpers'
import { rehire } from './hire'
import type { BriefingOptions } from './instructions'
import { startKnow } from './know-check'
import { leftStart } from './left-io'
import { startOnboard } from './onboard'
import { ancestorPaths, answerText, breakdownOf, commandsOf, listEntries } from './onboard-adapt'
import type { OnboardCard, OnboardIo } from './onboard-types'
import { checkOld } from './old-decisions'
import type { OwnToolIo } from './own-tools'
import { openPanes } from './panes'
import { resetFolderPayroll, savePayroll } from './payroll'
import { artifactIo } from './register-artifacts'
import { demoIo, oldIo, paneIo, payrollIo, ruleIo, runIo, stepIo } from './register-io'
import { knowIo } from './register-know'
import { homeOf } from './register-rules'
import { getFx, getPayroll, readBlurbs, readOnboard, readRoster, ses, setFx, updateArtifacts, updateContractorOffers, updateLeftUndone, updateOnboard, updatePayroll } from './register-state'
import { offerRule } from './rule-io'
import { askClawd, runScout, scoutHandoff } from './scout-run'
import type { ScoutHost } from './scout-run'
import { SCOUT_TIMEOUT_MS, SCOUT_TYPE } from './scout-spec'
import { guardRun } from './session-folder'
import type { FolderIo } from './session-folder'
import { reportStep } from './steps'
import { PAYROLL0, runEach, startNote } from './state'
import { loadTokens } from './run-io'

/**
 * Registers the setup scout, its definition written out in the call so the plugin directory can read its limits: SCOUT_SPEC's
 * prompt at session start (with the brief while an ask to Clawd is open), or with the brief in it for Clawd's hire. tests/scout-flow.test.tsx holds it equal to SCOUT_SPEC.
 */
export function registerScout($: EngineInterface, prompt: string) {
  return $.agent.register({
    name: 'scout',
    description: 'Clawd HQ\'s own scout for its setup step. Not for general use: the plugin starts it itself.',
    prompt: prompt,
    tools: ['Read', 'Glob'],
    disallowedTools: ['Grep', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'],
    permissionMode: 'dontAsk',
    model: 'sonnet',
    omitClaudeMd: true,
    maxTurns: 20,
  })
}
/** The setup scout (hooks/scout-run.ts): its picks are read from its transcript; in auto mode Clawd hires it (hooks/scout-handoff.ts). It is no hire, so it stays off the books. */
export function scoutHost($: EngineInterface): ScoutHost {
  return {
    spawn: a => $.agent.spawn({ subagentType: SCOUT_TYPE, description: a.description, prompt: a.prompt }), list: () => $.agent.list(), version: async () => { const v = await $.session.version(); return v.version }, messages: id => $.session.messages({ agentId: id }), stop: id => $.tool.call({ tool: 'TaskStop', task_id: id }), after: (ms, fn) => $.clock.after(ms, fn), askClawd: brief => askClawd({ register: s => registerScout($, s.prompt), after: (ms, fn) => $.clock.after(ms, fn) }, brief) }
}

// ---- Setup (hooks/onboard.ts): built per use, so the clock, home folder, agent lists and payroll are read as they are now ----

/** The setup card held this session; only setup's own code writes it, so the loose stored shape is an OnboardCard. */
export async function setupCard($: EngineInterface) { return ((await readOnboard($)) ?? undefined) as OnboardCard | undefined }

export async function onboardIo($: EngineInterface, opts: BriefingOptions): Promise<OnboardIo> {
  const [now, home, config, known, p] = [await $.clock.now(), await homeOf($), await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined), await readBlurbs($), await getPayroll($)]
  const types = [...new Set([...Object.keys(known), ...Object.keys(await readRoster($))])]
  const at = ses.cwd // a run whose session has since moved to another folder is dropped (hooks/session-folder.ts)
  return guardRun(() => ses.cwd !== at, {
    now: () => now, cwd: ses.cwd, home: () => home, isFolder: path => $.fs.stat(path).then(s => s.kind === 'dir', () => false), configDir: () => config || undefined, blurbs: () => known, allAgentTypes: () => types, parked: () => p.laidOff,
    get: async key => (await $.store.get(key)) as never, set: (key, value) => $.store.set(key, value),
    isShown: async () => (await $.session.surfaces().catch(() => [])).length > 0, isAutoOn: () => opts.isAutoOn,
    list: dir => listEntries(dir, d => $.fs.list(d), path => $.fs.stat(path)), read: path => $.fs.read(path).catch(() => undefined), exists: path => $.fs.exists(path),
    ancestors: async name => ancestorPaths(await $.fs.ancestors({ names: [name] })),
    breakdown: async () => breakdownOf(await $.session.usage({ breakdown: 'summary' })), commands: async () => commandsOf(await $.command.list()),
    complete: async req => answerText(await $.model.complete(req)),
    spawnScout: brief => runScout({ ...scoutHost($), isDropped: () => ses.cwd !== at }, brief, SCOUT_TIMEOUT_MS),
    registerHire: ({ name, description, prompt, skills }) => $.agent.register({ name: name, description: description, prompt: prompt, skills: skills }).then(() => true, () => false),
    savePayroll: laidOff => savePayroll(payrollIo($), { ...p, laidOff: [...laidOff], isReviewed: true }), // its stacks kept
    card: () => setupCard($), setCard: async card => { await updateOnboard($, () => card ?? null) },
  })
}

/** Contractors (hooks/contractor.ts): setup's calls, plus the offers on the Office tab. */
export async function contractorIo($: EngineInterface, opts: BriefingOptions): Promise<ContractorIo> {
  return { ...(await onboardIo($, opts)), change: fn => updateContractorOffers($, fn), toast: text => void $.ui.toast(text) }
}

/** The office's own tools (hooks/own-tools.ts): the tour, the offer of a lasting rule, the step report, and the search of everything installed. */
export function ownToolIo($: EngineInterface, opts: BriefingOptions): OwnToolIo {
  return {
    tour: async () => { await openPanes(paneIo($), false); await startDemo(demoIo($)) },
    offerRule: (id, input) => offerRule(ruleIo($), id, input), step: (id, input) => reportStep(stepIo($), id, input),
    find: async (id, input) => findHelpers(await onboardIo($, opts), id, input), contractor: async (id, input) => hireContractor(await contractorIo($, opts), id, input),
  }
}

/**
 * The session's folder as the engine has it now (issue #5). A move files everything under the new folder and reloads what is kept per
 * folder, as session start does, setup first: its card is cleared, so the frames start setup again for the new folder.
 */
export function folderIo($: EngineInterface, opts: BriefingOptions): FolderIo {
  return {
    folder: () => ses.cwd, root: () => $.session.root(), real: path => $.fs.stat(path, { resolve: true }).then(s => s.realPath),
    warn: text => { try { $.ui.log(text, { to: 'debug' }) } catch { /* a host with no log: the folder simply stays */ } }, after: (ms, fn) => $.clock.after(ms, fn),
    moveTo: async folder => {
      ses.cwd = folder
      scoutHandoff.drop() // a setup waiting for Clawd's hire was the old folder's
      resetFolderPayroll() // the review and the own-hire checks were the old folder's; the types offered this session stay
      const failed = await runEach([
        ['setup', async () => startOnboard(await onboardIo($, opts))],
        ['payroll review', async () => { if ((await getFx($)).layoffs) await setFx($, f => ({ ...f, layoffs: undefined })) }],
        ['check on finished work', () => startKnow(knowIo($), ses.cwd)],
        ['payroll', async () => { const saved = (await $.store.get(`payroll:${ses.cwd}`)) as Payroll | undefined; await updatePayroll($, () => ({ ...PAYROLL0, ...saved })); payrollIo($).invalidate() }],
        ['artifacts', async () => { const pages = cleanArtifacts(await $.store.get(`artifacts:${ses.cwd}`)); await updateArtifacts($, () => pages) }],
        ['left undone', async () => { const items = leftStart(await $.store.get(`leftUndone:${ses.cwd}`)); await updateLeftUndone($, () => items) }],
        ['project tokens', () => loadTokens(runIo($))],
        ['old decisions card', () => checkOld(oldIo($))],
        ['skill hires', async () => rehire(await onboardIo($, opts))],
      ])
      if (failed.length > 0) $.ui.toast(startNote(failed))
      void sweepArtifacts(artifactIo($), ses.cwd).catch(() => undefined)
    },
  }
}
