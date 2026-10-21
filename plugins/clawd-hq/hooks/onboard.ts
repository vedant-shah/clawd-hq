// Onboarding: the setup flow as steps over OnboardIo. It runs by itself the first time the office opens in a project with no
// saved setup (unless Automatic setup is off): quiet scan → team (scout, then Opus, then rules, the core four filling empty
// seats) → hire → workflow → one small card saying what was set up. There is no offer and no question. `/office-setup` runs
// the same flow on demand. The place is saved at `onboard:<folder>` before each step runs, so a reload or a new session resumes
// where setup stood. No `$`: register.tsx fills the io. Nothing is ever sent for the person.
import { MAX_FAILURES, QUIET, doneCard, failedCard, hireNote, scanCard, teamNames } from './onboard-cards'
import { hireTeam, parkList } from './hire'
import type { SavedTeam } from './hire'
import { installedHelpers } from './helpers'
import { PROFILE_KEY, SEATS, onboardKey, teamKey, usageKey } from './onboard-types'
import type { Helper, OnboardButton, OnboardIo, OnboardSave, OnboardStep, PastUse, Profile, ProjectFacts, RoleGuess, Team } from './onboard-types'
import { guessRole, projectFacts } from './scan'
import { pickTeam } from './team'
import { pastUse } from './usage-history'
import { workflowSteps } from './workflow-card'

/** What the engine calls the agents' and skills' sources, kept to check the words `helpers.ts` expects (names and counts only). */
export const SOURCES_KEY = 'debug:onboard-sources'

const STEPS: readonly OnboardStep[] = ['scan', 'team', 'workflow', 'done']
/** Places the old flow left: past its first job or skipped counts as done; an offer or a question counts as never started. */
const LEGACY_DONE = ['first', 'skipped']
/** A place saved this recently may belong to a run that is still working (a scout alone can take a minute and a half): left alone. DECIDED. */
const RESUME_AFTER_MS = 2 * 60_000

// ---- The saved place ----

/** The saved place, checked: the store is data, and an older or broken record is read as none. */
export async function savedOf(io: Pick<OnboardIo, 'cwd' | 'get'>): Promise<OnboardSave | undefined> {
  const v = await io.get<{ step?: unknown; role?: unknown; at?: unknown; failures?: unknown }>(onboardKey(io.cwd)).catch(() => undefined)
  if (typeof v !== 'object' || v === null) return undefined
  const step = LEGACY_DONE.includes(String(v.step)) ? 'done' : STEPS.find(s => s === v.step)
  if (step === undefined) return undefined
  return {
    step, at: typeof v.at === 'number' ? v.at : 0,
    ...(typeof v.role === 'string' ? { role: v.role } : {}),
    ...(typeof v.failures === 'number' && v.failures > 0 ? { failures: v.failures } : {}),
  }
}

type Change = { readonly step?: OnboardStep; readonly role?: string | null; readonly failures?: number | null }

/** Saves the place with a change. `role: null` forgets the role; `failures: null` forgets the failures, and so does reaching `done`. */
async function saveStep(io: OnboardIo, change: Change): Promise<OnboardSave> {
  const before = await savedOf(io)
  const step = change.step ?? before?.step ?? 'scan'
  const role = change.role === null ? undefined : change.role ?? before?.role
  const failures = step === 'done' || change.failures === null ? undefined : change.failures ?? before?.failures
  const next: OnboardSave = { step, at: io.now(), ...(role === undefined ? {} : { role }), ...(failures === undefined ? {} : { failures }) }
  await io.set(onboardKey(io.cwd), next)
  return next
}

// ---- Starting, and coming back ----

/**
 * The frame check: with a view shown and nothing held yet, and only while Automatic setup is on, setup starts for a project with
 * none saved or picks up the step it was left at. With the switch off, when it is done, or when the retry already failed, it is held
 * quiet (only `/office-setup` starts it then). A place saved under two minutes ago is left alone and looked at again at a later frame.
 */
