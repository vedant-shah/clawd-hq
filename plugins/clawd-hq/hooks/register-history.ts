// The history (hooks/history.ts, hooks/history-io.ts): the calls it is built from, and when records are made and written. One history per
// plugin load. Records wait and go in batches: after a run's end, after each plan tool call, at Clawd's turn end, when a batch is full, a few
// seconds after the first one waits, and (forced, all of them) at the session's end. No hook waits on the disk but the session's end. Runs,
// tool calls, requests and notes are kept with Clawd on or off (the office tracks agents either way); goal records only exist while Clawd
// runs the chat, as the plan does. The demo's stand-ins write nothing.
import type { EngineInterface } from 'claude-code'

import { PLAN_TOOL } from './constants'
import { goalEndRecord, goalStartRecord, ident, isRetryOf, noteRecord, requestRecord, runRecord, toolRecord } from './history'
import type { HistoryRecord, Stamp } from './history'
import { makeHistory, makeTabCache } from './history-io'
import type { History, HistoryIo } from './history-io'
import { DEMO } from './panel-model'
import type { GoalEnd } from './plan-run'
import { goalKey } from './plan-live'
import { withPlanNote } from './plan-run'
import { readArtifacts, readPlan, readStaff, ses, updateStaff } from './register-state'
import { withSkill } from './staff-model'
import { edit } from './state'
import type { Employee } from '../types'

/** Where the history's swallowed failures are kept in the plugin's store (the newest few lines only). */
export const HISTORY_DEBUG_KEY = 'debug:history'
/** How long the first waiting record waits for company. */
const FLUSH_MS = 5_000
/** At most this many batches are written at the session's end, one after another. */
const LAST_BATCHES = 50

let history: History | undefined
let timer: { cancel(): void } | undefined
/** The History tab's records for one folder: read once when the tab first draws, then grown by what this session writes (hooks/history-io.ts). */
let shown = makeTabCache()
/** The most of the newest history files the History tab reads: four rotated files' worth. */
const SHOWN_BYTES = 8 * 1024 * 1024

function historyIo($: EngineInterface): HistoryIo {
  return {
    root: () => ses.cwd, now: () => $.clock.now(),
    exists: path => $.fs.exists(path), read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text),
    list: async path => (await $.fs.list(path)).map(e => ({ name: e.name, kind: e.kind, size: e.size, mtimeMs: e.mtimeMs, isLink: e.isLink })),
    stat: async path => { const s = await $.fs.stat(path, { resolve: true }); return { kind: s.kind, isLink: s.isLink, realPath: s.realPath } },
    isMarked: async key => (await $.store.get(key)) === true, mark: key => $.store.set(key, true),
    debug: async line => { const at = await $.clock.now(); await $.store.set(HISTORY_DEBUG_KEY, withPlanNote(await $.store.get(HISTORY_DEBUG_KEY), line, at)) },
  }
}

function historyOf($: EngineInterface): History {
  history ??= makeHistory(historyIo($), undefined, (root, records) => {
    // What this session wrote joins what the History tab holds; the tab is drawn again only when what it shows changed (no file is read for it).
    if (shown.add(root, records)) $.ui.invalidate('ui.render')
  })
  return history
}

/** The project's history records for the History tab, read once (the newest files, up to a cap) and then kept up to date in memory. */
export function historyRecords($: EngineInterface): Promise<readonly HistoryRecord[]> {
  return shown.get(ses.cwd, () => historyOf($).readRecent(SHOWN_BYTES))
}

/** A line for the history's debug record. */
export async function noteHistory($: EngineInterface, line: string): Promise<void> {
  try {
    const at = await $.clock.now()
    await $.store.set(HISTORY_DEBUG_KEY, withPlanNote(await $.store.get(HISTORY_DEBUG_KEY), line, at))
  } catch {
    // A debug note that cannot be kept is let go.
  }
}

