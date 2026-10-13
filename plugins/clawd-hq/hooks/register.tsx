import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Ask, Badge, Boss, EndedBy, Employee, Fx, Memory, Mood, Payroll } from '../types'
import { BRIEF_NOTE, SAVED_CHARS, STAFFING_NOTE, answerText, fit, memoryBlock, oneLine, parseChoices, parseEffort, parseReport, proposeLayoffs, recallNote } from './desk'
import type { Effort } from './desk'
import { READING_BRIEF, THINKING, narrationOf, sentenceOf } from './activity'
import { NAP_MS } from './clawd-says'
import { renderDesk } from './desk-pane'
import { ACCENT, BRAND, ago, clip, hash, labelOf, roleOf } from './office'
import { renderPanel } from './panel'
import { limitsOf } from './meters'
import { DEMO, isActive, isWaiting, waitingSummary } from './panel-model'
import { tourSteps } from './demo'
import { LOGBOOK_FILE, fromMarkdown, mergeMarkdown } from './logbook'
import { SECTION_ID, isBriefed, loadBriefing, optionsOf } from './instructions'
import { PANES, openPanes, pinHeight, raise, retitleDecisions } from './panes'
import type { PaneIo } from './panes'
import type { PanelTools } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { ASK_SPEC, REMEMBER_SPEC } from './tool-specs'
import { QUIET_MS, endOfStatus, endRun, hire, markEngine, quietFor, restart, touch, verdict, withSaid, withStep, withTool } from './staff-model'
import { BOSS0, FX0, GAUGE0, PAYROLL0, edit } from './state'

const DESK = 'ceo-desk'
const DESK_TITLE = 'CEO Desk'
const FRAME_MS = 400
const CHEER_TICKS = 5
const MAX_ASKS = 60
/** A given name is a word or two; anything longer is cut. */
const NAME_CHARS = 40
/** How much of a question is kept in front of its answer in a saved decision. */
const TITLE_CHARS = 600
/** The last request, kept for the resume button. */
const TASK_CHARS = 4000
const BLURB_CHARS = 200
// Agent-written text is cut to one line where it is stored.
const DESCRIPTION_CHARS = 160
const MAX_BLURBS = 120
const DEMO_TOOL = 'mcp__clawd-hq__demo'
const ASK_TOOL = 'mcp__clawd-hq__ask_ceo'
const MEM_TOOL = 'mcp__clawd-hq__remember'
// The memory keeps this many entries per project; Clawd and each brief get the newest RECALL.
/** The newest this many decisions are kept: in the file and in the pane. */
const MAX_MEMORY = 1000
const RECALL = 25

const staff = atom({ plugin: 'clawd-hq', key: 'staff' } as const, [] as Employee[])
const boss = atom({ plugin: 'clawd-hq', key: 'boss' } as const, BOSS0)
const fx = atom({ plugin: 'clawd-hq', key: 'fx' } as const, FX0)
const tick = atom({ plugin: 'clawd-hq', key: 'tick' } as const, 0)
const blurbs = atom({ plugin: 'clawd-hq', key: 'blurbs' } as const, {} as Record<string, string>)
const roster = atom({ plugin: 'clawd-hq', key: 'roster' } as const, {} as Record<string, Badge>)
const desk = atom({ plugin: 'clawd-hq', key: 'desk' } as const, [] as Ask[])
const payroll = atom({ plugin: 'clawd-hq', key: 'payroll' } as const, PAYROLL0)
const memory = atom({ plugin: 'clawd-hq', key: 'memory' } as const, [] as Memory[])
const gauge = atom({ plugin: 'clawd-hq', key: 'gauge' } as const, GAUGE0)