export async function checkOnboard(io: OnboardIo): Promise<void> {
  if ((await io.card()) !== undefined || !(await io.isShown())) return
  return safely(io, async () => {
    const saved = await savedOf(io)
    if (saved?.step === 'done' || !io.isAutoOn() || (saved?.failures ?? 0) >= MAX_FAILURES) return io.setCard(QUIET)
    if (saved !== undefined && io.now() - saved.at < RESUME_AFTER_MS) return
    // Set before any slow step, so the next frame finds a card and does not start it twice.
    await io.setCard(scanCard())
    return runFrom(io, saved?.step ?? 'scan')
  })
}

/** Session start: the card is looked for again at the next frames. */
export async function startOnboard(io: OnboardIo): Promise<void> {
  await io.setCard(undefined)
}

/** `/office-setup`: the same flow from the start, whatever was saved; the role is guessed again. A run already working is left to finish. */
export async function restartOnboard(io: OnboardIo): Promise<void> {
  if ((await io.card())?.step === 'scan') return
  return safely(io, async () => {
    await io.setCard(scanCard())
    await saveStep(io, { step: 'scan', role: null, failures: null })
    return runFrom(io, 'scan')
  })
}

/** The step to carry on from; a saved team that is missing or unreadable sends the run back to the scan. */
async function runFrom(io: OnboardIo, step: OnboardStep): Promise<void> {
  if (step === 'scan') return scanAndPick(io)
  const team = await savedTeam(io)
  if (team === undefined) return scanAndPick(io)
  return step === 'team' ? hireAndFinish(io, team) : finishWith(io, team)
}

// ---- The quiet look around, and the team ----

type Found = { readonly facts: ProjectFacts; readonly use: PastUse; readonly helpers: readonly Helper[]; readonly guess: RoleGuess }

async function lookAround(io: OnboardIo): Promise<Found> {
  const facts = await projectFacts(io)
  const use = await pastUse(io)
  await io.set(usageKey(io.cwd), use).catch(() => undefined)
  const helpers = await installedHelpers(io, use, facts.instructions)
  await recordSources(io).catch(() => undefined)
  return { facts, use, helpers, guess: guessRole(facts, use) }
}

const uniq = (words: readonly (string | undefined)[]) => [...new Set(words.filter((w): w is string => typeof w === 'string'))]

/** The source words the engine really gives (helpers.ts reads `user`/`userSettings` and `project`/`projectSettings` as unproven). */
async function recordSources(io: OnboardIo): Promise<void> {
  const [b, commands] = await Promise.all([io.breakdown().catch(() => undefined), io.commands().catch(() => [])])
  await io.set(SOURCES_KEY, {
    at: io.now(), agents: uniq((b?.agents ?? []).map(a => a.source)), skills: uniq((b?.skills ?? []).map(s => s.source)),
    commands: uniq(commands.map(c => c.source)), includedSkills: b?.includedSkills, totalSkills: b?.totalSkills,
  })
}

/** Agents parked earlier (by hand or a past setup) are no candidates; they stay parked. */
const notParked = (io: OnboardIo, helpers: readonly Helper[]) => {
  const parked = new Set(io.parked())
  return helpers.filter(h => !(h.kind === 'agent' && parked.has(h.name)))
}

/**
 * Looks around, picks the team for the role the project reads as, keeps it, and hires it. A thin guess still picks the team (it is the
 * best there is) but is not written down as who the person is, in the record or the profile.
 */
async function scanAndPick(io: OnboardIo): Promise<void> {
  await saveStep(io, { step: 'scan' })
  const found = await lookAround(io)
  const kept = (await savedOf(io))?.role
  const team = await pickTeam(io, found.facts, found.use, notParked(io, found.helpers), kept ?? found.guess.role)
  const old = await io.get<SavedTeam>(teamKey(io.cwd)).catch(() => undefined)
  await io.set(teamKey(io.cwd), { ...team, ...(Array.isArray(old?.hires) ? { hires: old.hires } : {}) } satisfies SavedTeam)
  await saveStep(io, { step: 'team', ...(kept === undefined && found.guess.isThin ? {} : { role: kept ?? found.guess.role }) })
  return hireAndFinish(io, team)
}

const isTeam = (v: unknown): v is Team =>
  typeof v === 'object' && v !== null && Array.isArray((v as Team).picks) && Array.isArray((v as Team).empty)
    && (v as Team).picks.every(p => typeof p?.name === 'string' && typeof p.receipt === 'string' && SEATS.includes(p.seat) && (p.kind === 'agent' || p.kind === 'skill'))
    && (v as Team).empty.every(s => SEATS.includes(s))