/** The next flush `ms` from now, in place of any already set. */
function flushIn($: EngineInterface, ms: number) {
  timer?.cancel()
  timer = $.clock.after(ms, () => { timer = undefined; void flushHistory($) })
}

/**
 * Writes a batch of what waits, and sets up what follows: more waiting goes next, a failure waits out its backoff. `isForced` (the session's
 * end) writes everything now, batch after batch. The history has a queue of its own, so this never waits on the plugin's other writing.
 */
export async function flushHistory($: EngineInterface, isForced = false): Promise<void> {
  try {
    const h = historyOf($)
    for (let i = 0; i < (isForced ? LAST_BATCHES : 1); i += 1) {
      const how = await h.flush(isForced)
      if (how === 'done') return
      if (how === 'more' && isForced) continue
      if (how === 'more') { void flushHistory($); return }
      flushIn($, Math.max(await h.retryIn(), 1_000))
      return
    }
  } catch {
    // A history that cannot be written never stops what the session is doing.
  }
}

/** Records join the batch: a full batch goes at once, else a short timer sends them. Records made with no project folder are not kept. */
function keep($: EngineInterface, records: readonly HistoryRecord[]) {
  const h = historyOf($)
  h.add(ses.cwd, records)
  if (h.pending() >= 500) void flushHistory($)
  else if (timer === undefined) flushIn($, FLUSH_MS)
}

async function stamp($: EngineInterface, goal?: string): Promise<Stamp> {
  // A host that cannot say the session (none does today, but a test host may not answer) still gets its record, under "unknown".
  const session = await $.session.id().catch(() => 'unknown')
  return { at: await $.clock.now(), session, ...(goal === undefined ? {} : { goal }) }
}
/** The goal's slug in a run's goal key (`<slug>:<started>`). */
const slugOf = (key: string | undefined) => (key === undefined || !key.includes(':') ? undefined : key.slice(0, key.lastIndexOf(':')))
const startOf = (key: string | undefined) => (key === undefined || !key.includes(':') ? 0 : Number(key.slice(key.lastIndexOf(':') + 1)) || 0)
const linked = (one: Employee | undefined) => (one?.planKey !== undefined && one.stepId !== undefined ? one : undefined)

// ---- Runs and notes ----

/** A run that has just ended (run-io.ts `clockOut`): its record. `answer` is its last message where the end came with one. Nothing waits on the disk. */
export async function logRun($: EngineInterface, one: Employee, answer?: string): Promise<void> {
  if (one.id.startsWith(DEMO)) return
  const [staff, plan] = [await readStaff($), await readPlan($)]
  const on = linked(one)
  const step = on && plan !== null && goalKey(plan) === on.planKey ? plan.steps.find(s => s.id === on.stepId) : undefined
  // A retry is judged on this session's books and on the goal's runs in the history, earlier sessions' too.
  const earlier = on ? await historyOf($).readSince(startOf(on.planKey)) : []
  const notes = 0 // DECIDED: the "You should know" check ends after the run; its `note` records count the notes when the history is read.
  keep($, [runRecord(await stamp($, slugOf(on?.planKey)), one, { stepText: step?.text, answer, notes, isRetry: isRetryOf(one, staff, earlier, slugOf(on?.planKey)) })])
  void flushHistory($)
}

/** A "You should know" note raised about a run (`agentId`), or about Clawd's own turn (none): its tag only. */
export async function logNote($: EngineInterface, agentId: string | undefined, tag: string): Promise<void> {
  if (agentId?.startsWith(DEMO)) return
  const one = agentId === undefined ? undefined : (await readStaff($)).find(x => x.id === agentId)
  keep($, [noteRecord(await stamp($, slugOf(linked(one)?.planKey)), { run: agentId, tag })])
}

// ---- Tool calls ----

const isOk = (r: unknown) => typeof r === 'object' && r !== null && (r as { deny?: unknown }).deny === undefined && (r as { isError?: unknown }).isError !== true