// Values written by an older version of the mod lack the newer fields: fill them in.
async function getBoss($: EngineInterface): Promise<Boss> { return { ...BOSS0, ...(await read($, boss)) } }
async function getFx($: EngineInterface): Promise<Fx> { return { ...FX0, ...(await read($, fx)) } }
async function getPayroll($: EngineInterface): Promise<Payroll> { return { ...PAYROLL0, ...(await read($, payroll)) } }
async function setBoss($: EngineInterface, fn: (b: Boss) => Boss) { await update($, boss, b => fn({ ...BOSS0, ...b })) }
async function setFx($: EngineInterface, fn: (f: Fx) => Fx) { await update($, fx, f => fn({ ...FX0, ...f })) }

// The project the session runs in: payroll is kept per project.
let cwd = ''
let isPayrollFiled = false
// Each agent's effort, set the moment it is hired so its first request already carries it; staff keeps it across reloads.
const efforts = new Map<string, Effort>()

/** Runs tasks one after another, in the order asked, whatever each one's outcome: for writes many hooks make at the same moment. */
let line: Promise<unknown> = Promise.resolve()
function inLine<T>(task: () => Promise<T>): Promise<T> {
  const run = line.then(task, task)
  line = run.catch(() => undefined)
  return run
}

const isAtDesk = (e: Employee, t: number) => isActive(e) || (e.doneTick !== undefined && t - e.doneTick < CHEER_TICKS)

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
  const badge = cur[type] ?? { jobs: 0 }
  const next = { ...cur, [type]: { ...badge, jobs: badge.jobs + jobs } }
  await update($, roster, () => next)
  await $.store.set('roster', next)
}

async function newHire($: EngineInterface, id: string, type: string, description: string, name?: string) {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  const named = name ? { name: fit(name, NAME_CHARS) } : {}
  const fresh: Employee = { id, type, description: fit(description, DESCRIPTION_CHARS), ...named, mood: 'arriving', tools: 0, startedAt: now, lastSeen: now, joinedTick: t }
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
  await setBoss($, b => (mood === 'done'
    ? { ...b, proudUntil: t + 10, oopsUntil: 0, lastTitle: label, wins: b.wins + 1 }
    : { ...b, oopsUntil: t + 10, proudUntil: 0, lastTitle: label, fails: b.fails + 1 }))
  $.ui.toast(mood === 'done'
    ? `${role.prop} ${label} finished: ${e.description || e.type} (${ago(now - e.startedAt)}, ${e.tools} tools)`
    : `🤕 ${label} could not finish: ${e.description || e.type}`)
}

/** Any sign of life from a specialist (a tool call, a model step): it is heard from now, and a finished one is back at work. */
async function signOfLife($: EngineInterface, id: string, activity?: string) {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  await update($, staff, l => edit(l, id, one => {
    const back = touch(restart(one, now, t), now)
    return activity === undefined ? back : { ...back, activity }
  }))
}

/** An agent the engine lists that no spawn announced (it started before this mod loaded) joins the books. */
const hireFromList = ($: EngineInterface) => (a: { id: string; type: string; description: string; name?: string }) => newHire($, a.id, a.type, a.description, a.name)

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
  const waiting = (await read($, desk)).filter(isWaiting).length
  const parts = [n > 0 ? `🦀 ${n} at desk${n === 1 ? '' : 's'}` : '', waiting > 0 ? `📥 ${waiting} for you` : ''].filter(Boolean)
  $.ui.status(parts.length ? `HQ · ${parts.join(' · ')}` : undefined)
}

// ---- The panes: one per view, so the host's own tab strip switches between them (hooks/panes.ts) ----

const paneIo = ($: EngineInterface): PaneIo => ({
  open: args => $.ui.open(args),
  list: () => $.ui.panes(),
  decisions: async () => (await read($, memory)).length,
})

// ---- The CEO's desk ----

