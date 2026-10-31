// The tour's script: what each step says and does, in story order. The office's own actions come in as `io` (hooks/demo.ts),
// so every card on screen is drawn by the product's own panel code from stand-in state. Each step's caption is drawn at the top of every pane while it plays.
import type { Employee } from '../types'
import { CONTRACTOR_TYPE } from './contractor-name'
import { BRAND } from './office'
import type { PaneView } from './panes'

/** A stand-in specialist as it is hired: the kind, the name given, the job, and the model and effort Clawd sized for it. A pair or council member shares its goal. */
export type Cast = {
  type: string
  name: string
  description: string
  model?: string
  effort?: Employee['effort']
  pair?: { goal: string; isCouncil?: true }
}

export type TourIo = {
  show: (view: PaneView) => Promise<unknown>
  /** Settings shows the list of finished work (true) or its configs (false). */
  showLog: (isOpen: boolean) => Promise<unknown>
  setBusy: (isBusy: boolean) => Promise<unknown>
  say: (text: string, ticks?: number) => Promise<unknown>
  /** `n` names a stand-in specialist for the length of the tour. */
  hire: (n: string, one: Cast) => Promise<unknown>
  work: (n: string, tool: string, input: Record<string, unknown>) => Promise<unknown>
  /** The step tool's report: steps done of the plan, and a few plain words. */
  report: (n: string, done: number, total: number, note: string) => Promise<unknown>
  think: (n: string) => Promise<unknown>
  /** Ends the stand-in's run well; `words` is what it reported (a council voice's first line, a pair-up member's choices). */
  finish: (n: string, words?: Pick<Employee, 'report' | 'choices'>) => Promise<unknown>
  /** Every stand-in goes home. */
  clearFloor: () => Promise<unknown>
  goQuiet: () => Promise<unknown>
  recap: (text: string) => Promise<unknown>
}

const SONNET = 'claude-sonnet-5-5'
const BUILDER_TYPE = 'clawd-hq:core-builder'
const PAIR_GOAL = 'Move the scores to a new table'
const QUESTION = 'Postgres or SQLite for the scores?'
const voice = (name: string, description: string): Cast =>
  ({ type: 'general-purpose', name, description, model: SONNET, effort: 'medium', pair: { goal: QUESTION, isCouncil: true } })

const BUILDER: Cast = { type: BUILDER_TYPE, name: 'Builder', description: 'Add the export button', model: SONNET, effort: 'medium' }
const RESEARCHER: Cast = { type: 'clawd-hq:core-researcher', name: 'Researcher', description: 'Find how exports work now', model: 'claude-haiku-4-5', effort: 'low' }
const DESIGNER: Cast = { type: CONTRACTOR_TYPE, name: 'Designer', description: 'Style the export button', model: SONNET, effort: 'medium' }
const PAIR_BUILDER: Cast = { ...BUILDER, description: PAIR_GOAL, pair: { goal: PAIR_GOAL } }
const PAIR_REVIEWER: Cast = { type: 'clawd-hq:core-reviewer', name: 'Reviewer', description: PAIR_GOAL, model: SONNET, effort: 'medium', pair: { goal: PAIR_GOAL } }

