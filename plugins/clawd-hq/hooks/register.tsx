import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Artifact, Badge, Boss, Employee, Fx, KnowState, LeftItem, Memory, Payroll } from '../types'
import { FILE_TOOLS, leftActions, leftAnswer, leftAsked, leftOwnTurn, leftStart, leftToolUsed, leftTurnStart, leftWatch, type LeftIo } from './left-io'
import { BRIEF_NOTE, HANDOVER_NOTE, STAFFING_NOTE, boxAnswers, memoryBlock, oneLine, parseChoices, parseEffort, recallNote } from './desk'
import type { Effort } from './desk'
import { resumedEffort } from './resume-effort'
import { parsePairUp } from './pair-up'
import { cleanArtifacts, hideArtifact, keepArtifact, sweepArtifacts } from './artifacts'
import type { ArtifactAnswer, ArtifactIo } from './artifacts'
import { loadMemory, remember, rememberCall, saveBoxAnswer, saveMemory } from './memory-io'
import type { MemoryIo } from './memory-io'
import { READING_BRIEF, THINKING, narrationOf, sentenceOf } from './activity'
import { BLURB_CHARS, DEMO_TOOL, FRAME_MS, MEM_TOOL, RECALL, STEP_TOOL } from './constants'
import { ownToolAnswer } from './own-tools'
import type { OwnToolIo } from './own-tools'
import { blank, smallRow } from './quiet-rows'
import type { Resolve } from './quiet-rows'
import { createScoutBox } from './scout-box'
import { SCOUT_CRASH_DENY, runScout, scoutRoute, spawnTypeOf } from './scout-run'
import type { RouteIo, ScoutHost } from './scout-run'
import { SCOUT_SPEC, SCOUT_TIMEOUT_MS, SCOUT_TYPE, TEAM_PICK_SPEC } from './scout-spec'
import { freshHire, isLively, isSettling, settle, turnEndBoss, withBlurb, withJobs } from './office-state'
import { applyPayroll, resetPayroll, reviewPayroll, savePayroll, setLaidOff } from './payroll'
import { checkOnboard, chooseOnboard, isSetupBusy, onboardTurnEnd, restartOnboard, savedOf, startOnboard } from './onboard'
import { ancestorPaths, answerText, breakdownOf, commandsOf, listEntries } from './onboard-adapt'
import { rehire } from './hire'
import { PROFILE_BLOCK, profileBlock } from './profile'
import { PROFILE_KEY } from './onboard-types'
import type { OnboardCard, OnboardIo, Profile } from './onboard-types'
import type { PayrollIo } from './payroll'
import { ROWS_KEY, setToggle } from './configs'
import type { ConfigField, ConfigIo } from './configs'
import { BRAND, labelOf } from './office'
import { renderPanel } from './panel'
import { limitsOf } from './meters'
import { contextOf, noteRequest, noteThreshold, startGauge } from './usage'
import { isBreakTime, isPersonCompact, takeCoffeeBreak, whileCompacting, type CoffeeIo } from './coffee-break'
import { isNotification, isPersonMessage, withHandBack, withNewWork, withNotice, withPersonSpoke, withToolUsed, withTurnEnd } from './checkpoint'
import { keepCoffeeRecord } from './coffee-debug'
import type { CoffeeDebugIo } from './coffee-debug'
import type { GaugeIo } from './usage'
import { DEMO, isActive } from './panel-model'
import { startDemo } from './demo'
import type { DemoIo } from './demo'
import { SECTION_ID, SEED_KEYS, isBriefed, optionsOf, readBriefing } from './instructions'
import type { Briefing, BriefingIo, BriefingOptions } from './instructions'
import { SHIPPED_DENY, clawdActions, editNote, editPartOf, guardOnCrash, isShippedWrite, readFailed, readFailedLine, refreshClawd } from './clawd-edit'
import type { ClawdIo } from './clawd-edit'
import { maybeRecap, noteRecapTurn, resetRecap, setRecapOn } from './recap'
import { liveOptions, loadSaved, useSaved } from './toggle-store'
import type { RecapIo } from './recap'
import { isBackgroundHint, isHandback, isNoUpdate, rowLook } from './quiet'
import { checkHandback, checkOwnTurn, forgetKnow, isWatching, keepBrief, knowActions, knowPrompt, knowToolUsed, knowTurnStart, startKnow } from './know-check'
import type { KnowIo } from './know-check'
import { KNOW0, QUIET_FORK, isBuiltinKnow } from './know'
import { PANES, askAgain, openAtStart, openPanes, pinHeight, raise, retitleDecisions } from './panes'
import type { PaneIo } from './panes'
import type { PanelTools } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { reportStep } from './steps'
import type { StepIo } from './steps'
import { isCountedTool } from './usage-count'
import { recordUse } from './use-tally'
import { scrolled } from './scroll-window'
import { DEMO_SPEC, REMEMBER_SPEC, STEP_SPEC } from './tool-specs'
import { hire, withReport, withSaid, withStep, withTool } from './staff-model'
import { clockOut, hireListed, newHire, reconcile, signOfLife, specialistOf } from './run-io'
import type { RunIo } from './run-io'
import { BOSS0, BRIEF0, FX0, GAUGE0, PAYROLL0, edit, inLine, reasonOf, runEach, startNote } from './state'