async function fileAsk($: EngineInterface, ask: Omit<Ask, 'id' | 'status' | 'askedAt' | 'isDelivered'>, isQuiet = false): Promise<string> {
  const now = await $.clock.now()
  let id = ''
  await update($, desk, list => {
    const n = list.filter(a => a.kind === ask.kind).length + 1
    id = `${ask.kind === 'decision' ? 'D' : 'Q'}${n}`
    return [...list, { ...ask, id, status: 'open' as const, askedAt: now, isDelivered: false }].slice(-MAX_ASKS)
  })
  if (!isQuiet) {
    $.ui.toast(`📥 ${ask.kind === 'decision' ? 'Decision' : 'Question'} for the CEO from ${ask.from}: ${clip(ask.title, 70)}`)
    void $.ui.open({ id: DESK, title: DESK_TITLE, columns: 60 }).catch(() => undefined)
  }
  await showStatus($)
  return id
}

/** Sends one answer where it is needed: the agent that asked if it still runs, else Clawd's conversation. */
async function deliver($: EngineInterface, ask: Ask): Promise<boolean> {
  if (ask.fromId?.startsWith(DEMO) || ask.source === 'dialog') return true
  if (ask.action === 'payroll') return true
  const text = answerText(ask)
  const asker = ask.fromId ? (await read($, staff)).find(e => e.id === ask.fromId) : undefined
  if (asker && isActive(asker)) {
    await $.session.send({ to: { agentId: asker.id }, text })
    return true
  }
  if ((await getBoss($)).isBusy) {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
    return true
  }
  return false
}

async function answer($: EngineInterface, id: string, value: string, status: 'answered' | 'dismissed' = 'answered') {
  const now = await $.clock.now()
  let picked: Ask | undefined
  await update($, desk, list => list.map(a => {
    if (a.id !== id || !isWaiting(a)) return a
    picked = { ...a, status, answer: value, answeredAt: now }
    return picked
  }))
  const a = picked as Ask | undefined
  if (!a) return
  if (a.action === 'payroll') await applyPayroll($, status === 'answered' && value.startsWith('Lay off'))
  // The question is cut before the answer is, so a long question never pushes the answer out of what is saved.
  else if (status === 'answered' && !a.fromId?.startsWith(DEMO)) await remember($, { kind: 'decision', text: `${fit(a.title, TITLE_CHARS)} → ${fit(value, SAVED_CHARS)}`, by: 'CEO', source: 'desk' })
  const isDelivered = status === 'dismissed' || (await deliver($, a))
  if (isDelivered) await update($, desk, list => list.map(x => (x.id === id ? { ...x, isDelivered: true } : x)))
  const t = await read($, tick)
  await setBoss($, b => ({ ...b, quip: { text: status === 'dismissed' ? 'Noted. Moving on.' : `On it, boss: “${clip(value, 32)}”`, until: t + 8 } }))
  await showStatus($)
}

// ---- Memory: the project's decisions, a plain file in its .clawd-hq folder, mirrored in state for the pane ----

/** Set once a write failed this session, so the person is told once and not on every decision. */
let isLogbookWarned = false

/**
 * The file's text and entries; where there is no file, what this session holds. When the file's state cannot be
 * known (the check or the read failed), it is not safe to write over.
 */
async function loadLogbook($: EngineInterface): Promise<{ text: string; list: Memory[]; isWritable: boolean }> {
  if (!cwd) return { text: '', list: await read($, memory), isWritable: false }
  const path = `${cwd}/${LOGBOOK_FILE}`
  try {
    if (!(await $.fs.exists(path))) return { text: '', list: await read($, memory), isWritable: true }
    const text = await $.fs.read(path)
    return { text, list: fromMarkdown(text, await $.clock.now()), isWritable: true }
  } catch {
    return { text: '', list: await read($, memory), isWritable: false }
  }
}

const loadMemory = async ($: EngineInterface): Promise<Memory[]> => (await loadLogbook($)).list

