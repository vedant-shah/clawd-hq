// The coffee break button, pure: when the footer offers it, what pressing it does, and the one line it leaves when it cannot. It is offered
// when the chat has grown past a mark AND a piece of work has just closed (hooks/checkpoint.ts), so a compaction never lands between the
// steps of a job. register.tsx hands in every call as `io` (`$` never leaves that file).
import type { Boss, Employee, Fx, Gauge } from '../types'
import { BOX_BUSY, DIALOG_OPEN } from './clawd-edit'
import { atWork } from './panel-model'
import type { PanelData } from './panel-types'
import { reasonOf } from './state'

/** The chat is worth compacting at this many tokens, however large its window. */
export const COFFEE_TOKENS = 300_000
/**
 * DECIDED: and a little before Claude Code would compact by itself, at 90% of its own mark, so the person gets the choice of a calm
 * moment first. Whichever mark comes first counts; on a 1M window the 300k mark does, on a 200k window this one.
 */
export const AUTO_COMPACT_MARGIN = 0.9

/** Sent with the compaction (or put after /compact): what the summary must keep. One line, plain. */
export const COFFEE_NOTE =
  'Keep my latest request and any open work, any question still waiting for me, and what the specialists just finished and what is left. ' +
  'Recorded decisions live in .clawd-hq/decisions.md, so they need not be repeated in full.'

const NOT_NOW = 'Not now: Clawd is busy, or a question is waiting for you. Try again at the next break.'
const WORKING = 'Compacting the chat…'

/** The token count from which the button may show: the 300k mark, or the margin before the engine's own compaction, whichever is lower. */
export function triggerAt(g: Gauge): number {
  const own = g.autoCompactAt
  return own !== undefined && Number.isFinite(own) && own > 0 ? Math.min(COFFEE_TOKENS, Math.round(own * AUTO_COMPACT_MARGIN)) : COFFEE_TOKENS
}

/** The context has reached the mark; with no reading of it yet, it has not. */
export const isOverMark = (g: Gauge): boolean => g.contextTokens !== undefined && g.contextTokens >= triggerAt(g)

/**
 * A break: a piece of work has closed and nothing is going on. Clawd is not in a turn, no specialist is at work, and no tour plays. The
 * checkpoint mark itself says the work was reported (an open question box keeps Clawd busy, so it hides the button too), and lasts until the person's next message.
 */
export const isBreakTime = (b: Boss, staff: Employee[], fx: Fx): boolean =>
  b.isCheckpoint === true && !b.isBusy && atWork(staff).length === 0 && fx.demo === undefined

export type CoffeeView = {
  /** No button; the button; or the word that stands in for it while the compaction runs. */
  state: 'hidden' | 'ready' | 'running'
  note?: { text: string; isProblem: boolean }
}

/**
 * What the footer draws. The line the last press left is drawn only while Clawd is still in the turn it was made in: a new turn of his
 * makes it stale. A problem is told even when the button has gone since, so it is never lost.
 */
export function coffeeView(data: Pick<PanelData, 'boss' | 'staff' | 'fx' | 'gauge'>): CoffeeView {
  const { boss, staff, fx, gauge } = data
  const isTime = isOverMark(gauge) && isBreakTime(boss, staff, fx)
  const left = fx.coffee !== undefined && fx.coffee.turns === boss.turns ? fx.coffee : undefined
  if (!isTime) return left?.kind === 'problem' ? { state: 'hidden', note: { text: left.text, isProblem: true } } : { state: 'hidden' }
  if (left?.kind === 'running') return { state: 'running' }
  return left === undefined ? { state: 'ready' } : { state: 'ready', note: { text: left.text, isProblem: left.kind === 'problem' } }
}

type Note = { kind: 'running' | 'ready' | 'problem'; text: string }

