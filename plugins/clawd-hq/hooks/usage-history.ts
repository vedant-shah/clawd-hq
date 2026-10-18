// What past sessions in this folder used: agent and skill names with counts. Nothing else is kept, and it never leaves this computer.
// Reads through OnboardIo closures only (the session files are Claude Code's own and may change shape, so every line is read defensively).
// A skill shows up two ways: the Skill tool (a tool_use block) and a slash command (a user line that begins with the command tags).
import type { FsListEntry, OnboardIo, PastUse } from './onboard-types'

/** The newest session files read, the size above which one is left out, and the most bytes read in all. */
export const MAX_FILES = 100
export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024

export type UsageIo = Pick<OnboardIo, 'cwd' | 'home' | 'configDir' | 'list' | 'read' | 'breakdown' | 'commands'>
type Counts = Pick<PastUse, 'agents' | 'skills'>
/** The counts while reading: slash commands wait in `commands` until the names the engine knows are checked. */
type Tally = Counts & { readonly commands?: Readonly<Record<string, number>> }
type Listed = FsListEntry & { readonly mtimeMs?: number }

/** The folder name Claude Code gives a project: slash, underscore and dot become a dash. A looser name (every other character too) is the second try. */
export function projectFolders(cwd: string): readonly string[] {
  const tested = cwd.replace(/[/_.]/g, '-')
  const loose = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return tested === loose ? [tested] : [tested, loose]
}

const bump = (record: Readonly<Record<string, number>>, name: string): Record<string, number> => ({ ...record, [name]: (record[name] ?? 0) + 1 })

/** Adds one block's use to the counts, or returns them as they were. */
function countBlock(counts: Tally, block: unknown): Tally {
  if (typeof block !== 'object' || block === null) return counts
  const { type, name, input } = block as { type?: unknown; name?: unknown; input?: unknown }
  if (type !== 'tool_use' || typeof input !== 'object' || input === null) return counts
  const { subagent_type: agent, skill } = input as { subagent_type?: unknown; skill?: unknown }
  if ((name === 'Agent' || name === 'Task') && typeof agent === 'string' && agent) return { ...counts, agents: bump(counts.agents, agent) }
  if (name === 'Skill' && typeof skill === 'string' && skill) return { ...counts, skills: bump(counts.skills, skill) }
  return counts
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

/** Walks the files in order and keeps those that fit in the byte budget; one that does not fit is passed over and a smaller one after it may still be read. */
function withinBudget(files: readonly Listed[]): readonly Listed[] {
  return files.reduce<{ kept: readonly Listed[]; bytes: number }>((acc, e) => {
    const size = e.size ?? 0
    return acc.bytes + size <= MAX_TOTAL_BYTES ? { kept: [...acc.kept, e], bytes: acc.bytes + size } : acc
  }, { kept: [], bytes: 0 }).kept
}

const bareOf = (name: string) => name.slice(name.indexOf(':') + 1)

/**
 * The slash commands that count as skill use: the ones named like a skill the engine lists (a plugin's command file is listed as a skill too).
 * Claude Code's own commands (/model, /clear) and a plugin's coded commands (/office) are not skills. Nothing is counted when the engine gives no list.
 */
async function skillCommands(io: UsageIo): Promise<(typed: string) => boolean> {
  const [breakdown, commands] = await Promise.all([io.breakdown().then(b => b, () => undefined), io.commands().then(c => c, () => [])])
  const builtin = new Set(commands.filter(c => c.source === 'builtin').map(c => c.name))
  const names = (breakdown?.skills ?? []).map(s => s.name)
  const exact = new Set(names)
  const short = new Set(names.map(bareOf))
  return typed => exact.has(typed) || (!builtin.has(typed) && short.has(typed))
}

/** The counts without the waiting commands: the ones that are skills are added to the skills. */
function settle(tally: Tally, isSkill: (typed: string) => boolean): Counts {
  const skills = Object.entries(tally.commands ?? {}).filter(([name]) => isSkill(name)).reduce<Record<string, number>>(
    (acc, [name, n]) => ({ ...acc, [name]: (acc[name] ?? 0) + n }), { ...tally.skills })
  return { agents: tally.agents, skills }
}

/** Past use in this folder: the newest 100 session files under 4 MiB and 32 MiB in all, counted line by line. */
export async function pastUse(io: UsageIo): Promise<PastUse> {
  const { dir, files } = await sessionFiles(io)
  const small = files.filter(e => (e.size ?? 0) <= MAX_FILE_BYTES)
  const newest = [...small].sort(newestFirst).slice(0, MAX_FILES)
  const chosen = withinBudget(newest)
  let tally: Tally = { agents: {}, skills: {} }
  let read = 0
  for (const entry of chosen) {
    const text = await io.read(`${dir}/${entry.name}`)
    if (text === undefined) continue
    tally = text.split('\n').reduce((acc, line) => countLine(line, acc), tally)
    read += 1
  }
  const counts = settle(tally, await skillCommands(io))
  return { ...counts, files: read, skipped: files.length - small.length + newest.length - chosen.length }
}
