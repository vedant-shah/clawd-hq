import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Ask, Badge, Boss, Employee, Fx, Memory, Mood, Payroll } from '../types'
import { BRIEF_NOTE, STAFFING_NOTE, answerText, memoryBlock, parseChoices, parseEffort, parseReport, proposeLayoffs, recallNote } from './desk'
import type { Effort } from './desk'
import {
  ACCENT, BRAND, CLAWD_COLOR, CLAWD_LINES, GENERALIST, ROLES, SPIN,
  ago, clip, displayName, fill, hash, lineOf, looksOf, nameFor, roleOf, targetOf, verbOf,
} from './office'
import type { ClawdMood } from './office'
import { GEAR, NIGHTCAP, SHADES, W, ascii, crab, rasterCells, svgOf, sweat } from './pixels'
import type { Frame, Px } from './pixels'

const PANE = 'clawd-hq'
const TITLE = BRAND
const DESK = 'ceo-desk'
const DESK_TITLE = 'CEO Desk'
const FRAME_MS = 400
const CHEER_TICKS = 5
const MAX_STAFF = 30
const MAX_ASKS = 60
const PROMPT_CHARS = 400
const BLURB_CHARS = 200
const MAX_BLURBS = 120
const GONE_MS = 15_000
const NAP_MS = 120_000
// An agent with no tool call or model step for this long gets flagged on Clawd's card.
const QUIET_MS = 5 * 60_000
// A failure stays on Clawd's card this long.
const SICK_MS = 10 * 60_000
const DEMO = 'demo-'
const DEMO_TOOL = 'mcp__clawd-hq__demo'
const ASK_TOOL = 'mcp__clawd-hq__ask_ceo'
const MEM_TOOL = 'mcp__clawd-hq__remember'
// The memory keeps this many entries per project; Clawd and each brief get the newest RECALL.
const MAX_MEMORY = 200
const RECALL = 25
const CLAWD_TIE = { color: '#000000', tie: '#1f3a93' }

const BOSS0: Boss = {
  activity: 'Waiting for the boss…', isBusy: false, waveUntil: 0, turns: 0, proudUntil: 0, oopsUntil: 0,
  lastName: '', lastTitle: '', idleSince: 0, hires: 0, wins: 0, fails: 0,
}
const FX0: Fx = { view: 'office' }
const PAYROLL0: Payroll = { laidOff: [], isReviewed: false, stacks: [] }

const staff = atom({ plugin: 'clawd-hq', key: 'staff' } as const, [] as Employee[])
const boss = atom({ plugin: 'clawd-hq', key: 'boss' } as const, BOSS0)
const fx = atom({ plugin: 'clawd-hq', key: 'fx' } as const, FX0)
const tick = atom({ plugin: 'clawd-hq', key: 'tick' } as const, 0)
const blurbs = atom({ plugin: 'clawd-hq', key: 'blurbs' } as const, {} as Record<string, string>)
const roster = atom({ plugin: 'clawd-hq', key: 'roster' } as const, {} as Record<string, Badge>)
const desk = atom({ plugin: 'clawd-hq', key: 'desk' } as const, [] as Ask[])
const payroll = atom({ plugin: 'clawd-hq', key: 'payroll' } as const, PAYROLL0)
const memory = atom({ plugin: 'clawd-hq', key: 'memory' } as const, [] as Memory[])

// The project the session runs in: payroll is kept per project.
let cwd = ''
let isPayrollFiled = false
// Each agent's effort, set the moment it is hired so its first request already carries it; staff keeps it across reloads.
const efforts = new Map<string, Effort>()

// Values written by an older version of the mod lack the newer fields: fill them in.
async function getBoss($: EngineInterface): Promise<Boss> { return { ...BOSS0, ...(await read($, boss)) } }
async function getFx($: EngineInterface): Promise<Fx> { return { ...FX0, ...(await read($, fx)) } }
async function getPayroll($: EngineInterface): Promise<Payroll> { return { ...PAYROLL0, ...(await read($, payroll)) } }
async function setBoss($: EngineInterface, fn: (b: Boss) => Boss) { await update($, boss, b => fn({ ...BOSS0, ...b })) }
async function setFx($: EngineInterface, fn: (f: Fx) => Fx) { await update($, fx, f => fn({ ...FX0, ...f })) }

const isActive = (e: Employee) => e.mood === 'arriving' || e.mood === 'working' || e.mood === 'thinking'
const isAtDesk = (e: Employee, t: number) => isActive(e) || (e.doneTick !== undefined && t - e.doneTick < CHEER_TICKS)
const isWaiting = (a: Ask) => a.status === 'open' || a.status === 'live'
const fmtTokens = (n = 0) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))

function hire(list: Employee[], fresh: Employee): Employee[] {
  if (list.some(e => e.id === fresh.id)) {
    // A tool call can land before the spawn answers: keep its progress, take the spawn's facts.
    return list.map(e => (e.id === fresh.id ? { ...e, type: fresh.type, description: fresh.description || e.description, prompt: fresh.prompt || e.prompt } : e))
  }
  const all = [...list, fresh]
  // Over the cap, the longest-gone finishers leave first; a running agent is never dropped.
  let extra = all.length - MAX_STAFF
  return extra <= 0 ? all : all.filter(e => (extra > 0 && !isActive(e) ? (extra--, false) : true))
}

function edit(list: Employee[], id: string, fn: (e: Employee) => Employee): Employee[] {
  return list.map(e => (e.id === id ? fn(e) : e))
}

const note = (log: string[], line: string) => [...log, line].slice(-6)

/** Puts a type on the books with a name of its own, kept across sessions in the store. */
async function enroll($: EngineInterface, type: string, jobs: number) {
  const mine = await read($, roster)
  const saved = Object.keys(mine).length === 0 ? ((await $.store.get('roster')) as Record<string, Badge> | undefined) : undefined
  const cur = { ...(saved ?? {}), ...mine }
  if (cur[type] && jobs === 0) {
    if (saved) await update($, roster, () => cur)
    return
  }
  const taken = new Set(Object.values(cur).map(b => b.name))
  const badge = cur[type] ?? { name: nameFor(type, taken), jobs: 0 }
  const next = { ...cur, [type]: { ...badge, jobs: badge.jobs + jobs } }
  await update($, roster, () => next)
  await $.store.set('roster', next)
}

