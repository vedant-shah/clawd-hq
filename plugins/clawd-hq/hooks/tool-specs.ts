// The tool the office registers for the model, as data.
import type { EngineInterface } from 'claude-code'

type ToolSpec = Parameters<EngineInterface['tool']['register']>[0]

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
