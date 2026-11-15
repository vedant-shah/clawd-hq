// The Planner's plans (no `$`): a run whose brief starts with `PLAN-DRAFT: <goal title>` is asked to end its report with one `STEP: <text>`
// line per step. On its real hand-back those lines become the plan (hooks/plan-run.ts), or wait as a draft while another goal is in hand.
import { MAX_STEPS, cleanText } from './plan'
import { looksSecret } from './know'

/** Added to the brief of a run that carries `PLAN-DRAFT:`, and to no other. */
export const PLAN_DRAFT_NOTE =
  '\n\n(Plan note from Clawd HQ: this brief asks for a plan, and the office files it. End your report with one line per step, `STEP: <text>`, ' +
  'three to eight steps, each one outcome that one specialist can finish.)'

/** A plan the Planner reported while a goal was in hand: waiting for Clawd to start it. `isTold`: Clawd was told in the answer of a `plan` call. */
export type PlanDraft = { readonly folder: string; readonly title: string; readonly steps: readonly string[]; readonly at: number; readonly isTold: boolean }

/** The runs that carry `PLAN-DRAFT:`, by agent id, with the goal title: kept for the session, since the hand-back comes later. */
export const draftRuns = new Map<string, string>()

const STEP_LINE = /^[ \t]*[-*]?[ \t]*STEP:[ \t]*(.+?)[ \t]*$/gim

/**
 * The `STEP:` lines of a specialist's final report, in order, each cleaned like a step the `plan` tool is given (one clean line, cut to size,
 * no comment marks). A line that is empty after cleaning, or that looks like a key or a token, is left out. At most as many as a plan holds.
 */
export function parseSteps(text: string): string[] {
  return [...text.matchAll(STEP_LINE)].map(m => cleanText(m[1] ?? '')).filter(step => step !== '' && !looksSecret(step)).slice(0, MAX_STEPS)
}

/** What Clawd is told, in the answer of his next `plan` call, while a draft waits. */
export const draftNote = (draft: Pick<PlanDraft, 'title' | 'steps'>) =>
  `A plan from the Planner is waiting: ${draft.title}, ${draft.steps.length} ${draft.steps.length === 1 ? 'step' : 'steps'}. ` +
  'Its STEP lines are in the Planner\'s report. Start it with a plain start once the current goal is finished.'

/** The store key of the draft waiting in one project folder. */
export const draftKey = (folder: string) => `planDraft:${folder}`

/** A draft as the store held it, or none when what it holds is not one (the store is read, never trusted). */
export function draftFrom(raw: unknown, folder: string): PlanDraft | null {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const steps = Array.isArray(r.steps) ? r.steps.filter((s): s is string => typeof s === 'string' && s !== '') : []
  if (typeof r.title !== 'string' || r.title === '' || steps.length === 0 || r.folder !== folder) return null
  return { folder, title: r.title, steps, at: typeof r.at === 'number' ? r.at : 0, isTold: r.isTold === true }
}