const staff = atom({ plugin: 'clawd-hq', key: 'staff' } as const, [] as Employee[])
const boss = atom({ plugin: 'clawd-hq', key: 'boss' } as const, BOSS0)
const fx = atom({ plugin: 'clawd-hq', key: 'fx' } as const, FX0)
const tick = atom({ plugin: 'clawd-hq', key: 'tick' } as const, 0)
const blurbs = atom({ plugin: 'clawd-hq', key: 'blurbs' } as const, {} as Record<string, string>)
const roster = atom({ plugin: 'clawd-hq', key: 'roster' } as const, {} as Record<string, Badge>)
const payroll = atom({ plugin: 'clawd-hq', key: 'payroll' } as const, PAYROLL0)
const memory = atom({ plugin: 'clawd-hq', key: 'memory' } as const, [] as Memory[])
const gauge = atom({ plugin: 'clawd-hq', key: 'gauge' } as const, GAUGE0)
const artifacts = atom({ plugin: 'clawd-hq', key: 'artifacts' } as const, [] as Artifact[])
const leftUndone = atom({ plugin: 'clawd-hq', key: 'leftUndone' } as const, [] as LeftItem[])
const know = atom({ plugin: 'clawd-hq', key: 'know' } as const, KNOW0)
const clawdBrief = atom({ plugin: 'clawd-hq', key: 'brief' } as const, BRIEF0)
const onboard = atom({ plugin: 'clawd-hq', key: 'onboard' } as const, null as OnboardCard | null)

// Values written by an older version of the mod lack the newer fields: fill them in.
async function getBoss($: EngineInterface): Promise<Boss> { return { ...BOSS0, ...(await read($, boss)) } }
async function getFx($: EngineInterface): Promise<Fx> { return { ...FX0, ...(await read($, fx)) } }
async function getPayroll($: EngineInterface): Promise<Payroll> { return { ...PAYROLL0, ...(await read($, payroll)) } }
async function setBoss($: EngineInterface, fn: (b: Boss) => Boss) { await update($, boss, b => fn({ ...BOSS0, ...b })) }
async function setFx($: EngineInterface, fn: (f: Fx) => Fx) { await update($, fx, f => fn({ ...FX0, ...f })) }

// The project the session runs in: payroll is kept per project.
let cwd = ''
/** The setup scout (hooks/scout-run.ts): the files it opens and the picks it sends. It is no hire, so it stays off the books. */
const scoutBox = createScoutBox()
const scoutHost = ($: EngineInterface): ScoutHost => ({ spawn: a => $.agent.spawn(a), list: () => $.agent.list(), stop: id => $.tool.call({ tool: 'TaskStop', task_id: id }), after: (ms, fn) => $.clock.after(ms, fn) })
const scoutRouteIo = ($: EngineInterface): RouteIo => ({
  real: async path => (await $.fs.stat(path, { resolve: true })).realPath, isHired: async id => (await read($, staff)).some(one => one.id === id), typeOf: async id => (await $.agent.list()).find(a => a.id === id)?.type })
// Each agent's effort, set the moment it is hired so its first request already carries it; staff keeps it across reloads.
const efforts = new Map<string, Effort>()

/**
 * Puts a type on the books, with how often it was hired, kept across sessions in the store. Queued, so it never
 * overlaps another write to the books.
 */
const enroll = ($: EngineInterface, type: string, jobs: number) => inLine(() => enrollNow($, type, jobs))

/** The write itself, for a caller already inside `inLine`: queueing it again there would wait on itself for ever. */
async function enrollNow($: EngineInterface, type: string, jobs: number) {
  const mine = await read($, roster)
  const saved = Object.keys(mine).length === 0 ? ((await $.store.get('roster')) as Record<string, Badge> | undefined) : undefined
  const cur = { ...(saved ?? {}), ...mine }
  if (cur[type] && jobs === 0) {
    if (saved) await update($, roster, () => cur)
    return
  }
  const next = withJobs(cur, type, jobs)
  await update($, roster, () => next)
  await $.store.set('roster', next)
}

/** The books of specialists (hooks/run-io.ts): who is at work, hired, heard from or gone. */
const runIo = ($: EngineInterface): RunIo => ({
  now: () => $.clock.now(), tick: () => read($, tick), staff: () => read($, staff), changeStaff: fn => update($, staff, fn),
  blurbs: () => read($, blurbs), enroll: (type, jobs) => enroll($, type, jobs), setBoss: fn => setBoss($, fn),
  toast: text => void $.ui.toast(text), agents: () => $.agent.list(),
})

/** A resumed specialist is at work again, on a new run; one the books lost (from before a reload) joins them, not counted as a hire. */
async function rejoin<R extends { agentId?: string }>($: EngineInterface, r: R, e: { subagentType: string; description: string; name?: string; resume?: { agentId: string } }, said?: Effort) {
  if (!r.agentId) return r
  const [now, t] = [await $.clock.now(), await read($, tick)]
  if (!(await read($, staff)).some(one => one.id === r.agentId)) await update($, staff, l => hire(l, freshHire({ ...e, id: r.agentId!, type: e.subagentType }, now, t)))
  // The level it was hired with (or the follow-up's new one) goes on; the books are the copy that outlives a reload.
  const level = resumedEffort(said, [r.agentId, e.resume?.agentId], await read($, staff), efforts)
  if (level) { efforts.set(r.agentId, level); await update($, staff, l => edit(l, r.agentId!, one => ({ ...one, effort: level }))) }
  await signOfLife(runIo($), r.agentId)
  await showStatus($)
  return r
}

async function showStatus($: EngineInterface) {
  const n = (await read($, staff)).filter(isActive).length
  $.ui.status(n > 0 ? `HQ · 🦀 ${n} at desk${n === 1 ? '' : 's'}` : undefined)
}

// ---- Clawd's instructions: the person's own copies live in the home folder (hooks/instructions.ts) ----

/** File calls do not expand `~`: the home folder by name, '' when the process has none. */
const homeOf = async ($: EngineInterface) => ((await $.env.get("HOME").catch(() => undefined)) || (await $.env.get("USERPROFILE").catch(() => undefined)) || '').replace(/[\\/]+$/, '')

const briefIo = ($: EngineInterface, home: string, warn: (text: string) => void): BriefingIo => ({
  root: $.plugin.root, home, warn, read: path => $.fs.read(path), exists: path => $.fs.exists(path),
  seed: async part => { const v = await $.store.get(SEED_KEYS[part]); return typeof v === 'string' ? v : undefined },
})

