// Onboarding, piece 8: the setup flow as steps over OnboardIo. Offer (Start · Later · Skip) → two questions (box or card)
// → quiet scan → role (only when the evidence is thin) → team → Hire → workflow → first job → done. `/office-setup` starts
// again at the questions. The place is saved at `onboard:<folder>` before each step runs, so a reload or a new session
// resumes where setup stood. No `$`: register.tsx fills the io. Buttons fill the prompt box at most; nothing is sent.
import { QUESTIONS, answerOf, applyPending, nextQuestion, withAnswer } from './onboard-ask'
import type { SetupQuestion } from './onboard-ask'
import {
  BOX_NOTE, DONE_TOAST, FILLED_LINE, failedCard, QUIET, SEARCH_NOTE, WAIT_NOTE, firstCard, hireNote, offerCard, questionCard, readingCard,
  refusedNote, roleCard, scanCard, searchRequest, teamCard, withoutSearch, workflowCard,
} from './onboard-cards'
import { firstJob } from './first-job'
import { hireTeam, parkList } from './hire'
import type { SavedTeam } from './hire'
import { installedHelpers } from './helpers'
import { PROFILE_KEY, ROLES, SEATS, onboardKey, teamKey, usageKey } from './onboard-types'
import type { Helper, OnboardButton, OnboardCard, OnboardIo, OnboardSave, OnboardStep, PastUse, PendingToggle, Profile, ProjectFacts, RoleGuess, Team } from './onboard-types'
import { guessRole, projectFacts } from './scan'
import { pickTeam } from './team'
import { pastUse } from './usage-history'
import { workflowSteps } from './workflow-card'

/** What the engine calls the agents' and skills' sources, kept to check the words `helpers.ts` expects (names and counts only). */
export const SOURCES_KEY = 'debug:onboard-sources'

const STEPS: readonly OnboardStep[] = ['offer', 'intro', 'scan', 'team', 'workflow', 'first', 'done', 'skipped']

// ---- The saved place ----

const isToggle = (v: unknown): v is PendingToggle =>
  typeof v === 'object' && v !== null && QUESTIONS.some(q => q.field === (v as PendingToggle).field) && typeof (v as PendingToggle).value === 'boolean'

/** The saved place, checked: the store is data, and an older or broken record is read as none. */
export async function savedOf(io: Pick<OnboardIo, 'cwd' | 'get'>): Promise<OnboardSave | undefined> {
  const v = await io.get<OnboardSave>(onboardKey(io.cwd)).catch(() => undefined)
  if (typeof v !== 'object' || v === null || !STEPS.includes(v.step)) return undefined
  const pending = Array.isArray(v.pending) ? v.pending.filter(isToggle) : []
  return { step: v.step, pending, at: typeof v.at === 'number' ? v.at : 0, ...(typeof v.role === 'string' ? { role: v.role } : {}), ...(v.later === true ? { later: true } : {}) }
}

type Change = { readonly step?: OnboardStep; readonly pending?: readonly PendingToggle[]; readonly role?: string | null; readonly later?: true }

/** Saves the place with a change. A new step drops `later`; `role: null` forgets the role. */
async function saveStep(io: OnboardIo, change: Change): Promise<OnboardSave> {
  const before = await savedOf(io)
  const role = change.role === null ? undefined : change.role ?? before?.role
  const next: OnboardSave = {
    step: change.step ?? before?.step ?? 'offer',
    pending: change.pending ?? before?.pending ?? [],
    at: io.now(),
    ...(role === undefined ? {} : { role }),
    ...(change.later ? { later: true } : {}),
  }
  await io.set(onboardKey(io.cwd), next)
  return next
}

// ---- Starting, and coming back ----

/** The frame check: with a view shown and nothing held yet, the offer for a new project, or the step setup was left at. */
export async function checkOnboard(io: OnboardIo): Promise<void> {
  if ((await io.card()) !== undefined || !(await io.isShown())) return
  return safely(io, async () => {
    const saved = await savedOf(io)
    if (saved !== undefined) return resume(io, saved)
    await io.setCard(offerCard())
    await saveStep(io, { step: 'offer' })
  })
}

