// Playing the tour (the script is in hooks/demo-script.ts): stand-in employees on the real panel, one step every few seconds, cleaned up at the end.
// The office's own actions come in as `io`, so `$` and the state stay in register.tsx. Nothing real is spawned, saved or announced.
import type { Boss, Employee, Fx } from '../types'
import { sentenceOf } from './activity'
import { NAP_MS } from './clawd-says'
import { tourSteps } from './demo-script'
import type { Cast } from './demo-script'
import { hash, labelOf } from './office'
import { freshHire, quietBoss } from './office-state'
import type { PaneView } from './panes'
import { DEMO } from './panel-model'
import { endRun, finishedBoss, withTool } from './staff-model'
import { withProgress } from './steps'

export { onStage } from './demo-cast'

/** What playing the tour needs of the office; every call is a closure built in register.tsx. */
export type DemoIo = {
  show: (view: PaneView) => Promise<unknown>
  /** Settings shows the list of finished work (true) or its configs (false). */
  showLog: (isOpen: boolean) => Promise<unknown>
  boss: () => Promise<Boss>
  fx: () => Promise<Fx>
  setBoss: (fn: (b: Boss) => Boss) => Promise<unknown>
  tick: () => Promise<number>
  now: () => Promise<number>
  /** A stand-in joins the books. It is no hire: nothing is counted, enrolled or announced. */
  put: (one: Employee) => Promise<unknown>
  editStaff: (id: string, fn: (e: Employee) => Employee) => Promise<unknown>
  dropStandIns: () => Promise<unknown>
  setDemo: (demo: Fx['demo']) => Promise<unknown>
  showStatus: () => Promise<unknown>
  after: (ms: number, fn: () => void) => { cancel: () => void }
}

/** DECIDED: twenty steps of 4.5 seconds make the tour about 90 seconds. */
export const STEP_MS = 4500
let demoTimers: Array<{ cancel: () => void }> = []
/** Puts the office back as the running tour found it; none while no tour plays. */
let endTour: (() => Promise<void>) | undefined

/** A stand-in at work: what it is doing now, and the tokens that go with it. */
const work = (io: DemoIo, id: string, tool: string, input: Record<string, unknown>) => {
  const activity = sentenceOf(tool, input)
  return io.editStaff(id, one => ({ ...withTool(one, activity), tokens: (one.tokens ?? 0) + 18_000 + (hash(activity) % 9000) }))
}

async function say(io: DemoIo, text: string, ticks = 10) {
  const t = await io.tick()
  await io.setBoss(b => ({ ...b, quip: { text, until: t + ticks } }))
}

/** A new stand-in, hired now; a pair-up or council member carries its goal, hired together with the others of its card. */
async function hire(io: DemoIo, id: string, cast: Cast) {
  const [now, t] = [await io.now(), await io.tick()]
  const { type, name, description, model, effort, pair } = cast
  const group = pair === undefined ? {} : { pair: { goal: pair.goal, at: now, ...(pair.isCouncil ? { isCouncil: true as const } : {}) } }
  await io.put({ ...freshHire({ id, type, description, name }, now, t), model, effort, ...group })
}

/** The stand-in's run ends well, with what it reported; Clawd cheers. */
async function finish(io: DemoIo, id: string, words: Pick<Employee, 'report' | 'choices'> = {}) {
  const [now, t] = [await io.now(), await io.tick()]
  let label = ''
  await io.editStaff(id, one => { label = labelOf(one); return { ...endRun(one, 'done', 'signal', now, t), ...words, counted: one.tokens ?? 0 } })
  await io.setBoss(b => finishedBoss(b, 'done', t, label))
}

export async function startDemo(io: DemoIo) {
  for (const timer of demoTimers) timer.cancel()
  demoTimers = []
  await endTour?.() // a tour already playing is cleaned up first, so this one saves the office as it really was
  const [saved, savedFx] = [await io.boss(), await io.fx()]
  const id = (n: string) => `${DEMO}${n}`
  const steps = tourSteps({
    show: io.show,
    showLog: io.showLog,
    setBusy: isBusy => io.setBoss(b => ({ ...b, isBusy })),
    say: (text, ticks) => say(io, text, ticks),
    hire: (n, cast) => hire(io, id(n), cast),
    work: (n, tool, input) => work(io, id(n), tool, input),
    report: (n, done, total, note) => io.editStaff(id(n), one => withProgress(one, { done, total, note })),
    think: n => io.editStaff(id(n), one => ({ ...one, mood: 'thinking' })),
    finish: (n, words) => finish(io, id(n), words),
    clearFloor: io.dropStandIns,
    goQuiet: async () => { const now = await io.now(); await io.setBoss(b => quietBoss(b, now, NAP_MS)) },
    recap: text => io.setBoss(b => ({ ...b, recap: text })),
  })

  const total = steps.length
  steps.forEach(([caption, run], i) => {
    demoTimers.push(io.after(i * STEP_MS, () => {
      void (async () => {
        await io.setDemo({ step: i + 1, total, caption })
        await run()
      })().catch(() => undefined) // a step that fails is skipped; it must not become an unhandled rejection
    }))
  })
  endTour = async () => {
    endTour = undefined
    await io.dropStandIns()
    await io.setDemo(undefined)
    await io.setBoss(b => ({ ...saved, turns: b.turns }))
    await io.showLog(savedFx.isLogOpen === true)
    await io.showStatus()
  }
  demoTimers.push(io.after(total * STEP_MS + 1500, () => { void endTour?.() }))
}