/** What this session's chat was given: read at its first request, again after a session start or /clear. */
let briefing: Promise<Briefing> | undefined
/** The main chat's turn began with an edit request from the Settings tab: the plugin's own instruction files are off limits until it ends. */
let isEditTurn = false

/** The calls behind the buttons for Clawd's instructions in the Settings tab (hooks/clawd-edit.ts). The prompt box is filled after what is there, never sent. */
const clawdIo = async ($: EngineInterface, opts: BriefingOptions): Promise<ClawdIo> => ({
  isOn: opts.isOn, voiceFile: opts.voiceFile, briefing: briefIo($, await homeOf($), () => undefined),
  loaded: () => (briefing ?? Promise.resolve(undefined)).catch(() => undefined),
  write: (path, text) => $.fs.write(path, text), setSeed: (part, text) => $.store.set(SEED_KEYS[part], text),
  promptRead: () => $.prompt.read(), fill: text => $.prompt.fill({ text, mode: 'append' }),
  get: async () => ({ ...BRIEF0, ...(await read($, clawdBrief)) }), set: fn => update($, clawdBrief, b => fn({ ...BRIEF0, ...b })),
})

/** The tab follows the files. A read that fails is an amber line in the tab with why (a toast if even that fails); it never stops the hook that asked. */
const refreshTab = ($: EngineInterface, opts: BriefingOptions, isFresh: boolean) => clawdIo($, opts).then(io => refreshClawd(io, isFresh))
  .catch((err: unknown) => update($, clawdBrief, b => readFailed({ ...BRIEF0, ...b }, err))).catch((err: unknown) => $.ui.toast(readFailedLine(reasonOf(err))))

// ---- The panes: one per view, so the host's own tab strip switches between them (hooks/panes.ts) ----

const paneIo = ($: EngineInterface): PaneIo => ({
  open: args => $.ui.open(args),
  list: () => $.ui.panes(),
  close: id => $.ui.close({ id }),
  decisions: async () => (await read($, memory)).length,
})

// ---- Memory: the project's decisions (hooks/memory-io.ts) ----

/** Set once a write failed this session, so the person is told once and not on every decision. */
let isLogbookWarned = false
/** The same for the artifact list. */
let isArtifactsWarned = false

const memoryIo = ($: EngineInterface): MemoryIo => ({
  logbook: { cwd, exists: path => $.fs.exists(path), read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text), now: () => $.clock.now(), held: () => read($, memory) },
  keep: async list => { await update($, memory, () => list) },
  warnOnce: text => { if (!isLogbookWarned) $.ui.toast(text); isLogbookWarned = true },
  retitle: () => retitleDecisions(paneIo($)),
  now: () => $.clock.now(),
  quip: async (text, frames) => { const t = await read($, tick); await setBoss($, b => ({ ...b, quip: { text, until: t + frames } })) },
  byOf: async id => { const one = (await read($, staff)).find(e => e.id === id); return one ? labelOf(one, (await read($, blurbs))[one.type] ?? '') : 'agent' },
})

// ---- Payroll: which agent types Clawd is offered (hooks/payroll.ts) ----

const payrollIo = ($: EngineInterface): PayrollIo => ({
  cwd, get: () => getPayroll($), set: async p => { await update($, payroll, () => p) }, keep: (key, p) => $.store.set(key, p),
  types: async () => [...new Set([...Object.keys(await read($, blurbs)), ...Object.keys(await read($, roster))])],
  list: path => $.fs.list(path), fx: () => getFx($), setFx: fn => setFx($, fn), toast: text => void $.ui.toast(text),
  invalidate: () => { $.ui.invalidate('tool.describe'); $.ui.invalidate('prompt.attachment') },
})

// ---- The Artifact Desk: the pages Claude published or opened here, kept per project folder ----

const artifactIo = ($: EngineInterface): ArtifactIo => ({
  folder: () => cwd, now: () => $.clock.now(),
  change: fn => update($, artifacts, fn),
  save: (folder, list) => $.store.set(`artifacts:${folder}`, list),
  warnOnce: text => { if (!isArtifactsWarned) $.ui.toast(text); isArtifactsWarned = true },
  check: i => $.tool.check(i as never), list: i => $.tool.call({ tool: 'Artifact', ...i }) as never,
})

/** Left undone (hooks/left-io.ts): work put off, kept per project folder. The Do it now button reuses the heads-up card's prompt fill. */
const leftIo = ($: EngineInterface): LeftIo => ({
  folder: () => cwd, now: () => $.clock.now(), change: fn => update($, leftUndone, fn), save: (folder, list) => $.store.set(`leftUndone:${folder}`, list),
  read: path => $.fs.read(path), complete: ask => $.model.complete(ask), fillPrompt: text => knowIo($).fillPrompt(text), byOf: id => memoryIo($).byOf(id),
})

/** The office's own tools (hooks/own-tools.ts): the tour, remember, and the step report. */
const ownToolIo = ($: EngineInterface): OwnToolIo => ({
  tour: async () => { await openPanes(paneIo($), false); await startDemo(demoIo($)) },
  remember: (id, input) => rememberCall(memoryIo($), id, input), step: (id, input) => reportStep(stepIo($), id, input),
})

/** The step tool (hooks/steps.ts): only a specialist at work here reports. */
const stepIo = ($: EngineInterface): StepIo => ({
  isAtWork: async id => { const one = await specialistOf(runIo($), id); return one !== undefined && isActive(one) },
  record: async (id, report) => { const now = await $.clock.now(); await update($, staff, l => edit(l, id, one => withReport(one, report, now))) },
})

// ---- The recap (hooks/recap.ts): one line on where things stand, after a few quiet minutes ----

const recapIo = ($: EngineInterface): RecapIo => ({
  now: () => $.clock.now(), boss: () => getBoss($), setBoss: fn => setBoss($, fn),
  isTouring: async () => (await getFx($)).demo !== undefined,
  isShown: async () => ((await $.session.surfaces().catch(() => [])).length > 0),
  ask: prompt => $.model.fork({ prompt }),
})

// ---- The check on finished work (hooks/know-check.ts): what it may do, each a `$` call spelled here ----

