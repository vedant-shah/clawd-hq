import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Artifact, Badge, Boss, EndedBy, Employee, Fx, KnowState, Memory, Mood, Payroll } from '../types'
import { BRIEF_NOTE, HANDOVER_NOTE, SAVED_CHARS, STAFFING_NOTE, boxAnswers, fit, memoryBlock, oneLine, parseChoices, parseEffort, recallNote } from './desk'
import type { Effort } from './desk'
import { artifactCall, cleanArtifacts, withArtifact, withoutArtifact } from './artifacts'
import type { ArtifactAnswer } from './artifacts'
import { READING_BRIEF, THINKING, narrationOf, sentenceOf } from './activity'
import { NAP_MS } from './clawd-says'
import { BLURB_CHARS, DEMO_TOOL, FRAME_MS, MAX_MEMORY, MEM_TOOL, RECALL, STEP_TOOL, TITLE_CHARS } from './constants'
import { freshHire, isLively, isSettling, quietBoss, settle, turnEndBoss, withBlurb, withJobs } from './office-state'
import { applyPayroll, resetPayroll, reviewPayroll, setLaidOff } from './payroll'
import type { PayrollIo } from './payroll'
import { configKeyOf, refusalOf } from './configs'
import type { ConfigField } from './configs'
import { BRAND, clip, hash, labelOf, roleOf } from './office'
import { renderPanel } from './panel'
import { limitsOf } from './meters'
import { contextOf, noteRequest, startGauge } from './usage'
import type { GaugeIo } from './usage'
import { DEMO, isActive } from './panel-model'
import { tourSteps } from './demo'
import { LOGBOOK_FILE, loadLogbook, saveLogbook, withDecision } from './logbook'
import type { LogbookIo } from './logbook'
import { SECTION_ID, SEED_KEYS, isBriefed, optionsOf, readBriefing } from './instructions'
import type { Briefing, BriefingIo, BriefingOptions } from './instructions'
import { SHIPPED_DENY, clawdActions, editNote, editPartOf, guardOnCrash, isShippedWrite, refreshClawd } from './clawd-edit'
import type { ClawdIo } from './clawd-edit'
import { RECAP_PROMPT, isRecapDue, recapLine } from './recap'
import { isHandback, isNoUpdate } from './quiet'
import { side } from './side-ask'
import { checkHandback, checkOwnTurn, forgetKnow, isWatching, keepBrief, knowActions, knowPrompt, knowToolUsed, knowTurnStart, startKnow } from './know-check'
import type { KnowIo } from './know-check'
import { KNOW0, QUIET_FORK, isBuiltinKnow } from './know'
import { PANES, askAgain, openAtStart, openPanes, pinHeight, raise, retitleDecisions } from './panes'
import type { PaneIo } from './panes'
import type { PanelTools } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { parseStep } from './steps'
import { DEMO_SPEC, REMEMBER_SPEC, STEP_SPEC } from './tool-specs'
import { QUIET_MS, endOfStatus, endRun, finishedBoss, finishedText, hire, markEngine, quietFor, restart, touch, verdict, withReport, withSaid, withStep, withTool } from './staff-model'
import { BOSS0, BRIEF0, FX0, GAUGE0, PAYROLL0, edit, inLine } from './state'

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
const know = atom({ plugin: 'clawd-hq', key: 'know' } as const, KNOW0)
const clawdBrief = atom({ plugin: 'clawd-hq', key: 'brief' } as const, BRIEF0)

// Values written by an older version of the mod lack the newer fields: fill them in.
async function getBoss($: EngineInterface): Promise<Boss> { return { ...BOSS0, ...(await read($, boss)) } }
async function getFx($: EngineInterface): Promise<Fx> { return { ...FX0, ...(await read($, fx)) } }
async function getPayroll($: EngineInterface): Promise<Payroll> { return { ...PAYROLL0, ...(await read($, payroll)) } }
async function setBoss($: EngineInterface, fn: (b: Boss) => Boss) { await update($, boss, b => fn({ ...BOSS0, ...b })) }
async function setFx($: EngineInterface, fn: (f: Fx) => Fx) { await update($, fx, f => fn({ ...FX0, ...f })) }

// The project the session runs in: payroll is kept per project.
let cwd = ''
// The recap on Clawd's card: whether it may be made here, Clawd's turns this session, and the turn count the last one was asked at.
let isRecapOn = true
let turnsSeen = 0
let recapFor = 0
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