async function saveMemory($: EngineInterface, fn: (list: Memory[]) => Memory[]) {
  const { text, list: before, isWritable } = await loadLogbook($)
  const list = fn(before).slice(-MAX_MEMORY)
  await update($, memory, () => list)
  if (cwd) {
    try {
      if (!isWritable) throw new Error('the file cannot be read, so it is not written over')
      await $.fs.write(`${cwd}/${LOGBOOK_FILE}`, mergeMarkdown(text, list, await $.clock.now()))
    } catch {
      // The decision stays in this session; the person hears of it once.
      if (!isLogbookWarned) $.ui.toast(`Could not save decisions to ${LOGBOOK_FILE}. They are kept for this session only.`)
      isLogbookWarned = true
    }
  }
  await retitleDecisions(paneIo($))
}

async function remember($: EngineInterface, m: Omit<Memory, 'id' | 'at'>, supersedes?: string) {
  const at = await $.clock.now()
  const text = m.text.replace(/\s+/g, ' ').trim()
  if (!text) return
  await saveMemory($, list => {
    // The same thing said again moves to the end instead of piling up.
    const kept = list.filter(x => x.id !== supersedes && x.text.toLowerCase() !== text.toLowerCase())
    const n = list.reduce((top, x) => Math.max(top, Number(x.id.slice(1)) || 0), 0) + 1
    return [...kept, { ...m, text, id: `M${n}`, at }]
  })
}

/** Answers that reached nobody yet (Clawd was idle): handed over as one prompt. */
async function sendPending($: EngineInterface, isNewTurn: boolean) {
  const pending = (await read($, desk)).filter(a => a.status === 'answered' && !a.isDelivered)
  if (pending.length === 0) return
  const text = 'The CEO answered on the CEO Desk:\n' + pending.map(a => `- ${answerText(a)}`).join('\n')
  if (isNewTurn) await $.prompt.submit({ text: text + '\nCarry on with these.' })
  else await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  const ids = new Set(pending.map(a => a.id))
  await update($, desk, list => list.map(a => (ids.has(a.id) ? { ...a, isDelivered: true } : a)))
}

// ---- Payroll: which agent types Clawd is offered ----

async function projectFiles($: EngineInterface): Promise<string[]> {
  if (!cwd) return []
  const names: string[] = []
  try {
    const top = await $.fs.list(cwd)
    for (const one of top) {
      names.push(one.name)
      if (one.kind === 'dir' && !one.name.startsWith('.') && one.name !== 'node_modules') {
        try { for (const sub of await $.fs.list(`${cwd}/${one.name}`)) names.push(sub.name) } catch { /* unreadable folder */ }
      }
    }
  } catch { /* no project folder */ }
  return names
}

async function knownTypes($: EngineInterface): Promise<string[]> {
  return [...new Set([...Object.keys(await read($, blurbs)), ...Object.keys(await read($, roster))])]
}

async function savePayroll($: EngineInterface, p: Payroll) {
  await update($, payroll, () => p)
  if (cwd) await $.store.set(`payroll:${cwd}`, p)
  // The agent listing is drawn from the offer: ask for it again.
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('prompt.attachment')
}

async function reviewPayroll($: EngineInterface) {
  if (isPayrollFiled || (await getPayroll($)).isReviewed) return
  const types = await knownTypes($)
  if (types.length < 15) return
  isPayrollFiled = true
  const plan = proposeLayoffs(types, await projectFiles($))
  if (plan.laidOff.length === 0) {
    await savePayroll($, { ...(await getPayroll($)), isReviewed: true, stacks: plan.stacks })
    return
  }
  await fileAsk($, {
    kind: 'decision',
    title: `Payroll review: lay off ${plan.laidOff.length} of ${types.length} agent types this project doesn’t use?`,
    detail: `This project is ${plan.stacks.join(' + ') || 'an unknown stack'}. Not needed here: ${plan.why.join(', ')}. ` +
      'Laid-off agents stop being listed to Clawd, which saves context on every turn. You can rehire them in the People tab.',
    options: [`Lay off ${plan.laidOff.length}`, 'Keep everyone'],
    recommend: `Lay off ${plan.laidOff.length}`,
    from: 'Clawd',
    source: 'office',
    action: 'payroll',
  }, true)
}