const knowIo = ($: EngineInterface): KnowIo => ({
  now: () => $.clock.now(),
  get: key => $.store.get(key),
  set: (key, value) => $.store.set(key, value as never),
  surfaces: () => $.session.surfaces(),
  panes: () => $.ui.panes(),
  messages: agentId => (agentId === undefined ? $.session.messages() : $.session.messages({ agentId })),
  complete: ask => $.model.complete(ask),
  card: async (): Promise<KnowState> => ({ ...KNOW0, ...(await read($, know)) }),
  setCard: fn => update($, know, s => fn({ ...KNOW0, ...s })),
  fillPrompt: text => $.prompt.fill({ text, mode: 'append' }),
})

// ---- Setup (hooks/onboard.ts): built per use, so the clock, home folder, agent lists and payroll are read as they are now ----

/** The setup card held this session; only setup's own code writes it, so the loose stored shape is an OnboardCard. */
const setupCard = async ($: EngineInterface) => ((await read($, onboard)) ?? undefined) as OnboardCard | undefined

const onboardIo = async ($: EngineInterface, opts: BriefingOptions): Promise<OnboardIo> => {
  const [now, home, config, known, p] = [await $.clock.now(), await homeOf($), await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined), await read($, blurbs), await getPayroll($)]
  const types = [...new Set([...Object.keys(known), ...Object.keys(await read($, roster))])]
  return {
    now: () => now, cwd, home: () => home, configDir: () => config || undefined, blurbs: () => known, allAgentTypes: () => types, parked: () => p.laidOff,
    get: async key => (await $.store.get(key)) as never, set: (key, value) => $.store.set(key, value),
    isShown: async () => (await $.session.surfaces().catch(() => [])).length > 0, isBusy: async () => (await getBoss($)).isBusy,
    list: dir => listEntries(dir, d => $.fs.list(d), path => $.fs.stat(path)), read: path => $.fs.read(path).catch(() => undefined), exists: path => $.fs.exists(path),
    ancestors: async name => ancestorPaths(await $.fs.ancestors({ names: [name] })),
    breakdown: async () => breakdownOf(await $.session.usage({ breakdown: 'summary' })), commands: async () => commandsOf(await $.command.list()),
    complete: async req => answerText(await $.model.complete(req)),
    spawnScout: (brief, check) => runScout(scoutBox, scoutHost($), brief, check, SCOUT_TIMEOUT_MS),
    ask: q => $.ui.ask(q.question, { options: q.options.map(o => o.label), header: q.header }).catch(() => undefined), // a mod's own AskUserQuestion call is refused: "that is $.ui.ask"
    setToggle: async (field, value) => (await setToggle(configIo($), field, value)) === undefined, options: async () => ({ chiefOfStaff: opts.isOn, quietChat: opts.isQuiet }),
    registerHire: ({ name, description, prompt, skills }) => $.agent.register({ name, description, prompt, skills }).then(() => true, () => false),
    savePayroll: laidOff => savePayroll(payrollIo($), { ...p, laidOff: [...laidOff], isReviewed: true }), // its stacks kept
    showPeople: () => void raise(paneIo($), 'people'), fill: async text => { await $.prompt.fill({ text, mode: 'append' }) }, toast: text => $.ui.toast(text),
    decide: (question, said) => saveBoxAnswer(memoryIo($), question, said),
    card: () => setupCard($), setCard: async card => { await update($, onboard, () => card ?? null) },
  }
}

// ---- The frame clock ----

async function onFrame($: EngineInterface, frames: number, opts: BriefingOptions) {
  const [list, f, b, t0] = [await read($, staff), await getFx($), await getBoss($), await read($, tick)]
  if (frames % 8 === 0) {
    await reconcile(runIo($))
    const isDrawn = (await $.session.surfaces().catch(() => [])).length > 0 // the desktop attaches after session start
    if (isDrawn && !(await read($, onboard))) void onboardIo($, opts).then(checkOnboard).catch(() => undefined) // slow steps never hold a frame
  }
  if (frames % 25 === 0) {
    if (!isSetupBusy(await savedOf({ cwd, get: async key => (await $.store.get(key)) as never }))) await reviewPayroll(payrollIo($))
    // The model takes its time: the frames go on meanwhile, and a recap that fails is simply not shown.
    void maybeRecap(recapIo($)).catch(() => undefined)
  }
  // A quiet office only needs a frame now and then, for blinking and snoring; nothing is written in between.
  if (!isLively(list, f, b, t0) && frames % 3 !== 0) return
  const t = await update($, tick, n => n + 1)
  if (list.some(one => isSettling(one, t))) await update($, staff, l => settle(l, t))
  await showStatus($)
}

// ---- The side panel: a snapshot to draw, and what it may ask for ----

async function panelData($: EngineInterface, options: BriefingOptions): Promise<PanelData> {
  return {
    staff: await read($, staff), boss: await getBoss($), fx: await getFx($), tick: await read($, tick), blurbs: await read($, blurbs),
    roster: await read($, roster), payroll: await getPayroll($), memory: await read($, memory),
    artifacts: await read($, artifacts), leftUndone: await read($, leftUndone), gauge: await read($, gauge), now: await $.clock.now(), know: await knowIo($).card(),
    brief: { ...BRIEF0, ...(await read($, clawdBrief)) }, options, onboard: await setupCard($),
  }
}

/** Settings shows the list of finished work (true) or its configs (false); the choice is a display flag, shared by every drawing. */
const showLog = ($: EngineInterface, isOpen: boolean) => setFx($, f => ({ ...f, isLogOpen: isOpen }))

/** The settings rows for `setToggle` (hooks/configs.ts): the Settings switch's, and the one to hand any other caller (onboarding). */
const configIo = ($: EngineInterface): ConfigIo => ({
  plugin: $.plugin.name, list: () => $.config.list(), set: args => $.config.set(args), keepKeys: record => $.store.set(ROWS_KEY, record),
  save: (key, value) => $.store.set(key, value), refresh: async () => $.ui.invalidate('tool.describe'), // the Agent tool's text follows Clawd's switch
})

