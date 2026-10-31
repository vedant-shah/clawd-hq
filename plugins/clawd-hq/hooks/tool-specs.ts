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
  // In the prompt's own list: a specialist would not otherwise search for it, and its brief names it as one it has.
  isDeferred: false,
  description:
    'For a specialist (a subagent): report how far along your work is, so the person watching sees a progress bar. ' +
    'Call it first with your plan as `total` (3 to 8 steps) and `done: 0`, then after each step with `done` and a note of a few plain words. ' +
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

export const FIND_HELPERS_SPEC: ToolSpec = {
  name: 'find_helpers',
  // In the prompt's own list: Clawd calls it before every hire, so he should not have to search for it first.
  isDeferred: false,
  description:
    'For Clawd, in the main chat: search every installed agent and skill for a job, before you hire anyone. Give the job and 5 to 8 keywords. ' +
    'It always returns the five best fits, with no cut-off, so judge the fit yourself. Each has a name, a kind (agent or skill), what it does, and a status: staff (on this project\'s team), ' +
    'laid off (parked for this project) or not on team (installed, not picked). A skill also has a use: knowledge (facts or taste a model may lack) or process (a way of working). ' +
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
