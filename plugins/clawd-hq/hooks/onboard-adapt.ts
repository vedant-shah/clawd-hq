// Onboarding, piece 8: the engine's answers turned into the loose shapes OnboardIo uses, so register.tsx's closures stay
// one line each. Each takes the engine call as a closure; no `$` here.
import type { CommandEntry, FsListEntry, UsageBreakdown } from './onboard-types'

type Entry = { readonly name: string; readonly kind: string; readonly size?: number }

/** A folder's entries; a session file (`.jsonl`) also gets its modified time, so "the newest 100" really are. A failed stat leaves it out. */
export async function listEntries(dir: string, list: (dir: string) => Promise<readonly Entry[]>, stat: (path: string) => Promise<{ mtimeMs: number }>): Promise<readonly FsListEntry[]> {
  const entries = await list(dir)
  return Promise.all(entries.map(async (e): Promise<FsListEntry> => {
    const base = { name: e.name, isDir: e.kind === 'dir', ...(typeof e.size === 'number' ? { size: e.size } : {}) }
    if (e.kind !== 'file' || !e.name.endsWith('.jsonl')) return base
    const mtimeMs = await stat(`${dir}/${e.name}`).then(s => s.mtimeMs, () => undefined)
    return typeof mtimeMs === 'number' ? { ...base, mtimeMs } : base
  }))
}

type Breakdown = {
  readonly agents?: readonly { readonly agentType?: unknown; readonly source?: unknown }[]
  readonly skills?: { readonly includedSkills?: unknown; readonly totalSkills?: unknown; readonly skillFrontmatter?: readonly { readonly name?: unknown; readonly source?: unknown; readonly pluginName?: unknown }[] }
}
const text = (v: unknown) => (typeof v === 'string' ? v : '')
const count = (v: unknown) => (typeof v === 'number' ? v : undefined)

/** The agents and skills of `$.session.usage({ breakdown: 'summary' })`, or `undefined` when it has no breakdown. */
export function breakdownOf(usage: { readonly context?: { readonly breakdown?: Breakdown } } | undefined): UsageBreakdown | undefined {
  const b = usage?.context?.breakdown
  if (b === undefined) return undefined
  const agents = (b.agents ?? []).map(a => ({ name: text(a.agentType), source: text(a.source) })).filter(a => a.name)
  const skills = (b.skills?.skillFrontmatter ?? []).map(s => ({ name: text(s.name), source: text(s.source), ...(text(s.pluginName) ? { pluginName: text(s.pluginName) } : {}) })).filter(s => s.name)
  const [includedSkills, totalSkills] = [count(b.skills?.includedSkills), count(b.skills?.totalSkills)]
  return { agents, skills, ...(includedSkills === undefined ? {} : { includedSkills }), ...(totalSkills === undefined ? {} : { totalSkills }) }
}

/** The engine's command list as name, description and source. */
export const commandsOf = (list: readonly { readonly name: string; readonly description?: string; readonly source?: unknown }[]): readonly CommandEntry[] =>
  list.map(c => ({ name: c.name, ...(c.description ? { description: c.description } : {}), ...(typeof c.source === 'string' ? { source: c.source } : {}) }))

/** The paths of the files `$.fs.ancestors` found, nearest folder first as it lists them. */
export const ancestorPaths = (found: readonly { readonly dir: string; readonly name: string }[]): readonly string[] =>
  found.map(a => `${a.dir.replace(/\/+$/, '')}/${a.name}`)

/** A model's answer text, or `undefined` when it did not answer. */
export const answerText = (r: { readonly isAnswered: boolean; readonly text?: string }): string | undefined => (r.isAnswered ? r.text : undefined)
