// Onboarding, piece 5: "Hire this team" made real. Agents not on the team are parked through the payroll laid-off list
// (one tap in People brings each back). Skills on the team become hires: an agent with the skill preloaded, listed as
// `clawd-hq:<name>`. A skill name the engine does not know fails silently, so every name is checked against the
// installed list first and a name that is not there is dropped and reported. Skills cannot be hidden, only agents parked.
// No `$` here: the engine is reached through OnboardIo closures that register.tsx fills.
import { firstSentence, isBuiltIn } from './helpers'
import type { CommandEntry, HireSpec, OnboardIo, Pick as SeatPick, Seat, Team } from './onboard-types'
import { teamKey } from './onboard-types'

/** The calls hiring needs. */
export type HireIo = Readonly<Pick<OnboardIo, 'cwd' | 'get' | 'set' | 'breakdown' | 'commands' | 'allAgentTypes' | 'savePayroll' | 'registerHire'>>
/** The calls a rehire at session start needs. */
export type RehireIo = Readonly<Pick<OnboardIo, 'cwd' | 'get' | 'breakdown' | 'commands' | 'registerHire'>>

/** A skill the engine lists: its exact name and the first sentence of what it does. */
export type InstalledSkill = { readonly name: string; readonly about: string }
/** What a hire or rehire did. Names are as listed: `clawd-hq:<name>`. */
export type HireReport = {
  readonly parked: number
  readonly hired: readonly string[]
  /** Skill names not in the installed list. They were not hired. */
  readonly dropped: readonly string[]
  /** Hires the engine would not register. */
  readonly failed: readonly string[]
  /** The list of parked agents could not be saved, so none were parked. */
  readonly isParkFailed?: true
}
/** The team as kept at `team:<folder>`, with the hires made from it. */
export type SavedTeam = Team & { readonly hires?: readonly HireSpec[] }

const OWN_PLUGIN = 'clawd-hq'
const NAME_CHARS = 64
export const HIRE_PROMPT ='The skill listed for you is preloaded into your context. Follow it for the task you are given, do only that task, and report back plainly: what you did, what you found, and anything left undone.'
const EMPTY_REPORT: HireReport = { parked: 0, hired: [], dropped: [], failed: [] }

const listedAs = (name: string) => `${OWN_PLUGIN}:${name}`
const bareOf = (name: string) => name.slice(name.indexOf(':') + 1)

// ---- Parking ----

/** Agent types not on the team, minus built-ins and this plugin's own hires. Only agents are parked: a skill on the team never protects or hides an agent type. */
export function parkList(allAgentTypes: readonly string[], team: Team): readonly string[] {
  const kept = new Set(team.picks.filter(p => p.kind === 'agent').map(p => p.name))
  return allAgentTypes.filter(t => !isBuiltIn(t) && !t.startsWith(`${OWN_PLUGIN}:`) && !kept.has(t))
}

// ---- Hires ----

/** The skill's short name with only letters, digits, `-` and `_`, at most 64 characters. */
const cleanName = (id: string) => bareOf(id).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, NAME_CHARS)
const seatWord = (seat: Seat) => seat.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** A name no other hire in this batch has: the short name, else with the seat added, else numbered. */
function freeName(taken: ReadonlySet<string>, short: string, seat: Seat): string {
  const withSeat = `${seatWord(seat)}-${short}`.slice(0, NAME_CHARS)
  const options = [short, withSeat, ...Array.from({ length: 98 }, (_, i) => `${withSeat.slice(0, NAME_CHARS - 3)}-${i + 2}`)]
  return options.find(n => !taken.has(n)) ?? short
}

function specFor(pick: SeatPick, skill: InstalledSkill | undefined, name: string): HireSpec {
  const about = skill?.about || pick.name
  return { name, description: `${pick.seat}: ${about}`, prompt: HIRE_PROMPT, skills: [pick.name] }
}

/**
 * One hire per skill on the team. With an installed list, a name not exactly in it is dropped and reported
 * (a wrong name fails silently). With no list there is nothing to check against, so nothing is dropped.
 */
export function skillHires(team: Team, installed: readonly InstalledSkill[] | undefined): { readonly hires: readonly HireSpec[]; readonly dropped: readonly string[] } {
  const known = installed ? new Map(installed.map(s => [s.name, s])) : undefined
  return team.picks.filter(p => p.kind === 'skill').reduce<{ hires: readonly HireSpec[]; dropped: readonly string[] }>((acc, pick) => {
    if (known && !known.has(pick.name)) return { ...acc, dropped: [...acc.dropped, pick.name] }
    const short = cleanName(pick.name)
    if (!short) return { ...acc, dropped: [...acc.dropped, pick.name] }
    const name = freeName(new Set(acc.hires.map(h => h.name)), short, pick.seat)
    return { ...acc, hires: [...acc.hires, specFor(pick, known?.get(pick.name), name)] }
  }, { hires: [], dropped: [] })
}

/**
 * The skills the engine lists. When it cut its list (or gave none), the command list tops it up.
 * `undefined` when neither list is there, so a caller does not drop every name for want of a list.
 */