async function newHire($: EngineInterface, id: string, type: string, description: string, name?: string) {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  const fresh = freshHire({ id, type, description, name }, now, t)
  if ((await read($, staff)).some(e => e.id === id)) {
    await update($, staff, list => hire(list, fresh))
    return
  }
  await enroll($, type, id.startsWith(DEMO) ? 0 : 1)
  await update($, staff, list => hire(list, fresh))
  const role = roleOf(type, (await read($, blurbs))[type] ?? '')
  await setBoss($, b => ({ ...b, activity: role.hello, waveUntil: t + 6, hires: b.hires + 1 }))
}

/**
 * Ends one specialist's run. The check sits inside the write, so two signals for one stop (turn.complete,
 * SubagentStop, the reconcile) end it once; a guess from the engine or the clock also checks it is still quiet.
 */
async function clockOut($: EngineInterface, id: string, mood: Mood, how: EndedBy = 'signal') {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  let ended: Employee | undefined
  await update($, staff, l => {
    ended = undefined
    return edit(l, id, one => {
      if (!isActive(one) || (how !== 'signal' && quietFor(one, now) <= QUIET_MS)) return one
      ended = one
      return endRun(one, mood, how, now, t)
    })
  })
  const e = ended as Employee | undefined
  // Lost contact is neither a win nor a failure: no toast, no cheer.
  if (!e || mood === 'lost') return
  const blurb = (await read($, blurbs))[e.type] ?? ''
  const [role, label] = [roleOf(e.type, blurb), labelOf(e, blurb)]
  await setBoss($, b => finishedBoss(b, mood, t, label))
  $.ui.toast(finishedText(mood, role.prop, label, e, now))
}

/** Any sign of life from a specialist (a tool call, a model step): it is heard from now, and a finished one is back at work. */
async function signOfLife($: EngineInterface, id: string, activity?: string) {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  await update($, staff, l => edit(l, id, one => {
    const back = touch(restart(one, now, t), now)
    return activity === undefined ? back : { ...back, activity }
  }))
}

/** A resumed specialist is at work again, on a new run; one the books lost (from before a reload) joins them, not counted as a hire. */
async function rejoin<R extends { agentId?: string }>($: EngineInterface, r: R, e: { subagentType: string; description: string; name?: string }) {
  if (!r.agentId) return r
  const [now, t] = [await $.clock.now(), await read($, tick)]
  if (!(await read($, staff)).some(one => one.id === r.agentId)) await update($, staff, l => hire(l, freshHire({ ...e, id: r.agentId!, type: e.subagentType }, now, t)))
  await signOfLife($, r.agentId)
  await showStatus($)
  return r
}

/** An agent the engine lists that no spawn announced (it started before this mod loaded) joins the books. */
const hireFromList = ($: EngineInterface) => (a: { id: string; type: string; description: string; name?: string }) => newHire($, a.id, a.type, a.description, a.name)

/** The specialist of this id on the books. One the engine lists that no spawn has announced yet (its first call can beat the hire) joins first. */
async function specialistOf($: EngineInterface, id: string): Promise<Employee | undefined> {
  const known = (await read($, staff)).find(one => one.id === id)
  if (known) return known
  const listed = (await $.agent.list()).find(one => one.id === id)
  if (!listed) return undefined
  await hireFromList($)(listed)
  return (await read($, staff)).find(one => one.id === id)
}

/**
 * The engine's own list catches agents spawned before this mod loaded and stops nobody saw; the clock catches
 * runs that went silent. Only silence ends a run (see verdict), so a long step is never cut short.
 */
