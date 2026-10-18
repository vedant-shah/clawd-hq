// Counting agent and skill use from one line of a session file, or one tool call. Names only: nothing else is looked at or kept.
import type { PastUse } from './onboard-types'

export type Counts = Pick<PastUse, 'agents' | 'skills'>
/** The counts while reading: slash commands wait in `commands` until the names the engine knows are checked. */
export type Tally = Counts & { readonly commands?: Readonly<Record<string, number>> }

export const EMPTY: Counts = { agents: {}, skills: {} }

/** The size above which one file is left out: the file read refuses more than 4 MiB. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export const bump = (record: Readonly<Record<string, number>>, name: string): Record<string, number> => ({ ...record, [name]: (record[name] ?? 0) + 1 })

/** The tools whose use is counted: those that start an agent and those that run a skill. */
export const isCountedTool = (tool: unknown): boolean => tool === 'Agent' || tool === 'Task' || tool === 'Skill'

/** Adds one tool use to the counts, or returns them as they were. `input` holds the tool's arguments (`subagent_type`, `skill`). */
export function countUse<T extends Counts>(counts: T, tool: unknown, input: unknown): T {
  if (typeof input !== 'object' || input === null) return counts
  const { subagent_type: agent, skill } = input as { subagent_type?: unknown; skill?: unknown }
  if ((tool === 'Agent' || tool === 'Task') && typeof agent === 'string' && agent) return { ...counts, agents: bump(counts.agents, agent) }
  if (tool === 'Skill' && typeof skill === 'string' && skill) return { ...counts, skills: bump(counts.skills, skill) }
  return counts
}

function countBlock(counts: Tally, block: unknown): Tally {
  if (typeof block !== 'object' || block === null) return counts
  const { type, name, input } = block as { type?: unknown; name?: unknown; input?: unknown }
  return type === 'tool_use' ? countUse(counts, name, input) : counts
}

/** A slash command's text begins with its tags (message then name, or name then message); text that only quotes them does not. */
const COMMAND_TEXT = /^\s*<command-(?:message|name)>/
const COMMAND_NAME = /<command-name>\/?([^<\s]+)<\/command-name>/

function countCommand(counts: Tally, content: unknown): Tally {
  const name = typeof content === 'string' && COMMAND_TEXT.test(content) ? COMMAND_NAME.exec(content)?.[1] : undefined
  return name ? { ...counts, commands: bump(counts.commands ?? {}, name) } : counts
}

/** Counts one session line. Only the names it holds are looked at; a line that is not JSON, or holds no tool use or command, changes nothing. */
export function countLine(line: string, counts: Tally): Tally {
  if (!line.includes('"tool_use"') && !line.includes('<command-name>')) return counts
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return counts
  }
  const content = (parsed as { message?: { content?: unknown } } | null)?.message?.content
  return Array.isArray(content) ? content.reduce(countBlock, counts) : countCommand(counts, content)
}

const merged = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>, pick: (x: number, y: number) => number): Record<string, number> =>
  Object.entries(b).reduce<Record<string, number>>((acc, [name, n]) => ({ ...acc, [name]: pick(acc[name] ?? 0, n) }), { ...a })

/** Two counts added together: different events. */
export const sumCounts = (a: Counts, b: Counts): Counts => ({ agents: merged(a.agents, b.agents, (x, y) => x + y), skills: merged(a.skills, b.skills, (x, y) => x + y) })

/** Two counts of the same events seen two ways (session files and the running tally): each name takes the larger, so nothing counts twice. */
export const mostOf = (a: Counts, b: Counts): Counts => ({ agents: merged(a.agents, b.agents, Math.max), skills: merged(a.skills, b.skills, Math.max) })
