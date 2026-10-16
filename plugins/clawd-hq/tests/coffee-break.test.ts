import { expect, test } from 'claude-code/testing'
import { BOX_BUSY, DIALOG_OPEN } from '../hooks/clawd-edit'
import {
  AUTO_COMPACT_MARGIN, COFFEE_AFTERGLOW_MS, COFFEE_NOTE, COFFEE_OFFER_LINE, COFFEE_TOKENS, coffeeView, isBreakTime, isDrinking, isOffering, isOverMark, takeCoffeeBreak, triggerAt,
} from '../hooks/coffee-break'
import type { CoffeeIo } from '../hooks/coffee-break'
import { BOSS0, GAUGE0 } from '../hooks/state'
import type { PanelData } from '../hooks/panel-types'
import type { Boss, Employee, Fx, Gauge } from '../types'

// The runner has a real timer, though its types do not list one.
declare const setTimeout: (run: () => void, ms: number) => unknown
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 10))

const worker = (mood: Employee['mood']): Employee => ({ id: 'a1', type: 'ecc:planner', description: 'Plan', mood } as Employee)
const gauge = (over: Partial<Gauge> = {}): Gauge => ({ ...GAUGE0, ...over })
const boss = (over: Partial<Boss> = {}): Boss => ({ ...BOSS0, isCheckpoint: true, ...over })

// ---- Where the button starts to show ----

test('the mark is 300,000 tokens, or 90% of where Claude Code compacts by itself, whichever comes first', () => {
  expect(COFFEE_TOKENS).toBe(300_000)
  expect(AUTO_COMPACT_MARGIN).toBe(0.9)
  expect(triggerAt(gauge())).toBe(300_000)
  // A 1M window compacts late, so the 300k mark comes first.
  expect(triggerAt(gauge({ autoCompactAt: 950_000 }))).toBe(300_000)
  // A threshold just past the point where the two meet (333,333): 90% of it is still above 300k.
  expect(triggerAt(gauge({ autoCompactAt: 340_000 }))).toBe(300_000)
  // A 200k window compacts early, so the margin before it comes first.
  expect(triggerAt(gauge({ autoCompactAt: 167_000 }))).toBe(150_300)
  expect(triggerAt(gauge({ autoCompactAt: 200_000 }))).toBe(180_000)
})