async function reconcile($: EngineInterface) {
  const [agents, list, now] = [await $.agent.list(), await read($, staff), await $.clock.now()]
  for (const a of agents) {
    if (!list.some(e => e.id === a.id) && endOfStatus(a.status) === undefined) await hireFromList($)(a)
  }
  for (const e of list) {
    const status = agents.find(a => a.id === e.id)?.status
    const seen = status !== undefined && status !== e.engine ? markEngine(e, status, now) : e
    if (seen !== e) await update($, staff, l => edit(l, e.id, one => markEngine(one, status!, now)))
    const end = verdict(seen, status, now)
    if (end) await clockOut($, e.id, end.mood, end.how)
  }
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

/** The tab follows the files; a read that fails leaves it as it was and never stops the hook that asked. */
const refreshTab = ($: EngineInterface, opts: BriefingOptions, isFresh: boolean) => clawdIo($, opts).then(io => refreshClawd(io, isFresh)).catch(() => undefined)

// ---- The panes: one per view, so the host's own tab strip switches between them (hooks/panes.ts) ----

const paneIo = ($: EngineInterface): PaneIo => ({
  open: args => $.ui.open(args),
  list: () => $.ui.panes(),
  close: id => $.ui.close({ id }),
  decisions: async () => (await read($, memory)).length,
})

// ---- Memory: the project's decisions, a plain file in its .clawd-hq folder, mirrored in state for the pane ----

/** Set once a write failed this session, so the person is told once and not on every decision. */
let isLogbookWarned = false
/** The same for the artifact list. */
let isArtifactsWarned = false

const logbookIo = ($: EngineInterface): LogbookIo => ({
  cwd, exists: path => $.fs.exists(path), read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text),
  now: () => $.clock.now(), held: () => read($, memory),
})

const loadMemory = async ($: EngineInterface): Promise<Memory[]> => (await loadLogbook(logbookIo($))).list

async function saveMemory($: EngineInterface, fn: (list: Memory[]) => Memory[]) {
  const io = logbookIo($)
  const book = await loadLogbook(io)
  const list = fn(book.list).slice(-MAX_MEMORY)
  await update($, memory, () => list)
  if (!(await saveLogbook(io, book, list))) {
    // The decision stays in this session; the person hears of it once.
    if (!isLogbookWarned) $.ui.toast(`Could not save decisions to ${LOGBOOK_FILE}. They are kept for this session only.`)
    isLogbookWarned = true
  }
  await retitleDecisions(paneIo($))
}

async function remember($: EngineInterface, m: Omit<Memory, 'id' | 'at'>, supersedes?: string) {
  const at = await $.clock.now()
  const text = m.text.replace(/\s+/g, ' ').trim()
  if (!text) return
  await saveMemory($, list => withDecision(list, { ...m, text }, at, supersedes))
}

/** An answer the person gave in Clawd's question box, saved as their decision. The question is cut before the answer is, so a long question never pushes the answer out of what is saved. */
async function saveBoxAnswer($: EngineInterface, question: string, said: string) {
  await remember($, { kind: 'decision', text: `${fit(question, TITLE_CHARS)} → ${said}`, by: 'CEO', source: 'desk' })
  const t = await read($, tick)
  await setBoss($, b => ({ ...b, quip: { text: `On it, boss: “${clip(said, 32)}”`, until: t + 8 } }))
}

// ---- Payroll: which agent types Clawd is offered (hooks/payroll.ts) ----

const payrollIo = ($: EngineInterface): PayrollIo => ({
  cwd, get: () => getPayroll($), set: async p => { await update($, payroll, () => p) }, keep: (key, p) => $.store.set(key, p),
  types: async () => [...new Set([...Object.keys(await read($, blurbs)), ...Object.keys(await read($, roster))])],
  list: path => $.fs.list(path), fx: () => getFx($), setFx: fn => setFx($, fn), toast: text => void $.ui.toast(text),
  invalidate: () => { $.ui.invalidate('tool.describe'); $.ui.invalidate('prompt.attachment') },
})

// ---- The Artifact Desk: the pages Claude published or opened here, kept per project folder ----

/** Notes what a call to the Artifact tool did. The change is made on the list as it stands when the write lands, so calls made at the same moment all land. */
async function keepArtifact($: EngineInterface, folder: string, input: Record<string, unknown>, ran: ArtifactAnswer) {
  const call = artifactCall(input, ran)
  if (!call) return
  const at = await $.clock.now()
  await inLine(async () => {
    // The session moved to another project while the call ran: this page is not that project's, so it is dropped.
    if (cwd !== folder) return
    const next = await update($, artifacts, list => (call.isDelete ? withoutArtifact(list, call.link) : withArtifact(list, call.link, call.title, at)))
    if (!folder) return
    try {
      await $.store.set(`artifacts:${folder}`, next)
    } catch {
      // The page stays in this session's list; the person hears of it once.
      if (!isArtifactsWarned) $.ui.toast('Could not save the artifact list. It is kept for this session only.')
      isArtifactsWarned = true
    }
  })
}

// ---- The recap: one line on where things stand, after a few quiet minutes ----

