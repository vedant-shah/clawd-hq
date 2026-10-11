// The two tools the office registers for the model, as data.
import type { EngineInterface } from 'claude-code'

type ToolSpec = Parameters<EngineInterface['tool']['register']>[0]

export const ASK_SPEC: ToolSpec = {
  name: 'ask_ceo',
  description:
    'File a decision or question for the user (the CEO) on the CEO Desk without stopping work. ' +
    'Use it for choices that are the user’s to make but need not block you: say what you will do meanwhile (`default`), carry on, ' +
    'and the answer arrives later as a message. For a choice you cannot proceed without, ask directly instead.',
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['decision', 'question'] },
      question: { type: 'string', description: 'One line, ending in a question mark.' },
      context: { type: 'string', description: 'Why it matters, a sentence or two.' },
      options: { type: 'array', items: { type: 'string' }, description: 'For a decision: 2–6 short options.' },
      recommended: { type: 'string', description: 'The option you recommend.' },
      default: { type: 'string', description: 'What you will do until the CEO answers.' },
    },
    required: ['kind', 'question'],
  },
}

export const REMEMBER_SPEC: ToolSpec = {
  name: 'remember',
  description:
    'Record a decision the user made, or a key choice they confirmed, so the office follows it in this and later sessions ' +
    '(it lands in the project memory every agent brief carries). One decision per call, stated as the outcome. ' +
    'Not for routine progress, and not for the CEO Desk’s answers, which are recorded already.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', description: 'The decision as one line, e.g. “Scores live in Postgres, not DynamoDB”.' },
      supersedes: { type: 'string', description: 'The memory id (M12) this replaces, when the user changed an earlier decision.' },
    },
    required: ['decision'],
  },
}
