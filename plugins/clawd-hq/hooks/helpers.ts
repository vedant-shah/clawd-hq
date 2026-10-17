// The agents and skills the person has installed, with what each does, who it came from and how much it was used.
// Reads through OnboardIo closures only. Descriptions come from the agent hook's kept blurbs, the engine's command list or the SKILL.md / agent file itself.
import type { CommandEntry, Helper, OnboardIo, PastUse, UsageBreakdown } from './onboard-types'

export type HelpersIo = Pick<OnboardIo, 'cwd' | 'home' | 'configDir' | 'list' | 'read' | 'breakdown' | 'commands' | 'blurbs'>

/** Always on, never hired or parked. */
export const BUILT_INS: ReadonlySet<string> = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup'])
export const isBuiltIn = (name: string) => BUILT_INS.has(name)

const ABOUT_CHARS = 160
const OWN = 'your own'
const PROJECT = 'this project'
const NOT_ON_DISK = 'built in / not on disk'
const NO_ABOUT = 'Used here before; no description available.'
/** Helpers sessions often use that are not files on disk; written by Clawd HQ because a name alone is not enough to choose by. */
const KNOWN_ABOUT: Readonly<Record<string, string>> = {
  'claude-code-guide': 'Answers questions about Claude Code, its settings and hooks, and the Agent SDK.',
}

type Where = 'own' | 'project' | 'plugin'
type Found = { readonly name: string; readonly kind: 'agent' | 'skill'; readonly where: Where; readonly plugin?: string; readonly about: string }