async function resume(io: OnboardIo, saved: OnboardSave): Promise<void> {
  if (saved.step === 'done' || saved.step === 'skipped') return io.setCard(QUIET)
  if (saved.step === 'offer') return io.setCard(offerCard()) // a Later from an earlier session is asked again
  // Set before any slow step, so the next frame finds a card and does not start it twice.
  await io.setCard(scanCard())
  if (saved.step === 'intro') return showQuestion(io, saved.pending)
  if (saved.step === 'scan') return runScan(io)
  if (saved.step === 'team') return showSavedTeam(io)
  if (saved.step === 'workflow') return showWorkflow(io)
  return showFirst(io)
}

/** Session start: the card is looked for again at the next frames, and answers left waiting are applied. */
export async function startOnboard(io: OnboardIo): Promise<void> {
  await io.setCard(undefined)
  const saved = await savedOf(io)
  if (saved !== undefined && saved.step !== 'intro' && saved.pending.length > 0) await applyAnswers(io)
}

/** Clawd's turn ended: answers that waited for it are applied now. */
export async function onboardTurnEnd(io: OnboardIo): Promise<void> {
  const saved = await savedOf(io)
  if (saved === undefined || saved.step === 'intro' || saved.pending.length === 0) return
  const note = await applyAnswers(io)
  const card = await io.card()
  if (card !== undefined && card !== QUIET && card.step !== 'done') await io.setCard(note === undefined ? withoutWait(card) : { ...card, note })
}

const withoutWait = (card: NonNullable<Awaited<ReturnType<OnboardIo['card']>>>) => {
  if (card.note !== WAIT_NOTE) return card
  const { note: _was, ...rest } = card
  return rest
}

/** `/office-setup`: the questions again, from the start; the role is guessed again. */
export async function restartOnboard(io: OnboardIo): Promise<void> {
  return safely(io, async () => {
    await saveStep(io, { step: 'intro', pending: [], role: null })
    await askIntro(io)
  })
}

// ---- The two questions ----

const showQuestion = async (io: OnboardIo, answered: readonly PendingToggle[], note?: string) => {
  const q = nextQuestion(answered)
  return q === undefined ? toScan(io) : io.setCard(questionCard(q, note))
}

/**
 * The card shows each question with Yes and No, and the question box asks it too, one at a time; whichever answers first
 * counts. A box that is dismissed, cannot open or gets a typed answer leaves the card's buttons to answer the rest.
 */
async function askIntro(io: OnboardIo): Promise<void> {
  let pending = (await savedOf(io))?.pending ?? []
  await showQuestion(io, pending)
  for (let q = nextQuestion(pending); q !== undefined; q = nextQuestion(pending)) {
    const said = await io.ask(q).catch(() => undefined)
    const saved = await savedOf(io)
    if (saved?.step !== 'intro') return // skipped, or started again, meanwhile
    const value = answerOf(said)
    const isOnCard = saved.pending.some(p => p.field === q?.field) // answered on the card meanwhile
    if (!isOnCard && (value === undefined || said === undefined)) return showQuestion(io, saved.pending, BOX_NOTE)
    pending = isOnCard || value === undefined || said === undefined ? saved.pending : await record(io, q, value, said)
    await showQuestion(io, pending) // the card follows the box, so its Yes and No answer the question it shows
  }
}

/** One answer kept (waiting to be applied), then saved in Decisions as the person said it. Read fresh, so an answer given meanwhile stays. */
async function record(io: OnboardIo, q: SetupQuestion, value: boolean, said: string): Promise<readonly PendingToggle[]> {
  const before = (await savedOf(io))?.pending ?? []
  if (before.some(p => p.field === q.field)) return before
  const pending = withAnswer(before, { field: q.field, value })
  await saveStep(io, { pending })
  await io.decide(q.question, said)
  return pending
}

/** Yes or No pressed on the card: the answer to the question it shows. */
async function answer(io: OnboardIo, value: boolean): Promise<void> {
  const saved = await savedOf(io)
  if (saved?.step !== 'intro') return
  const q = nextQuestion(saved.pending)
  if (q === undefined) return toScan(io)
  return showQuestion(io, await record(io, q, value, value ? 'Yes' : 'No'))
}

