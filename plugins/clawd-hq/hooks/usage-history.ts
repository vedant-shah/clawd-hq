// What past sessions in this folder used: agent and skill names with counts. Nothing else is kept, and it never leaves this computer.
// Reads through OnboardIo closures only (the session files are Claude Code's own and may change shape, so every line is read defensively).
import type { FsListEntry, OnboardIo, PastUse } from './onboard-types'

/** The newest session files read, and the size above which one is left out. */
export const MAX_FILES = 100
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export type UsageIo = Pick<OnboardIo, 'cwd' | 'home' | 'configDir' | 'list' | 'read'>
type Counts = Pick<PastUse, 'agents' | 'skills'>
type Listed = FsListEntry & { readonly mtimeMs?: number }

/** The folder name Claude Code gives a project: slash, underscore and dot become a dash. A looser name (every other character too) is the second try. */
export function projectFolders(cwd: string): readonly string[] {
  const tested = cwd.replace(/[/_.]/g, '-')
  const loose = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return tested === loose ? [tested] : [tested, loose]
}

const bump = (record: Readonly<Record<string, number>>, name: string): Record<string, number> => ({ ...record, [name]: (record[name] ?? 0) + 1 })

/** Adds one block's use to the counts, or returns them as they were. */
function countBlock(counts: Counts, block: unknown): Counts {
  if (typeof block !== 'object' || block === null) return counts
  const { type, name, input } = block as { type?: unknown; name?: unknown; input?: unknown }
  if (type !== 'tool_use' || typeof input !== 'object' || input === null) return counts
  const { subagent_type: agent, skill } = input as { subagent_type?: unknown; skill?: unknown }
  if ((name === 'Agent' || name === 'Task') && typeof agent === 'string' && agent) return { ...counts, agents: bump(counts.agents, agent) }
  if (name === 'Skill' && typeof skill === 'string' && skill) return { ...counts, skills: bump(counts.skills, skill) }
  return counts
}

/** Counts one session line. Only the names it holds are looked at; a line that is not JSON, or holds no tool use, changes nothing. */
export function countLine(line: string, counts: Counts): Counts {
  if (!line.includes('"tool_use"')) return counts
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return counts
  }
  const content = (parsed as { message?: { content?: unknown } } | null)?.message?.content
  return Array.isArray(content) ? content.reduce(countBlock, counts) : counts
}

const newestFirst = (a: Listed, b: Listed) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || (a.name < b.name ? 1 : -1)

async function sessionFiles(io: UsageIo): Promise<{ dir: string; files: readonly Listed[] }> {
  const root = `${io.configDir() ?? `${io.home()}/.claude`}/projects`
  for (const folder of projectFolders(io.cwd)) {
    const dir = `${root}/${folder}`
    const listed = await io.list(dir).then(found => found, () => [] as readonly Listed[])
    const files = listed.filter(e => !e.isDir && e.name.endsWith('.jsonl'))
    if (files.length > 0) return { dir, files }
  }
  return { dir: root, files: [] }
}

/** Past use in this folder: the newest 100 session files under 4 MiB, counted line by line. */
export async function pastUse(io: UsageIo): Promise<PastUse> {
  const { dir, files } = await sessionFiles(io)
  const small = files.filter(e => (e.size ?? 0) <= MAX_FILE_BYTES)
  const newest = [...small].sort(newestFirst).slice(0, MAX_FILES)
  let counts: Counts = { agents: {}, skills: {} }
  let read = 0
  for (const entry of newest) {
    const text = await io.read(`${dir}/${entry.name}`)
    if (text === undefined) continue
    counts = text.split('\n').reduce((acc, line) => countLine(line, acc), counts)
    read += 1
  }
  return { ...counts, files: read, skipped: files.length - small.length }
}
