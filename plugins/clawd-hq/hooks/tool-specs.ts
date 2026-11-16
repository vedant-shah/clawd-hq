// The tool the office registers for the model, as data.
import type { EngineInterface } from 'claude-code'
import { BRAND } from './office'

type ToolSpec = Parameters<EngineInterface['tool']['register']>[0]

export const DEMO_SPEC: ToolSpec = {
  name: 'demo',
  description: `Plays the ${BRAND} office tour in the side panel (about a minute and a half, stand-in employees, nothing real is spawned, the office is left as it was found). Call only when the user asks to see the office demo.`,
  inputSchema: { type: 'object', properties: {} },
}

export const STEP_SPEC: ToolSpec = {
  name: 'step',
  // Registered and not deferred, though a brief no longer orders it: the four shipped agents list it among their tools, so it must be there when they look.
  isDeferred: false,
  description:
    'For a specialist (a subagent): optionally report how far along your work is, so the person watching sees a progress bar. ' +
    'Using it is optional: a plain sentence such as "Step 2 of 4: checking that the tests pass." in your reply works just as well, and gives the same bar. ' +
    'If you use it, call it first with your plan as `total` (3 to 8 steps) and `done: 0`, then after each step with `done` and a note of a few plain words. ' +
    'A new `total` replaces the old one when the plan changes. Ignored in the main chat.',
  inputSchema: {
    type: 'object',
    properties: {
      // The limits are told in words and checked in the office (hooks/steps.ts), which answers a breach with a plain reason.
      done: { type: 'integer', description: 'Steps finished so far, 0 or more.' },
      total: { type: 'integer', description: 'Steps in your plan, 1 to 12.' },
      note: { type: 'string', description: 'A few plain words on the step you are on, e.g. “Writing the tests”. At most 80 characters; a longer note is refused.' },
    },
    required: ['done', 'total'],
  },
}

export const BEFORE_QUESTION_SPEC: ToolSpec = {
  name: 'before_question',
  // In the prompt's own list: Clawd calls it at every pause, so he should not have to search for it first.
  isDeferred: false,
  description:
    'For Clawd, in the main chat: call it once, right after your catch-up and right before the question box (AskUserQuestion), so the catch-up shows as written. ' +
    'It takes no input and does nothing; it answers "Ready." A specialist has no use for it.',
  inputSchema: { type: 'object', properties: {} },
}

export const FIND_HELPERS_SPEC: ToolSpec = {
  name: 'find_helpers',
  // In the prompt's own list: Clawd calls it before every hire, so he should not have to search for it first.
  isDeferred: false,
  description:
    'For Clawd, in the main chat: search every installed agent and skill for a job, before you hire anyone. Give the job and 5 to 8 keywords. ' +
    'It always returns the five best fits, with no cut-off, so judge the fit yourself. Each has a name, a kind (agent or skill), what it does, and a status: staff (on this project\'s team), ' +
    'laid off (parked for this project) or not on team (installed, not picked). A skill also has a use: knowledge (facts or taste a model may lack) or process (a way of working). ' +
    'When the Settings switch is on and the installed matches are weak (no match, a low score, or only Clawd HQ\'s own four), it also searches the public skill registry (skills.sh) in the same call and lists what it finds as not installed, with a note to follow. ' +
    'A specialist cannot use it.',
  inputSchema: {
    type: 'object',
    properties: {
      job: { type: 'string', description: 'The work to be done, in plain words, e.g. “design the settings page” or “review a Go change for bugs”.' },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: '5 to 8 words for the same work: other ways to say it, synonyms, and the field\'s own words. For a design job: “UI, layout, CSS, visual, polish”. At most 12.',
      },
      registry: { type: 'boolean', description: 'Optional. Set true on a second call only when strong installed matches came back and none fit: it then searches the public skill registry (skills.sh), if that is switched on. Weak or missing matches are searched there without it.' },
    },
    required: ['job'],
  },
}