/** A config's toggle pressed: its settings row is changed as in /config, and the plugin reloads with it. A refusal, or a call that fails, is shown plainly. */
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
    forget: id => saveMemory(memoryIo($), list => list.filter(x => x.id !== id)),
    hideArtifact: url => hideArtifact(artifactIo($), cwd, url),
    layOff: type => setLaidOff(payrollIo($), type, true),
    hire: type => setLaidOff(payrollIo($), type, false),
    settlePayroll: isLayoff => applyPayroll(payrollIo($), isLayoff),
    toggleUsage: () => setFx($, f => ({ ...f, isUsageOpen: !f.isUsageOpen })),
    coffeeBreak: isTerminal => takeCoffeeBreak(coffeeIo($), isTerminal).catch((err: unknown) => $.ui.toast(`Couldn't compact the chat: ${reasonOf(err)}.`)),
    showLog: isOpen => showLog($, isOpen),
    setConfig: (field, value) => setConfig($, field, value),
    scrollClawd: async (part, dir) => { const text = (await read($, clawdBrief))[part]?.text ?? ''; await setFx($, f => ({ ...f, scroll: scrolled(f.scroll, part, text, dir) })) },
    choose: async button => { void chooseOnboard(await onboardIo($, opts), button) }, // a step can wait on the question box or a model: the press does not
    ...knowActions(knowIo($)),
    ...leftActions(leftIo($)),
  }
}

// ---- The header meters: context and rate limits, kept as the engine reports them ----

const gaugeIo = ($: EngineInterface): GaugeIo => ({
  now: () => $.clock.now(), usage: () => $.session.usage(), model: () => $.session.model(),
  threshold: () => $.session.usage({ breakdown: 'summary' }).then(u => u.context.breakdown?.autoCompactThreshold),
  get: () => read($, gauge), set: fn => update($, gauge, fn),
})

/** The coffee break button (hooks/coffee-break.ts). Where the engine has no compact call (the desktop app can bundle 2.1.295), calling it fails and the command is put in the prompt box instead. */
const coffeeIo = ($: EngineInterface): CoffeeIo => ({
  now: () => $.clock.now(),
  isBreak: async () => isBreakTime(await getBoss($), await read($, staff), await getFx($)),
  ask: prompt => $.model.fork({ prompt }), // the note's one short question, on the cached chat
  compact: args => $.session.compact(args),
  promptRead: () => $.prompt.read(), fill: text => $.prompt.fill({ text, mode: 'append' }),
  setNote: async note => { const { turns } = await getBoss($); await setFx($, f => ({ ...f, coffee: note && { ...note, turns } })) },
  clearReading: async () => { await setBoss($, withNewWork); await update($, gauge, g => ({ ...g, contextPercent: undefined, contextTokens: undefined })) }, // a compaction ends the checkpoint too
})

/** The record of why the coffee break button shows or not (hooks/coffee-debug.ts), kept at `debug:coffee` in the store. */
const coffeeDebugIo = ($: EngineInterface): CoffeeDebugIo => ({
  now: () => $.clock.now(), save: (key, value) => $.store.set(key, value),
  data: async () => ({ boss: await getBoss($), staff: await read($, staff), fx: await getFx($), gauge: await read($, gauge) }),
})

// ---- The demo: a scripted tour with stand-in employees, cleaned up at the end ----

const demoIo = ($: EngineInterface): DemoIo => ({
  show: view => raise(paneIo($), view), showLog: isOpen => showLog($, isOpen),
  boss: () => getBoss($), setBoss: fn => setBoss($, fn), tick: () => read($, tick), now: () => $.clock.now(),
  hire: (id, type, description) => newHire(runIo($), id, type, description), finish: (id, mood) => clockOut(runIo($), id, mood),
  editStaff: (id, fn) => update($, staff, l => edit(l, id, fn)),
  dropStandIns: () => update($, staff, l => l.filter(e => !e.id.startsWith(DEMO))),
  setDemo: demo => setFx($, f => ({ ...f, demo })), showStatus: () => showStatus($),
  after: (ms, fn) => $.clock.after(ms, fn),
})

/** The drawing table of a render event, handed to the quiet rows (hooks/quiet-rows.tsx) as a closure. */
const resolver = ($: EngineInterface): Resolve => e => $.ui.resolve(e)

