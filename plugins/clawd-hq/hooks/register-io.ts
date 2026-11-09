// The calls the office's features may make, each spelled out as `$` calls (the shared ones; a feature's own sit beside its hooks in register-*.ts).
// Each is a function declaration, not a constant: the plugin check follows `$` past an import only into a declaration.
import type { EngineInterface } from 'claude-code'

import type { Badge } from '../types'
import { DEMO, isActive } from './panel-model'
import type { DemoIo } from './demo'
import { raise } from './panes'
import type { PaneIo } from './panes'
import { hireTypes } from './hire'
import type { SavedTeam } from './hire'
import { labelOf } from './office'
import { teamKey } from './onboard-types'
import type { Team } from './onboard-types'
import { withJobs } from './office-state'
import type { OldIo } from './old-decisions'
import type { PayrollIo } from './payroll'
import type { RecapIo } from './recap'
import type { RuleIo } from './rule-io'
import type { GaugeIo } from './usage'
import type { CouncilIo } from './council'
import type { RunIo } from './run-io'
import { specialistOf } from './run-io'
import { hire, withReport } from './staff-model'
import { edit, inLine } from './state'
import type { StepIo } from './steps'
import { getBoss, getFx, getPayroll, readBlurbs, readGauge, readRoster, readStaff, readTick, ses, setBoss, setFx, updateGauge, updatePayroll, updateProjectTokens, updateRoster, updateRuleOffers, updateStaff } from './register-state'

/**
 * Puts a type on the books, with how often it was hired, kept across sessions in the store. Queued, so it never
 * overlaps another write to the books.
 */
export function enroll($: EngineInterface, type: string, jobs: number, tokens = 0) { return inLine(() => enrollNow($, type, jobs, tokens)) }

/** The write itself, for a caller already inside `inLine`: queueing it again there would wait on itself for ever. */
export async function enrollNow($: EngineInterface, type: string, jobs: number, tokens = 0) {
  const mine = await readRoster($)
  const saved = Object.keys(mine).length === 0 ? ((await $.store.get('roster')) as Record<string, Badge> | undefined) : undefined
  const cur = { ...(saved ?? {}), ...mine }
  if (cur[type] && jobs === 0 && tokens === 0) {
    if (saved) await updateRoster($, () => cur)
    return
  }
  const next = withJobs(cur, type, jobs, tokens)
  await updateRoster($, () => next)
  await $.store.set('roster', next)
}

/** The books of specialists (hooks/run-io.ts): who is at work, hired, heard from or gone. */
export function runIo($: EngineInterface): RunIo {
  return {
    now: () => $.clock.now(), tick: () => readTick($), staff: () => readStaff($), changeStaff: fn => updateStaff($, fn),
    blurbs: () => readBlurbs($), enroll: (type, jobs, tokens) => enroll($, type, jobs, tokens), setBoss: fn => setBoss($, fn),
    toast: text => void $.ui.toast(text), agents: () => $.agent.list(), folder: () => ses.cwd, get: key => $.store.get(key), set: (key, value) => $.store.set(key, value), showTokens: m => updateProjectTokens($, () => m),
  }
}

export async function showStatus($: EngineInterface) {
  const n = (await readStaff($)).filter(isActive).length
  $.ui.status(n > 0 ? `HQ · 🦀 ${n} at desk${n === 1 ? '' : 's'}` : undefined)
}

// ---- The panes: one per view, so the host's own tab strip switches between them (hooks/panes.ts) ----

export function paneIo($: EngineInterface): PaneIo {
  return {
    open: args => $.ui.open(args),
    list: () => $.ui.panes(),
    close: id => $.ui.close({ id }), hasSurface: async () => (await $.session.surfaces()).length > 0,
  }
}

/** The name an agent's work is filed under; 'agent' when it is not on the books. */
export async function byOf($: EngineInterface, id: string) {
  const one = (await readStaff($)).find(e => e.id === id)
  return one ? labelOf(one, (await readBlurbs($))[one.type] ?? '') : 'agent'
}

// ---- Payroll: which agent types Clawd is offered (hooks/payroll.ts) ----

export function payrollIo($: EngineInterface): PayrollIo {
  return {
    cwd: ses.cwd, get: () => getPayroll($), set: async p => { await updatePayroll($, () => p) }, keep: (key, p) => $.store.set(key, p),
    types: async () => [...new Set([...Object.keys(await readBlurbs($)), ...Object.keys(await readRoster($))])],
    picks: async () => ((await $.store.get(teamKey(ses.cwd))) as Team | undefined)?.picks?.filter(p => p.kind === 'agent').map(p => p.name),
    hires: async () => hireTypes((await $.store.get(teamKey(ses.cwd))) as SavedTeam | undefined), list: path => $.fs.list(path), fx: () => getFx($), setFx: fn => setFx($, fn),
    invalidate: () => { $.ui.invalidate('tool.describe'); $.ui.invalidate('prompt.attachment') },
  }
}