/** Applies the waiting answers; the note to show when one could not be set, or is still waiting for Clawd's turn to end. */
async function applyAnswers(io: OnboardIo): Promise<string | undefined> {
  const saved = await savedOf(io)
  const r = await applyPending({ ...io, keep: async pending => { await saveStep(io, { pending }) } }, saved?.pending ?? [])
  if (r.refused.length > 0) return refusedNote(r.refused)
  return r.pending.length > 0 ? WAIT_NOTE : undefined
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

/** Both questions answered: on to the scan, once (the box and the card can both finish the questions). */
const toScan = async (io: OnboardIo) => {
  if ((await savedOf(io))?.step !== 'intro') return
  await saveStep(io, { step: 'scan' })
  return runScan(io)
}

/** Applies the answers, looks around, then shows the team, or the role choice first when the evidence is thin. */
async function runScan(io: OnboardIo): Promise<void> {
  await io.setCard(scanCard())
  const note = await applyAnswers(io)
  const found = await lookAround(io)
  const role = (await savedOf(io))?.role ?? (found.guess.isThin ? undefined : found.guess.role)
  return role === undefined ? io.setCard(roleCard(note)) : pickAndShow(io, found, role, note)
}

/** Agents parked earlier (by hand or a past setup) are no candidates; they stay parked. */
const notParked = (io: OnboardIo, helpers: readonly Helper[]) => {
  const parked = new Set(io.parked())
  return helpers.filter(h => !(h.kind === 'agent' && parked.has(h.name)))
}

async function pickAndShow(io: OnboardIo, found: Found, role: string, note?: string): Promise<void> {
  const team = await pickTeam(io, found.facts, found.use, notParked(io, found.helpers), role)
  const now = (await savedOf(io))?.step
  if (now !== 'scan' && now !== 'team') return // skipped or started again while the team was picked
  const old = await io.get<SavedTeam>(teamKey(io.cwd)).catch(() => undefined)
  await io.set(teamKey(io.cwd), { ...team, ...(Array.isArray(old?.hires) ? { hires: old.hires } : {}) } satisfies SavedTeam)
  await saveStep(io, { step: 'team', role })
  return io.setCard(teamCard({ team, role, parked: parkedBy(io, team), note }))
}

/** How many agent types a hire would park that are not parked already. */
const parkedBy = (io: OnboardIo, team: Team) => {
  const already = new Set(io.parked())
  return parkList(io.allAgentTypes(), team).filter(t => !already.has(t)).length
}

const isTeam = (v: unknown): v is Team =>
  typeof v === 'object' && v !== null && Array.isArray((v as Team).picks) && Array.isArray((v as Team).empty)
    && (v as Team).picks.every(p => typeof p?.name === 'string' && typeof p.receipt === 'string' && SEATS.includes(p.seat) && (p.kind === 'agent' || p.kind === 'skill'))
    && (v as Team).empty.every(s => SEATS.includes(s))

/** The team picked earlier (kept at `team:<folder>`), or a new look around when it is missing. */
async function showSavedTeam(io: OnboardIo, note?: string): Promise<void> {
  const [saved, team] = [await savedOf(io), await io.get<SavedTeam>(teamKey(io.cwd)).catch(() => undefined)]
  if (!isTeam(team) || saved?.role === undefined) return runScan(io)
  const plain: Team = { picks: team.picks, empty: team.empty, by: team.by }
  return io.setCard(teamCard({ team: plain, role: saved.role, parked: parkedBy(io, plain), note }))
}

/** A role pressed: on the team step it changes the role only (no second pick); after a thin scan it picks the team. */
async function chooseRole(io: OnboardIo, label: string): Promise<void> {
  if (!ROLES.includes(label)) return io.setCard(roleCard())
  const saved = await savedOf(io)
  await saveStep(io, { role: label })
  if (saved?.step === 'team') return showSavedTeam(io)
  await io.setCard(scanCard())
  return pickAndShow(io, await lookAround(io), label)
}

/** Hire this team: the rest parked on top of what was parked before, the skill hires registered; an empty team parks nothing. */
async function hire(io: OnboardIo, team: Team | undefined): Promise<void> {
  if (team === undefined) return showSavedTeam(io)
  if (team.picks.length === 0) return showWorkflow(io)
  const fresh = parkedBy(io, team)
  const keepParked = (list: readonly string[]) => io.savePayroll([...new Set([...io.parked(), ...list])])
  const report = await hireTeam({ ...io, savePayroll: keepParked }, team)
  // The note counts the newly parked only; the ones parked before stay as they were.
  return showWorkflow(io, hireNote({ ...report, parked: report.parked > 0 ? fresh : 0 }))
}

async function search(io: OnboardIo, isYes: boolean): Promise<void> {
  const card = await io.card()
  if (card?.step !== 'team') return
  if (isYes && card.searchSeat !== undefined) await io.fill(searchRequest(card.searchSeat))
  return io.setCard(withoutSearch(card, isYes ? SEARCH_NOTE : card.note))
}

// ---- How the person works, and the first job ----

const textOf = (v: unknown) => (typeof v === 'string' ? v : undefined)
const stepsOf = (v: unknown) => (Array.isArray(v) && v.every(s => typeof s === 'string') ? (v as readonly string[]) : undefined)

/** The machine-wide profile, merged: this setup's role and chosen steps replace the old ones; a skipped card keeps the old steps. */
const saveProfile = async (io: OnboardIo, workflow?: readonly string[]) => {
  const old = await io.get<Profile>(PROFILE_KEY).catch(() => undefined)
  const role = (await savedOf(io))?.role ?? textOf(old?.role)
  const steps = workflow ?? stepsOf(old?.workflow)
  const profile: Profile = { at: io.now(), ...(role === undefined ? {} : { role }), ...(steps === undefined ? {} : { workflow: steps }) }
  await io.set(PROFILE_KEY, profile)
}

async function showWorkflow(io: OnboardIo, note?: string): Promise<void> {
  await saveStep(io, { step: 'workflow' })
  await io.setCard(readingCard(note))
  const found = await workflowSteps(io).catch(() => undefined)
  if (found !== undefined) return io.setCard(workflowCard(found.steps, note))
  await saveProfile(io)
  return showFirst(io, note)
}

async function useWorkflow(io: OnboardIo, isUsed: boolean): Promise<void> {
  const card = await io.card()
  if (card?.step !== 'workflow') return
  await saveProfile(io, isUsed ? card.workflow : undefined)
  return showFirst(io)
}

async function showFirst(io: OnboardIo, note?: string): Promise<void> {
  await saveStep(io, { step: 'first' })
  return io.setCard(firstCard(firstJob(await projectFacts(io)), note))
}

async function finish(io: OnboardIo, step: 'done' | 'skipped'): Promise<void> {
  await saveStep(io, { step, ...(step === 'skipped' ? { pending: [] } : {}) })
  await io.setCard(QUIET)
}

/** Use this on the first job: the text goes in the prompt box, never sent, and setup is done. */
async function useFirst(io: OnboardIo): Promise<void> {
  const suggestion = (await io.card())?.suggestion
  if (suggestion !== undefined) await io.fill(suggestion)
  await finish(io, 'done')
  io.toast(suggestion === undefined ? DONE_TOAST : `${FILLED_LINE} ${DONE_TOAST}`)
}

// ---- A press on the card ----

async function run(io: OnboardIo, button: OnboardButton, card: OnboardCard): Promise<void> {
  const { step } = card
  switch (button.action) {
    case 'start': await saveStep(io, { step: 'intro', pending: [] }); return askIntro(io)
    case 'later': await saveStep(io, { step: 'offer', later: true }); return io.setCard(QUIET)
    case 'skip': return finish(io, step === 'first' ? 'done' : 'skipped')
    case 'yes': return answer(io, true)
    case 'no': return answer(io, false)
    case 'changeRole': return chooseRole(io, button.label)
    case 'hire': return hire(io, card.team)
    case 'adjust': return io.showPeople()
    case 'searchYes': return search(io, true)
    case 'searchNo': return search(io, false)
    case 'useWorkflow': return useWorkflow(io, true)
    case 'skipWorkflow': return useWorkflow(io, false)
    case 'useFirst': return useFirst(io)
  }
}

/** A button pressed on the setup card. A press for a step the card no longer shows (a double press) does nothing. */
export async function chooseOnboard(io: OnboardIo, button: OnboardButton): Promise<void> {
  return safely(io, async () => {
    const card = await io.card()
    if (card?.buttons.some(b => b.action === button.action) !== true) return
    if (button.action === 'start' || button.action === 'hire') await io.setCard(scanCard()) // taken first: a second press finds no such button
    return run(io, button, card)
  })
}

/** Runs a step; one that fails puts the offer back with what went wrong, so Start tries again and setup is never stuck. */
async function safely(io: OnboardIo, step: () => Promise<void>): Promise<void> {
  try {
    await step()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await io.setCard(failedCard(reason)).catch(() => undefined)
    await saveStep(io, { step: 'offer' }).catch(() => undefined)
  }
}

/** The payroll review waits until setup is done or skipped, so the two never ask at once. */
export const isSetupBusy = (saved: OnboardSave | undefined) => saved?.step !== 'done' && saved?.step !== 'skipped'
