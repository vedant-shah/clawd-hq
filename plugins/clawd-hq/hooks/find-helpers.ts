// find_helpers: Clawd's search of everything installed before a hire. It lists the agents (laid off or not) and every skill the
// engine knows, ranks them against a plain description of the job by word overlap (no model call), and returns the top five with
// where each stands: staff (on this project's team), laid off (parked), or not on team. No `$` here: the lists come through closures.
import { coveredCore } from './core-cover'
import { CORE_FOUR } from './core-four'
import { installedHelpers } from './helpers'
import type { HelpersIo } from './helpers'
import { hireTypes, installedSkills } from './hire'
import type { SavedTeam } from './hire'
import { teamKey } from './onboard-types'
import type { OnboardIo, PastUse } from './onboard-types'
import { useOf } from './skill-use'
import { idOf } from './team-rules'

/** The most matches a search returns. */
export const MATCHES = 5
const JOB_CHARS = 1000
const MAX_KEYWORDS = 12
const KEYWORD_CHARS = 40

export type Status = 'staff' | 'laid off' | 'not on team'
/**
 * One installed helper, as the search sees it. `id` is the exact name to hire it by; `hireAs` is the agent type of a staff skill's hire;
 * `covers` is the one of Clawd HQ's own four whose role it fills, when it is not laid off (hooks/core-cover.ts).
 */
export type Listed = { readonly id: string; readonly kind: 'agent' | 'skill'; readonly about: string; readonly status: Status; readonly hireAs?: string; readonly covers?: string }
/** What the search reads: the lists setup reads, the saved team and the parked agents. */
export type FindIo = HelpersIo & Pick<OnboardIo, 'get' | 'parked'>

// ---- Words ----

const STOP = new Set(('a an the and or but of to for in on at by as with from into about my me we us our your you it its is are was be do does did not no so up ' +
  'this that these those then than also just any all some can could will would should please help need needs want make makes use used using new job work thing things get got').split(' '))
const ENDINGS = ['ing', 'ed', 'es', 'er', 's']

/** A word with its ending folded and a closing "e" dropped, so "testing", "tests" and "tester" meet. */
function stem(word: string): string {
  const end = ENDINGS.find(e => word.length >= e.length + 3 && word.endsWith(e))
  const cut = end === undefined ? word : word.slice(0, -end.length)
  return cut.length > 3 && cut.endsWith('e') ? cut.slice(0, -1) : cut
}

/** The plain stems of a text: stop words and one-letter words gone. */
export const jobWords = (text: string): ReadonlySet<string> =>
  new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 2 && !STOP.has(w)).map(stem))

// ---- Ranking ----

const NAME_WEIGHT = 3
const ORDER: Readonly<Record<Status, number>> = { staff: 0, 'not on team': 1, 'laid off': 2 }
const bareName = (id: string) => id.slice(id.indexOf(':') + 1)

/** A word of the job in the helper's own name counts three, in its description one. */
function scoreOf(job: ReadonlySet<string>, h: Listed): number {
  const [name, about] = [jobWords(bareName(h.id)), jobWords(h.about)]
  return [...job].reduce((sum, w) => sum + (name.has(w) ? NAME_WEIGHT : 0) + (about.has(w) ? 1 : 0), 0)
}

/** The keywords Clawd gave: text only, trimmed, blanks dropped, the first twelve. Anything else gives none. */
export const keywordsOf = (input: unknown): readonly string[] =>
  Array.isArray(input) ? input.filter((k): k is string => typeof k === 'string').map(k => k.trim().slice(0, KEYWORD_CHARS)).filter(k => k !== '').slice(0, MAX_KEYWORDS) : []

/** How far below its best cover's score one of Clawd HQ's own helpers is put: less than one word, so it lands just below. */
const BELOW_COVER = 0.5

type Scored = { readonly h: Listed; readonly score: number; readonly rank: number }

/** The rows that share a word with the job, best rank first; at the same rank by status, then by name. */
const sorted = (rows: readonly Scored[]): readonly Scored[] =>
  rows.filter(r => r.score > 0).sort((a, b) => b.rank - a.rank || ORDER[a.h.status] - ORDER[b.h.status] || a.h.id.localeCompare(b.h.id))

/** The ranks with one of the four whose role a cover in `shown` fills put just below that cover's best score. */
function capped(rows: readonly Scored[], shown: readonly Scored[]): readonly Scored[] {
  const coverScore = (id: string) => Math.max(...shown.filter(r => r.h.covers === id).map(r => r.score))
  const covered = new Set(shown.flatMap(r => (r.h.covers === undefined ? [] : [r.h.covers])))
  return rows.map(r => (covered.has(r.h.id) ? { ...r, rank: Math.min(r.score, coverScore(r.h.id) - BELOW_COVER) } : r))
}

/**
 * The best fits for the job and its keywords, best first. At the same fit: staff, then not on team, then laid off, then by name. Nothing that
 * shares no word is returned. One of Clawd HQ's own four ranks just below a helper on the team that covers its role, when that cover fits the
 * job itself and is among the matches; otherwise it ranks by its own fit.
 */
export function rankHelpers(job: string, list: readonly Listed[], limit = MATCHES, keywords: readonly string[] = []): readonly Listed[] {
  const words = jobWords([job, ...keywords].join(' '))
  const rows = list.map((h): Scored => {
    const score = scoreOf(words, h)
    return { h, score, rank: score }
  })
  return sorted(capped(rows, sorted(rows).slice(0, limit))).slice(0, limit).map(r => r.h)
}

// ---- Everything installed ----