async function newHire($: EngineInterface, id: string, type: string, description: string, prompt: string) {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  const fresh: Employee = { id, type, description, prompt: clip(prompt, PROMPT_CHARS), mood: 'arriving', tools: 0, startedAt: now, joinedTick: t, log: ['walked in'] }
  if ((await read($, staff)).some(e => e.id === id)) {
    await update($, staff, list => hire(list, fresh))
    return
  }
  await enroll($, type, id.startsWith(DEMO) ? 0 : 1)
  await update($, staff, list => hire(list, fresh))
  const role = roleOf(type, ((await read($, blurbs))[type] ?? '') + ' ' + prompt)
  await setBoss($, b => ({ ...b, activity: role.hello, waveUntil: t + 6, hires: b.hires + 1 }))
}

async function clockOut($: EngineInterface, id: string, mood: Mood) {
  const [now, t] = [await $.clock.now(), await read($, tick)]
  // The check sits inside the write, so turn.complete and the reconcile can't both clock one agent out.
  let ended: Employee | undefined
  await update($, staff, l => {
    ended = undefined
    return edit(l, id, one => {
      if (!isActive(one)) return one
      ended = one
      return { ...one, mood, tool: undefined, endedAt: now, doneTick: t, log: note(one.log, mood === 'done' ? 'clocked out ✓' : 'went home sick ✗') }
    })
  })
  const e = ended as Employee | undefined
  if (!e) return
  const role = roleOf(e.type, e.description)
  const name = looksOf(e.type, await read($, roster)).name
  await setBoss($, b => (mood === 'done'
    ? { ...b, proudUntil: t + 10, oopsUntil: 0, lastName: name, lastTitle: role.title, wins: b.wins + 1 }
    : { ...b, oopsUntil: t + 10, proudUntil: 0, lastName: name, lastTitle: role.title, fails: b.fails + 1 }))
  $.ui.toast(mood === 'done'
    ? `${role.prop} ${name} the ${role.title} finished: ${e.description || e.type} (${ago(now - e.startedAt)}, ${e.tools} tools)`
    : `🤕 ${name} the ${role.title} could not finish: ${e.description || e.type}`)
}

// The engine's own list catches agents spawned before this mod loaded, and ends it missed.
async function reconcile($: EngineInterface) {
  const [agents, list, now] = [await $.agent.list(), await read($, staff), await $.clock.now()]
  for (const a of agents) {
    const known = list.find(e => e.id === a.id)
    if (!known && (a.status === 'running' || a.status === 'pending' || a.status === 'waiting')) {
      await newHire($, a.id, a.type, a.description, '')
    } else if (known && a.status === 'completed') {
      await clockOut($, a.id, 'done')
    } else if (known && (a.status === 'failed' || a.status === 'killed')) {
      await clockOut($, a.id, 'failed')
    }
  }
  // The engine drops a finished agent's task after a while; one still at a desk then has finished.
  for (const e of list) {
    if (isActive(e) && !e.id.startsWith(DEMO) && now - e.startedAt > GONE_MS && !agents.some(a => a.id === e.id)) await clockOut($, e.id, 'done')
  }
}

async function showStatus($: EngineInterface) {
  const n = (await read($, staff)).filter(isActive).length
  const waiting = (await read($, desk)).filter(isWaiting).length
  const parts = [n > 0 ? `🦀 ${n} at desk${n === 1 ? '' : 's'}` : '', waiting > 0 ? `📥 ${waiting} for you` : ''].filter(Boolean)
  $.ui.status(parts.length ? `HQ · ${parts.join(' · ')}` : undefined)
}

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
  else if (status === 'answered' && !a.fromId?.startsWith(DEMO)) await remember($, { kind: 'decision', text: `${a.title} → ${value}`, by: 'CEO', source: 'desk' })
  const isDelivered = status === 'dismissed' || (await deliver($, a))
  if (isDelivered) await update($, desk, list => list.map(x => (x.id === id ? { ...x, isDelivered: true } : x)))
  const t = await read($, tick)
  await setBoss($, b => ({ ...b, quip: { text: status === 'dismissed' ? 'Noted. Moving on.' : `On it, boss: “${clip(value, 32)}”`, until: t + 8 } }))
  await showStatus($)
}

// ---- Memory: kept per project in the store, mirrored in state for the pane ----

async function loadMemory($: EngineInterface): Promise<Memory[]> {
  const saved = cwd ? ((await $.store.get(`memory:${cwd}`)) as Memory[] | undefined) : undefined
  return saved ?? (await read($, memory))
}

