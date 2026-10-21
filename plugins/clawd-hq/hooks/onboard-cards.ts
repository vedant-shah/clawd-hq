// Onboarding: what setup says on Clawd's card in the Office tab, as OnboardCard data (hooks/panel-onboard.tsx draws it).
// Setup runs by itself, so there is no offer and no question: a quiet line while it works, one small card afterwards that
// says what was set up, and a stopped card with what went wrong. Pure; the words are plain and every line wraps on the card.
import { CORE_FOUR } from './core-four'
import type { HireReport } from './hire'
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

/** Runs that may stop before only /office-setup starts setup again: the first stop gets one more try by itself next session. */
export const MAX_FAILURES = 2

/** A step that failed: what went wrong, and how to try again. `failures` counts this stop; the first is retried once next session, any later one needs /office-setup. */
export const failedCard = (reason: string, failures: number): OnboardCard => ({
  step: 'failed',
  lines: [failures < MAX_FAILURES
    ? `Setup stopped: ${reason}. It tries once more next session, or run /office-setup to try now.`
    : `Setup stopped: ${reason}. Run /office-setup to try again.`],
  buttons: [DISMISS],
})

/** One plain word for a pick: Clawd HQ's own helpers by their label, the rest by the role their name reads as. */
const nameOf = (name: string, blurbs: Readonly<Record<string, string>>) =>
  CORE_FOUR.find(h => h.type === name)?.label ?? roleOf(name, blurbs[name] ?? '').title

/** The team in plain role words, in the card's seat order, each role once. */
export function teamNames(team: Team, blurbs: Readonly<Record<string, string>> = {}): readonly string[] {
  const picks = SEATS.flatMap(seat => team.picks.filter(p => p.seat === seat))
  return [...new Set(picks.map(p => nameOf(p.name, blurbs)))]
}

/**
 * What the hire set aside or could not do, as one dim note on the card; nothing when all went well. `newlyParked` is how many installed
 * helpers were newly parked; it counts for nothing when the list could not be saved, which is said instead.
 */
export function hireNote(report: HireReport, newlyParked: number): string | undefined {
  const setAside = report.isParkFailed === true ? 0 : newlyParked
  const parts = [
    setAside === 0 ? '' : setAside === 1 ? '1 other helper was set aside; bring it back in People.' : `${setAside} other helpers were set aside; bring them back in People.`,
    report.isParkFailed === true ? 'Could not save the list of helpers set aside, so none were.' : '',
    report.dropped.length > 0 ? `Left out, not installed under that name: ${report.dropped.join(', ')}.` : '',
    report.failed.length > 0 ? `Claude Code would not add: ${report.failed.join(', ')}.` : '',
  ].filter(Boolean)
  return parts.length === 0 ? undefined : parts.join(' ')
}