const NO_USE: PastUse = { agents: {}, skills: {}, files: 0, skipped: 0 }
const OWN_PLUGIN = 'clawd-hq:'
const CORE = new Set(CORE_FOUR.map(h => h.type))
type Base = Pick<Listed, 'id' | 'kind' | 'about'>

/**
 * Every agent and skill the engine lists, from the full lists (not the cut one the model is shown): the breakdown, the command list for the
 * skills past the cut, the files on disk and the kept descriptions. This plugin's own hires stay out beside their skills; the shipped four stay in.
 */
async function everyone(io: FindIo): Promise<readonly Base[]> {
  const [helpers, skills] = await Promise.all([installedHelpers(io, NO_USE, ''), installedSkills(io)])
  const known = new Set(helpers.filter(h => h.kind === 'skill').flatMap(h => [h.name, idOf(h)]))
  const more = (skills ?? []).filter(s => !known.has(s.name)).map((s): Base => ({ id: s.name, kind: 'skill', about: s.about }))
  const all = [...helpers.map((h): Base => ({ id: idOf(h), kind: h.kind, about: h.about })), ...more]
  const kept = all.filter(b => !(b.kind === 'agent' && b.id.startsWith(OWN_PLUGIN) && !CORE.has(b.id)))
  return [...new Map(kept.map(b => [`${b.kind}:${b.id}`, b])).values()]
}

/** The saved team's picks and hires, when the record is whole enough to read. */
const teamOf = (saved: SavedTeam | undefined) => ({
  picks: new Set(Array.isArray(saved?.picks) ? saved.picks.map(p => `${p.kind}:${p.name}`) : []),
  hires: Array.isArray(saved?.hires) ? saved.hires : [],
})

/** Which of the four a helper not laid off covers: an agent by its name, a skill by its saved hire's, while that hire is not laid off. */
function coversOf(b: Base, hireAs: string | undefined, own: ReadonlySet<string>, parked: ReadonlySet<string>): string | undefined {
  if (b.kind === 'agent') return parked.has(b.id) ? undefined : coveredCore(b.id, own)
  return hireAs === undefined || parked.has(hireAs) ? undefined : coveredCore(hireAs, own)
}

/**
 * The whole list with each one's place: staff for the shipped four (unless laid off, as when an installed helper covers its role) and the
 * team's picks, laid off for a parked agent, else not on team.
 */
export async function listHelpers(io: FindIo): Promise<readonly Listed[]> {
  const [base, saved] = [await everyone(io), await io.get<SavedTeam>(teamKey(io.cwd)).catch(() => undefined)]
  const [team, parked, own] = [teamOf(saved), new Set(io.parked()), new Set(hireTypes(saved))]
  return base.map((b): Listed => {
    // One of the four may be a pick of the setup as well: laid off, it is not staff whatever the picks say.
    const isCore = b.kind === 'agent' && CORE.has(b.id)
    const isStaff = isCore ? !parked.has(b.id) : team.picks.has(`${b.kind}:${b.id}`)
    const status: Status = isStaff ? 'staff' : b.kind === 'agent' && parked.has(b.id) ? 'laid off' : 'not on team'
    const hire = b.kind === 'skill' ? team.hires.find(h => h.skills.includes(b.id)) : undefined
    const hireAs = hire ? `${OWN_PLUGIN}${hire.name}` : undefined
    const covers = coversOf(b, hireAs, own, parked)
    return { ...b, status, ...(hireAs && isStaff ? { hireAs } : {}), ...(covers ? { covers } : {}) }
  })
}

// ---- The answer ----

const CONTRACTOR_NAME = 'hire_contractor'
/** The refusal for anyone but Clawd. */
export const FIND_DENY = 'Only Clawd searches for helpers. Put what you need in your report and Clawd will staff it.'
const NO_FIT = 'Nothing installed fits this job. Use the general-purpose agent, write a fuller brief, and say in one line why nothing fit.'

/** What to do next with a match, in a line the model can follow. */
function nextOf(h: Listed): string {
  if (h.kind === 'agent') {
    return h.status === 'laid off'
      ? `Parked for this project. If it fits best, say so in one line and hire it anyway with the Agent tool as "${h.id}", or suggest bringing it back from the People tab.`
      : `Hire it with the Agent tool as "${h.id}".`
  }
  if (h.status === 'staff') return h.hireAs ? `On the team. Hire the agent "${h.hireAs}" with the Agent tool, and give it a role name.` : `On the team, but its hire is not registered. Call ${CONTRACTOR_NAME} with skill "${h.id}".`
  return `Not on the team. Call ${CONTRACTOR_NAME} with skill "${h.id}" and a short role, then hire the agent it returns.`
}

/** A match as Clawd sees it. A skill also says what it adds (`use`); an agent has no such label. */
const shown = (h: Listed) => ({ name: h.id, kind: h.kind, ...(h.kind === 'skill' ? { use: useOf(h.id, h.about) } : {}), about: h.about, status: h.status, next: nextOf(h) })

/** The answer to a call of `find_helpers`: the top matches for the job as JSON text, or why the call is refused. Only Clawd (no agent id) may search. */
export async function findHelpers(io: FindIo, agentId: string | undefined, input: Record<string, unknown>): Promise<{ readonly result: string } | { readonly deny: string }> {
  if (agentId !== undefined) return { deny: FIND_DENY }
  const job = typeof input.job === 'string' ? input.job.trim().slice(0, JOB_CHARS) : ''
  if (job === '') return { deny: 'job must be text: say what the work is in a few words.' }
  const matches = rankHelpers(job, await listHelpers(io), MATCHES, keywordsOf(input.keywords)).map(shown)
  return { result: JSON.stringify(matches.length > 0 ? { matches } : { matches, note: NO_FIT }) }
}
