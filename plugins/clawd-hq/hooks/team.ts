// Onboarding, piece 4: the team pick. The scout (a Sonnet agent that looks around the project, see scout-spec.ts) picks first;
// one Opus call over the same candidate list when the scout gives nothing usable; the rule pick when neither does. Whatever
// picked, the core seats left empty are filled by the four helpers Clawd HQ ships (core-four.ts). The answers are untrusted
// data: every name must be on the list, the seat limits hold, and the receipt on the card is the scout's reason only when it
// rests on a file the scout opened; otherwise it comes from facts (team-rules.ts), never from a model's own words.
// No `$`: the scout and the model call come in through the onboarding io.
import { withCoreFour } from './core-four'
import type { CompleteRequest, Helper, OnboardIo, PastUse, Pick as SeatPick, ProjectFacts, ScoutCheck, Seat, Team, TeamBy } from './onboard-types'
import { SEATS, SEAT_LIMITS, TEAM_LIMIT } from './onboard-types'
import { scoutPicks } from './scout-pick'
import { scoutBrief } from './scout-spec'
import { teamPrompt } from './team-prompt'
import { BUILTINS, candidateList, projectSignals, receiptOf, rulePick } from './team-rules'
import type { Candidate, RawPick } from './team-rules'

const MAX_TOKENS = 2000
const TIMEOUT_MS = 60_000
/** An answer this long is not a team of eight; it is not read. */
const MAX_REPLY_CHARS = 100_000

/** The closures the pick needs: the scout, the one model call, and the project folder the scout may look in. */
export type TeamIo = Readonly<Pick<OnboardIo, 'complete' | 'spawnScout' | 'cwd'>>

/** Opus at medium effort, as tested. */
const opusRequest = (prompt: string): CompleteRequest => ({ model: 'opus', prompt, maxTokens: MAX_TOKENS, effort: 'medium', timeoutMs: TIMEOUT_MS })

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The JSON object in an answer, prose or a code fence around it allowed. */
function jsonIn(text: unknown): unknown {
  if (typeof text !== 'string' || text.length > MAX_REPLY_CHARS) return undefined
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function rawPick(p: unknown): RawPick[] {
  if (!isRecord(p) || typeof p.seat !== 'string' || typeof p.name !== 'string') return []
  const said = p.seat.trim().toLowerCase()
  const seat = SEATS.find(s => s.toLowerCase() === said)
  const name = p.name.trim()
  return seat && name ? [{ seat, name }] : []
}

/** The seats and names of an answer, or `undefined` when it holds no `picks` list. The model's `why` is never read. */
export function parseReply(text: unknown): readonly RawPick[] | undefined {
  const data = jsonIn(text)
  const picks = isRecord(data) ? data.picks : undefined
  return Array.isArray(picks) ? picks.flatMap(rawPick) : undefined
}

/** Whether a pick may join the ones before it: on the list, not built in, not repeated, within its seat and the team. */
function isAllowed(before: readonly RawPick[], p: RawPick, byId: ReadonlyMap<string, Candidate>): boolean {
  const inSeat = before.filter(b => b.seat === p.seat).length
  return byId.has(p.name) && !BUILTINS.has(p.name) && !before.some(b => b.name === p.name)
    && inSeat < SEAT_LIMITS[p.seat] && before.length < TEAM_LIMIT
}

/** The team from raw picks, in the order given, each with a receipt (the scout's reason when it has one, else from facts); seats left empty are listed for the card. */
export function teamFrom(raw: readonly RawPick[], cands: readonly Candidate[], facts: ProjectFacts, by: TeamBy): Team {
  const byId = new Map(cands.map(c => [c.id, c]))
  const kept = raw.reduce<readonly RawPick[]>((before, p) => (isAllowed(before, p, byId) ? [...before, p] : before), [])
  const signals = projectSignals(facts)
  const picks = SEATS.flatMap(seat => kept.filter(p => p.seat === seat)).flatMap((p): SeatPick[] => {
    const c = byId.get(p.name)
    return c ? [{ seat: p.seat, name: c.id, kind: c.kind, receipt: p.reason ?? receiptOf(c, signals, facts.deps) }] : []
  })
  const empty: readonly Seat[] = SEATS.filter(s => !picks.some(p => p.seat === s))
  return { picks, empty, by }
}

const usable = (team: Team): Team | undefined => (team.picks.length > 0 ? team : undefined)

/** What the scout's pick tool says back when none of the picks can be used, so the scout can try again. */
const checkOf = (cands: readonly Candidate[], folder: string): ScoutCheck => (picks, reads) => {
  const { picks: found, problems } = scoutPicks({ picks, reads }, cands, folder)
  if (found.length > 0) return undefined
  return `None of those picks could be used. ${problems.join(' ')} Each pick needs a seat (${SEATS.join(', ')}) and a name copied exactly from the candidate list. Call team_pick again.`
}

/** The scout's team, or `undefined` when it could not start, ran out of time, failed, or named nobody on the list. */
async function askScout(io: TeamIo, cands: readonly Candidate[], facts: ProjectFacts, use: PastUse, role: string | undefined): Promise<Team | undefined> {
  const brief = scoutBrief({ facts, use, cands, role, folder: io.cwd })
  const report = await io.spawnScout(brief, checkOf(cands, io.cwd)).catch(() => undefined)
  return report ? usable(teamFrom(scoutPicks(report, cands, io.cwd).picks, cands, facts, 'scout')) : undefined
}

/** One Opus call's team, or `undefined` when it fails or its answer has no usable pick. A failed call is the same as no answer. */
async function askOpus(io: TeamIo, prompt: string, cands: readonly Candidate[], facts: ProjectFacts): Promise<Team | undefined> {
  const text = await io.complete(opusRequest(prompt)).catch(() => undefined)
  const raw = parseReply(text)
  return raw ? usable(teamFrom(raw, cands, facts, 'opus')) : undefined
}

/** The starting team: the scout first, one Opus call if the scout gives nothing usable, the rules if neither does; the core seats still empty get the shipped four. */
export async function pickTeam(io: TeamIo, facts: ProjectFacts, use: PastUse, helpers: readonly Helper[], role: string | undefined): Promise<Team> {
  const cands = candidateList(helpers, use)
  if (cands.length === 0) return withCoreFour(teamFrom([], cands, facts, 'rules'))
  const team = (await askScout(io, cands, facts, use, role))
    ?? (await askOpus(io, teamPrompt({ facts, use, cands, role }), cands, facts))
    ?? teamFrom(rulePick(cands, facts), cands, facts, 'rules')
  return withCoreFour(team)
}
