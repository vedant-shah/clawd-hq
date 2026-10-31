// Registering the setup scout, with its definition written out in the call: the plugin directory reads an agent's limits
// (its tools, the tools withheld and its permission mode) only from an object written in the register call itself.
// SCOUT_SPEC (scout-spec.ts) stays the source of truth: tests/scout-flow.test.tsx holds what this registers equal to it.
import type { EngineInterface } from 'claude-code'

/** Registers the scout with this system prompt: SCOUT_SPEC's own at session start, or with the brief in it for Clawd's hire. */
// A function declaration, not an arrow: the engine follows `$` past an import only into one.
export function registerScout($: EngineInterface, prompt: string) {
  return $.agent.register({
    name: 'scout',
    description: 'Clawd HQ\'s own scout for its setup step. Not for general use: the plugin starts it itself.',
    prompt,
    tools: ['Read', 'Glob'],
    disallowedTools: ['Grep', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'],
    permissionMode: 'dontAsk',
    model: 'sonnet',
    omitClaudeMd: true,
    maxTurns: 20,
  })
}
