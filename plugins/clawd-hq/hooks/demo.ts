// The one-minute tour: its script (what each step says and does) and its timing. The office's own actions come in as
// `io`, so `$` and the state stay in register.tsx. Each step's caption is drawn at the top of every pane while it plays.
import type { Boss, Employee, Fx, Mood } from '../types'
import { sentenceOf } from './activity'
import { BRAND, hash } from './office'
import { quietBoss } from './office-state'
import { NAP_MS } from './clawd-says'
import type { PaneView } from './panes'
import { DEMO } from './panel-model'
import { withTool } from './staff-model'

export type TourIo = {
  show: (view: PaneView) => Promise<unknown>
  /** Settings shows the list of finished work (true) or its configs (false). */
  showLog: (isOpen: boolean) => Promise<unknown>
  setBusy: () => Promise<unknown>
  say: (text: string, ticks?: number) => Promise<unknown>
  /** `n` names a stand-in specialist for the length of the tour. */
  hire: (n: string, type: string, description: string) => Promise<unknown>
  work: (n: string, tool: string, input: Record<string, unknown>) => Promise<unknown>
  finish: (n: string, mood: Mood) => Promise<unknown>
  goQuiet: () => Promise<unknown>
}

export function tourSteps(io: TourIo): Array<[string, () => Promise<void>]> {
  return [
    [`Welcome to ${BRAND}. Clawd is your chief of staff; you are the CEO; every subagent is an employee.`, async () => {
      await io.show('office')
      await io.setBusy()
      await io.say('Welcome to the office! Mind the claws.')
    }],
    ['Hiring: each agent type gets an avatar of its own, with its own outfit, headwear and prop.', async () => {
      await io.hire('arch', 'ecc:architect', 'Design the scoring API')
    }],
    ['Each specialist at work gets a row: its avatar, its task, what it is doing right now, and how long it has been at it.', async () => {
      await io.work('arch', 'Read', { file_path: 'scoring.ts' })
      await io.hire('scout', 'Explore', 'Map the backend')
    }],
    ['A specialist is known by its role, in one or two plain words, or by the name it was given.', async () => {
      await io.work('scout', 'Grep', { pattern: 'computeScore' })
      await io.hire('rev', 'ecc:code-reviewer', 'Review the survey flow')
    }],
    ['Hire too many at once and Clawd starts to grumble.', async () => {
      await io.hire('tdd', 'ecc:tdd-guide', 'Test the review panel')
      await io.hire('data', 'acme-ops:(o_o) data-analyst', 'Crunch the deal data')
      await io.work('rev', 'Read', { file_path: 'surveys.ts' })
      await io.work('arch', 'Edit', { file_path: 'design.md' })
    }],
    ['Specialists do not stop to ask you. They make their best call, carry on, and put their questions in their report to Clawd.', async () => {
      await io.work('tdd', 'Bash', { command: 'npm test', description: 'Run the review panel tests' })
      await io.work('data', 'Read', { file_path: 'deals.csv' })
    }],
    ['Clawd settles what he can and asks you the rest in one question box, at a natural pause. Your answers are saved as decisions.', async () => {
      await io.say('Two questions saved up. I’ll ask them in one go.')
    }],
    ['When an agent fails, it goes home sick and Clawd reacts.', async () => {
      await io.finish('tdd', 'failed')
    }],
    ['Finishers are listed in Settings, under Finished this session, with how long they took.', async () => {
      await io.finish('arch', 'done')
      await io.finish('scout', 'done')
      await io.showLog(true)
      await io.show('settings')
    }],
    ['People is the payroll: who’s on the team and who’s in the talent pool for this project.', async () => {
      await io.showLog(false)
      await io.show('people')
    }],
    ['Leave the office quiet for 2 minutes and Clawd gets drowsy.', async () => {
      await io.show('office')
      await io.finish('rev', 'done')
      await io.finish('data', 'done')
      await io.goQuiet()
    }],
    ['That’s the tour! The demo staff are heading home.', async () => {
      await io.say('Thanks for visiting. Now, back to work!', 12)
    }],
  ]
}

// ---- Playing it: stand-in employees, one step every five seconds, cleaned up at the end ----

/** What playing the tour needs of the office; every call is a closure built in register.tsx. */
export type DemoIo = {
  show: TourIo['show']
  showLog: TourIo['showLog']
  boss: () => Promise<Boss>
  setBoss: (fn: (b: Boss) => Boss) => Promise<unknown>
  tick: () => Promise<number>
  now: () => Promise<number>
  /** `id` is the stand-in's full id (it starts with DEMO). */
  hire: (id: string, type: string, description: string) => Promise<unknown>
  finish: (id: string, mood: Mood) => Promise<unknown>
  editStaff: (id: string, fn: (e: Employee) => Employee) => Promise<unknown>
  dropStandIns: () => Promise<unknown>
  setDemo: (demo: Fx['demo']) => Promise<unknown>
  showStatus: () => Promise<unknown>
  after: (ms: number, fn: () => void) => { cancel: () => void }
}

const STEP_MS = 5000
let demoTimers: Array<{ cancel: () => void }> = []

/** A stand-in at work: what it is doing now, and the tokens that go with it. */
const work = (io: DemoIo, id: string, tool: string, input: Record<string, unknown>) => {
  const activity = sentenceOf(tool, input)
  return io.editStaff(id, one => ({ ...withTool(one, activity), tokens: (one.tokens ?? 0) + 18_000 + (hash(activity) % 9000) }))
}

async function say(io: DemoIo, text: string, ticks = 10) {
  const t = await io.tick()
  await io.setBoss(b => ({ ...b, quip: { text, until: t + ticks } }))
}

export async function startDemo(io: DemoIo) {
  for (const timer of demoTimers) timer.cancel()
  demoTimers = []
  const saved = await io.boss()
  const id = (n: string) => `${DEMO}${n}`
  const steps = tourSteps({
    show: io.show,
    showLog: io.showLog,
    setBusy: () => io.setBoss(b => ({ ...b, isBusy: true })),
    say: (text, ticks) => say(io, text, ticks),
    hire: (n, type, description) => io.hire(id(n), type, description),
    work: (n, tool, input) => work(io, id(n), tool, input),
    finish: (n, mood) => io.finish(id(n), mood),
    goQuiet: async () => { const now = await io.now(); await io.setBoss(b => quietBoss(b, now, NAP_MS)) },
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
  demoTimers.push(io.after(total * STEP_MS + 1500, () => {
    void (async () => {
      await io.dropStandIns()
      await io.setDemo(undefined)
      await io.setBoss(b => ({ ...saved, turns: b.turns, recap: b.recap, quip: undefined }))
      await io.showStatus()
    })()
  }))
}
