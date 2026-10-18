// What a session's subagent files show. Every session folder holds `subagents/agent-<id>.meta.json` (small: the agent's type and a few facts)
// and `agent-<id>.jsonl` (that agent's own session). A session file too big to read still has its agents named here, and the skills a subagent ran
// are only ever in its own file. Only the agent type and Skill tool names are read; nothing else is kept.
import type { FsListEntry, OnboardIo } from './onboard-types'
import { EMPTY, MAX_FILE_BYTES, bump, countLine } from './usage-count'
import type { Counts } from './usage-count'

export type SubagentIo = Pick<OnboardIo, 'list' | 'read'>

/** A meta file is a few hundred bytes; one far bigger is not one. */
export const MAX_META_BYTES = 16 * 1024
/** The most subagent files read in all, meta files first. */
export const MAX_SUBAGENT_READS = 1000
const MAX_NAME_CHARS = 100

type Listed = FsListEntry & { readonly mtimeMs?: number }
type Folder = { readonly session: string; readonly isUnread: boolean; readonly entries: readonly Listed[] }
/** One session's counts from its subagent files. */
export type SessionUse = { readonly session: string; readonly counts: Counts }

const isMeta = (e: Listed) => !e.isDir && /^agent-.+\.meta\.json$/.test(e.name) && (e.size ?? 0) <= MAX_META_BYTES
const isAgentFile = (e: Listed) => !e.isDir && /^agent-.+\.jsonl$/.test(e.name)
const newestFirst = (a: Listed, b: Listed) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || (a.name < b.name ? 1 : -1)

/** The agent type of a meta file, or nothing when the file is not JSON or names none. */
export function agentTypeOf(text: string): string | undefined {
  try {
    const type = (JSON.parse(text) as { agentType?: unknown } | null)?.agentType
    return typeof type === 'string' && type !== '' && type.length <= MAX_NAME_CHARS ? type : undefined
  } catch {
    return undefined
  }
}

async function foldersOf(io: SubagentIo, dir: string, sessions: readonly string[], unread: ReadonlySet<string>): Promise<readonly Folder[]> {
  return Promise.all(sessions.map(async (session): Promise<Folder> => ({
    session, isUnread: unread.has(session), entries: await io.list(`${dir}/${session}/subagents`).then(found => found, () => [] as readonly Listed[]),
  })))
}

/** Agent types from the meta files of the sessions whose own file was not read, up to `room` files; those sessions' counts and the files used. */
async function agentsOf(io: SubagentIo, dir: string, folders: readonly Folder[], room: number): Promise<{ uses: readonly SessionUse[]; used: number }> {
  let used = 0
  const uses: SessionUse[] = []
  for (const f of folders.filter(x => x.isUnread)) {
    let agents: Record<string, number> = {}
    for (const e of f.entries.filter(isMeta)) {
      if (used >= room) break
      used += 1
      const type = agentTypeOf((await io.read(`${dir}/${f.session}/subagents/${e.name}`)) ?? '')
      if (type) agents = bump(agents, type)
    }
    uses.push({ session: f.session, counts: { ...EMPTY, agents } })
  }
  return { uses, used }
}

/** Skills the subagent files ran, newest first, until the reads or the bytes run out. */
async function skillsOf(io: SubagentIo, dir: string, folders: readonly Folder[], room: number, bytes: number): Promise<readonly SessionUse[]> {
  let [reads, left] = [0, bytes]
  const uses: SessionUse[] = []
  for (const f of folders) {
    let skills: Record<string, number> = {}
    for (const e of f.entries.filter(isAgentFile).sort(newestFirst)) {
      const size = e.size ?? 0
      if (reads >= room || size > left || size > MAX_FILE_BYTES) continue
      reads += 1
      left -= size
      const text = await io.read(`${dir}/${f.session}/subagents/${e.name}`)
      skills = (text ?? '').split('\n').reduce((acc, line) => countLine(line, { ...EMPTY, skills: acc }).skills, skills)
    }
    uses.push({ session: f.session, counts: { ...EMPTY, skills } })
  }
  return uses
}

/**
 * The subagent files of these sessions (newest first). Agent types come from the meta files of the `unread` sessions only (a session file that was
 * read already counted its agents); skills come from every session's subagent files. `bytes` is what is left of the read budget.
 */
export async function subagentUse(io: SubagentIo, dir: string, sessions: readonly string[], unread: ReadonlySet<string>, bytes: number): Promise<readonly SessionUse[]> {
  const folders = await foldersOf(io, dir, sessions, unread)
  const agents = await agentsOf(io, dir, folders, MAX_SUBAGENT_READS)
  const skills = await skillsOf(io, dir, folders, MAX_SUBAGENT_READS - agents.used, bytes)
  return sessions.map((session): SessionUse => ({
    session,
    counts: {
      agents: agents.uses.find(u => u.session === session)?.counts.agents ?? {},
      skills: skills.find(u => u.session === session)?.counts.skills ?? {},
    },
  }))
}