async function applyPayroll($: EngineInterface, isLayoff: boolean) {
  const types = await knownTypes($)
  const plan = proposeLayoffs(types, await projectFiles($))
  await savePayroll($, { laidOff: isLayoff ? plan.laidOff : [], isReviewed: true, stacks: plan.stacks })
  $.ui.toast(isLayoff ? `📉 ${plan.laidOff.length} agent types laid off for this project. Rehire any from the People tab.` : '👥 Everyone stays on the payroll.')
}

// ---- The frame clock ----

async function onFrame($: EngineInterface, frames: number) {
  const [list, f, b, t0] = [await read($, staff), await getFx($), await getBoss($), await read($, tick)]
  const isLively = list.some(one => isAtDesk(one, t0)) || b.isBusy || f.demo !== undefined ||
    (b.quip !== undefined && t0 < b.quip.until) || t0 < b.waveUntil
  if (frames % 8 === 0) await reconcile($)
  if (frames % 25 === 0) await reviewPayroll($)
  // A quiet office only needs a frame now and then, for blinking and snoring; nothing is written in between.
  if (!isLively && frames % 3 !== 0) return
  const t = await update($, tick, n => n + 1)
  if (list.some(one => one.mood === 'arriving' && t - one.joinedTick >= 3)) {
    await update($, staff, l => l.map(one => (one.mood === 'arriving' && t - one.joinedTick >= 3 ? { ...one, mood: 'thinking' } : one)))
  }
  await showStatus($)
}

// ---- The side panel: a snapshot to draw, and what it may ask for ----

async function panelData($: EngineInterface): Promise<PanelData> {
  return {
    staff: await read($, staff), boss: await getBoss($), fx: await getFx($), tick: await read($, tick), blurbs: await read($, blurbs),
    roster: await read($, roster), asks: await read($, desk), payroll: await getPayroll($), memory: await read($, memory),
    gauge: await read($, gauge), now: await $.clock.now(),
  }
}

async function setLaidOff($: EngineInterface, type: string, isOff: boolean) {
  const p = await getPayroll($)
  const rest = p.laidOff.filter(t => t !== type)
  await savePayroll($, { ...p, laidOff: isOff ? [...rest, type] : rest, isReviewed: true })
}

function panelActions($: EngineInterface): PanelActions {
  return {
    setFind: (tab, text) => setFx($, f => ({ ...f, finds: { ...f.finds, [tab]: text } })),
    openDesk: () => $.ui.open({ id: DESK, title: DESK_TITLE, focus: true, columns: 60 }),
    resume: task => $.prompt.fill({ text: `Pick up where we left off: ${task}` }),
    forget: id => saveMemory($, list => list.filter(x => x.id !== id)),
    layOff: type => setLaidOff($, type, true),
    hire: type => setLaidOff($, type, false),
  }
}

// ---- The header meters: context and rate limits, kept as the engine reports them ----

/** Reads the meters once at session start; where the engine cannot say, the session began now. */
async function startGauge($: EngineInterface) {
  const now = await $.clock.now()
  try {
    const u = await $.session.usage()
    await update($, gauge, () => ({ startedAt: u.startedAt, contextPercent: u.context.percent, limits: limitsOf(u.rateLimits) }))
  } catch {
    await update($, gauge, g => ({ ...g, startedAt: now }))
  }
}

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
    setBusy: () => setBoss($, b => ({ ...b, isBusy: true })),
    say: (text, ticks) => demoSay($, text, ticks),
    hire: (n, type, description) => newHire($, id(n), type, description),
    work: (n, tool, input) => demoWork($, id(n), tool, input),
    ask: (ask, from) => fileAsk($, { ...ask, fromId: id(from) }, true),
    answer: (askId, value) => answer($, askId, value),
    finish: (n, mood) => clockOut($, id(n), mood),
    clearDesk: () => update($, desk, l => l.filter(a => !a.fromId?.startsWith(DEMO))),
    goQuiet: async () => {
      const now = await $.clock.now()
      await setBoss($, b => ({ ...b, isBusy: false, proudUntil: 0, oopsUntil: 0, quip: undefined, idleSince: now - NAP_MS - 1 }))
    },
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
      await update($, desk, l => l.filter(a => !a.fromId?.startsWith(DEMO)))
      await setFx($, f => ({ ...f, demo: undefined }))
      await setBoss($, b => ({ ...saved, turns: b.turns, quip: undefined }))
      await showStatus($)
    })()
  }))
}

