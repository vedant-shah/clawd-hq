// Onboarding: what setup says on Clawd's card in the Office tab, as OnboardCard data (hooks/panel-onboard.tsx draws it).
// Setup runs by itself, so there is no offer and no question: a quiet line while it works, one small card afterwards that
// says what was set up, and a stopped card with what went wrong. Pure; the words are plain and every line wraps on the card.
import { CORE_FOUR } from './core-four'
import { roleOf } from './office'
import { SEATS } from './onboard-types'
import type { OnboardButton, OnboardCard, Team } from './onboard-types'

/** Held in memory once setup has nothing to show this session: drawn as nothing, and the frame check stops looking. */
export const QUIET: OnboardCard = { step: 'quiet', lines: [], buttons: [] }

/** Shown while the quiet look around runs and nothing else has been said. */
export const LOOKING_LINE = 'Looking around…'
/** The card afterwards: what was set up, then where to change it. DECIDED wording. */
export const DONE_HEAD = 'Set up your team for this project: '
export const DONE_TAIL = 'Change it in People or Settings, or run /office-setup again.'
export const NO_TEAM_LINE = 'Set up this project with no extra helpers: none were found, so the team is Claude\'s built-in agents.'

const DISMISS: OnboardButton = { action: 'dismiss', label: 'Dismiss' }
const withNote = (card: OnboardCard, note: string | undefined): OnboardCard => (note === undefined ? card : { ...card, note })

export const scanCard = (): OnboardCard => ({ step: 'scan', lines: [], buttons: [] })

/** The after-card: the team by name, then how to change it. A note (a hire that failed) sits dim beneath. */
export const doneCard = (names: readonly string[], note?: string): OnboardCard =>
  withNote({ step: 'done', lines: [names.length === 0 ? NO_TEAM_LINE : `${DONE_HEAD}${names.join(', ')}.`, DONE_TAIL], buttons: [DISMISS] }, note)

/** A step that failed: what went wrong, and how to try again. The saved place stays, so the next session picks up too. */
export const failedCard = (reason: string): OnboardCard =>
  ({ step: 'failed', lines: [`Setup stopped: ${reason}. Run /office-setup to try again.`], buttons: [DISMISS] })

/** One plain word for a pick: Clawd HQ's own helpers by their label, the rest by the role their name reads as. */
const nameOf = (name: string, blurbs: Readonly<Record<string, string>>) =>
  CORE_FOUR.find(h => h.type === name)?.label ?? roleOf(name, blurbs[name] ?? '').title

/** The team in plain role words, in the card's seat order, each role once. */
export function teamNames(team: Team, blurbs: Readonly<Record<string, string>> = {}): readonly string[] {
  const picks = SEATS.flatMap(seat => team.picks.filter(p => p.seat === seat))
  return [...new Set(picks.map(p => nameOf(p.name, blurbs)))]
}

/** The note when Claude Code would not take a hire; nothing when all went in. */
export const failedHiresNote = (failed: readonly string[]) => (failed.length === 0 ? undefined : `Claude Code would not add: ${failed.join(', ')}.`)