/**
 * Asks the model over the session's own transcript, which the API serves from the main thread's cache, as Claude
 * Code's own session recap does. Once per pause: the turn count is noted before the question goes out. Only while no
 * other side question runs or waits (hooks/side-ask.ts); a later frame tries again.
 */
async function maybeRecap($: EngineInterface) {
  const [b, f, now] = [await getBoss($), await getFx($), await $.clock.now()]
  if (!isRecapDue({ isOn: isRecapOn, isBusy: b.isBusy || f.demo !== undefined, idleSince: b.idleSince, now, turns: turnsSeen, lastFor: recapFor })) return
  // A recap is for someone looking at the panel: none while nothing is drawn. Read only once one is due, to keep frames cheap.
  if ((await $.session.surfaces().catch(() => [])).length === 0) return
  side.tryNow(() => askRecap($))
}

async function askRecap($: EngineInterface) {
  const asked = turnsSeen
  recapFor = asked
  const reply = await $.model.fork({ prompt: RECAP_PROMPT })
  const text = reply.isAnswered ? recapLine(reply.text) : undefined
  // A turn that began while the model was answering has made the line stale: it is dropped.
  if (text !== undefined && asked === turnsSeen) await setBoss($, boss => (boss.isBusy ? boss : { ...boss, recap: text }))
}

/** A new session, or a /clear: the turns are counted afresh and an old recap goes. */
async function resetRecap($: EngineInterface) {
  turnsSeen = 0
  recapFor = 0
  if ((await getBoss($)).recap !== undefined) await setBoss($, b => ({ ...b, recap: undefined }))
}

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
})

// ---- The frame clock ----

async function onFrame($: EngineInterface, frames: number) {
  const [list, f, b, t0] = [await read($, staff), await getFx($), await getBoss($), await read($, tick)]
  if (frames % 8 === 0) await reconcile($)
  if (frames % 25 === 0) {
    await reviewPayroll(payrollIo($))
    // The model takes its time: the frames go on meanwhile, and a recap that fails is simply not shown.
    void maybeRecap($).catch(() => undefined)
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
    artifacts: await read($, artifacts), gauge: await read($, gauge), now: await $.clock.now(), know: await knowIo($).card(),
    brief: { ...BRIEF0, ...(await read($, clawdBrief)) }, options,
  }
}

/** Settings shows the list of finished work (true) or its configs (false); the choice is a display flag, shared by every drawing. */
const showLog = ($: EngineInterface, isOpen: boolean) => setFx($, f => ({ ...f, isLogOpen: isOpen }))

/** A config's toggle pressed: its settings row is changed as in /config, and the plugin reloads with it. A refusal, or a call that fails, is shown plainly. */
async function setConfig($: EngineInterface, field: ConfigField, value: boolean) {
  const key = configKeyOf(await $.config.list().catch(() => []), $.plugin.name, field)
  const r = await $.config.set({ key, value }).catch((err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) }))
  await setFx($, f => ({ ...f, configNote: r.deny === undefined ? undefined : refusalOf(field, r.deny) }))
}


function panelActions($: EngineInterface, opts: BriefingOptions): PanelActions {
  return {
    editClawd: async (target, isTerminal) => clawdActions(await clawdIo($, opts)).editClawd(target, isTerminal),
    resetClawd: async part => clawdActions(await clawdIo($, opts)).resetClawd(part),
    setFind: (tab, text) => setFx($, f => ({ ...f, finds: { ...f.finds, [tab]: text } })),
    forget: id => saveMemory($, list => list.filter(x => x.id !== id)),
    layOff: type => setLaidOff(payrollIo($), type, true),
    hire: type => setLaidOff(payrollIo($), type, false),
    settlePayroll: isLayoff => applyPayroll(payrollIo($), isLayoff),
    toggleUsage: () => setFx($, f => ({ ...f, isUsageOpen: !f.isUsageOpen })),
    showLog: isOpen => showLog($, isOpen),
    setConfig: (field, value) => setConfig($, field, value),
    ...knowActions(knowIo($)),
  }
}

// ---- The header meters: context and rate limits, kept as the engine reports them ----

const gaugeIo = ($: EngineInterface): GaugeIo => ({
  now: () => $.clock.now(), usage: () => $.session.usage(), model: () => $.session.model(),
  get: () => read($, gauge), set: fn => update($, gauge, fn),
})

// ---- The demo: a scripted tour with stand-in employees, cleaned up at the end ----

let demoTimers: Timer[] = []