/** The first sentence of a description, spaces folded, at most 160 characters and cut at a word, never mid-word. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = flat.split(/(?<=[.!?])\s/)[0] ?? ''
  if (sentence.length <= ABOUT_CHARS) return sentence
  const cut = sentence.slice(0, ABOUT_CHARS)
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 0) || ABOUT_CHARS)
}

/** The `description:` of a file's front matter: on one line, quoted, or folded (`>` or `|`) over indented lines. */
export function frontMatterDescription(text: string): string {
  const head = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!head) return ''
  const rows = (head[1] ?? '').split(/\r?\n/)
  const at = rows.findIndex(r => /^description:/.test(r))
  if (at < 0) return ''
  const value = (rows[at] ?? '').replace(/^description:\s*/, '').trim()
  if (/^[>|][+-]?$/.test(value)) {
    const body = rows.slice(at + 1)
    const end = body.findIndex(r => r.trim() !== '' && !/^\s/.test(r))
    return (end < 0 ? body : body.slice(0, end)).map(r => r.trim()).filter(Boolean).join(' ')
  }
  return value.replace(/^(["'])(.*)\1$/, '$2')
}

const bareOf = (name: string) => name.slice(name.indexOf(':') + 1)
const pluginOf = (name: string) => (name.includes(':') ? name.slice(0, name.indexOf(':')) : undefined)
const sourceOf = (where: Where, plugin?: string) => (where === 'own' ? OWN : where === 'project' ? PROJECT : plugin ?? 'installed')
const whereOf = (engineSource: string): Where => (/^(user|userSettings)$/.test(engineSource) ? 'own' : /^(project|projectSettings)$/.test(engineSource) ? 'project' : 'plugin')

/** Folders on disk named the way Claude Code looks for them. */
function diskDirs(io: HelpersIo, kind: 'agents' | 'skills'): ReadonlyArray<{ dir: string; where: Where }> {
  return [{ dir: `${io.configDir() ?? `${io.home()}/.claude`}/${kind}`, where: 'own' }, { dir: `${io.cwd}/.claude/${kind}`, where: 'project' }]
}

async function diskHelpers(io: HelpersIo, kind: 'agent' | 'skill'): Promise<readonly Found[]> {
  const groups = await Promise.all(diskDirs(io, kind === 'agent' ? 'agents' : 'skills').map(async ({ dir, where }) => {
    const entries = await io.list(dir).then(found => found, () => [])
    const wanted = entries.filter(e => (kind === 'skill' ? e.isDir : !e.isDir && e.name.endsWith('.md')))
    return Promise.all(wanted.map(async (e): Promise<Found> => {
      const file = kind === 'skill' ? `${dir}/${e.name}/SKILL.md` : `${dir}/${e.name}`
      const about = firstSentence(frontMatterDescription((await io.read(file)) ?? ''))
      return { name: kind === 'skill' ? e.name : e.name.replace(/\.md$/, ''), kind, where, about }
    }))
  }))
  return groups.flat()
}

function fromBreakdown(b: UsageBreakdown | undefined, blurbs: Readonly<Record<string, string>>, said: (name: string) => string): readonly Found[] {
  const agents = (b?.agents ?? []).map((a): Found => {
    const plugin = pluginOf(a.name)
    return { name: a.name, kind: 'agent', where: plugin ? 'plugin' : whereOf(a.source), plugin, about: firstSentence(blurbs[a.name] ?? '') }
  })
  const skills = (b?.skills ?? []).map((s): Found => ({
    name: s.name, kind: 'skill', where: s.pluginName ? 'plugin' : whereOf(s.source), plugin: s.pluginName ?? pluginOf(s.name), about: said(s.name),
  }))
  const blurbed = Object.keys(blurbs).map((name): Found => ({ name, kind: 'agent', where: 'plugin', plugin: pluginOf(name), about: firstSentence(blurbs[name] ?? '') }))
  return [...agents, ...skills, ...blurbed]
}

/** Each kind and name once; the first sighting wins, and it takes a description from a later one when it has none. */
function merge(found: readonly Found[]): readonly Found[] {
  return found.reduce<readonly Found[]>((acc, f) => {
    const same = (x: Found) => x.kind === f.kind && x.name === f.name
    const have = acc.find(same)
    if (!have) return [...acc, f]
    return have.about ? acc : acc.map(x => (same(x) ? { ...x, about: f.about } : x))
  }, [])
}

const countOf = (counts: Readonly<Record<string, number>>, key: string) => counts[key] ?? 0
function usesOf(counts: Readonly<Record<string, number>>, f: Found): number {
  const keys = new Set([f.name, f.name.includes(':') ? bareOf(f.name) : f.plugin ? `${f.plugin}:${f.name}` : f.name])
  return [...keys].reduce((sum, k) => sum + countOf(counts, k), 0)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Named as a whole word in the instruction text (the short name counts only when it has a dash, so plain words like "planner" do not). */
function isNamedIn(text: string, name: string): boolean {
  const lower = text.toLowerCase()
  const tests = (n: string) => new RegExp(`(^|[^a-z0-9:-])${escape(n.toLowerCase())}($|[^a-z0-9:-])`).test(lower)
  return tests(name) || (name.includes(':') && bareOf(name).includes('-') && tests(bareOf(name)))
}

const describe = (descriptions: ReadonlyMap<string, string>, f: Found) => f.about || firstSentence(descriptions.get(f.name) ?? descriptions.get(bareOf(f.name)) ?? '')

function descriptionsOf(commands: readonly CommandEntry[]): ReadonlyMap<string, string> {
  const pairs = commands.filter(c => c.description).flatMap(c => [[c.name, c.description as string] as const, [bareOf(c.name), c.description as string] as const])
  return new Map([...pairs].reverse())
}

function toHelper(f: Found, past: PastUse, instructions: string, descriptions: ReadonlyMap<string, string>): Helper {
  return {
    name: f.name,
    kind: f.kind,
    source: sourceOf(f.where, f.plugin),
    ...(f.plugin ? { plugin: f.plugin } : {}),
    about: describe(descriptions, f),
    uses: usesOf(f.kind === 'agent' ? past.agents : past.skills, f),
    isNamed: isNamedIn(instructions, f.name),
    isOwn: f.where === 'own',
  }
}

/** Names used in past sessions that no installed helper answers to. */
function usedButMissing(past: PastUse, installed: readonly Helper[]): readonly Helper[] {
  const known = (kind: 'agent' | 'skill', name: string) => installed.some(h => h.kind === kind && (h.name === name || (h.name.includes(':') && bareOf(h.name) === name)))
  const rows = [...Object.entries(past.agents).map(([n, c]) => ['agent', n, c] as const), ...Object.entries(past.skills).map(([n, c]) => ['skill', n, c] as const)]
  return rows.filter(([kind, name]) => !isBuiltIn(name) && !known(kind, name)).map(([kind, name, uses]) => ({
    name, kind, source: NOT_ON_DISK, about: KNOWN_ABOUT[name] ?? NO_ABOUT, uses, isNamed: false, isOwn: false,
  }))
}

/**
 * The agents and skills available here. `instructions` is the text of the instruction files (to see which helpers are named in them).
 * A failing engine list never stops the rest: own and project files on disk and the kept blurbs fill in.
 */
export async function installedHelpers(io: HelpersIo, past: PastUse, instructions: string): Promise<readonly Helper[]> {
  const [breakdown, commands, agentFiles, skillFiles] = await Promise.all([
    io.breakdown().then(b => b, () => undefined),
    io.commands().then(c => c, () => [] as readonly CommandEntry[]),
    diskHelpers(io, 'agent'),
    diskHelpers(io, 'skill'),
  ])
  const descriptions = descriptionsOf(commands)
  const disk = new Map([...agentFiles, ...skillFiles].map(f => [`${f.kind}:${f.name}`, f.about]))
  const listed = fromBreakdown(breakdown, io.blurbs(), name => disk.get(`skill:${name}`) ?? '')
  const found = merge([...listed, ...agentFiles, ...skillFiles]).filter(f => !isBuiltIn(f.name))
  const helpers = found.map(f => toHelper(f, past, instructions, descriptions))
  return [...helpers, ...usedButMissing(past, helpers)]
}
