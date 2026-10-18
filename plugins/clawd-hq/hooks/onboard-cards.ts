// Onboarding, piece 8: what each setup step says and which buttons it shows, as OnboardCard data for the Office tab
// (hooks/panel-onboard.tsx draws it). Pure; the words are plain and every line wraps on the card.
import { TOGGLES } from './configs'
import type { HireReport } from './hire'
import type { SetupQuestion } from './onboard-ask'
import { ROLES, SEATS } from './onboard-types'
import type { OnboardAction, OnboardButton, OnboardCard, Seat, Team, ToggleField } from './onboard-types'

/** Held in memory once setup has nothing to show this session: drawn as nothing, and the frame check stops looking. */
export const QUIET: OnboardCard = { step: 'done', lines: [], buttons: [] }

export const OFFER_LINE = "I'm Clawd, your chief of staff. Tell me what you need and I'll make sure it gets done: I hand the work to the right specialists, check what comes back, and keep you posted."
export const OFFER_ASK = 'Want me to set up a starting team for this project? Two quick questions, then I look around this folder.'
export const INTRO_LINE = 'Two quick questions first.'
export const BOX_NOTE = 'The question box closed without a Yes or No, so answer here on the card.'
export const ROLE_LINE = "I couldn't tell what you do here. Which fits best?"
export const NO_TEAM_LINE = "I found no installed helpers to pick from, so for now the team is Claude's built-in agents."
export const READING_LINE = 'Reading how you like to work…'
export const WORKFLOW_LINE = 'This is how you seem to like working. Shall I keep it in mind?'
export const FIRST_LINE = 'What is the first thing you want done here? Here is a start:'
export const FILLED_LINE = "It's in the prompt box. Change it as you like and send it when you're ready."
export const SEARCH_NOTE = "The search request is in the prompt box. Send it when you're ready; nothing is installed without you."
export const WAIT_NOTE = 'Your answers to the two questions apply once my current turn ends.'
export const DONE_TOAST = "Setup is done. Type /office-setup any time to run it again."

/** Seats worth a skills.sh search when empty; an empty Specialist seat is normal. */
const SEARCH_SEATS: readonly Seat[] = SEATS.filter(s => s !== 'Specialist')

const btn = (action: OnboardAction, label: string, isPrimary?: true): OnboardButton => (isPrimary ? { action, label, isPrimary } : { action, label })
const withNote = (card: OnboardCard, note: string | undefined): OnboardCard => (note === undefined ? card : { ...card, note })

export const offerCard = (): OnboardCard => ({ step: 'offer', lines: [OFFER_LINE, OFFER_ASK], buttons: [btn('start', 'Start', true), btn('later', 'Later'), btn('skip', 'Skip')] })

/** A step that failed: the offer again, with what went wrong, so Start tries setup again from the questions. */
export const failedCard = (reason: string): OnboardCard => ({ ...offerCard(), note: `Setup stopped: ${reason}. Start tries again.` })

export const questionCard = (q: SetupQuestion, note?: string): OnboardCard =>
  withNote({ step: 'intro', lines: [INTRO_LINE, q.question], buttons: [btn('yes', 'Yes', true), btn('no', 'No')] }, note)

export const scanCard = (): OnboardCard => ({ step: 'scan', lines: [], buttons: [] })

export const roleCard = (note?: string): OnboardCard => withNote({ step: 'scan', lines: [ROLE_LINE], buttons: ROLES.map(r => btn('changeRole', r)) }, note)

export type TeamView = { readonly team: Team; readonly role: string; readonly parked: number; readonly note?: string }

/** The team, with the first empty seat worth searching skills.sh for. An empty team offers to carry on, never to park. */
export function teamCard(view: TeamView): OnboardCard {
  const isEmpty = view.team.picks.length === 0
  const searchSeat = SEARCH_SEATS.find(s => view.team.empty.includes(s))
  const search = searchSeat === undefined ? [] : [btn('searchYes', 'Yes'), btn('searchNo', 'No')]
  const card: OnboardCard = {
    step: 'team',
    lines: isEmpty ? [NO_TEAM_LINE] : [],
    role: view.role,
    team: view.team,
    parked: isEmpty ? 0 : view.parked,
    ...(searchSeat === undefined ? {} : { searchSeat }),
    buttons: [btn('changeRole', 'Change'), btn('hire', isEmpty ? 'Carry on' : 'Hire this team', true), btn('adjust', 'Adjust in People'), ...search],
  }
  return withNote(card, view.note)
}

/** The team card once the search offer is answered: no search line, no search buttons. */
export function withoutSearch(card: OnboardCard, note?: string): OnboardCard {
  const { searchSeat: _gone, ...rest } = card
  return withNote({ ...rest, buttons: card.buttons.filter(b => b.action !== 'searchYes' && b.action !== 'searchNo') }, note)
}

export const readingCard = (note?: string): OnboardCard => withNote({ step: 'workflow', lines: [READING_LINE], buttons: [] }, note)

export const workflowCard = (steps: readonly string[], note?: string): OnboardCard =>
  withNote({ step: 'workflow', lines: [WORKFLOW_LINE], workflow: steps, buttons: [btn('useWorkflow', 'Use this', true), btn('skipWorkflow', 'Skip')] }, note)

export const firstCard = (suggestion: string, note?: string): OnboardCard =>
  withNote({ step: 'first', lines: [FIRST_LINE], suggestion, buttons: [btn('useFirst', 'Use this', true), btn('skip', 'Not now')] }, note)

/** The prompt-box request for an empty seat: Claude searches when the person sends it; the mod itself makes no network call. */
export const searchRequest = (seat: Seat) =>
  `Search skills.sh for a skill that could fill the ${seat} seat on my team for this project. Show me the best two or three, what each does and the command that installs it, but do not install anything.`

const listOf = (names: readonly string[]) => names.join(', ')

/** What a hire did, in plain words. */
export function hireNote(r: HireReport): string {
  return [
    r.hired.length > 0 ? `Hired ${listOf(r.hired)}.` : 'No skill hires were needed.',
    r.parked > 0 ? `Parked ${r.parked} agent type${r.parked === 1 ? '' : 's'}; People brings any back.` : '',
    r.dropped.length > 0 ? `Left out, not installed under that name: ${listOf(r.dropped)}.` : '',
    r.failed.length > 0 ? `Claude Code would not add: ${listOf(r.failed)}.` : '',
  ].filter(Boolean).join(' ')
}

const titleOf = (field: ToggleField) => TOGGLES.find(t => t.field === field)?.title ?? field

/** The note when a switch could not be changed from here. */
export const refusedNote = (fields: readonly ToggleField[]) =>
  `I couldn't change ${fields.map(titleOf).join(' or ')} from here. You can set it in the Settings tab.`