async function demoWork($: EngineInterface, id: string, tool: string, input: Record<string, unknown>) {
  const activity = sentenceOf(tool, input)
  await update($, staff, l => edit(l, id, one => ({ ...withTool(one, activity), tokens: (one.tokens ?? 0) + 18_000 + (hash(activity) % 9000) })))
}

async function demoSay($: EngineInterface, text: string, ticks = 10) {
  const t = await read($, tick)
  await setBoss($, b => ({ ...b, quip: { text, until: t + ticks } }))
}

async function startDemo($: EngineInterface) {
  for (const timer of demoTimers) timer.cancel()
  demoTimers = []
  const saved = await getBoss($)
  const id = (n: string) => `${DEMO}${n}`
  const steps = tourSteps({
    show: view => raise(paneIo($), view),
    showLog: isOpen => showLog($, isOpen),
    setBusy: () => setBoss($, b => ({ ...b, isBusy: true })),
    say: (text, ticks) => demoSay($, text, ticks),
    hire: (n, type, description) => newHire($, id(n), type, description),
    work: (n, tool, input) => demoWork($, id(n), tool, input),
    finish: (n, mood) => clockOut($, id(n), mood),
    goQuiet: async () => { const now = await $.clock.now(); await setBoss($, b => quietBoss(b, now, NAP_MS)) },
  })

  const total = steps.length
  steps.forEach(([caption, run], i) => {
    demoTimers.push($.clock.after(i * 5000, () => {
      void (async () => {
        await setFx($, f => ({ ...f, demo: { step: i + 1, total, caption } }))
        await run()
      })().catch(() => undefined) // a step that fails is skipped; it must not become an unhandled rejection
    }))
  })
  demoTimers.push($.clock.after(total * 5000 + 1500, () => {
    void (async () => {
      await update($, staff, l => l.filter(e => !e.id.startsWith(DEMO)))
      await setFx($, f => ({ ...f, demo: undefined }))
      await setBoss($, b => ({ ...saved, turns: b.turns, recap: b.recap, quip: undefined }))
      await showStatus($)
    })()
  }))
}

