// Onboarding, piece 4: the team pick. One Opus call over the candidate list; the same question to Haiku when Opus gives
// no usable answer; the rule pick when neither does. The answer is untrusted data: only its seats and names are read,
// every name must be on the list, the seat limits hold, and the receipts on the card come from facts (team-rules.ts),
// never from the model's own words. No `$`: the model call comes in through the onboarding io.
import type { CompleteRequest, Helper, OnboardIo, PastUse, Pick as SeatPick, ProjectFacts, Seat, Team, TeamBy } from './onboard-types'
import { SEATS, SEAT_LIMITS, TEAM_LIMIT } from './onboard-types'
import { teamPrompt } from './team-prompt'
import { BUILTINS, candidateList, projectSignals, receiptOf, rulePick } from './team-rules'
import type { Candidate, RawPick } from './team-rules'

const MAX_TOKENS = 2000
const TIMEOUT_MS = 60_000
/** An answer this long is not a team of eight; it is not read. */
const MAX_REPLY_CHARS = 100_000
const MODELS = ['opus', 'haiku'] as const
type TeamModel = (typeof MODELS)[number]

/** The one closure the pick needs. */
export type TeamIo = Readonly<Pick<OnboardIo, 'complete'>>

/** Opus at medium effort, as tested; Haiku gets the same question without an effort setting. */
const requestFor = (model: TeamModel, prompt: string): CompleteRequest =>
  model === 'opus'
    ? { model, prompt, maxTokens: MAX_TOKENS, effort: 'medium', timeoutMs: TIMEOUT_MS }
    : { model, prompt, maxTokens: MAX_TOKENS, timeoutMs: TIMEOUT_MS }

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

/** The team from raw picks, in the order given, each with a receipt from facts; seats left empty are listed for the card. */
export function teamFrom(raw: readonly RawPick[], cands: readonly Candidate[], facts: ProjectFacts, by: TeamBy): Team {
  const byId = new Map(cands.map(c => [c.id, c]))
  const kept = raw.reduce<readonly RawPick[]>((before, p) => (isAllowed(before, p, byId) ? [...before, p] : before), [])
  const signals = projectSignals(facts)
  const picks = SEATS.flatMap(seat => kept.filter(p => p.seat === seat)).flatMap((p): SeatPick[] => {
    const c = byId.get(p.name)
    return c ? [{ seat: p.seat, name: c.id, kind: c.kind, receipt: receiptOf(c, signals, facts.deps) }] : []
  })
  const empty: readonly Seat[] = SEATS.filter(s => !picks.some(p => p.seat === s))
  return { picks, empty, by }
}

async function answerOf(io: TeamIo, req: CompleteRequest): Promise<string | undefined> {
  try {
    return await io.complete(req)
  } catch {
    // A failed call is the same as no answer: the next model, then the rules, take over.
    return undefined
  }
}

/** One model's team, or `undefined` when its answer had no usable pick. */
async function askModel(io: TeamIo, model: TeamModel, prompt: string, cands: readonly Candidate[], facts: ProjectFacts): Promise<Team | undefined> {
  const raw = parseReply(await answerOf(io, requestFor(model, prompt)))
  const team = raw ? teamFrom(raw, cands, facts, model) : undefined
  return team && team.picks.length > 0 ? team : undefined
}

/** The starting team: Opus once, Haiku if Opus gives nothing usable, the rules if neither does. */
export async function pickTeam(io: TeamIo, facts: ProjectFacts, use: PastUse, helpers: readonly Helper[], role: string | undefined): Promise<Team> {
  const cands = candidateList(helpers, use, facts)
  if (cands.length === 0) return teamFrom([], cands, facts, 'rules')
  const prompt = teamPrompt({ facts, use, cands, role })
  for (const model of MODELS) {
    const team = await askModel(io, model, prompt, cands, facts)
    if (team) return team
  }
  return teamFrom(rulePick(cands, facts), cands, facts, 'rules')
}