export async function installedSkills(io: Pick<OnboardIo, 'breakdown' | 'commands'>): Promise<readonly InstalledSkill[] | undefined> {
  const [breakdown, commands] = await Promise.all([
    io.breakdown().then(b => b, () => undefined),
    io.commands().then(c => c, () => [] as readonly CommandEntry[]),
  ])
  const about = new Map(commands.map(c => [c.name, firstSentence(c.description ?? '')]))
  const listed = (breakdown?.skills ?? []).map(s => ({ name: s.name, about: about.get(s.name) ?? '' }))
  const isCut = !breakdown || (breakdown.totalSkills !== undefined && (breakdown.includedSkills ?? 0) < breakdown.totalSkills)
  const extra = isCut ? commands.filter(c => !listed.some(s => s.name === c.name)).map(c => ({ name: c.name, about: about.get(c.name) ?? '' })) : []
  const all = [...listed, ...extra]
  return all.length > 0 ? all : undefined
}

/** Registers each hire; a refusal or an error is a failure for that hire only. */
async function register(io: Pick<OnboardIo, 'registerHire'>, hires: readonly HireSpec[]): Promise<{ readonly hired: readonly string[]; readonly failed: readonly string[] }> {
  const results = await hires.reduce<Promise<readonly (readonly [string, boolean])[]>>(async (before, spec) => {
    const done = await before
    const isOk = await io.registerHire(spec).then(ok => ok, () => false)
    return [...done, [listedAs(spec.name), isOk] as const]
  }, Promise.resolve([]))
  return { hired: results.filter(([, ok]) => ok).map(([n]) => n), failed: results.filter(([, ok]) => !ok).map(([n]) => n) }
}

/** "Hire this team": park the rest, register the skill hires, keep the team with its hires. Each part carries on if another fails. */
export async function hireTeam(io: HireIo, team: Team): Promise<HireReport> {
  const { hires, dropped } = skillHires(team, await installedSkills(io))
  const parkedList = parkList(io.allAgentTypes(), team)
  const isParked = await io.savePayroll(parkedList).then(() => true, () => false)
  await io.set(teamKey(io.cwd), { ...team, hires } satisfies SavedTeam).catch(() => undefined)
  const { hired, failed } = await register(io, hires)
  return { parked: isParked ? parkedList.length : 0, hired, dropped, failed, ...(isParked ? {} : { isParkFailed: true as const }) }
}

/**
 * Adds one skill to the saved team as a specialist and registers its hire, with the team's other picks, its hires and the parked list left
 * as they were. This is how a contractor is made staff. A skill that is not in the installed list is not added (a wrong name fails silently).
 * A save that fails is thrown, so the caller can say so.
 */
export async function addSkillHire(io: Pick<HireIo, 'cwd' | 'get' | 'set' | 'breakdown' | 'commands' | 'registerHire'>, skill: string, receipt: string): Promise<HireReport> {
  const saved = await io.get<SavedTeam>(teamKey(io.cwd)).then(s => s, () => undefined)
  const base: SavedTeam = Array.isArray(saved?.picks) && Array.isArray(saved.empty) ? saved : { picks: [], empty: [], by: 'rules' }
  const isThere = base.picks.some(p => p.kind === 'skill' && p.name === skill)
  const team: Team = { ...base, picks: isThere ? base.picks : [...base.picks, { seat: 'Specialist', name: skill, kind: 'skill', receipt }] }
  const { hires, dropped } = skillHires(team, await installedSkills(io))
  if (dropped.includes(skill)) return { ...EMPTY_REPORT, dropped: [skill] }
  await io.set(teamKey(io.cwd), { ...team, hires } satisfies SavedTeam)
  const { hired, failed } = await register(io, hires.filter(h => h.skills.includes(skill)))
  return { parked: 0, hired, dropped, failed }
}

// ---- Rehire ----

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isSpec = (v: unknown): v is HireSpec => {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return isText(s.name) && /^[A-Za-z0-9_-]{1,64}$/.test(s.name) && isText(s.description) && isText(s.prompt)
    && Array.isArray(s.skills) && s.skills.length > 0 && s.skills.every(isText)
}

/** Registers the saved hires again: the engine forgets them each session. Names are re-checked when the skill list is there. */
export async function rehire(io: RehireIo): Promise<HireReport> {
  const saved = await io.get<SavedTeam>(teamKey(io.cwd)).then(s => s, () => undefined)
  const hires = Array.isArray(saved?.hires) ? saved.hires.filter(isSpec) : []
  if (hires.length === 0) return EMPTY_REPORT
  const installed = await installedSkills(io)
  const known = installed ? new Set(installed.map(s => s.name)) : undefined
  const isThere = (h: HireSpec) => !known || h.skills.every(s => known.has(s))
  const { hired, failed } = await register(io, hires.filter(isThere))
  return { parked: 0, hired, dropped: hires.filter(h => !isThere(h)).flatMap(h => h.skills.filter(s => known && !known.has(s))), failed }
}