export const register: Register = (on, options) => {
  let timer: Timer | undefined
  let isFraming = false
  const brief = optionsOf(options)

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
    isRecapOn = brief.isRecapOn
    await resetRecap($)
    await startKnow(knowIo($), cwd)
    // A review made for an earlier session is not this one's: it is made again within a few seconds if it still stands.
    if ((await getFx($)).layoffs) await setFx($, f => ({ ...f, layoffs: undefined }))
    await $.command.register({ name: 'office', description: `Open ${BRAND}, the virtual office of this session’s agents` })
    await $.command.register({ name: 'office-demo', description: `Play a one-minute tour of ${BRAND}’s features` })
    await $.tool.register(DEMO_SPEC)

    const saved = (await $.store.get(`payroll:${cwd}`)) as Payroll | undefined
    if (saved) await update($, payroll, () => ({ ...PAYROLL0, ...saved }))
    const recalled = await loadMemory($)
    await update($, memory, () => recalled)
    // This project's pages only: a list left by another folder is replaced, and what the store holds is checked.
    const pages = cleanArtifacts(await $.store.get(`artifacts:${cwd}`))
    await update($, artifacts, () => pages)
    await $.tool.register(REMEMBER_SPEC)
    await $.tool.register(STEP_SPEC)
    await enroll($, 'general-purpose', 0)
    await startGauge(gaugeIo($))
    await refreshTab($, brief, true)

    let frames = 0
    timer?.cancel()
    timer = $.clock.every(FRAME_MS, () => {
      frames += 1
      // A frame that is still running (a slow agent list) is not stacked on.
      if (isFraming) return
      isFraming = true
      void onFrame($, frames).finally(() => { isFraming = false })
    })

    await reconcile($)
    // Office is asked to the front on every surface; a refusal is tried once more after the first reply (hooks/panes.ts).
    void openAtStart(paneIo($))

    return next(e)
  })

  // The agent's own stop signal, beside turn.complete: whichever comes first ends the run, the second finds it ended.
  on('classic.SubagentStop', async ($, e, next) => {
    await clockOut($, e.agent_id, 'done')
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await openPanes(paneIo($), true)
    return { text: `${BRAND} is open: Office · Decisions · People · Settings are the tabs at the top.` }
  })

  // The header's context bar and limit countdowns follow the engine's own readings.
  on('session.measure', async ($, e, next) => {
    await update($, gauge, g => ({ ...g, ...contextOf(e.context), limits: limitsOf(e.rateLimits) }))
    return next(e)
  })

  // A /clear ends the session without a session.start: from here the list of finished work starts over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      briefing = undefined
      const now = await $.clock.now()
      await update($, gauge, g => ({ ...g, startedAt: now, contextPercent: undefined, contextTokens: undefined }))
    }
    // Another conversation takes over this process without a session.start: its recap and its turns are its own.
    if (e.reason === 'clear' || e.reason === 'resume') await resetRecap($)
    await forgetKnow(knowIo($))
    return next(e)
  })

  on('command.run', { command: 'office-demo' }, async $ => {
    await openPanes(paneIo($), false)
    await startDemo($)
    return { text: `The ${BRAND} tour is playing in the side panel (about a minute).` }
  })

  // Instruction-aware: remember what each agent type is for, put it on the books, and keep laid-off types off the listing.
  on('agent.offer', async ($, e, next) => {
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
    // A resumed run keeps its first brief (the engine takes no change to it) and its place on the books: no hire is counted again.
    if (e.resume) return rejoin($, await next(e), e)
    // Clawd's [effort: …] line comes off the brief; every agent learns how to report its questions and choices.
    const { effort, prompt } = parseEffort(e.prompt)
    // A workflow's agent keeps the script's prompt (2.1.300 applies a rewrite there): its answer is the script's to read.
    const sent = e.workflow ? e.prompt : prompt + recallNote((await loadMemory($)).slice(-RECALL)) + BRIEF_NOTE
    const r = await next({ ...e, prompt: sent })
    if (r.agentId) {
      keepBrief(r.agentId, sent)
      if (effort) efforts.set(r.agentId, effort)
      await newHire($, r.agentId, e.subagentType, e.description, e.name)
      await update($, staff, l => edit(l, r.agentId!, one => ({ ...one, ...(effort ? { effort } : {}), model: one.model || r.model })))
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
    if (me) await signOfLife($, me.id, THINKING)
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
    void keepArtifact($, folder, e as unknown as Record<string, unknown>, ran as ArtifactAnswer).catch(() => undefined)
    return ran
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.agentId
    if (isEditTurn && isShippedWrite(tool, input)) return { deny: SHIPPED_DENY } as never
    // Every tool Clawd uses himself counts towards a long turn of his own (hooks/know-check.ts), but a step report is no work.
    if (id === undefined && tool !== STEP_TOOL) knowToolUsed()

    if (tool === DEMO_TOOL) {
      await openPanes(paneIo($), false)
      await startDemo($)
      return { result: `The ${BRAND} tour is playing in the side panel for about a minute. If the panel is not visible, the user can type /office.` } as never
    }

    if (tool === MEM_TOOL) {
      const decision = fit(String(input.decision ?? ''), SAVED_CHARS)
      // A subagent's call is its own note, never the user's decision.
      const caller = id ? (await read($, staff)).find(one => one.id === id) : undefined
      const by = caller ? labelOf(caller, (await read($, blurbs))[caller.type] ?? '') : 'agent'
      const mine = id === undefined ? { kind: 'decision' as const, by: 'CEO' } : { kind: 'choice' as const, by }
      await remember($, { ...mine, text: decision, source: 'clawd' }, typeof input.supersedes === 'string' ? input.supersedes : undefined)
      const t = await read($, tick)
      await setBoss($, b => ({ ...b, quip: { text: `Noted for the record: “${clip(decision, 40)}”`, until: t + 10 } }))
      return { result: `Recorded in the project memory: ${decision}` } as never
    }

    // A specialist's own report of how far along it is (hooks/steps.ts). Only one at work here counts; any other call is ignored.
    if (tool === STEP_TOOL) {
      const mine = id ? await specialistOf($, id) : undefined
      if (!mine || !isActive(mine)) return { result: 'Ignored: only a specialist at work here reports steps.' } as never
      const parsed = parseStep(input)
      if ('error' in parsed) return { deny: parsed.error } as never
      const now = await $.clock.now()
      // The run is checked again inside the write: it may have ended since it was read.
      await update($, staff, l => edit(l, mine.id, one => withReport(one, parsed.report, now)))
      return { result: `Noted: ${parsed.report.done} of ${parsed.report.total} steps done.` } as never
    }

    // What the person answers in Clawd's question box is saved as their decision, each question with its own answer.
    if (tool === 'AskUserQuestion' && id === undefined) {
      const ran = await next(e)
      for (const { question, said } of boxAnswers(input, ran)) await saveBoxAnswer($, question, said)
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
    if (listed) await hireFromList($)(listed)
    else await signOfLife($, id)
    await update($, staff, l => edit(l, id, one => withTool(one, sentenceOf(tool, input))))
    try {
      return await next(e)
    } finally {
      await update($, staff, l => edit(l, id, one => (one.mood === 'working' ? { ...one, mood: 'thinking' } : one)))
    }
  }).catch((_$, e, next) => (!next.called && guardOnCrash(isEditTurn, String(e.tool), e as unknown as Record<string, unknown>) === 'deny' ? { deny: SHIPPED_DENY } as never : next(e)))

  // The person's prompts: the latest ride along with the check on finished work, and the second passes a note over.
  // An edit request from the Settings tab carries a note of its own: the file to edit, and what must not be touched.
  on('prompt.submit', async ($, e, next) => {
    if (brief.isKnowOn) await knowPrompt(knowIo($), e as { text: string })
    const note = await editNote(e.text, brief.voiceFile, $.plugin.root, () => homeOf($))
    return next(note === undefined ? e : { ...e, context: [...(e.context ?? []), note] })
  })
  // While ours is on and an office tab is open, Claude Code's own "You should know" stays quiet; every other side question passes.
  if (brief.isKnowOn) on('model.fork', async ($, e, next) => (isBuiltinKnow(next.origin) && (await isWatching(knowIo($))) ? { value: QUIET_FORK } : next(e)))

  // Clawd's standing orders and the project's memory ride at the top of every conversation.
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const entries = (await loadMemory($)).slice(-RECALL)
    return { ...r, blocks: [...r.blocks, { name: 'clawdMemory', text: memoryBlock(entries) }] }
  })

  on('turn.start', async ($, e, next) => {
    // Since 2.1.299 specialists' turns start here too: all of this is about Clawd's own, in the main chat.
    if (e.agentId !== undefined) return next(e)
    // Work goes on, so a recap of the pause before it is out of date.
    turnsSeen += 1
    knowTurnStart(e.text ?? '')
    isEditTurn = editPartOf(e.text ?? '') !== undefined
    await setBoss($, b => ({ ...b, isBusy: true, turns: b.turns + 1, recap: undefined, activity: e.text ? READING_BRIEF : 'Back at it' }))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const asker = (await read($, staff)).find(one => one.id === e.agentId)
      // Key choices the agent made itself go into the project's memory. Its questions stay in its report, for Clawd.
      if (asker && !asker.id.startsWith(DEMO)) {
        const by = labelOf(asker, (await read($, blurbs))[asker.type] ?? '')
        for (const text of parseChoices(e.answer ?? '')) await remember($, { kind: 'choice', text, by, source: 'report' })
        // After each hand-back, a check of the work against its report; a note may join Clawd's card.
        if (brief.isKnowOn) void checkHandback(knowIo($), { ...e, agentId: asker.id }, by)
      }
      await clockOut($, e.agentId, e.reason === 'answer' ? 'done' : 'failed')
      await showStatus($)
    } else {
      if (brief.isKnowOn) void checkOwnTurn(knowIo($), e)
      isEditTurn = false
      await askAgain(paneIo($))
      const now = await $.clock.now()
      await setBoss($, b => turnEndBoss(b, e.reason, now))
      // An edit Claude just made shows in the Settings tab, marked as waiting for the next session.
      await refreshTab($, brief, true)
    }
    return next(e)
  })

  // ---- The quiet chat: filler rows are not drawn (hooks/quiet.ts says which); the full view shows everything ----
  // Only while Clawd runs the chat: his rules are what make him report on what is hidden.
  if (brief.isQuiet && brief.isOn) {
    on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
      const p = e.props
      // Most rows are the person's own or already in full: nothing is read for them.
      if (p.isExpanded || (!p.task && !p.from)) return next(e)
      if (!isHandback({ isExpanded: p.isExpanded, originKind: p.origin.kind, text: p.text, task: p.task, from: p.from }, await read($, staff))) return next(e)
      const { Text } = $.ui.resolve(e)
      return <Text>{''}</Text>
    })

    on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
      if (!isNoUpdate(e.props.text)) return next(e)
      const { Text } = $.ui.resolve(e)
      return <Text>{''}</Text>
    })
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
