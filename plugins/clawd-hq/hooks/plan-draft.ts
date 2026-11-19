// The Planner's plans (no `$`): a run whose brief starts with `PLAN-DRAFT: <goal title>` is asked to end its report with one `STEP: <text>`
// line per step. On its real hand-back those lines become the plan (hooks/plan-run.ts), or wait as a draft while another goal is in hand.
import { cleanText } from './plan'
import { looksSecret, looksUnsafe } from './know'

/** Added to the brief of a run that carries `PLAN-DRAFT:`, and to no other. */
export const PLAN_DRAFT_NOTE =
  '\n\n(Plan note from Clawd HQ: this brief asks for a plan, and the office files it. End your report with one line per step, `STEP: <text>`, ' +
  'three to eight steps, each one outcome that one specialist can finish.)'

/**
 * What the draft slot of a folder holds. `waiting`: a plan the Planner reported while a goal was in hand, for Clawd to start. `started`: a
 * plan the office started by itself on the hand-back, which Clawd is told of once. `isTold`: Clawd was told, in the answer of a `plan` call.
 */
export type PlanDraft = {
  readonly folder: string
  readonly title: string
  readonly steps: readonly string[]
  readonly at: number
  readonly isTold: boolean
  readonly kind: 'waiting' | 'started'
}

/** A draft waits at most this long: one that Clawd never started is dropped when it is next looked at. */
export const DRAFT_DAYS = 7
export const DRAFT_MS = DRAFT_DAYS * 24 * 60 * 60 * 1000

/**
 * The runs that carry `PLAN-DRAFT:`, by agent id: the goal title, and the folder the Planner was hired in (the draft belongs to that
 * folder, whatever folder the session is in when the report comes). Kept for the session, since the hand-back comes later.
 */
export const draftRuns = new Map<string, { title: string; folder: string }>()

/** The most steps a draft keeps: the Planner is asked for three to eight, and a plan that long is a list nobody reads. */
export const DRAFT_STEPS = 12

const STEP_LINE = /^[ \t]*[-*]?[ \t]*STEP:[ \t]*(.*?)[ \t]*$/i
/** What a step says when nothing was written in it: an echo of the note's own `<text>`, a gap mark, or "to be decided". */
const PLACEHOLDER = /^(<[^>]*>|\.{1,3}|…+|-+|tbd|tba|todo|to be (decided|determined)|n\/a|none)$/i

/**
 * The `STEP:` lines of a specialist's final report: the last unbroken block of them (a line of anything else ends a block, a blank line
 * does not), so an earlier example or quotation in the report is not read as the plan. Each is cleaned like a step the `plan` tool is given
 * (one clean line, cut to size, no comment marks). A step is left out when it is empty or a placeholder, when it looks like a key or a token,
 * when it carries a web address or a command (`looksUnsafe`), or when it repeats one before it. At most `DRAFT_STEPS`.
 */
export function parseSteps(text: string): string[] {
  const { blocks } = text.split(/\r?\n/).reduce<{ blocks: readonly (readonly string[])[]; isOpen: boolean }>((acc, line) => {
    const step = line.match(STEP_LINE)?.[1]
    if (step === undefined) return line.trim() === '' ? acc : { ...acc, isOpen: false }
    const head = acc.isOpen ? acc.blocks.slice(0, -1) : acc.blocks
    return { blocks: [...head, [...(acc.isOpen ? acc.blocks[acc.blocks.length - 1]! : []), step]], isOpen: true }
  }, { blocks: [], isOpen: false })
  const clean = (blocks[blocks.length - 1] ?? []).map(cleanText).filter(step => step !== '' && !PLACEHOLDER.test(step) && !looksSecret(step) && !looksUnsafe(step))
  return clean.filter((step, i) => clean.findIndex(other => other.toLowerCase() === step.toLowerCase()) === i).slice(0, DRAFT_STEPS)
}

/** The goal's title as the plan's own clean-up makes it: how a draft's title and a `start`'s goal are compared. */
export const sameTitle = (a: string, b: string) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase()

/** What Clawd is told, in the answer of his next `plan` call, while a draft waits: its steps in full, so a plain `start` can carry them. */
export const draftNote = (draft: Pick<PlanDraft, 'title' | 'steps'>) =>
  `A plan from the Planner is waiting: ${draft.title}, ${draft.steps.length} ${draft.steps.length === 1 ? 'step' : 'steps'}. ` +
  `Once the current goal is finished, start it with the plan tool: op "start", goal "${draft.title}", and these steps (or leave the steps out and the waiting ones are used):\n` +
  draft.steps.map(step => `- ${step}`).join('\n')

/** What Clawd is told, once, after the office started the Planner's plan by itself. */
export const startedNote = (draft: Pick<PlanDraft, 'title' | 'steps'>) => `The Planner's plan for ${draft.title} was started: ${draft.steps.length} ${draft.steps.length === 1 ? 'step' : 'steps'}.`

/**
 * The store key of the draft waiting for one session in one project folder. DECIDED: a draft is its session's own, as its goal is, so two
 * sessions in a folder have two slots; one saved under the folder alone (before drafts named a session) is read by no one and ages out.
 */
export const draftKey = (folder: string, session: string) => `planDraft:${folder}:${session}`

/** A draft as the store held it, or none when what it holds is not one (the store is read, never trusted). */
export function draftFrom(raw: unknown, folder: string): PlanDraft | null {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const steps = Array.isArray(r.steps) ? r.steps.filter((s): s is string => typeof s === 'string' && s !== '') : []
  if (typeof r.title !== 'string' || r.title === '' || steps.length === 0 || r.folder !== folder) return null
  return { folder, title: r.title, steps, at: typeof r.at === 'number' ? r.at : 0, isTold: r.isTold === true, kind: r.kind === 'started' ? 'started' : 'waiting' }
}