export function tourSteps(io: TourIo): Array<[string, () => Promise<void>]> {
  return [
    ['Meet Clawd, your chief of staff, in his gold crown. He hands work to specialists, so he stays free to talk.', async () => {
      await io.show('office')
      await io.setBusy(false)
      await io.say('Welcome to the office! Ask me anything.')
    }],
    ['Clawd keeps his words plain: short sentences, one idea each, inspired by Simplified Technical English (ASD-STE100).', async () => {
      await io.say('Two files changed. The tests pass. One thing needs you.')
    }],
    ['Hiring starts with a search of every installed helper. Clawd picks from the five best fits.', async () => {
      await io.setBusy(true)
      await io.say('Searching the helpers. Five fit this job.')
    }],
    ['Each hire gets the smallest model that can do the job, and a knowledge skill when it helps.', async () => {
      await io.setBusy(false)
      await io.hire('build', BUILDER)
      await io.work('build', 'Skill', { skill: 'ecc:frontend-patterns' })
      await io.hire('research', RESEARCHER)
      await io.work('research', 'Grep', { pattern: 'export' })
    }],
    ['Specialists report as they go: a bar for their steps, and a short note in their own words.', async () => {
      await io.report('build', 3, 5, 'Writing the test for the empty case')
      await io.report('research', 1, 3, 'Reading how exports work now')
    }],
    ['Plans change. Clawd passes a new instruction to the working specialist, and nobody stops.', async () => {
      await io.say('New note for the Builder: use the round button.')
      await io.report('build', 1, 5, 'Taking in the new instruction')
    }],
    ['The specialist picks it up at its next step. The bar fills again, and the job never restarts.', async () => {
      await io.report('build', 4, 5, 'Writing the round button')
      await io.finish('research')
    }],
    ['If only an off-team skill fits, Clawd hires a contractor for one job. It wears a badge.', async () => {
      await io.hire('design', DESIGNER)
      await io.work('design', 'Skill', { skill: 'ecc:design-system' })
    }],
    ['The contractor finishes and leaves. Hire the same skill twice, and Clawd offers to make it staff.', async () => {
      await io.finish('design')
      await io.finish('build')
    }],
    ['Risky work gets a pair-up: a builder and a reviewer on one card. The reviewer first says the plan back in its own words.', async () => {
      await io.hire('pairbuild', PAIR_BUILDER)
      await io.hire('pairreview', PAIR_REVIEWER)
      await io.work('pairreview', 'Read', { file_path: 'plan.md' })
    }],
    ['They swap one round of critique, then each reports to Clawd. A part the reviewer cannot restate gets fixed first.', async () => {
      await io.work('pairbuild', 'Edit', { file_path: 'scores.ts' })
      await io.finish('pairbuild')
    }],
    ['For a hard choice, Clawd calls a council: four voices on one Council card, each with its own status.', async () => {
      await io.finish('pairreview', { choices: ['Plan restated first; one unclear step fixed before building'] })
      await io.hire('skeptic', voice('Skeptic', 'Challenge the question'))
      await io.hire('pragmatist', voice('Pragmatist', 'What ships, and what it costs'))
      await io.hire('critic', voice('Critic', 'How each option fails'))
      await io.hire('architect', voice('Architect', 'The long term, and how hard it is to undo'))
    }],
    ['Each voice answers alone. The voices never read each other.', async () => {
      await io.finish('skeptic', { report: 'Position: ask what the scores really need first.' })
      await io.finish('pragmatist', { report: 'Position: SQLite ships today and costs nothing to run.' })
      await io.finish('architect', { report: 'Position: SQLite now; the move to Postgres is easy later.' })
      await io.think('critic')
    }],
    ['Clawd sums up with a recommendation, and keeps the lone dissent. You decide.', async () => {
      await io.finish('critic', { report: 'Dissent: SQLite may not hold up when many people write at once.' })
      await io.say('I recommend SQLite. The Critic dissents: many writers may be a problem. You decide.', 11)
    }],
    ['Finished work stays tidy: the pair-up and the council get one card each, voice by voice.', async () => {
      await io.showLog(true)
      await io.show('settings')
    }],
    ['Questions wait and come in one box, only if they need you. Your answer settles the job at hand only.', async () => {
      await io.showLog(false)
      await io.show('office')
      await io.clearFloor()
      await io.say('Two questions. I will ask them in one go.')
    }],
    ['Quiet chat hides the noise: finished notices and filler. Results, failures and questions always show.', async () => {
      await io.show('settings')
    }],
    ['Back from a break? Where we left off shows where things stand, and the next step.', async () => {
      await io.show('office')
      await io.goQuiet()
      await io.recap('Adding the export button to the scores page. Next: ask the reviewer to check the empty case.')
    }],
    ['People lists the team: what each helper does, and the tokens it has used.', async () => {
      await io.show('people')
    }],
    [`That is the tour. The stand-ins go home, and ${BRAND} is back to normal.`, async () => {
      await io.show('office')
      await io.say('Thanks for visiting. Now, back to work!', 12)
    }],
  ]
}