export const HIRE_CONTRACTOR_SPEC: ToolSpec = {
  name: 'hire_contractor',
  // In the prompt's own list: find_helpers sends Clawd here for an off-team skill, so he should not have to search for it first.
  isDeferred: false,
  description:
    'For Clawd, in the main chat: hire an installed skill that is not on the team (find_helpers says "not on team") as a contractor for one job. ' +
    'Give the skill\'s exact name and a short role such as “Designer”. It tells you the agent type to hire with the Agent tool, right away. ' +
    'Give that hire the role as its name; the name is required. It also gives you the exact line that has the contractor load the skill. ' +
    'Put that line right after the [effort: …] line of the brief, and after a PAIR-UP: or COUNCIL: line if there is one. ' +
    'The contractor leaves when the job ends. A specialist cannot use it.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'string', description: 'The exact name of an installed skill, as find_helpers gives it.' },
      role: { type: 'string', description: 'A short title for the job, e.g. “Designer”. At most 30 characters.' },
    },
    required: ['skill', 'role'],
  },
}

export const OFFER_RULE_SPEC: ToolSpec = {
  name: 'offer_rule',
  description:
    'For Clawd, in the main chat: offer the person a lasting rule to add to the project\'s CLAUDE.md. Call it once when they state a rule for later work ' +
    '("always", "never", "from now on", "every time"). It puts a card on the Office tab, and they add the line with one press. ' +
    'The rule is one line in their words, at most 300 characters. This tool does not write CLAUDE.md. A specialist cannot use it: it puts the rule in its report.',
  inputSchema: {
    type: 'object',
    properties: {
      rule: { type: 'string', description: 'The rule as one line in the person\'s words, e.g. “Always run the tests before a commit”.' },
    },
    required: ['rule'],
  },
}

export const PLAN_SPEC: ToolSpec = {
  name: 'plan',
  // In the prompt's own list: Clawd calls it whenever the goal changes, so he should not have to search for it first.
  isDeferred: false,
  description:
    'For Clawd, in the main chat: keep the plan for the one goal in hand, a short ordered list of steps the person would recognise, saved in the project. ' +
    'Use it when the person asks for something that takes several steps. One goal at a time: op "start" is refused until the goal in hand is over. ' +
    'Ops: start (goal, steps, and an optional summary: the goal in one sentence), summary (text: set or replace that sentence when the goal shifts; empty clears it), add (text, and after to place it), drop (id), move (id, and after; no after means first), split (id, steps), ' +
    'done (id: you did that step yourself), reopen (id), later (text: put off for another day), finish (outcome "done" or "stopped": the goal is over). ' +
    'Every call answers with the plan and the id of each step (s1, s2, ...). Hire a specialist for a step by starting its brief with the line PLAN: <id>, after the PAIR-UP: line if there is one, and before the line hire_contractor gave you. To ask the Planner for a plan, start its brief with PLAN-DRAFT: <goal title> in the same place instead: its STEP: lines become the plan, or wait as a draft while another goal is in hand. ' +
    'A step is ticked by itself when its specialist finishes well and nothing else is working on it, and it is never ticked when a specialist on it failed: then it is yours to rerun, drop, or tick with done. ' +
    'The goal is never ended by itself: call finish when the person is satisfied. A step with a specialist at work cannot be dropped or split. A specialist cannot use this tool.',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: ['start', 'add', 'drop', 'move', 'split', 'done', 'reopen', 'later', 'summary', 'finish'], description: 'What to do.' },
      goal: { type: 'string', description: 'For start: the goal in a few words, e.g. “Export scores as CSV”.' },
      summary: { type: 'string', description: 'For start, optional: the goal in one sentence, shown under the title, at most 120 characters.' },
      steps: { type: 'array', items: { type: 'string' }, description: 'For start: the steps in order (1 to 40). For split: the two or more steps that replace one. Each at most 120 characters.' },
      id: { type: 'string', description: 'For drop, move, split, done and reopen: the step\'s id, as the last answer gave it, e.g. “s2”.' },
      after: { type: 'string', description: 'For add and move: the id of the step to go after. Left out, add goes last and move goes first.' },
      text: { type: 'string', description: 'For add, later and summary: the words of the step, the put-off item or the one-sentence summary (empty clears it), at most 120 characters.' },
      outcome: { type: 'string', enum: ['done', 'stopped'], description: 'For finish: how the goal ended.' },
    },
    required: ['op'],
  },
}
