// find_helpers: Clawd's search of everything installed before a hire. It lists the agents (laid off or not) and every skill the
// engine knows, ranks them against a plain description of the job by word overlap (no model call), and returns the top five with
// where each stands: staff (on this project's team), laid off (parked), or not on team. No `$` here: the lists come through closures.
import { CORE_FOUR } from './core-four'
import { installedHelpers } from './helpers'
import type { HelpersIo } from './helpers'
import { installedSkills } from './hire'
import type { SavedTeam } from './hire'
import { teamKey } from './onboard-types'
import type { OnboardIo, PastUse } from './onboard-types'
import { idOf } from './team-rules'

/** The most matches a search returns. */
export const MATCHES = 5
const JOB_CHARS = 1000

export type Status = 'staff' | 'laid off' | 'not on team'
/** One installed helper, as the search sees it. `id` is the exact name to hire it by; `hireAs` is the agent type of a staff skill's hire. */
export type Listed = { readonly id: string; readonly kind: 'agent' | 'skill'; readonly about: string; readonly status: Status; readonly hireAs?: string }
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

/** The best fits for the job, best first. At the same fit: staff, then not on team, then laid off, then by name. Nothing that shares no word is returned. */
export function rankHelpers(job: string, list: readonly Listed[], limit = MATCHES): readonly Listed[] {
  const words = jobWords(job)
  return list.map(h => ({ h, score: scoreOf(words, h) })).filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || ORDER[a.h.status] - ORDER[b.h.status] || a.h.id.localeCompare(b.h.id))
    .slice(0, limit).map(r => r.h)
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

/** The whole list with each one's place: staff for the shipped four and the team's picks, laid off for a parked agent, else not on team. */
export async function listHelpers(io: FindIo): Promise<readonly Listed[]> {
  const [base, saved] = [await everyone(io), await io.get<SavedTeam>(teamKey(io.cwd)).catch(() => undefined)]
  const [team, parked] = [teamOf(saved), new Set(io.parked())]
  return base.map((b): Listed => {
    const isStaff = team.picks.has(`${b.kind}:${b.id}`) || (b.kind === 'agent' && CORE.has(b.id))
    const status: Status = isStaff ? 'staff' : b.kind === 'agent' && parked.has(b.id) ? 'laid off' : 'not on team'
    const hire = b.kind === 'skill' && isStaff ? team.hires.find(h => h.skills.includes(b.id)) : undefined
    return { ...b, status, ...(hire ? { hireAs: `${OWN_PLUGIN}${hire.name}` } : {}) }
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

const shown = (h: Listed) => ({ name: h.id, kind: h.kind, about: h.about, status: h.status, next: nextOf(h) })

/** The answer to a call of `find_helpers`: the top matches for the job as JSON text, or why the call is refused. Only Clawd (no agent id) may search. */
export async function findHelpers(io: FindIo, agentId: string | undefined, input: Record<string, unknown>): Promise<{ readonly result: string } | { readonly deny: string }> {
  if (agentId !== undefined) return { deny: FIND_DENY }
  const job = typeof input.job === 'string' ? input.job.trim().slice(0, JOB_CHARS) : ''
  if (job === '') return { deny: 'job must be text: say what the work is in a few words.' }
  const matches = rankHelpers(job, await listHelpers(io)).map(shown)
  return { result: JSON.stringify(matches.length > 0 ? { matches } : { matches, note: NO_FIT }) }
}