test('a threshold that makes no sense is ignored, and the 300k mark stands', () => {
  for (const autoCompactAt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(triggerAt(gauge({ autoCompactAt }))).toBe(300_000)
})

test('a reading that names the percent and the window but no token count is counted from them', () => {
  expect(isOverMark(gauge({ contextPercent: 48, contextWindow: 1_000_000 }))).toBe(true)
  expect(isOverMark(gauge({ contextPercent: 29, contextWindow: 1_000_000 }))).toBe(false)
  // The count, when the engine gives it, wins over the percent.
  expect(isOverMark(gauge({ contextTokens: 100_000, contextPercent: 48, contextWindow: 1_000_000 }))).toBe(false)
  // No window, or no percent, is no reading.
  expect(isOverMark(gauge({ contextPercent: 48 }))).toBe(false)
  expect(isOverMark(gauge({ contextWindow: 1_000_000 }))).toBe(false)
})

test('the mark is reached at exactly the mark, and not one token before it', () => {
  expect(isOverMark(gauge({ contextTokens: 299_999 }))).toBe(false)
  expect(isOverMark(gauge({ contextTokens: 300_000 }))).toBe(true)
  expect(isOverMark(gauge({ contextTokens: 300_001 }))).toBe(true)
  const early = gauge({ autoCompactAt: 200_000 })
  expect(isOverMark({ ...early, contextTokens: 179_999 })).toBe(false)
  expect(isOverMark({ ...early, contextTokens: 180_000 })).toBe(true)
})

test('with no reading of the context there is nothing to compare', () => {
  expect(isOverMark(gauge())).toBe(false)
  expect(isOverMark(gauge({ contextPercent: 99, autoCompactAt: 100 }))).toBe(false)
})

// ---- A break is for a checkpoint ----

test('it is a break only at a checkpoint when nobody is busy and no tour plays', () => {
  expect(isBreakTime(boss(), [], {})).toBe(true)
  expect(isBreakTime(boss(), [worker('done'), worker('failed'), worker('lost')], {})).toBe(true)
})

test('Clawd running a turn, or any specialist at work, is not a break', () => {
  expect(isBreakTime(boss({ isBusy: true }), [], {})).toBe(false)
  for (const mood of ['arriving', 'working', 'thinking'] as const) expect(isBreakTime(boss(), [worker('done'), worker(mood)], {})).toBe(false)
})

test('a pause without a checkpoint is not a break: between the steps of a job, or after a plain reply', () => {
  expect(isBreakTime(boss({ isCheckpoint: false }), [], {})).toBe(false)
  expect(isBreakTime(boss({ isCheckpoint: undefined }), [], {})).toBe(false)
})

test('the tour is not a break', () => {
  const demo: Fx = { demo: { step: 1, total: 5, caption: 'Hello' } }
  expect(isBreakTime(boss(), [], demo)).toBe(false)
})

// ---- What the footer draws ----

const data = (over: Partial<Pick<PanelData, 'boss' | 'staff' | 'fx' | 'gauge'>> = {}) =>
  ({ boss: boss(), staff: [], fx: {}, gauge: gauge({ contextTokens: 310_000 }), ...over }) as Pick<PanelData, 'boss' | 'staff' | 'fx' | 'gauge'>

test('the button shows at a checkpoint over the mark, and nothing is shown below it', () => {
  expect(coffeeView(data())).toEqual({ state: 'ready' })
  expect(coffeeView(data({ gauge: gauge({ contextTokens: 299_999 }) }))).toEqual({ state: 'hidden' })
})

test('the button is hidden while busy, while a specialist works, and with no checkpoint, whatever the context', () => {
  expect(coffeeView(data({ boss: boss({ isBusy: true }) })).state).toBe('hidden')
  expect(coffeeView(data({ staff: [worker('working')] })).state).toBe('hidden')
  expect(coffeeView(data({ boss: boss({ isCheckpoint: false }) })).state).toBe('hidden')
})

test('a problem is told while its turn stands, and not after Clawd has begun another', () => {
  const fx: Fx = { coffee: { kind: 'problem', text: 'The chat was not compacted: a hook said no.', turns: 3 } }
  expect(coffeeView(data({ boss: boss({ turns: 3 }), fx }))).toEqual({ state: 'ready', note: { text: 'The chat was not compacted: a hook said no.', isProblem: true } })
  expect(coffeeView(data({ boss: boss({ turns: 4 }), fx }))).toEqual({ state: 'ready' })
})

test('a problem is still told when the button itself is gone, so it is never lost', () => {
  const fx: Fx = { coffee: { kind: 'problem', text: 'Not now.', turns: 3 } }
  expect(coffeeView(data({ boss: boss({ turns: 3, isCheckpoint: false }), fx }))).toEqual({ state: 'hidden', note: { text: 'Not now.', isProblem: true } })
})

test('while it compacts the button gives way to a plain word, and a ready line is told only with the button', () => {
  const running: Fx = { coffee: { kind: 'running', text: 'Compacting the chat…', turns: 3 } }
  expect(coffeeView(data({ boss: boss({ turns: 3 }), fx: running }))).toEqual({ state: 'running' })
  const ready: Fx = { coffee: { kind: 'ready', text: 'Ready in your prompt box.', turns: 3 } }
  expect(coffeeView(data({ boss: boss({ turns: 3 }), fx: ready }))).toEqual({ state: 'ready', note: { text: 'Ready in your prompt box.', isProblem: false } })
  expect(coffeeView(data({ boss: boss({ turns: 3 }), fx: ready, gauge: gauge({ contextTokens: 10 }) }))).toEqual({ state: 'hidden' })
})

// ---- Clawd's offer and his drink ----

test('the offer is the button showing, not pressed and not compacting; the line is one fixed sentence', () => {
  expect(COFFEE_OFFER_LINE).toBe("It's time to take a coffee break.")
  expect(isOffering(data())).toBe(true)
  expect(isOffering(data({ gauge: gauge({ contextTokens: 10 }) }))).toBe(false)
  const running: Fx = { coffee: { kind: 'running', text: 'Compacting the chat…', turns: 3 } }
  expect(isOffering(data({ boss: boss({ turns: 3 }), fx: running }))).toBe(false)
})

const NOW = 5_000_000
const drinking = (fx: Fx, now = NOW, over: Partial<Boss> = {}) => isDrinking({ boss: boss({ turns: 3, ...over }), fx, now })

test('he drinks while the compaction runs, and not while the button only shows', () => {
  expect(drinking({})).toBe(false)
  expect(drinking({ coffee: { kind: 'running', text: 'Compacting the chat…', turns: 3 } })).toBe(true)
  // A running line left from another turn of his is stale.
  expect(drinking({ coffee: { kind: 'running', text: 'Compacting the chat…', turns: 2 } })).toBe(false)
})

test('he drinks for two minutes after a compaction that stood, then not', () => {
  expect(COFFEE_AFTERGLOW_MS).toBe(120_000)
  const done = (at: number): Fx => ({ coffee: { kind: 'done', text: '', turns: 3, at } })
  expect(drinking(done(NOW))).toBe(true)
  expect(drinking(done(NOW - COFFEE_AFTERGLOW_MS + 1))).toBe(true)
  expect(drinking(done(NOW - COFFEE_AFTERGLOW_MS))).toBe(false)
  // Another turn of his does not end it: the drink lasts by the clock.
  expect(drinking(done(NOW), NOW, { turns: 9 })).toBe(true)
})

test('he does not drink after a skipped, failed or command-only press', () => {
  for (const kind of ['problem', 'ready'] as const) expect(drinking({ coffee: { kind, text: 'x', turns: 3 } })).toBe(false)
})

test('a finished drink is never drawn as a line under the footer', () => {
  const fx: Fx = { coffee: { kind: 'done', text: '', turns: 3, at: NOW } }
  expect(coffeeView(data({ boss: boss({ turns: 3 }), fx }))).toEqual({ state: 'ready' })
})

// ---- The note sent with the compaction ----

test('the note asks the summary to keep what the next step needs, in a few plain lines', () => {
  expect(COFFEE_NOTE).toMatch(/latest request/i)
  expect(COFFEE_NOTE).toMatch(/open work/i)
  expect(COFFEE_NOTE).toMatch(/questions? (still )?waiting/i)
  expect(COFFEE_NOTE).toMatch(/specialists?/i)
  expect(COFFEE_NOTE).toContain('.clawd-hq/decisions.md')
  expect(COFFEE_NOTE.length).toBeLessThan(600)
  expect(COFFEE_NOTE).not.toMatch(/\n/)
})

// ---- Pressing it ----

/** An engine that has no compact call: calling it fails the way a missing function does. */
const noCompact: CoffeeIo['compact'] = () => { throw new TypeError('$.session.compact is not a function') }

/** The calls a press makes, recorded. */
function fakeIo(over: Partial<CoffeeIo> = {}) {
  const log = { compacts: [] as string[], notes: [] as Array<{ kind: string; text: string; at?: number } | undefined>, fills: [] as string[], cleared: 0 }
  const io: CoffeeIo = {
    now: async () => 777,
    isBreak: async () => true,
    compact: async args => { log.compacts.push(args.instructions); return {} },
    promptRead: async () => ({ text: '' }),
    fill: async text => { log.fills.push(text); return { isFilled: true } },
    setNote: async note => { log.notes.push(note) },
    clearReading: async () => { log.cleared += 1 },
    ...over,
  }
  return { io, log }
}
const lastNote = (log: ReturnType<typeof fakeIo>['log']) => log.notes[log.notes.length - 1]

test('pressing compacts once, right away, with the note', async () => {
  const { io, log } = fakeIo()
  await takeCoffeeBreak(io, true)
  expect(log.compacts).toEqual([COFFEE_NOTE])
  expect(log.fills).toEqual([])
})

test('a compaction that stands leaves no line, only the time it was done, and the reading of the context starts over', async () => {
  const { io, log } = fakeIo()
  await takeCoffeeBreak(io, true)
  expect(log.notes.map(n => n?.kind)).toEqual(['running', 'done'])
  expect(lastNote(log)).toEqual({ kind: 'done', text: '', at: 777 })
  expect(log.cleared).toBe(1)
})

test('a compaction a hook skipped is one plain line with the reason, and the reading is kept', async () => {
  const { io, log } = fakeIo({ compact: async () => ({ skip: 'a hook said no' }) })
  await takeCoffeeBreak(io, true)
  expect(lastNote(log)).toEqual({ kind: 'problem', text: 'The chat was not compacted: a hook said no.' })
  expect(log.cleared).toBe(0)
})

test('a compaction that fails is one plain line with the reason, never swallowed', async () => {
  const { io, log } = fakeIo({ compact: async () => { throw new Error('a turn is running') } })
  await expect(takeCoffeeBreak(io, true)).resolves.toBeUndefined()
  expect(lastNote(log)).toEqual({ kind: 'problem', text: "Couldn't compact the chat: a turn is running." })
  expect(log.cleared).toBe(0)
})

test('a failure that is not an error object is still told', async () => {
  const { io, log } = fakeIo({ compact: () => Promise.reject('plain words') })
  await takeCoffeeBreak(io, true)
  expect(lastNote(log)?.text).toBe("Couldn't compact the chat: plain words.")
})

test('a second press while the first is working compacts nothing more', async () => {
  let release: () => void = () => undefined
  const { io, log } = fakeIo({ compact: async args => { log.compacts.push(args.instructions); await new Promise<void>(r => { release = r }); return {} } })
  const first = takeCoffeeBreak(io, true)
  const second = takeCoffeeBreak(io, true)
  await second
  await pause()
  release()
  await first
  expect(log.compacts).toHaveLength(1)
})

test('after a press has ended, a later press works again, even after a failure', async () => {
  let isFailing = true
  const { io, log } = fakeIo({ compact: async args => { log.compacts.push(args.instructions); if (isFailing) throw new Error('nope'); return {} } })
  await takeCoffeeBreak(io, true)
  isFailing = false
  await takeCoffeeBreak(io, true)
  expect(log.compacts).toHaveLength(2)
  expect(lastNote(log)?.kind).toBe('done')
})

test('a press that finds it is no longer a break compacts nothing and says so', async () => {
  const { io, log } = fakeIo({ isBreak: async () => false })
  await takeCoffeeBreak(io, true)
  expect(log.compacts).toEqual([])
  expect(lastNote(log)).toEqual({ kind: 'problem', text: 'Not now: Clawd is busy, or a question is waiting for you. Try again at the next break.' })
})

test('a note that cannot be kept while a press fails does not stop the press from ending', async () => {
  const { io } = fakeIo({ compact: async () => { throw new Error('x') }, setNote: async note => { if (note?.kind === 'problem') throw new Error('state gone') } })
  await expect(takeCoffeeBreak(io, true)).rejects.toThrow('state gone')
  // The press is over all the same: the next one is let through.
  const next = fakeIo()
  await takeCoffeeBreak(next.io, true)
  expect(next.log.compacts).toHaveLength(1)
})

// ---- An engine with no compact call ----

test('without a compact call, /compact and the note go into an empty prompt box, and nothing is sent', async () => {
  const { io, log } = fakeIo({ compact: noCompact })
  await takeCoffeeBreak(io, true)
  expect(log.fills).toEqual([`/compact ${COFFEE_NOTE}`])
  expect(lastNote(log)).toEqual({ kind: 'ready', text: 'Ready in your prompt box. Press Esc, then Enter to compact.' })
  const desktop = fakeIo({ compact: noCompact })
  await takeCoffeeBreak(desktop.io, false)
  expect(lastNote(desktop.log)).toEqual({ kind: 'ready', text: 'Ready in your prompt box. Send it to compact.' })
})

test('without a compact call, a prompt box that already has text is left alone', async () => {
  const { io, log } = fakeIo({ compact: noCompact, promptRead: async () => ({ text: 'half a thought' }) })
  await takeCoffeeBreak(io, true)
  expect(log.fills).toEqual([])
  expect(lastNote(log)).toEqual({ kind: 'problem', text: BOX_BUSY })
})

test('without a compact call, a question open in the chat, or a box that takes nothing, is told in one line', async () => {
  const dialog = fakeIo({ compact: noCompact, fill: async () => ({ isFilled: false, refusal: 'dialog' }) })
  await takeCoffeeBreak(dialog.io, true)
  expect(lastNote(dialog.log)).toEqual({ kind: 'problem', text: DIALOG_OPEN })
  const none = fakeIo({ compact: noCompact, fill: async () => { throw new Error('no composer') } })
  await takeCoffeeBreak(none.io, true)
  expect(lastNote(none.log)).toEqual({ kind: 'problem', text: `Type this in the chat: /compact ${COFFEE_NOTE}` })
})

test('only a missing compact call falls back to the prompt box: any other failure is told, not worked around', async () => {
  for (const err of [new TypeError('Cannot read properties of undefined'), new TypeError('x is not a function'), new Error('a turn is running')]) {
    const { io, log } = fakeIo({ compact: () => { throw err } })
    await takeCoffeeBreak(io, true)
    expect(log.fills).toEqual([])
    expect(lastNote(log)?.kind).toBe('problem')
  }
  // The same missing call, failing later as a rejection, is still a missing call.
  const later = fakeIo({ compact: () => Promise.reject(new TypeError('$.session.compact is not a function')) })
  await takeCoffeeBreak(later.io, true)
  expect(later.log.fills).toHaveLength(1)
})

test('without a compact call, a prompt box that cannot be read counts as empty, as it does for "Edit with Claude"', async () => {
  const { io, log } = fakeIo({ compact: noCompact, promptRead: async () => { throw new Error('no composer') } })
  await takeCoffeeBreak(io, true)
  expect(log.fills).toHaveLength(1)
})

test('a missing compact call is found from the message alone: a plain Error, or an error from another realm, both fall back', async () => {
  const foreign = { name: 'TypeError', message: '$.session.compact is not a function' } // what another JS realm's TypeError looks like to instanceof
  for (const err of [new Error('$.session.compact is not a function'), foreign, new Error('compact is not defined'), new Error('$.session.compact is undefined')]) {
    const { io, log } = fakeIo({ compact: () => { throw err } })
    await takeCoffeeBreak(io, true)
    expect(log.fills).toEqual([`/compact ${COFFEE_NOTE}`])
  }
  const other = fakeIo({ compact: () => { throw { name: 'TypeError', message: 'a turn is running' } } })
  await takeCoffeeBreak(other.io, true)
  expect(other.log.fills).toEqual([])
  expect(lastNote(other.log)?.kind).toBe('problem')
})

test('whatever fails after the running note is set, the note ends cleared or replaced, never left saying "Compacting"', async () => {
  const outcome = async (over: Partial<CoffeeIo>) => {
    const { io, log } = fakeIo(over)
    await takeCoffeeBreak(io, true).catch(() => undefined)
    return lastNote(log)
  }
  // The final note cannot be kept.
  const final = fakeIo({ compact: async () => ({ skip: 'no' }) })
  let isFirst = true
  final.io.setNote = async note => { final.log.notes.push(note); if (note?.kind === 'problem' && isFirst) { isFirst = false; throw new Error('state gone') } }
  await takeCoffeeBreak(final.io, true).catch(() => undefined)
  expect(lastNote(final.log)).toBeUndefined()
  // The reading cannot be cleared after a good compaction.
  expect(await outcome({ clearReading: async () => { throw new Error('gone') } })).toBeUndefined()
  // The prompt box calls misbehave in a way that throws out of the fallback.
  expect(await outcome({ compact: noCompact, promptRead: () => { throw new Error('x') }, fill: () => { throw new Error('y') } })).not.toMatchObject({ kind: 'running' })
})

test('on an older engine a second press, with /compact already in the box, keeps the ready line instead of "busy"', async () => {
  const { io, log } = fakeIo({ compact: noCompact, promptRead: async () => ({ text: `/compact ${COFFEE_NOTE}` }) })
  await takeCoffeeBreak(io, true)
  expect(log.fills).toEqual([])
  expect(lastNote(log)).toEqual({ kind: 'ready', text: 'Ready in your prompt box. Press Esc, then Enter to compact.' })
  const typed = fakeIo({ compact: noCompact, promptRead: async () => ({ text: '  /compact' }) })
  await takeCoffeeBreak(typed.io, false)
  expect(lastNote(typed.log)).toEqual({ kind: 'ready', text: 'Ready in your prompt box. Send it to compact.' })
})
