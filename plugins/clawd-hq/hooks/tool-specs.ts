// The tool the office registers for the model, as data.
import type { EngineInterface } from 'claude-code'

type ToolSpec = Parameters<EngineInterface['tool']['register']>[0]

export const STEP_SPEC: ToolSpec = {
  name: 'step',
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

export const REMEMBER_SPEC: ToolSpec = {
  name: 'remember',
  description:
    'Record a decision the user made, or a key choice they confirmed, so the office follows it in this and later sessions ' +
    '(it lands in the project memory every agent brief carries). One decision per call, stated as the outcome. ' +
    'Not for routine progress, and not for answers the user gave in a question box, which are recorded already.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', description: 'The decision as one line, e.g. “Scores live in Postgres, not DynamoDB”.' },
      supersedes: { type: 'string', description: 'The memory id (M12) this replaces, when the user changed an earlier decision.' },
    },
    required: ['decision'],
  },
}