export const register: Register = (on, options) => {
  let timer: Timer | undefined
  let isFraming = false
  const brief = liveOptions(optionsOf(options)) // each switch read when used: a saved press first (hooks/toggle-store.ts)

  // Clawd's rules and voice join the main chat's instructions: read once a session (and again after /clear), then the same text on every request, so the prompt cache holds.
  on('prompt.compose', async ($, e, next) => {
    const base = await next(e)
    if (!brief.isOn || !isBriefed(e.traits)) return base
    // Set before anything is awaited, so requests made at the same moment share one read (and one warning).
    briefing ??= homeOf($).then(home => readBriefing(briefIo($, home, text => void $.ui.toast(text)), brief))
    const { text } = await briefing
    return text === undefined ? base : { sections: [...base.sections, { id: SECTION_ID, scope: 'session', text } as const] }
  })

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    briefing = undefined
    isEditTurn = false
    resetPayroll()
    isLogbookWarned = false
    isArtifactsWarned = false
    // The setting only: whether anything is drawn is read at each frame's ask, since the desktop app attaches after this.
    setRecapOn(() => brief.isRecapOn)
    // Each step stands on its own: one that fails stops none after it (the Settings tab still fills), and the person is told which.
    const failed = await runEach([
      ['saved switches', async () => useSaved(await loadSaved(key => $.store.get(key)))],
      ['recap', () => resetRecap(recapIo($))],
      ['check on finished work', () => startKnow(knowIo($), cwd)],
      // A review made for an earlier session is not this one's: it is made again within a few seconds if it still stands.
      ['payroll review', async () => { if ((await getFx($)).layoffs) await setFx($, f => ({ ...f, layoffs: undefined })) }],
      ['/office', () => $.command.register({ name: 'office', description: `Open ${BRAND}, the virtual office of this session’s agents` })],
      ['/office-demo', () => $.command.register({ name: 'office-demo', description: `Play a one-minute tour of ${BRAND}’s features` })],
      ['demo tool', () => $.tool.register(DEMO_SPEC)],
      ['payroll', async () => { const saved = (await $.store.get(`payroll:${cwd}`)) as Payroll | undefined; if (saved) await update($, payroll, () => ({ ...PAYROLL0, ...saved })) }],
      ['decisions', async () => { const recalled = await loadMemory(memoryIo($)); await update($, memory, () => recalled) }],
      // This project's pages only: a list left by another folder is replaced, and what the store holds is checked.
      ['artifacts', async () => { const pages = cleanArtifacts(await $.store.get(`artifacts:${cwd}`)); await update($, artifacts, () => pages) }],
      ['left undone', async () => { const items = leftStart(await $.store.get(`leftUndone:${cwd}`)); await update($, leftUndone, () => items) }],
      ['remember tool', () => $.tool.register(REMEMBER_SPEC)],
      ['step tool', () => $.tool.register(STEP_SPEC)],
      ['team pick tool', () => $.tool.register(TEAM_PICK_SPEC)],
      ['setup scout', () => $.agent.register(SCOUT_SPEC)],
      ['setup', async () => startOnboard(await onboardIo($, brief))], // looked for again on the frames; answers left waiting applied
      ['skill hires', async () => rehire(await onboardIo($, brief))], // the engine forgets registered agents each session
      ['/office-setup', () => $.command.register({ name: 'office-setup', description: `Set up ${BRAND}: two questions, then a starting team for this project` })],
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
    // Office is asked to the front on every surface; a refusal is tried once more after the first reply (hooks/panes.ts).
    void openAtStart(paneIo($))
    void sweepArtifacts(artifactIo($), cwd).catch(() => undefined) // not waited for: session start never holds on it

    return next(e)
  })

  // The agent's own stop signal, beside turn.complete: whichever comes first ends the run, the second finds it ended.
  on('classic.SubagentStop', async ($, e, next) => {
    await clockOut(runIo($), e.agent_id, 'done')
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await openPanes(paneIo($), true)
    return { text: `${BRAND} is open: Office · Decisions · People · Settings are the tabs at the top.` }
  })

  // The header's context bar and limit countdowns follow the engine's own readings.
  on('session.measure', async ($, e, next) => {
    await update($, gauge, g => ({ ...g, ...contextOf(e.context), limits: limitsOf(e.rateLimits) }))
    void keepCoffeeRecord(coffeeDebugIo($), 'measure') // the reading of the turn that just ended, which the turn's own record could not have yet
    return next(e)
  })

  // The person's own /compact (typed, or the one the coffee break button filled): Clawd drinks while it runs, and a while after it stands.
  on('session.compact', async ($, e, next) => (isPersonCompact(e) ? whileCompacting(coffeeIo($), () => next(e)) : next(e)))

  // A /clear ends the session without a session.start: from here the list of finished work starts over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      briefing = undefined
      const now = await $.clock.now()
      await update($, gauge, g => ({ ...g, startedAt: now, contextPercent: undefined, contextTokens: undefined }))
    }
    // Another conversation takes over this process without a session.start: its recap and its turns are its own.
    if (e.reason === 'clear' || e.reason === 'resume') await resetRecap(recapIo($))
    await forgetKnow(knowIo($))
    return next(e)
  })

  on('command.run', { command: 'office-setup' }, async $ => {
    await openPanes(paneIo($), true)
    void restartOnboard(await onboardIo($, brief)).catch(() => undefined) // the question box is not waited for
    return { text: `${BRAND} setup is on the Office tab: two questions, then a starting team for this project.` }
  })

  on('command.run', { command: 'office-demo' }, async $ => {
    await openPanes(paneIo($), false)
    await startDemo(demoIo($))
    return { text: `The ${BRAND} tour is playing in the side panel (about a minute).` }
  })

  // Instruction-aware: remember what each agent type is for, put it on the books, and keep laid-off types off the listing.
  on('agent.offer', async ($, e, next) => {
    if (e.agent === SCOUT_TYPE) return { isOffered: false } // the plugin's own: never offered to the chat, never on the books
    const blurb = oneLine(e.description, BLURB_CHARS)
    // The engine offers every agent type at the same moment when a session starts. Their writes go one at a time:
    // the state refuses a write that lost the race too often, and the hook was then skipped for that type.
    await inLine(async () => {
      if ((await read($, blurbs))[e.agent] !== blurb) {
        await update($, blurbs, m => withBlurb(m, e.agent, blurb))
      }
      if (!(await read($, roster))[e.agent]) await enrollNow($, e.agent, 0)
    })
    if ((await getPayroll($)).laidOff.includes(e.agent)) return { isOffered: false }
    return next(e)
  })

  // Clawd learns to pick each hire's model and effort, and, while he runs the chat, that handing work over needs no asking.
  for (const tool of ['Agent', 'Task']) {
    on('tool.describe', { tool }, async ($, e, next) => {
      const r = await next(e)
      return { ...r, description: r.description + STAFFING_NOTE + (brief.isOn ? HANDOVER_NOTE : '') }
    })
  }

  on('agent.spawn', async ($, e, next) => {
    if (spawnTypeOf(e) === SCOUT_TYPE) { const r = await next(e); if (r.agentId) scoutBox.mark(r.agentId); return r } // marked before anyone else hears of it: no brief notes, no desk
    // A resumed run keeps its first brief (the engine takes no change to it) and its place on the books: no hire is counted again.
    // Clawd's [effort: …] line comes off the brief; every agent learns how to report its questions and choices.
    // A pair-up member's `PAIR-UP: <goal>` line (hooks/pair-up.ts) comes off the same way, right after it.
    const { effort, prompt: unEffort } = parseEffort(e.prompt)
    const { goal, prompt } = parsePairUp(unEffort)
    await setBoss($, withNewWork) // a hire or a resume is new work: the coffee break checkpoint is over
    if (e.resume) return rejoin($, await next(e), e, effort) // the engine takes no change to a resumed message, so its effort line stays on it
    // A workflow's agent keeps the script's prompt (2.1.300 applies a rewrite there): its answer is the script's to read.
    const sent = e.workflow ? e.prompt : prompt + recallNote(await loadMemory(memoryIo($))) + BRIEF_NOTE
    const r = await next({ ...e, prompt: sent })
    if (r.agentId) {
      keepBrief(r.agentId, sent)
      if (effort) efforts.set(r.agentId, effort)
      await newHire(runIo($), r.agentId, e.subagentType, e.description, e.name)
      const pair = goal !== undefined && !e.workflow ? { goal, at: await $.clock.now() } : undefined // a workflow keeps its script's prompt, so its line was never taken off
      await update($, staff, l => edit(l, r.agentId!, one => ({ ...one, ...(effort ? { effort } : {}), ...(pair ? { pair } : {}), model: one.model || r.model })))
      await showStatus($)
    }
    return r
  })

  // Each model request of an agent: what it has spent, and how full its context is.
  on('turn.step', async function* ($, e, next) {
    // Not waited for: the store's answer never holds a request back (noteRequest keeps its own errors).
    if (!e.agentId) void noteRequest(gaugeIo($), e.model, e.effort)
    const me = e.agentId ? (await read($, staff)).find(one => one.id === e.agentId) : undefined
    // A request is a sign of life, and a resumed specialist's first can come before any tool call.
    if (me) await signOfLife(runIo($), me.id, THINKING)
    const effort = e.agentId ? efforts.get(e.agentId) ?? me?.effort : undefined
    const result = yield* next(effort ? { ...e, effort } : e)
    const [u, said] = [result.usage, narrationOf(result.answer ?? '')]
    if (!e.agentId || (!u && !said)) return result
    const now = await $.clock.now()
    await update($, staff, l => edit(l, e.agentId!, one => {
      const stepped = u ? withStep(one, u, u.model || e.model, now) : one
      // A request that comes back after the run was sent home says nothing: its words would outlive the run.
      return said && isActive(one) ? withSaid(stepped, said) : stepped
    }))
    return result
  })

  // A page Claude publishes or opens, by Clawd or by a specialist, joins the Artifact Desk on the Office tab.
  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const folder = cwd
    const ran = await next(e)
    // The tool's answer matters more than the desk: the save is started, not waited for, and a desk that cannot be kept is skipped, not thrown.
    void keepArtifact(artifactIo($), folder, e as unknown as Record<string, unknown>, ran as ArtifactAnswer).catch(() => undefined)
    return ran
  })

  // Unfinished-work lines Claude or a specialist writes into files (TODO, a skipped test, "not implemented") join Left undone.
  for (const tool of FILE_TOOLS) on('tool.call', { tool: tool as 'Edit' }, ($, e, next) => leftWatch(leftIo($), e as never, () => next(e))) // MultiEdit is no declared tool name, but the engine runs one if a build has it

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.agentId
    // The running tally of agent and skill use (hooks/use-tally.ts): names and counts only, for what session files are too big to show. Never waited for.
    if (isCountedTool(tool)) void (async () => recordUse({ get: async key => (await $.store.get(key)) as never, set: (key, value) => $.store.set(key, value) }, cwd, await $.session.id(), tool, input))().catch(() => undefined)
    if (isEditTurn && isShippedWrite(tool, input)) return { deny: SHIPPED_DENY } as never
    // The setup scout reads inside the project and sends its picks, guarded from its first call (hooks/scout-run.ts); anyone else is turned away from its tool.
    const scouted = await scoutRoute(scoutBox, scoutRouteIo($), cwd, id, tool, input)
    if (scouted) return ('run' in scouted ? next({ ...e, ...scouted.run } as never) : scouted) as never
    // Every tool Clawd uses himself counts towards a long turn of his own (hooks/know-check.ts), but a step report is no work.
    if (id === undefined && tool !== STEP_TOOL) { knowToolUsed(); leftToolUsed(tool); await setBoss($, b => withToolUsed(b, tool)) } // editing files himself ends a coffee break checkpoint at the turn's end
    const own = await ownToolAnswer(ownToolIo($), tool, id, input) // the tour, remember, and a specialist's step report
    if (own) return own as never
    // What the person answers in Clawd's question box is saved as their decision, each question with its own answer.
    if (tool === 'AskUserQuestion' && id === undefined) {
      const ran = await next(e)
      for (const { question, said } of boxAnswers(input, ran)) await saveBoxAnswer(memoryIo($), question, said)
      return ran
    }
    if (id === undefined) {
      if (tool !== 'Agent' && tool !== 'Task') await setBoss($, b => ({ ...b, activity: sentenceOf(tool, input) }))
      return next(e)
    }
    // An id no spawn announced and the engine does not list is no one of ours: no hire, no revival.
    const known = (await read($, staff)).find(one => one.id === id)
    const listed = known ? undefined : (await $.agent.list()).find(one => one.id === id)
    if (!known && !listed) return next(e)
    if (listed) await hireListed(runIo($), listed)
    else await signOfLife(runIo($), id)
    await update($, staff, l => edit(l, id, one => withTool(one, sentenceOf(tool, input))))
    try { return await next(e) } finally { await update($, staff, l => edit(l, id, one => (one.mood === 'working' ? { ...one, mood: 'thinking' } : one))) }
  }).catch((_$, e, next) => {
    if (!next.called && e.agentId !== undefined && scoutBox.isScout(e.agentId)) return { deny: SCOUT_CRASH_DENY } as never // fails closed
    return !next.called && guardOnCrash(isEditTurn, String(e.tool), e as unknown as Record<string, unknown>) === 'deny' ? { deny: SHIPPED_DENY } as never : next(e)
  })

  // The person's prompts: the latest ride along with the check on finished work, and the second passes a note over.
  // An edit request from the Settings tab carries a note of its own: the file to edit, and what must not be touched.
  on('prompt.submit', async ($, e, next) => {
    leftAsked(e)
    if (isPersonMessage(e)) await setBoss($, b => withPersonSpoke(b, e.origin?.kind)) // what closed before it is behind us: the coffee break button waits for the next checkpoint
    else if (isNotification(e)) await setBoss($, b => withNotice(b, e.turnId !== undefined)) // a job's notification starts or joins a turn: which one reports a hand-back
    if (brief.isKnowOn) await knowPrompt(knowIo($), e as { text: string })
    const note = await editNote(e.text, brief.voiceFile, $.plugin.root, () => homeOf($))
    return next(note === undefined ? e : { ...e, context: [...(e.context ?? []), note] })
  })
  // While ours is on and an office tab is open, Claude Code's own "You should know" stays quiet; every other side question passes.
  on('model.fork', async ($, e, next) => (brief.isKnowOn && isBuiltinKnow(next.origin) && (await isWatching(knowIo($))) ? { value: QUIET_FORK } : next(e)))

  // Clawd's standing orders and the project's memory ride at the top of every conversation.
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const entries = (await loadMemory(memoryIo($))).slice(-RECALL)
    const profile = profileBlock((await $.store.get(PROFILE_KEY).catch(() => undefined)) as Profile | undefined) // who the person is, from setup
    return { ...r, blocks: [...r.blocks, { name: 'clawdMemory', text: memoryBlock(entries) }, ...(profile ? [{ name: PROFILE_BLOCK, text: profile }] : [])] }
  })

  on('turn.start', async ($, e, next) => {
    // Since 2.1.299 specialists' turns start here too: all of this is about Clawd's own, in the main chat.
    if (e.agentId !== undefined) return next(e)
    // Work goes on, so a recap of the pause before it is out of date.
    noteRecapTurn()
    knowTurnStart(e.text ?? '')
    leftTurnStart()
    isEditTurn = editPartOf(e.text ?? '') !== undefined
    await setBoss($, b => ({ ...b, isBusy: true, turns: b.turns + 1, recap: undefined, activity: e.text ? READING_BRIEF : 'Back at it' }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      scoutBox.finish(e.agentId) // a scout that ends with no picks sent ends the wait; anyone else is no scout, and nothing happens
      const asker = (await read($, staff)).find(one => one.id === e.agentId)
      // Key choices the agent made itself go into the project's memory. Its questions stay in its report, for Clawd.
      if (asker && !asker.id.startsWith(DEMO)) {
        if (e.reason === 'answer') await setBoss($, withHandBack) // work handed back: a checkpoint once Clawd has reported it
        const by = labelOf(asker, (await read($, blurbs))[asker.type] ?? '')
        for (const text of parseChoices(e.answer ?? '')) await remember(memoryIo($), { kind: 'choice', text, by, source: 'report' })
        // After each hand-back, a check of the work against its report; a note may join Clawd's card.
        if (brief.isKnowOn) void checkHandback(knowIo($), { ...e, agentId: asker.id }, by)
        void leftAnswer(leftIo($), e, by)
      }
      await clockOut(runIo($), e.agentId, e.reason === 'answer' ? 'done' : 'failed')
      await showStatus($)
    } else {
      if (brief.isKnowOn) void checkOwnTurn(knowIo($), e)
      void leftOwnTurn(leftIo($), e, brief.isLeftOn)
      isEditTurn = false
      await askAgain(paneIo($))
      const now = await $.clock.now()
      await setBoss($, b => withTurnEnd(turnEndBoss(b, e.reason, now), e))
      void onboardIo($, brief).then(onboardTurnEnd).catch(() => undefined) // setup's answers that waited for the turn to end
      // The point Claude Code compacts at can move with the model: read again, never waited for. The record of the button follows it.
      void noteThreshold(gaugeIo($)).then(() => keepCoffeeRecord(coffeeDebugIo($), 'turn'))
      // An edit Claude just made shows in the Settings tab, marked as waiting for the next session.
      await refreshTab($, brief, true)
    }
    return next(e)
  })

  // ---- The quiet chat: filler rows are not drawn (hooks/quiet.ts says which); the full view shows everything ----
  // Only while Clawd runs the chat: his rules are what make him report on what is hidden. Read at each row: a press applies at once.
  const isQuiet = () => brief.isQuiet && brief.isOn
  {
    on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
      const p = e.props
      // Most rows are the person's own or already in full: nothing is read for them. A notification may be the merged line, which names no task.
      if (!isQuiet() || p.isExpanded || (!p.task && !p.from && p.origin.kind !== 'task-notification')) return next(e)
      if (!isHandback({ isExpanded: p.isExpanded, originKind: p.origin.kind, text: p.text, task: p.task, from: p.from }, await read($, staff))) return next(e)
      return blank(resolver($), e)
    })
    on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => (isQuiet() && isNoUpdate(e.props.text) ? blank(resolver($), e) : next(e)))
    // Small rows: the office's own bookkeeping calls are hidden or dimmed (hooks/quiet.ts says which). Errors always show.
    on('ui.render', { component: 'ToolUse' }, async ($, e, next) => (isQuiet() ? smallRow(resolver($), e, rowLook(e.props, await read($, staff)), () => next(e)) : next(e)))
    on('ui.render', { component: 'ToolResult' }, async ($, e, next) => (isQuiet() ? smallRow(resolver($), e, rowLook(e.props, await read($, staff)), () => next(e)) : next(e)))
    on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => (isQuiet() && isBackgroundHint(e.props.kind) ? blank(resolver($), e) : next(e)))
  }

  // ---- The four office panes, one per host tab: drawn by panel.tsx from a snapshot of the state ----
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