async function saveMemory($: EngineInterface, fn: (list: Memory[]) => Memory[]) {
  const list = fn(await loadMemory($)).slice(-MAX_MEMORY)
  await update($, memory, () => list)
  if (cwd) await $.store.set(`memory:${cwd}`, list)
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

async function forget($: EngineInterface, id: string) {
  await saveMemory($, list => list.filter(x => x.id !== id))
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
      'Laid-off agents stop being listed to Clawd, which saves context on every turn. You can rehire them in the directory (d).',
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
  $.ui.toast(isLayoff ? `📉 ${plan.laidOff.length} agent types laid off for this project. Rehire any from the directory.` : '👥 Everyone stays on the payroll.')
}

async function toggleDept($: EngineInterface, roleKey: string) {
  const p = await getPayroll($)
  const notes = await read($, blurbs)
  const members = (await knownTypes($)).filter(t => t.includes(':') && roleOf(t, notes[t] ?? '').key === roleKey)
  const isAllOff = members.every(t => p.laidOff.includes(t))
  const laidOff = isAllOff ? p.laidOff.filter(t => !members.includes(t)) : [...new Set([...p.laidOff, ...members])]
  await savePayroll($, { ...p, laidOff, isReviewed: true })
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

function clawdMood(b: Boss, f: Fx, active: number, waiting: number, t: number, now: number): ClawdMood {
  if (t < b.oopsUntil) return 'oops'
  if (t < b.proudUntil) return 'proud'
  if (active >= 4) return 'stressed'
  if (t < b.waveUntil) return 'delegating'
  if (b.isBusy) return 'focused'
  if (waiting > 0) return 'waiting'
  if (active === 0 && b.idleSince > 0 && now - b.idleSince > NAP_MS) return 'sleepy'
  return active > 0 ? 'delegating' : 'chill'
}

function clawdPixels(mood: ClawdMood, t: number): Px[][] {
  const frames: Record<ClawdMood, () => Px[][]> = {
    proud: () => crab(CLAWD_COLOR, 'cheerA', [SHADES, CLAWD_TIE]),
    oops: () => crab(CLAWD_COLOR, 'sad', [CLAWD_TIE]),
    stressed: () => sweat(crab(CLAWD_COLOR, t % 2 ? 'typeA' : 'typeB', [CLAWD_TIE]), t),
    delegating: () => crab(CLAWD_COLOR, t % 2 ? 'cheerA' : 'idle', [CLAWD_TIE]),
    focused: () => crab(CLAWD_COLOR, t % 2 ? 'typeA' : 'typeB', [CLAWD_TIE]),
    waiting: () => crab(CLAWD_COLOR, t % 6 === 0 ? 'blink' : 'idle', [CLAWD_TIE]),
    sleepy: () => crab(CLAWD_COLOR, 'blink', [NIGHTCAP, CLAWD_TIE]),
    chill: () => crab(CLAWD_COLOR, t % 11 === 0 ? 'blink' : 'idle', [CLAWD_TIE]),
  }
  return frames[mood]()
}

function employeePixels(one: Employee, role: string, color: string, t: number): Px[][] {
  const blink = (t + (hash(one.id) % 9)) % 9 === 0
  const cheering = one.doneTick !== undefined && one.mood === 'done'
  const pose: Frame = one.mood === 'failed' ? 'sad'
    : cheering ? (t % 2 ? 'cheerA' : 'cheerB')
      : one.mood === 'arriving' ? (t % 2 ? 'walkA' : 'walkB')
        : one.mood === 'working' ? (t % 2 ? 'typeA' : 'typeB')
          : blink ? 'blink' : 'idle'
  return crab(color, pose, [GEAR[role] ?? GEAR.generalist!])
}

// ---- The demo: a scripted tour with stand-in employees, cleaned up at the end ----

let demoTimers: Timer[] = []

async function demoWork($: EngineInterface, id: string, tool: string, target: string) {
  await update($, staff, l => edit(l, id, one => ({
    ...one, mood: 'working', tool, target, tools: one.tools + 1, tokens: (one.tokens ?? 0) + 18_000 + (hash(target) % 9000),
    log: note(one.log, `${verbOf(tool)} ${target}`),
  })))
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
  let decision = ''

  const steps: Array<[string, () => Promise<void>]> = [
    [`Welcome to ${BRAND}. Clawd is your chief of staff; you are the CEO; every subagent is an employee.`, async () => {
      await setFx($, f => ({ ...f, view: 'office', selected: undefined }))
      await setBoss($, b => ({ ...b, isBusy: true }))
      await demoSay($, 'Welcome to the office! Mind the claws.')
    }],
    ['Hiring: each agent type is a crab of its own, dressed for its role (hard hat, sunglasses, safari hat…).', async () => {
      await newHire($, id('arch'), 'ecc:architect', 'Design the scoring API', 'Design the scoring service for roadmap rank')
    }],
    ['Desks show live work: the tool, the file and the tokens each agent has used.', async () => {
      await demoWork($, id('arch'), 'Read', 'scoring.ts')
      await newHire($, id('scout'), 'Explore', 'Map the backend', 'Find every place that computes a score')
    }],
    ['Each type keeps its name across sessions, and skills show as study time.', async () => {
      await demoWork($, id('scout'), 'Grep', 'computeScore')
      await demoWork($, id('arch'), 'Skill', '📖 api-design')
      await newHire($, id('rev'), 'ecc:code-reviewer', 'Review the survey flow', 'Review the survey lifecycle code')
    }],
    ['Hire too many at once and Clawd starts to sweat.', async () => {
      await newHire($, id('tdd'), 'ecc:tdd-guide', 'Test the review panel', 'Write tests for the review panel')
      await newHire($, id('data'), 'acme-ops:(o_o) data-analyst', 'Crunch the deal data', 'Analyse deal metrics')
      await demoWork($, id('rev'), 'Read', 'surveys.ts')
      await demoWork($, id('arch'), 'Edit', 'design.md')
    }],
    ['Agents raise decisions and questions for you, the CEO. They land on the CEO Desk (i) and the band above the prompt.', async () => {
      decision = await fileAsk($, {
        kind: 'decision', title: 'Store scores in DynamoDB or Postgres?', detail: 'Scores are read per survey, written once a day.',
        options: ['DynamoDB', 'Postgres'], recommend: 'DynamoDB', fallback: 'carrying on with DynamoDB',
        from: looksOf('ecc:architect', await read($, roster)).name + ' the Architect', fromType: 'ecc:architect', fromId: id('arch'), source: 'tool',
      }, true)
      await fileAsk($, {
        kind: 'question', title: 'Which quarter should the deal report cover?', options: [],
        from: looksOf('acme-ops:(o_o) data-analyst', await read($, roster)).name + ' the Analyst', fromId: id('data'), source: 'report',
      }, true)
      await demoWork($, id('tdd'), 'Bash', 'npm test')
    }],
    ['Agents don’t wait on you: they carry on with their recommended option until you answer.', async () => {
      await setFx($, f => ({ ...f, selected: id('arch') }))
      await demoWork($, id('data'), 'Read', 'deals.csv')
    }],
    ['You decide; the answer goes straight back to the agent who asked.', async () => {
      if (decision) await answer($, decision, 'DynamoDB')
      await setFx($, f => ({ ...f, selected: undefined }))
    }],
    ['When an agent fails, it goes home sick and Clawd reacts.', async () => {
      await clockOut($, id('tdd'), 'failed')
    }],
    ['Finishers cheer, then take a coffee in the break room.', async () => {
      await clockOut($, id('arch'), 'done')
      await clockOut($, id('scout'), 'done')
    }],
    ['The directory (d) is the payroll: departments, who’s hired and who’s laid off for this project.', async () => {
      await setFx($, f => ({ ...f, view: 'directory' }))
    }],
    ['Leave the office quiet for 2 minutes and Clawd puts on his nightcap.', async () => {
      await setFx($, f => ({ ...f, view: 'office' }))
      await clockOut($, id('rev'), 'done')
      await clockOut($, id('data'), 'done')
      await update($, desk, l => l.filter(a => !a.fromId?.startsWith(DEMO)))
      const now = await $.clock.now()
      await setBoss($, b => ({ ...b, isBusy: false, proudUntil: 0, oopsUntil: 0, quip: undefined, idleSince: now - NAP_MS - 1 }))
    }],
    ['That’s the tour! The demo staff are heading home.', async () => {
      await demoSay($, 'Thanks for visiting. Now, back to work!', 12)
    }],
  ]

  const total = steps.length
  steps.forEach(([caption, run], i) => {
    demoTimers.push($.clock.after(i * 5000, () => {
      void (async () => {
        await setFx($, f => ({ ...f, demo: { step: i + 1, total, caption } }))
        await run()
      })()
    }))
  })
  demoTimers.push($.clock.after(total * 5000 + 1500, () => {
    void (async () => {
      await update($, staff, l => l.filter(e => !e.id.startsWith(DEMO)))
      await update($, desk, l => l.filter(a => !a.fromId?.startsWith(DEMO)))
      await setFx($, f => ({ ...f, demo: undefined, selected: undefined, view: 'office' }))
      await setBoss($, b => ({ ...saved, turns: b.turns, quip: undefined }))
      await showStatus($)
    })()
  }))
}

export const register: Register = on => {
  let timer: Timer | undefined
  let isFraming = false

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    isPayrollFiled = false
    await $.command.register({ name: 'office', description: `Open ${BRAND}, the virtual office of this session’s agents` })
    await $.command.register({ name: 'ceo', description: 'Open the CEO Desk: decisions and questions the agents raised for you' })
    await $.command.register({ name: 'office-demo', description: `Play a one-minute tour of ${BRAND}’s features` })
    await $.tool.register({
      name: 'demo',
      description: `Plays the ${BRAND} office tour in the side panel (about a minute, stand-in employees, nothing real is spawned). Call only when the user asks to see the office demo.`,
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'ask_ceo',
      description:
        'File a decision or question for the user (the CEO) on the CEO Desk without stopping work. ' +
        'Use it for choices that are the user’s to make but need not block you: say what you will do meanwhile (`default`), carry on, ' +
        'and the answer arrives later as a message. For a choice you cannot proceed without, ask directly instead.',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['decision', 'question'] },
          question: { type: 'string', description: 'One line, ending in a question mark.' },
          context: { type: 'string', description: 'Why it matters, a sentence or two.' },
          options: { type: 'array', items: { type: 'string' }, description: 'For a decision: 2–6 short options.' },
          recommended: { type: 'string', description: 'The option you recommend.' },
          default: { type: 'string', description: 'What you will do until the CEO answers.' },
        },
        required: ['kind', 'question'],
      },
    })

    const saved = (await $.store.get(`payroll:${cwd}`)) as Payroll | undefined
    if (saved) await update($, payroll, () => ({ ...PAYROLL0, ...saved }))
    const recalled = await loadMemory($)
    await update($, memory, () => recalled)
    await $.tool.register({
      name: 'remember',
      description:
        'Record a decision the user made, or a key choice they confirmed, so the office follows it in this and later sessions ' +
        '(it lands in the project memory every agent brief carries). One decision per call, stated as the outcome. ' +
        'Not for routine progress, and not for the CEO Desk’s answers, which are recorded already.',
      inputSchema: {
        type: 'object',
        properties: {
          decision: { type: 'string', description: 'The decision as one line, e.g. “Scores live in Postgres, not DynamoDB”.' },
          supersedes: { type: 'string', description: 'The memory id (M12) this replaces, when the user changed an earlier decision.' },
        },
        required: ['decision'],
      },
    })
    await enroll($, 'general-purpose', 0)

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
    void $.ui.open({ id: PANE, title: TITLE, columns: 60 }).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, columns: 60 })
    return { text: `${BRAND} is open. 1–9 pick · i CEO Desk · d payroll · m memory · c send break room home.` }
  })

  on('command.run', { command: 'ceo' }, async $ => {
    await $.ui.open({ id: DESK, title: DESK_TITLE, focus: true, columns: 60 })
    return { text: 'CEO Desk is open. 1–6 pick an option on the top item · x dismiss it · s send answers to Clawd.' }
  })

  on('command.run', { command: 'office-demo' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, columns: 60 })
    await startDemo($)
    return { text: `The ${BRAND} tour is playing in the side panel (about a minute).` }
  })

  // Instruction-aware: remember what each agent type is for, put it on the books, and keep laid-off types off the listing.
  on('agent.offer', async ($, e, next) => {
    const blurb = clip(e.description, BLURB_CHARS)
    if ((await read($, blurbs))[e.agent] !== blurb) {
      await update($, blurbs, m => Object.fromEntries([...Object.entries(m).filter(([k]) => k !== e.agent), [e.agent, blurb]].slice(-MAX_BLURBS)))
    }
    if (!(await read($, roster))[e.agent]) await enroll($, e.agent, 0)
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
      await newHire($, r.agentId, e.subagentType, e.description, prompt)
      if (effort) await update($, staff, l => edit(l, r.agentId!, one => ({ ...one, effort })))
      await showStatus($)
    }
    return r
  })

  // Each model request of an agent: what it has spent, and how full its context is.
  on('turn.step', async function* ($, e, next) {
    const effort = e.agentId ? efforts.get(e.agentId) ?? (await read($, staff)).find(one => one.id === e.agentId)?.effort : undefined
    const result = yield* next(effort ? { ...e, effort } : e)
    const u = result.usage
    if (!e.agentId || !u) return result
    const context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0)
    const at = await $.clock.now()
    await update($, staff, l => edit(l, e.agentId!, one => ({
      ...one, model: u.model || e.model, context, tokens: (one.tokens ?? 0) + context, lastAt: at,
    })))
    return result
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.agentId

    if (tool === DEMO_TOOL) {
      await $.ui.open({ id: PANE, title: TITLE, columns: 60 })
      await startDemo($)
      return { result: `The ${BRAND} tour is playing in the side panel for about a minute. If the panel is not visible, the user can type /office.` } as never
    }

    if (tool === ASK_TOOL) {
      const asker = id ? (await read($, staff)).find(one => one.id === id) : undefined
      const books = await read($, roster)
      const from = asker ? `${looksOf(asker.type, books).name} the ${roleOf(asker.type).title}` : 'Clawd'
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
      const decision = String(input.decision ?? '')
      // A subagent's call is its own note, never the user's decision.
      const caller = id ? (await read($, staff)).find(one => one.id === id) : undefined
      const by = caller ? `${looksOf(caller.type, await read($, roster)).name} the ${roleOf(caller.type).title}` : 'agent'
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
        const said = clip(String((ran as { text?: string }).text ?? 'answered').replace(/\s+/g, ' '), 140)
        for (const one of ids) await answer($, one, said)
        return ran
      } catch (err) {
        for (const one of ids) await answer($, one, 'no answer', 'dismissed')
        throw err
      }
    }

    const target = targetOf(input)
    if (id === undefined) {
      if (tool !== 'Agent' && tool !== 'Task') await setBoss($, b => ({ ...b, activity: `${verbOf(tool)} ${target}`.trim() }))
      return next(e)
    }

    if (!(await read($, staff)).some(one => one.id === id)) {
      const a = (await $.agent.list()).find(one => one.id === id)
      await newHire($, id, a?.type ?? 'general-purpose', a?.description ?? '', '')
    }
    const at = await $.clock.now()
    await update($, staff, l => edit(l, id, one => ({
      ...one, mood: one.mood === 'arriving' ? 'arriving' : 'working', tool, target, tools: one.tools + 1, lastAt: at,
      log: note(one.log, `${verbOf(tool)} ${target}`.trim()),
    })))
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
    const task = e.text ? clip(e.text.replace(/\s+/g, ' '), 60) : undefined
    await setBoss($, b => ({ ...b, isBusy: true, turns: b.turns + 1, task: task ?? b.task, activity: task ? 'Reading the brief' : 'Back at it' }))
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
        const from = `${looksOf(asker.type, await read($, roster)).name} the ${roleOf(asker.type).title}`
        for (const r of raised) await fileAsk($, { ...r, from, fromType: asker.type, fromId: asker.id, source: 'report' })
      }
      // Key choices the agent made itself go into the project's memory.
      if (asker && !asker.id.startsWith(DEMO)) {
        const by = `${looksOf(asker.type, await read($, roster)).name} the ${roleOf(asker.type).title}`
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
    const d = waiting.filter(a => a.kind === 'decision').length
    const q = waiting.length - d
    const what = [d ? `${d} decision${d === 1 ? '' : 's'}` : '', q ? `${q} question${q === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={ACCENT} bold>📥 CEO Desk</Text>
        <Text>{what} waiting:</Text>
        <Text dimColor wrap="truncate">{clip(waiting[0]!.title, Math.max(10, e.props.bodyColumns - what.length - 34))}</Text>
        <Button key="open-desk" label="open" onPress={() => $.ui.open({ id: DESK, title: DESK_TITLE, focus: true, columns: 60 })} />
      </Box>
    )
  })

  // ---- The CEO Desk pane ----
  on('ui.render', { component: 'Pane', requestId: DESK }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const [list, b, now] = [await read($, desk), await getBoss($), await $.clock.now()]
    const open = list.filter(isWaiting)
    const pending = list.filter(a => a.status === 'answered' && !a.isDelivered)
    const done = list.filter(a => !isWaiting(a)).slice(-8).reverse()
    // Every surface but mobile draws Input; an `in` check on the table always says no.
    const Input = e.surface === 'mobile' ? undefined : $.ui.resolve(e).Input

    const item = (a: Ask, i: number) => {
      const isTop = i === 0
      return (
        <Box key={`ask-${a.id}`} borderStyle={isTop ? 'double' : 'round'} borderColor={a.kind === 'decision' ? ACCENT : '#ffdb00'} paddingX={1} flexDirection="column" marginBottom={1}>
          <Text dimColor wrap="truncate">{a.id} · {a.kind === 'decision' ? 'DECISION' : 'QUESTION'} · from {a.from} · {ago(now - a.askedAt)} ago</Text>
          <Text bold wrap="wrap">{a.title}</Text>
          {a.detail !== undefined && <Text dimColor wrap="wrap">{a.detail}</Text>}
          {a.recommend !== undefined && <Text color="green" wrap="wrap">★ Recommends: {a.recommend}</Text>}
          {a.fallback !== undefined && <Text dimColor wrap="wrap">Meanwhile: {a.fallback}</Text>}
          {a.status === 'live'
            ? <Text color="yellow">↳ Clawd is asking you this now. Answer in the dialog below the transcript.</Text>
            : (
              <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
                {a.kind === 'decision' && a.options.map((o, n) => (
                  <Button key={`opt-${a.id}-${n}`} hotkey={isTop ? String(n + 1) : undefined} variant={o === a.recommend ? 'primary' : undefined}
                    label={o === a.recommend ? `${o} ★` : o} onPress={() => answer($, a.id, o)} />
                ))}
                {a.kind === 'question' && Input && (
                  <Input key={`in-${a.id}`} placeholder="Type your answer, Enter to send" submitLabel="answer" onSubmit={value => (value.trim() ? answer($, a.id, value.trim()) : undefined)} />
                )}
                <Button key={`dismiss-${a.id}`} hotkey={isTop ? 'x' : undefined} dimColor label="dismiss" onPress={() => answer($, a.id, 'dismissed', 'dismissed')} />
              </Box>
            )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={ACCENT}>CEO DESK</Text>
          <Text dimColor>{open.length} waiting · {list.filter(a => a.status === 'answered').length} decided</Text>
        </Box>
        <Text dimColor wrap="wrap">The agents keep working while these wait. Your answer goes back to whoever asked.</Text>
        <Box marginTop={1} flexDirection="column">
          {open.length === 0 && <Text dimColor>Nothing waiting for you. Clawd has it handled. ☕</Text>}
          {open.map(item)}
        </Box>
        {pending.length > 0 && (
          <Box flexDirection="row" gap={1}>
            <Text color="yellow">{pending.length} answer{pending.length === 1 ? '' : 's'} not yet sent{b.isBusy ? '' : ' (Clawd is idle)'}.</Text>
            <Button key="send" hotkey="s" variant="primary" label="send to Clawd now" onPress={() => sendPending($, true)} />
          </Box>
        )}
        {done.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold dimColor>DECISION LOG</Text>
            {done.map(a => (
              <Text wrap="truncate">
                <Text color={a.status === 'dismissed' ? undefined : 'green'} dimColor={a.status === 'dismissed'}>{a.status === 'dismissed' ? '–' : '✓'} {a.id}</Text>
                <Text> {clip(a.title, 40)}</Text>
                <Text dimColor> → {a.answer} · {a.from}</Text>
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })

  // ---- The office pane ----
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const [list, b, f, t, notes, books, asks, pay, now] = [
      await read($, staff), await getBoss($), await getFx($), await read($, tick), await read($, blurbs),
      await read($, roster), await read($, desk), await getPayroll($), await $.clock.now(),
    ]
    const remembered = await read($, memory)
    const cw = Math.max(24, e.props.bodyColumns)
    const desks = list.filter(one => isAtDesk(one, t))
    const lounge = list.filter(one => !isAtDesk(one, t))
    const active = list.filter(isActive).length
    const waiting = asks.filter(isWaiting)
    const roster9 = [...desks, ...lounge].slice(0, 9)
    const selected = list.find(one => one.id === f.selected)
    const blurbOf = (one: Employee) => (notes[one.type] ?? '') + ' ' + one.prompt
    const nameOf = (one: Employee) => displayName(one, list, books)
    const totalTokens = list.reduce((n, one) => n + (one.tokens ?? 0), 0)

    // A crab drawn the best way the surface can: pixels on the terminal, an SVG on the desktop, text elsewhere.
    // Picked by `e.surface`: the resolved table does not answer an `in` check, so probing it fell through to text.
    // `scale` is CSS pixels per pixel where the surface draws SVG; the terminal's cells are fixed.
    const art = (key: string, g: Px[][], color: string, label: string, scale = 4) => {
      const [gw, gh] = [g[0]?.length ?? 0, g.length]
      if (e.surface === 'terminal') {
        const { Raster } = $.ui.resolve(e)
        return <Raster key={key} columns={gw} rows={Math.ceil(gh / 2)} cells={rasterCells(g)} />
      }
      const { Svg } = $.ui.resolve(e)
      if (Svg) return <Svg source={svgOf(g, scale)} alt={label} width={gw * scale} height={gh * scale} />
      return <Box flexDirection="column">{ascii(g).map(row => <Text color={color}>{row}</Text>)}</Box>
    }

    // ---- Clawd's corner office ----
    const mood = clawdMood(b, f, active, waiting.length, t, now)
    const vars = { name: b.lastName, title: b.lastTitle, n: active, q: waiting.length }
    const said = b.quip && t < b.quip.until
      ? b.quip.text
      : fill(lineOf(CLAWD_LINES[mood], Math.floor(t / 20) + (mood === 'proud' || mood === 'oops' ? 0 : hash(mood))), vars)
    const atDesks = desks.filter(one => !one.doneTick).length
    const shuffle = mood === 'focused' || mood === 'stressed' ? (t % 4 < 2 ? 0 : 1) : 0
    // Too narrow for Clawd and his notes side by side: stack them.
    const isNarrow = cw < 44
    const bubbleColor = '#5a6b80'

    // The card answers "do I need to do anything?" first; the joke comes last.
    const real = list.filter(one => !one.id.startsWith(DEMO))
    const quiet = real.filter(one => isActive(one) && now - (one.lastAt ?? one.startedAt) > QUIET_MS)
    const sick = real.filter(one => one.mood === 'failed' && now - (one.endedAt ?? 0) < SICK_MS)
    const decisions = waiting.filter(a => a.kind === 'decision').length
    const questions = waiting.length - decisions
    const needs = [
      decisions ? `📥 ${decisions} decision${decisions === 1 ? '' : 's'}` : '',
      questions ? `${decisions ? '' : '📥 '}${questions} question${questions === 1 ? '' : 's'}` : '',
      quiet[0] ? `⚠ ${nameOf(quiet[0])} quiet ${ago(now - (quiet[0].lastAt ?? quiet[0].startedAt))}${quiet.length > 1 ? ` +${quiet.length - 1}` : ''}` : '',
      sick[0] ? `🤕 ${nameOf(sick[0])} failed${sick.length > 1 ? ` +${sick.length - 1}` : ''}` : '',
    ].filter(Boolean)
    const working = real.filter(isActive)
    const busyLine = `${SPIN[t % SPIN.length]} ${b.activity}`
    const headline = needs.length ? needs.join(' · ')
      : b.isBusy ? busyLine
        : working.length ? `${working.length} agent${working.length === 1 ? '' : 's'} working`
          : '✓ All clear'
    const headColor = needs.length ? 'yellow' : b.isBusy || working.length ? undefined : 'green'
    const lastTask = b.task ? `“${b.task}”${b.outcome === 'stopped' ? ' · stopped early' : ''}` : ''
    const detail = b.isBusy ? (needs.length ? busyLine : lastTask ? `On ${lastTask}` : '')
      : working.length ? working.slice(0, 2).map(one => `${nameOf(one)}: ${one.mood === 'working' ? `${verbOf(one.tool ?? '')} ${one.target ?? ''}`.trim() : 'thinking'}`).join(' · ')
        : b.doneAt ? ''
          : 'Nothing on the go yet. Hand Clawd a task to get started.'
    const canResume = !b.isBusy && working.length === 0 && b.task !== undefined

    const stats = `${atDesks} at desks · ${lounge.length} on break · ${fmtTokens(totalTokens)} tokens`

    // The hero card: the brand on top, Clawd and what needs the user below, all in one frame.
    const hero = (
      <Box borderStyle="round" borderColor={ACCENT} paddingX={1} flexDirection="column">
        <Box flexDirection={isNarrow ? 'column' : 'row'} justifyContent="space-between" alignItems={isNarrow ? 'flex-start' : 'center'}>
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text bold color={ACCENT}>{BRAND.toUpperCase()}</Text>
          </Box>
          <Text dimColor wrap="truncate">{stats}</Text>
        </Box>
        <Box flexDirection={isNarrow ? 'column' : 'row'} gap={2} marginTop={1} alignItems={isNarrow ? 'flex-start' : 'center'}>
          <Box flexShrink={0} paddingLeft={shuffle}>
            {art('clawd', clawdPixels(mood, t), CLAWD_COLOR, `Clawd, ${mood}`, 7)}
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text bold>Clawd <Text dimColor>· Chief of Staff</Text></Text>
            <Text bold color={headColor} wrap="truncate">{headline}</Text>
            {detail !== '' && <Text dimColor wrap="truncate">{detail}</Text>}
            <Box flexDirection="row" alignItems="center" marginTop={1}>
              <Text color={bubbleColor}>◀</Text>
              <Box borderStyle="round" borderColor={bubbleColor} paddingX={1} flexShrink={1}>
                <Text italic color={mood === 'oops' ? 'red' : mood === 'proud' ? 'green' : undefined} wrap="wrap">{said}</Text>
              </Box>
            </Box>
            {(quiet[0] || canResume) && (
              <Box flexDirection="row" columnGap={1} marginTop={1}>
                {quiet[0] && (
                  <Button key="check-quiet" label={`check on ${nameOf(quiet[0])}`}
                    onPress={() => setFx($, x => ({ ...x, view: 'office', selected: quiet[0]!.id }))} />
                )}
                {canResume && (
                  <Button key="resume" label={b.outcome === 'stopped' ? 'retry last task' : 'pick up where we left off'}
                    onPress={() => $.prompt.fill({ text: `Pick up where we left off: ${b.task}` })} />
                )}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    )

    // ---- A desk: the crab on top, its work below ----
    const across = Math.max(1, Math.floor((cw + 1) / 19))
    const cardW = Math.max(18, Math.floor((cw - (across - 1)) / across))
    const infoW = cardW - 4
    const card = (one: Employee) => {
      const look = looksOf(one.type, books)
      const role = roleOf(one.type, blurbOf(one))
      const isCheering = one.doneTick !== undefined
      const line3 = one.mood === 'arriving'
        ? 'walking in…'
        : isCheering ? (one.mood === 'failed' ? 'oh no ✗' : 'DONE! ✓')
          : one.mood === 'working' ? `${SPIN[t % SPIN.length]} ${verbOf(one.tool ?? '')}`
            : `💭 thinking${'.'.repeat(t % 4)}`
      const line4 = one.mood === 'working' ? one.target ?? '' : `${ago((one.endedAt ?? now) - one.startedAt)} · ${one.tools} tools · ${fmtTokens(one.tokens)}`
      const asks1 = waiting.filter(a => a.fromId === one.id).length
      const slide = one.mood === 'arriving' ? Math.max(0, 3 - (t - one.joinedTick)) : 0

      return (
        <Box key={`desk-${one.id}`} width={cardW} borderStyle={one.id === f.selected ? 'double' : 'round'} borderColor={look.color} paddingX={1} flexDirection="column">
          <Box flexDirection="row" justifyContent="center" paddingLeft={slide}>
            {art(`crab-${one.id}`, employeePixels(one, role.key, look.color, t), look.color, `${look.name} the ${role.title}`)}
          </Box>
          <Text bold color={look.color} wrap="truncate">{nameOf(one)}{asks1 ? ' 📥' : ''}</Text>
          <Text wrap="truncate">{clip(`${role.prop} ${role.title}`, infoW)}</Text>
          <Text color={isCheering ? (one.mood === 'failed' ? 'red' : 'green') : undefined} wrap="truncate">{line3}</Text>
          <Text dimColor wrap="truncate">{clip(line4, infoW)}</Text>
        </Box>
      )
    }

    // ---- The memory: what the project has settled, newest first ----
    const memoryView = () => (
      <Box flexDirection="column">
        <Text bold dimColor>MEMORY · {remembered.length} settled · every brief carries the newest {RECALL}</Text>
        {remembered.length === 0 && <Text dimColor wrap="wrap">Nothing yet. Decisions you make on the desk, and key choices agents report back, land here.</Text>}
        {remembered.slice(-15).reverse().map(m => (
          <Box key={`mem-${m.id}`} flexDirection="row" justifyContent="space-between" marginTop={1}>
            <Box flexDirection="column" flexShrink={1}>
              <Text wrap="wrap">{m.kind === 'decision' ? '⚖' : '✎'} {m.text}</Text>
              <Text dimColor wrap="truncate">{m.id} · {m.by} · {ago(now - m.at)} ago</Text>
            </Box>
            <Button key={`forget-${m.id}`} plain dimColor label="forget" onPress={() => forget($, m.id)} />
          </Box>
        ))}
      </Box>
    )

    // ---- The directory, which is the payroll: departments, who's hired, who's laid off ----
    const directory = () => {
      const types = [...new Set([...Object.keys(notes), ...Object.keys(books), ...list.map(one => one.type)])]
      const off = new Set(pay.laidOff)
      const groups = [...ROLES, GENERALIST]
        .map(role => ({ role, members: types.filter(type => roleOf(type, notes[type] ?? '').key === role.key).sort() }))
        .filter(g => g.members.length > 0)
      const onPayroll = types.filter(type => !off.has(type)).length
      return (
        <Box flexDirection="column">
          <Text bold dimColor>PAYROLL · {onPayroll} on payroll · {off.size} laid off · {groups.length} departments</Text>
          {pay.stacks.length > 0 && <Text dimColor>This project: {pay.stacks.join(' + ')}</Text>}
          {groups.map(({ role, members }) => {
            const hired = members.filter(m => !off.has(m))
            const canToggle = members.some(m => m.includes(':'))
            return (
              <Box flexDirection="column" marginTop={1}>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text bold>{role.prop} {role.title} <Text dimColor>· {hired.length}/{members.length} hired</Text></Text>
                  {canToggle && (
                    <Button key={`dept-${role.key}`} plain dimColor label={hired.length === 0 ? 'rehire' : 'lay off'} onPress={() => toggleDept($, role.key)} />
                  )}
                </Box>
                <Text wrap="wrap">
                  {members.map(type => {
                    const look = looksOf(type, books)
                    const jobs = books[type]?.jobs ?? 0
                    return off.has(type)
                      ? <Text dimColor strikethrough>{look.name} </Text>
                      : <Text color={look.color}>{look.name}{jobs > 0 ? `·${jobs}` : ''} </Text>
                  })}
                </Text>
              </Box>
            )
          })}
          <Box marginTop={1}>
            <Button key="review" plain dimColor label="run a payroll review" onPress={async () => {
              isPayrollFiled = false
              await savePayroll($, { ...(await getPayroll($)), isReviewed: false })
              await reviewPayroll($)
            }} />
          </Box>
        </Box>
      )
    }

    const cloudX = t % Math.max(1, cw - 8)

    return (
      <Box flexDirection="column">
        {f.demo && (
          <Box borderStyle="single" borderColor="yellow" paddingX={1}>
            <Text color="yellow" wrap="wrap">🎬 {f.demo.step}/{f.demo.total} · {f.demo.caption}</Text>
          </Box>
        )}

        {hero}

        {waiting.length > 0 && (
          <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold color="yellow">📥 FOR THE CEO · {waiting.length}</Text>
              <Button key="desk" hotkey="i" plain label="open desk" onPress={() => $.ui.open({ id: DESK, title: DESK_TITLE, focus: true, columns: 60 })} />
            </Box>
            {waiting.slice(0, 3).map(a => (
              <Text wrap="truncate"><Text dimColor>{a.id}</Text> {a.title} <Text dimColor>· {a.from}</Text></Text>
            ))}
          </Box>
        )}

        {f.view === 'directory' ? directory() : f.view === 'memory' ? memoryView() : (
          <Box flexDirection="column">
            <Text bold dimColor>THE FLOOR</Text>
            {desks.length === 0
              ? (
                <Box flexDirection="column">
                  <Text dimColor>{' '.repeat(cloudX)}☁</Text>
                  <Text dimColor>Quiet in here. Ask Clawd to delegate something!</Text>
                </Box>
              )
              : <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{desks.map(card)}</Box>}

            {lounge.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold dimColor>BREAK ROOM</Text>
                {lounge.slice(-5).map(one => {
                  const look = looksOf(one.type, books)
                  const sip = (t + look.blink) % 6 === 0 ? '☕~' : '☕ '
                  return (
                    <Text wrap="truncate">
                      <Text color={look.color}>{one.mood === 'failed' ? '🤕' : sip} {nameOf(one)}</Text>
                      <Text dimColor> {clip(one.description || one.type, Math.max(4, cw - 36))} · {ago((one.endedAt ?? now) - one.startedAt)} · {fmtTokens(one.tokens)}</Text>
                    </Text>
                  )
                })}
              </Box>
            )}

            {selected && (
              <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={looksOf(selected.type, books).color} paddingX={1}>
                <Text bold color={looksOf(selected.type, books).color}>
                  {nameOf(selected)} the {roleOf(selected.type, blurbOf(selected)).title} <Text dimColor>({selected.type})</Text>
                </Text>
                <Text wrap="wrap">Task: {selected.description || '—'}</Text>
                {(notes[selected.type] ?? '') !== '' && <Text dimColor wrap="truncate">Hired for: {notes[selected.type]}</Text>}
                {selected.prompt !== '' && <Text dimColor wrap="truncate">Brief: {selected.prompt.replace(/\s+/g, ' ')}</Text>}
                <Text dimColor wrap="truncate">
                  {selected.model ? `${selected.model} · ` : ''}{selected.effort ? `${selected.effort} effort · ` : ''}{fmtTokens(selected.tokens)} tokens{selected.context ? ` · context ${fmtTokens(selected.context)}` : ''}
                  {(books[selected.type]?.jobs ?? 0) > 1 ? ` · veteran of ${books[selected.type]?.jobs} jobs` : ''}
                </Text>
                {selected.log.slice(-4).map(line => <Text dimColor wrap="truncate">• {line}</Text>)}
              </Box>
            )}
          </Box>
        )}

        <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
          {f.view === 'office' && roster9.map((one, i) => (
            <Button key={`pick-${one.id}`} hotkey={String(i + 1)} plain dimColor={one.id !== f.selected} label={nameOf(one)}
              onPress={() => setFx($, x => ({ ...x, selected: x.selected === one.id ? undefined : one.id }))} />
          ))}
          <Button key="directory" hotkey="d" plain label={f.view === 'directory' ? 'office' : 'payroll'} onPress={() =>
            setFx($, x => ({ ...x, view: x.view === 'directory' ? 'office' : 'directory' }))} />
          <Button key="memory" hotkey="m" plain label={f.view === 'memory' ? 'office' : `memory${remembered.length ? ` (${remembered.length})` : ''}`} onPress={() =>
            setFx($, x => ({ ...x, view: x.view === 'memory' ? 'office' : 'memory' }))} />
          <Button key="home" hotkey="c" plain label="send home" onPress={async () => {
            const t2 = await read($, tick)
            await update($, staff, l => l.filter(one => isAtDesk(one, t2)))
          }} />
        </Box>
      </Box>
    )
  })
}