/** The team picked earlier (kept at `team:<folder>`), or nothing when it is missing or unreadable. */
async function savedTeam(io: OnboardIo): Promise<Team | undefined> {
  const team = await io.get<SavedTeam>(teamKey(io.cwd)).catch(() => undefined)
  return isTeam(team) ? { picks: team.picks, empty: team.empty, by: team.by } : undefined
}

// ---- The hire, how the person works, and the card afterwards ----

/** How many agent types a hire would park that are not parked already. */
const parkedBy = (io: OnboardIo, team: Team) => {
  const already = new Set(io.parked())
  return parkList(io.allAgentTypes(), team).filter(t => !already.has(t)).length
}

/**
 * Hires the team: the rest parked on top of what was parked before, the skill hires registered. An empty team parks nothing.
 * Returns the note for the card: how many helpers were set aside, which skills were left out, and what could not be done.
 */
async function hire(io: OnboardIo, team: Team): Promise<string | undefined> {
  if (team.picks.length === 0) return undefined
  const fresh = parkedBy(io, team)
  const keepParked = (list: readonly string[]) => io.savePayroll([...new Set([...io.parked(), ...list])])
  const report = await hireTeam({ ...io, savePayroll: keepParked }, team)
  return hireNote(report, report.parked > 0 ? fresh : 0)
}

async function hireAndFinish(io: OnboardIo, team: Team): Promise<void> {
  const note = await hire(io, team)
  await saveStep(io, { step: 'workflow' })
  return finishWith(io, team, note)
}

const textOf = (v: unknown) => (typeof v === 'string' ? v : undefined)
const stepsOf = (v: unknown) => (Array.isArray(v) && v.every(s => typeof s === 'string') ? (v as readonly string[]) : undefined)

/** The machine-wide profile, merged: this setup's role and the steps read from the instruction files replace the old ones; no steps found keeps the old ones. */
async function saveProfile(io: OnboardIo, workflow?: readonly string[]): Promise<void> {
  const old = await io.get<Profile>(PROFILE_KEY).catch(() => undefined)
  const role = (await savedOf(io))?.role ?? textOf(old?.role)
  const steps = workflow ?? stepsOf(old?.workflow)
  const profile: Profile = { at: io.now(), ...(role === undefined ? {} : { role }), ...(steps === undefined ? {} : { workflow: steps }) }
  await io.set(PROFILE_KEY, profile)
}

/** The workflow is read and kept without a card to confirm it, then setup is done and the small card says what was set up. */
async function finishWith(io: OnboardIo, team: Team, note?: string): Promise<void> {
  const found = await workflowSteps(io).catch(() => undefined)
  await saveProfile(io, found?.steps)
  await saveStep(io, { step: 'done' })
  return io.setCard(doneCard(teamNames(team, io.blurbs()), note))
}

// ---- A press on the card ----

/** A button pressed on the card. A press for a button the card no longer shows (a double press) does nothing. */
export async function chooseOnboard(io: OnboardIo, button: OnboardButton): Promise<void> {
  const card = await io.card()
  if (card?.buttons.some(b => b.action === button.action) !== true) return
  return io.setCard(QUIET)
}

/**
 * Runs a step; one that fails is counted in the saved place and shows the stopped card with what went wrong. The place stays, so the
 * next session retries once by itself; after a second failure only `/office-setup` starts it again.
 */
async function safely(io: OnboardIo, step: () => Promise<void>): Promise<void> {
  try {
    await step()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    const failures = ((await savedOf(io))?.failures ?? 0) + 1
    await saveStep(io, { failures }).catch(() => undefined)
    await io.setCard(failedCard(reason, failures)).catch(() => undefined)
  }
}

/**
 * The payroll review waits until setup is done, so the two never run at once. It need not wait when nothing will start or go on by
 * itself: Automatic setup is off, or the retry already failed.
 */
export const isSetupBusy = (saved: OnboardSave | undefined, isAutoOn: boolean) =>
  saved?.step !== 'done' && isAutoOn && (saved?.failures ?? 0) < MAX_FAILURES