export const register: Register = (on, options) => {
  let timer: Timer | undefined
  let isFraming = false
  const brief = optionsOf(options)
  let briefing: Promise<string | undefined> | undefined

  // Clawd's rules and voice join the main chat's instructions: read once, then the same text on every request, so the prompt cache holds.
  on('prompt.compose', async ($, e, next) => {
    const base = await next(e)
    if (!brief.isOn || !isBriefed(e.traits)) return base
    briefing ??= loadBriefing({ root: $.plugin.root, read: path => $.fs.read(path), warn: text => void $.ui.toast(text) }, brief.voiceFile)
    const text = await briefing
    return text === undefined ? base : { sections: [...base.sections, { id: SECTION_ID, scope: 'session', text } as const] }
  })

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    isPayrollFiled = false
    isLogbookWarned = false
    await $.command.register({ name: 'office', description: `Open ${BRAND}, the virtual office of this session’s agents` })
    await $.command.register({ name: 'ceo', description: 'Open the CEO Desk: decisions and questions the agents raised for you' })
    await $.command.register({ name: 'office-demo', description: `Play a one-minute tour of ${BRAND}’s features` })
    await $.tool.register({
      name: 'demo',
      description: `Plays the ${BRAND} office tour in the side panel (about a minute, stand-in employees, nothing real is spawned). Call only when the user asks to see the office demo.`,
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register(ASK_SPEC)

    const saved = (await $.store.get(`payroll:${cwd}`)) as Payroll | undefined
    if (saved) await update($, payroll, () => ({ ...PAYROLL0, ...saved }))
    const recalled = await loadMemory($)
    await update($, memory, () => recalled)
    await $.tool.register(REMEMBER_SPEC)
    await enroll($, 'general-purpose', 0)
    await startGauge($)

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
    void openPanes(paneIo($), false)

    return next(e)
  })

  // The agent's own stop signal, beside turn.complete: whichever comes first ends the run, the second finds it ended.
  on('classic.SubagentStop', async ($, e, next) => {
    await clockOut($, e.agent_id, 'done')
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await openPanes(paneIo($), true)
    return { text: `${BRAND} is open: Office · Decisions · People · Log are the tabs at the top. i opens the CEO Desk.` }
  })

  // The header's context bar and limit countdowns follow the engine's own readings.
  on('session.measure', async ($, e, next) => {
    await update($, gauge, g => ({ ...g, contextPercent: e.context.percent, limits: limitsOf(e.rateLimits) }))
    return next(e)
  })

  // A /clear ends the session without a session.start: from here the Log starts over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      const now = await $.clock.now()
      await update($, gauge, g => ({ ...g, startedAt: now, contextPercent: undefined }))
    }
    return next(e)
  })

  on('command.run', { command: 'ceo' }, async $ => {
    await $.ui.open({ id: DESK, title: DESK_TITLE, focus: true, columns: 60 })
    return { text: 'CEO Desk is open. 1–6 pick an option on the top item · x dismiss it · s send answers to Clawd.' }
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
        await update($, blurbs, m => Object.fromEntries([...Object.entries(m).filter(([k]) => k !== e.agent), [e.agent, blurb]].slice(-MAX_BLURBS)))
      }
      if (!(await read($, roster))[e.agent]) await enrollNow($, e.agent, 0)
    })
    if ((await getPayroll($)).laidOff.includes(e.agent)) return { isOffered: false }
    return next(e)
  })

  // Clawd learns to pick each hire's model and effort.
  for (const tool of ['Agent', 'Task']) {
    on('tool.describe', { tool }, async ($, e, next) => {
      const r = await next(e)
      return { ...r, description: r.description + STAFFING_NOTE }
    })
  }

  on('agent.spawn', async ($, e, next) => {
    // Clawd's [effort: …] line comes off the brief; every agent learns how to raise things for the CEO.
    const { effort, prompt } = parseEffort(e.prompt)
    const r = await next({ ...e, prompt: prompt + recallNote((await loadMemory($)).slice(-RECALL)) + BRIEF_NOTE })
    if (r.agentId) {
      if (effort) efforts.set(r.agentId, effort)
      await newHire($, r.agentId, e.subagentType, e.description, e.name)
      if (effort) await update($, staff, l => edit(l, r.agentId!, one => ({ ...one, effort })))
      await showStatus($)
    }
    return r
  })

  // Each model request of an agent: what it has spent, and how full its context is.
  on('turn.step', async function* ($, e, next) {
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

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.agentId

    if (tool === DEMO_TOOL) {
      await openPanes(paneIo($), false)
      await startDemo($)
      return { result: `The ${BRAND} tour is playing in the side panel for about a minute. If the panel is not visible, the user can type /office.` } as never
    }

    if (tool === ASK_TOOL) {
      const asker = id ? (await read($, staff)).find(one => one.id === id) : undefined
      const from = asker ? labelOf(asker, (await read($, blurbs))[asker.type] ?? '') : 'Clawd'
      const options = Array.isArray(input.options) ? (input.options as unknown[]).map(String).slice(0, 6) : []
      const kind = input.kind === 'decision' && options.length > 1 ? 'decision' : 'question'
      const filed = await fileAsk($, {
        kind, title: String(input.question ?? ''), detail: typeof input.context === 'string' ? input.context : undefined,
        options: kind === 'decision' ? options : [], recommend: typeof input.recommended === 'string' ? input.recommended : undefined,
        fallback: typeof input.default === 'string' ? input.default : undefined,
        from, fromType: asker?.type, fromId: id, source: 'tool',
      })
      return {
        result: `Filed as ${filed} on the CEO Desk. Don't wait for it: carry on with ${typeof input.default === 'string' ? `“${input.default}”` : 'your best call'} and say so; the CEO's answer will arrive as a message.`,
      } as never
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

    // Clawd asking the CEO directly shows on the desk too, answered in the dialog.
    if (tool === 'AskUserQuestion' && id === undefined) {
      const questions = Array.isArray(input.questions) ? (input.questions as Array<{ question?: string; options?: Array<{ label?: string }> }>) : []
      const ids: string[] = []
      for (const q of questions) {
        ids.push(await fileAsk($, {
          kind: (q.options?.length ?? 0) > 1 ? 'decision' : 'question', title: String(q.question ?? ''),
          options: [], from: 'Clawd', source: 'dialog',
        }, true))
      }
      await update($, desk, l => l.map(a => (ids.includes(a.id) ? { ...a, status: 'live' as const } : a)))
      try {
        const ran = await next(e)
        // Each question is saved with its own answer: the box hands them back keyed by the question's text. A reply typed
        // without picking anything stands for a question that has no pick; one left unanswered saves nothing.
        const box = (ran as { result?: { answers?: Record<string, unknown>; response?: unknown } }).result
        for (const [i, one] of ids.entries()) {
          const picked = box?.answers?.[String(questions[i]?.question ?? '')] ?? box?.response
          const said = typeof picked === 'string' ? fit(picked, SAVED_CHARS) : ''
          if (said) await answer($, one, said)
          else await answer($, one, 'no answer', 'dismissed')
        }
        return ran
      } catch (err) {
        for (const one of ids) await answer($, one, 'no answer', 'dismissed')
        throw err
      }
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
  })

  // Clawd's standing orders and the project's memory ride at the top of every conversation.
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const entries = (await loadMemory($)).slice(-RECALL)
    return { ...r, blocks: [...r.blocks, { name: 'clawdMemory', text: memoryBlock(entries) }] }
  })

  on('turn.start', async ($, e, next) => {
    // Kept whole: the resume button puts it back in the prompt box.
    const task = e.text ? fit(e.text, TASK_CHARS) : undefined
    await setBoss($, b => ({ ...b, isBusy: true, turns: b.turns + 1, task: task ?? b.task, activity: task ? READING_BRIEF : 'Back at it' }))
    // Answers the CEO gave while Clawd was idle ride along with the new turn.
    await sendPending($, false)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const asker = (await read($, staff)).find(one => one.id === e.agentId)
      // A report's CEO-DECISION and CEO-QUESTION lines land on the desk.
      const raised = parseReport(e.answer ?? '')
      if (asker && raised.length > 0) {
        const from = labelOf(asker, (await read($, blurbs))[asker.type] ?? '')
        for (const r of raised) await fileAsk($, { ...r, from, fromType: asker.type, fromId: asker.id, source: 'report' })
      }
      // Key choices the agent made itself go into the project's memory.
      if (asker && !asker.id.startsWith(DEMO)) {
        const by = labelOf(asker, (await read($, blurbs))[asker.type] ?? '')
        for (const text of parseChoices(e.answer ?? '')) await remember($, { kind: 'choice', text, by, source: 'report' })
      }
      await clockOut($, e.agentId, e.reason === 'answer' ? 'done' : 'failed')
      await showStatus($)
    } else {
      const now = await $.clock.now()
      await setBoss($, b => ({
        ...b, isBusy: false, idleSince: now, doneAt: now, outcome: e.reason === 'answer' ? 'done' : 'stopped',
        activity: e.reason === 'answer' ? 'All done, boss.' : 'Hmm, that turn stopped early.',
      }))
    }
    return next(e)
  })

  // ---- The band above the prompt: what's waiting for the CEO ----
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const waiting = (await read($, desk)).filter(a => a.status === 'open')
    if (e.props.hasSurvey || waiting.length === 0) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const what = waitingSummary(waiting)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={ACCENT} bold>📥 CEO Desk</Text>
        <Text>{what} waiting:</Text>
        <Text dimColor wrap="truncate">{clip(waiting[0]!.title, Math.max(10, e.props.bodyColumns - what.length - 34))}</Text>
        <Button key="open-desk" label="open" onPress={() => $.ui.open({ id: DESK, title: DESK_TITLE, focus: true, columns: 60 })} />
      </Box>
    )
  })

  // ---- The CEO Desk pane: drawn by desk-pane.tsx ----
  on('ui.render', { component: 'Pane', requestId: DESK }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // Every surface but mobile draws Input; an `in` check on the table always says no.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input
    const data = { list: await read($, desk), boss: await getBoss($), now: await $.clock.now() }
    return renderDesk({ Box, Text, Button, Input }, data, { answer: (id, value, status) => answer($, id, value, status), send: () => sendPending($, true) })
  })

  // ---- The four office panes, one per host tab: drawn by panel.tsx from a snapshot of the state ----
  for (const pane of PANES) {
    on('ui.render', { component: 'Pane', requestId: pane.id }, async ($, e) => {
      const ui = $.ui.resolve(e)
      // Picked by `e.surface`: the resolved table does not answer an `in` check. Input is missing on mobile, Raster is the terminal's, Svg the others'.
      const tools: PanelTools = {
        Box: ui.Box, Text: ui.Text, Button: ui.Button,
        Input: e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input,
        Raster: e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined,
        Svg: e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg,
      }
      const layout = { columns: e.props.bodyColumns, minHeight: pinHeight(e.surface, e.props.placement, e.props.scroll.bodyRows) }
      return renderPanel(tools, layout, await panelData($), panelActions($), pane.view)
    })
  }
}