/**
 * The "Add to CLAUDE.md" card (hooks/rule-io.ts). The press writes the exact line shown into the project's CLAUDE.md with no model in
 * between: the one place the plugin writes that file, and a deliberate exception to "buttons only fill the prompt box".
 */
export function ruleIo($: EngineInterface): RuleIo {
  return {
    path: () => (ses.cwd === '' ? '' : `${ses.cwd.replace(/[\\/]+$/, '')}/CLAUDE.md`),
    exists: path => $.fs.exists(path), read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text),
    now: () => $.clock.now(), change: fn => updateRuleOffers($, fn),
    setDone: fn => setFx($, f => ({ ...f, ruleDone: fn(f.ruleDone) })), after: (ms, fn) => $.clock.after(ms, fn),
  }
}

/** The one-time card about an old decisions file (hooks/old-decisions.ts): the plugin only checks that the file is there; it never reads or changes it. */
export function oldIo($: EngineInterface): OldIo {
  return {
    folder: () => ses.cwd, exists: path => $.fs.exists(path), get: key => $.store.get(key), set: (key, value) => $.store.set(key, value),
    fill: async text => (await $.prompt.fill({ text, mode: 'append' })).isFilled,
    show: isShown => setFx($, f => ({ ...f, oldDecisions: isShown ? true : undefined })), toast: text => void $.ui.toast(text),
  }
}

/** The step tool (hooks/steps.ts): only a specialist at work here reports. */
export function stepIo($: EngineInterface): StepIo {
  return {
    isAtWork: async id => { const one = await specialistOf(runIo($), id); return one !== undefined && isActive(one) },
    record: async (id, report) => { const now = await $.clock.now(); await updateStaff($, l => edit(l, id, one => withReport(one, report, now))) },
  }
}

// ---- The recap (hooks/recap.ts): one line on where things stand, after a few quiet minutes ----

export function recapIo($: EngineInterface): RecapIo {
  return {
    now: () => $.clock.now(), boss: () => getBoss($), setBoss: fn => setBoss($, fn),
    isTouring: async () => (await getFx($)).demo !== undefined,
    isShown: async () => ((await $.session.surfaces().catch(() => [])).length > 0),
    ask: prompt => $.model.fork({ prompt }),
  }
}

// ---- The header meters: context and rate limits, kept as the engine reports them ----

export function gaugeIo($: EngineInterface): GaugeIo {
  return {
    now: () => $.clock.now(), usage: () => $.session.usage(), model: () => $.session.model(),
    threshold: () => $.session.usage({ breakdown: 'summary' }).then(u => u.context.breakdown?.autoCompactThreshold),
    get: () => readGauge($), set: fn => updateGauge($, fn),
  }
}

/** /office-council (hooks/council.ts): the box is filled after what is there; a typed question is sent as the person's own words. */
export function councilIo($: EngineInterface): CouncilIo {
  return { fill: text => $.prompt.fill({ text, mode: 'append' }), submit: text => $.prompt.submit({ text, asUser: true }), later: fn => $.clock.after(0, fn), toast: text => void $.ui.toast(text) }
}

// ---- The demo: a scripted tour with stand-in employees, cleaned up at the end ----

/** Settings shows the list of finished work (true) or its configs (false); the choice is a display flag, shared by every drawing. */
export function showLog($: EngineInterface, isOpen: boolean) { return setFx($, f => ({ ...f, isLogOpen: isOpen })) }

export function demoIo($: EngineInterface): DemoIo {
  return {
    show: view => raise(paneIo($), view), showLog: isOpen => showLog($, isOpen),
    boss: () => getBoss($), fx: () => getFx($), setBoss: fn => setBoss($, fn), tick: () => readTick($), now: () => $.clock.now(),
    put: one => updateStaff($, l => hire(l, one)), // a stand-in joins the books: no hire is counted, nothing is enrolled, no toast
    editStaff: (id, fn) => updateStaff($, l => edit(l, id, fn)),
    dropStandIns: () => updateStaff($, l => l.filter(e => !e.id.startsWith(DEMO))),
    setDemo: demo => setFx($, f => ({ ...f, demo })), showStatus: () => showStatus($),
    after: (ms, fn) => $.clock.after(ms, fn),
  }
}