export type CoffeeIo = {
  /** Still a break right now: the button may have been drawn before Clawd began a turn. */
  isBreak: () => Promise<boolean>
  /** The engine's compact call. A resolved `skip` is a hook's veto. On an older engine it throws that it is not a function (see `isMissingCall`). */
  compact: (args: { instructions: string }) => Promise<{ skip?: string }>
  promptRead: () => Promise<{ text: string }>
  fill: (text: string) => Promise<{ isFilled: boolean; refusal?: string }>
  /** Keeps the one line under the footer's row; none takes it away. The turn it was made in is added by the caller. */
  setNote: (note: Note | undefined) => Promise<unknown>
  /** The context reading starts over until the engine's next measure, so the button does not wait on a number from before. */
  clearReading: () => Promise<unknown>
}

const problem = (text: string): Note => ({ kind: 'problem', text })

/** Without a compact call: `/compact` and the note go in the prompt box when it is empty (as "Edit with Claude" does), never sent. */
async function fillCommand(io: CoffeeIo, isTerminal: boolean): Promise<Note> {
  const box = await io.promptRead().catch(() => ({ text: '' }))
  const ready: Note = { kind: 'ready', text: `Ready in your prompt box. ${isTerminal ? 'Press Esc, then Enter' : 'Send it'} to compact.` }
  // A second press finds the command from the first still waiting: that is the ready state, not a busy box.
  if (box.text.trimStart().startsWith(COMPACT_COMMAND)) return ready
  if (box.text.trim() !== '') return problem(BOX_BUSY)
  const line = `${COMPACT_COMMAND} ${COFFEE_NOTE}`
  const r = await io.fill(line).catch(() => ({ isFilled: false, refusal: undefined as string | undefined }))
  if (r.isFilled) return ready
  return problem(r.refusal === 'dialog' ? DIALOG_OPEN : `Type this in the chat: ${line}`)
}

const COMPACT_COMMAND = '/compact'

/**
 * The engine has no compact call (the desktop app can bundle Claude Code 2.1.295): calling it fails as a missing function does. The loader
 * does not let a plugin look at `$.session.compact` without calling it, so this is how an older engine is told apart. It is told from the
 * message alone (never `instanceof TypeError`: the engine may run plugins in another JS realm, or wrap the call). Any other failure is not.
 */
const MISSING_WORDS = /not a function|is not defined|undefined/
export function isMissingCall(err: unknown): boolean {
  const message = typeof err === 'string' ? err : typeof (err as { message?: unknown } | null)?.message === 'string' ? (err as { message: string }).message : ''
  return /compact/.test(message) && MISSING_WORDS.test(message)
}

/** Compacts now: nothing when it stood, one plain line when it was skipped or failed, and `'missing'` where the engine has no such call. */
async function compactNow(compact: CoffeeIo['compact']): Promise<Note | 'missing' | undefined> {
  try {
    const r = await compact({ instructions: COFFEE_NOTE })
    return r.skip === undefined ? undefined : problem(`The chat was not compacted: ${r.skip}.`)
  } catch (err) {
    return isMissingCall(err) ? 'missing' : problem(`Couldn't compact the chat: ${reasonOf(err)}.`)
  }
}

/**
 * The press itself. Any failure after the running word is set (a note that cannot be kept, a reading that cannot be cleared) takes the word
 * away before it is passed on, so "Compacting the chat…" is never left standing.
 */
async function runPress(io: CoffeeIo, isTerminal: boolean): Promise<void> {
  try {
    await io.setNote({ kind: 'running', text: WORKING })
    const left = await compactNow(io.compact)
    await io.setNote(left === 'missing' ? await fillCommand(io, isTerminal) : left)
    if (left === undefined) await io.clearReading()
  } catch (err) {
    await io.setNote(undefined).catch(() => undefined)
    throw err
  }
}

/** A press under way:a second press meanwhile does nothing. Set before anything is awaited, so two presses at one moment still compact once. */
let isPressing = false

/**
 * The button pressed. A press that finds the break over (the button was drawn before Clawd began a turn) says so and compacts nothing.
 * Otherwise the chat is compacted right away, with the note; a skip or a failure is kept as one plain line for the footer.
 */
export async function takeCoffeeBreak(io: CoffeeIo, isTerminal: boolean): Promise<void> {
  if (isPressing) return
  isPressing = true
  try {
    if (!(await io.isBreak())) return void (await io.setNote(problem(NOT_NOW)))
    await runPress(io, isTerminal)
  } finally {
    isPressing = false
  }
}