/**
 * One tool call, timed: `run` is the plugin's own handling of it and everything beneath. Its record says who, which tool, when and whether it
 * went well; never its input or its output. A Skill call that went well puts the skill on its run.
 */
export async function timedTool<T>($: EngineInterface, e: { tool: unknown; agentId?: string; skill?: unknown }, run: () => Promise<T>): Promise<T> {
  const startedAt = await $.clock.now()
  let ok = false
  try {
    const result = await run()
    ok = isOk(result)
    return result
  } finally {
    await logTool($, e, startedAt, ok).catch(() => undefined)
  }
}

async function logTool($: EngineInterface, e: { tool: unknown; agentId?: string; skill?: unknown }, startedAt: number, ok: boolean) {
  const [tool, id] = [String(e.tool), e.agentId]
  if (id?.startsWith(DEMO)) return
  const one = id === undefined ? undefined : (await readStaff($)).find(x => x.id === id)
  if (id !== undefined && one === undefined) return // an agent that is not ours (the setup scout, an unknown id): not on the books, not in the history
  const skill = ident(e.skill)
  if (one !== undefined && ok && tool === 'Skill' && skill !== undefined) await updateStaff($, l => edit(l, one.id, x => withSkill(x, skill)))
  const on = linked(one)
  const who = one === undefined ? { name: 'Clawd', type: 'main' } : { run: one.id, name: one.name ?? '', type: one.type, step: on?.stepId }
  keep($, [toolRecord(await stamp($, slugOf(on?.planKey)), { ...who, tool, startedAt, endedAt: await $.clock.now(), ok })])
  if (tool === PLAN_TOOL) void flushHistory($)
}

// ---- Model requests ----

type Usage = Parameters<typeof requestRecord>[1]['usage']

/** One model request the host reported usage for; Clawd's (no agent) or one of ours. */
export async function logRequest($: EngineInterface, e: { agentId?: string; model: string; effort?: unknown }, usage: Usage | null | undefined) {
  if (!usage || e.agentId?.startsWith(DEMO)) return
  const one = e.agentId === undefined ? undefined : (await readStaff($)).find(x => x.id === e.agentId)
  if (e.agentId !== undefined && one === undefined) return
  const on = linked(one)
  keep($, [requestRecord(await stamp($, slugOf(on?.planKey)), { run: one?.id, usage, model: e.model, effort: e.effort ?? one?.effort, step: on?.stepId })])
}

// ---- Goals ----

export async function logGoalStart($: EngineInterface, start: { slug: string; title: string; summary?: string; steps: number }) {
  keep($, [goalStartRecord(await stamp($, start.slug), start, 'clawd')])
}

/** The goal's end, once its finish went through: its totals from its runs in the history (earlier sessions' too) and the artifacts published while it ran. */
export async function logGoalEnd($: EngineInterface, end: GoalEnd) {
  const all = await historyOf($).readSince(end.startedAt)
  const runs = all.filter(r => r.kind === 'run' && r.goal === end.slug && r.at <= end.endedAt)
  const artifacts = (await readArtifacts($)).filter(a => a.at >= end.startedAt && a.at <= end.endedAt).map(a => ({ url: a.url, title: a.title }))
  keep($, [goalEndRecord({ ...(await stamp($, end.slug)), at: end.endedAt }, { ...end, runs, artifacts })])
  void flushHistory($)
}

/** When the goal began, from its `goal_start` record in the history; none when there is none (a plan from before the history). */
export async function goalStartedAt($: EngineInterface, slug: string): Promise<number | undefined> {
  const starts = (await historyOf($).readSince(0)).filter(r => r.kind === 'goal_start' && r.goal === slug)
  return starts[starts.length - 1]?.at
}

/** A new plugin load starts a new history; what waited in the old one is written first (as far as the old load can still write). */
export function forgetHistory() {
  const old = history
  timer?.cancel()
  timer = undefined
  history = undefined
  shown = makeTabCache()
  void old?.flush(true).catch(() => undefined)
}
