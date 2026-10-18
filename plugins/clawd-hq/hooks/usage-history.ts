// What past sessions in this folder used: agent and skill names with counts. Nothing else is kept, and it never leaves this computer.
// Reads through OnboardIo closures only (the session files are Claude Code's own and may change shape, so every line is read defensively).
// A skill shows up two ways: the Skill tool (a tool_use block) and a slash command (a user line that begins with the command tags).
// The file read refuses more than 4 MiB and has no range option, so a session file that big is not read; its agents come from the small
// `subagents/*.meta.json` files beside it (usage-subagents.ts) and its other uses from the running tally the plugin keeps (use-tally.ts).
import type { FsListEntry, OnboardIo, PastUse } from './onboard-types'
import { EMPTY, MAX_FILE_BYTES, countLine, sumCounts, mostOf } from './usage-count'
import type { Counts, Tally } from './usage-count'
import { subagentUse } from './usage-subagents'
import type { SessionUse } from './usage-subagents'
import { savedTally } from './use-tally'
import type { SessionTally } from './use-tally'

export { MAX_FILE_BYTES, countLine }
/** The newest session files looked at, and the most bytes read in all (session files and subagent files together). */
export const MAX_FILES = 100
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024

export type UsageIo = Pick<OnboardIo, 'cwd' | 'home' | 'configDir' | 'list' | 'read' | 'breakdown' | 'commands' | 'get' | 'set'>
type Listed = FsListEntry & { readonly mtimeMs?: number }

/** The folder name Claude Code gives a project: slash, underscore and dot become a dash. A looser name (every other character too) is the second try. */
export function projectFolders(cwd: string): readonly string[] {
  const tested = cwd.replace(/[/_.]/g, '-')
  const loose = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  return tested === loose ? [tested] : [tested, loose]
}

const newestFirst = (a: Listed, b: Listed) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || (a.name < b.name ? 1 : -1)
/** A session file is named by its session id. */
const sessionOf = (e: Listed) => e.name.replace(/\.jsonl$/, '')

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

/** Reads the chosen session files line by line; the counts, the sessions that were read and the bytes they took. */
async function readSessions(io: UsageIo, dir: string, chosen: readonly Listed[]): Promise<{ tally: Tally; read: ReadonlySet<string>; bytes: number }> {
  let tally: Tally = EMPTY
  const read = new Set<string>()
  let bytes = 0
  for (const entry of chosen) {
    const text = await io.read(`${dir}/${entry.name}`)
    if (text === undefined) continue
    tally = text.split('\n').reduce((acc, line) => countLine(line, acc), tally)
    read.add(sessionOf(entry))
    bytes += entry.size ?? 0
  }
  return { tally, read, bytes }
}

/**
 * What the sessions add beyond the files that were read: for each session whose file was not read, its subagent files and the running tally
 * (the same events seen two ways, so the larger count of each name); for a session that was read, only the skills its subagents ran.
 * A session the tally knows but the newest files no longer list counts from the tally alone.
 */
function extraUse(subs: readonly SessionUse[], saved: SessionTally, unread: ReadonlySet<string>): Counts {
  const fromFiles = subs.map(({ session, counts }) => (unread.has(session) && saved[session] ? mostOf(counts, saved[session]) : counts))
  const listed = new Set(subs.map(s => s.session))
  const tallyOnly = Object.entries(saved).filter(([session]) => !listed.has(session)).map(([, counts]) => counts)
  return [...fromFiles, ...tallyOnly].reduce(sumCounts, EMPTY)
}

/** Past use in this folder: the newest 100 session files under 4 MiB and 32 MiB in all, counted line by line, with the subagent files and the running tally beside them. */
export async function pastUse(io: UsageIo): Promise<PastUse> {
  const { dir, files } = await sessionFiles(io)
  const newest = [...files].sort(newestFirst).slice(0, MAX_FILES)
  const small = newest.filter(e => (e.size ?? 0) <= MAX_FILE_BYTES)
  const chosen = withinBudget(small)
  const { tally, read, bytes } = await readSessions(io, dir, chosen)
  const sessions = newest.map(sessionOf)
  const unread = new Set(sessions.filter(s => !read.has(s)))
  const subs = await subagentUse(io, dir, sessions, unread, MAX_TOTAL_BYTES - bytes)
  const counts = sumCounts(settle(tally, await skillCommands(io)), extraUse(subs, await savedTally(io, io.cwd), unread))
  return { ...counts, files: read.size, skipped: newest.length - chosen.length }
}
