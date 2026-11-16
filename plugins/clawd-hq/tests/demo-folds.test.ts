import { expect, test } from 'claude-code/testing'
import { STEP_MS, startDemo } from '../hooks/demo'
import type { DemoIo } from '../hooks/demo'
import { BOSS0, FX0 } from '../hooks/state'

// The tour puts back only the folds it changed: a fold the person opened while it played stays open, and one it shut that was open is open again.

const OTHER = 'history-other' // the fold the fake's `showDone` opens and closes, as the History tab's Other work does

/** A recording office: the folds in one list, the timers kept for the test to fire, every other call a stand-in. */
function office(folds: string[]) {
  const mine = { folds, timers: [] as Array<{ ms: number; fn: () => void; isCancelled: boolean; isFired: boolean }> }
  const change = (key: string, isOpen: boolean) => { mine.folds = isOpen ? [...mine.folds.filter(k => k !== key), key] : mine.folds.filter(k => k !== key) }
  const io: DemoIo = {
    show: async () => undefined, showDone: async isOpen => change(OTHER, isOpen), fold: async (key, isOpen) => change(key, isOpen),
    setFolds: async list => { mine.folds = list ?? [] },
    boss: async () => BOSS0, fx: async () => ({ ...FX0, folds: mine.folds }), setBoss: async () => undefined, tick: async () => 0, now: async () => 1_000,
    put: async () => undefined, editStaff: async () => undefined, dropStandIns: async () => undefined, setDemo: async () => undefined, showStatus: async () => undefined,
    after: (ms, fn) => { const timer = { ms, fn, isCancelled: false, isFired: false }; mine.timers.push(timer); return { cancel: () => { timer.isCancelled = true } } },
  }
  return { io, mine }
}
const settle = async () => { for (let i = 0; i < 80; i += 1) await Promise.resolve() }
/** Fires the timers of the newest tour in order, up to and not past the first at which `stop` holds; none left over when it never does. */
async function play(mine: ReturnType<typeof office>['mine'], stop: () => boolean = () => false) {
  for (const timer of mine.timers.filter(t => !t.isCancelled && !t.isFired)) {
    if (stop()) return
    timer.isFired = true
    timer.fn()
    await settle()
  }
}

test('a tour that plays to its end puts back the folds it opened and keeps the ones the person opened meanwhile', async () => {
  const { io, mine } = office(['kept'])
  await startDemo(io)
  await play(mine, () => mine.folds.length > 1)
  expect(mine.folds.length).toBeGreaterThan(1) // the tour opened its own folds
  mine.folds = [...mine.folds, 'person-opened']
  await play(mine) // the rest of the steps and the clean-up
  expect(mine.folds.sort()).toEqual(['kept', 'person-opened'])
})

test('a fold that was open before the tour and that the tour shut is open again at the end', async () => {
  const { io, mine } = office([OTHER, 'kept'])
  await startDemo(io)
  await play(mine)
  expect(mine.folds.sort()).toEqual([OTHER, 'kept'].sort())
})

test('a tour cut short by a second one is cleaned up first: its folds go, the person\'s stay, the second tour saves the office as it is', async () => {
  const { io, mine } = office(['kept'])
  await startDemo(io)
  await play(mine, () => mine.folds.length > 1)
  mine.folds = [...mine.folds, 'person-opened']
  const cutAt = mine.timers.length
  await startDemo(io) // the first tour's clean-up runs now
  expect(mine.folds.sort()).toEqual(['kept', 'person-opened'])
  expect(mine.timers.slice(0, cutAt).every(t => t.isCancelled)).toBe(true) // the first tour's timers are all called off
  await play(mine)
  expect(mine.folds.sort()).toEqual(['kept', 'person-opened'])
})

test('a tour with no folds at the start leaves none, and the clean-up comes after the last step', async () => {
  const { io, mine } = office([])
  await startDemo(io)
  const last = mine.timers[mine.timers.length - 1]!
  expect(last.ms).toBeGreaterThan(20 * STEP_MS)
  await play(mine)
  expect(mine.folds).toEqual([])
})
