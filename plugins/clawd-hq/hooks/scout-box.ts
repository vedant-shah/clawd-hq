// The mailbox between the scout and the setup step that started it: the files it opens, the picks it sends, and the wait for them.
// Plain state, no `$`: the timer comes in as a closure. One scout at a time; ids stay known for a while after it is done,
// so a scout that carries on after its time is up is still refused rather than mistaken for a stranger.
import type { ScoutCheck, ScoutReport } from './onboard-types'

/** How many scout ids are remembered. */
const KEEP_IDS = 20
const MAX_READS = 400
const READ_CHARS = 500
/** The scout may send picks this many times; a try the check refuses is sent back to it with the reason. */
export const MAX_TRIES = 3
const ENOUGH = 'That was the third try that could not be used, so the scout is finished.'
const CLOSED = 'The scout has finished its work.'

type Slot = { readonly reads: readonly string[]; readonly tries: number; readonly isClosed: boolean; readonly report?: ScoutReport }
type Timer = { readonly cancel: () => void }
export type After = (ms: number, fn: () => void) => Timer
/** What sending picks does: they are taken, or sent back with the reason. */
export type Delivery = { readonly isTaken: true } | { readonly problem: string }

export type ScoutBox = {
  /** Judges the picks of the scout about to start. */
  readonly begin: (check: ScoutCheck) => void
  /** Notes an id as a scout. */
  readonly mark: (id: string) => void
  readonly isScout: (id: string) => boolean
  /** Whether the scout is done: it sent its picks, ran out of time, or ended. Everything it calls after that is refused. */
  readonly isClosed: (id: string) => boolean
  readonly noteRead: (id: string, path: string) => void
  readonly deliver: (id: string, picks: unknown) => Delivery
  /** The scout ended; if it sent no picks, the wait is over. */
  readonly finish: (id: string) => void
  /** The picks, or `undefined` when time ran out or the scout ended without any. */
  readonly wait: (id: string, ms: number, after: After) => Promise<ScoutReport | undefined>
}

/** The scouts known so far, newest last, replaced rather than changed. */
function createSlots() {
  let slots: ReadonlyMap<string, Slot> = new Map()
  return {
    get: (id: string) => slots.get(id),
    mark: (id: string) => {
      if (!slots.has(id)) slots = new Map([...[...slots].slice(1 - KEEP_IDS), [id, { reads: [], tries: 0, isClosed: false }]])
    },
    patch: (id: string, fn: (s: Slot) => Slot) => {
      const slot = slots.get(id)
      if (slot) slots = new Map(slots).set(id, fn(slot))
    },
  }
}

/** Who is waiting for a scout's picks. Whoever settles it, the timer goes. */
function createWaiters() {
  const waiting = new Map<string, (report: ScoutReport | undefined) => void>()
  return {
    settle: (id: string, report: ScoutReport | undefined) => {
      const done = waiting.get(id)
      waiting.delete(id)
      done?.(report)
    },
    hold: (id: string, ms: number, after: After, onTimeout: () => void) => new Promise<ScoutReport | undefined>(resolve => {
      let timer: Timer | undefined
      waiting.set(id, report => { timer?.cancel(); resolve(report) })
      timer = after(ms, onTimeout)
    }),
  }
}

export function createScoutBox(): ScoutBox {
  const slots = createSlots()
  const waiters = createWaiters()
  let check: ScoutCheck = () => undefined
  const close = (id: string, report?: ScoutReport) => {
    slots.patch(id, s => ({ ...s, isClosed: true, ...(report ? { report } : {}) }))
    waiters.settle(id, report)
  }
  return {
    begin: next => { check = next },
    mark: slots.mark,
    isScout: id => slots.get(id) !== undefined,
    isClosed: id => slots.get(id)?.isClosed ?? false,
    noteRead: (id, path) => slots.patch(id, s => (s.reads.length >= MAX_READS || path.length > READ_CHARS ? s : { ...s, reads: [...s.reads, path] })),
    deliver: (id, picks) => {
      const slot = slots.get(id)
      if (!slot || slot.isClosed) return { problem: CLOSED }
      const problem = check(picks, slot.reads)
      if (problem === undefined) {
        close(id, { picks, reads: slot.reads })
        return { isTaken: true }
      }
      if (slot.tries + 1 >= MAX_TRIES) {
        close(id)
        return { problem: ENOUGH }
      }
      slots.patch(id, s => ({ ...s, tries: s.tries + 1 }))
      return { problem }
    },
    finish: id => { if (slots.get(id)?.isClosed === false) close(id) },
    wait: (id, ms, after) => {
      const slot = slots.get(id)
      return !slot || slot.isClosed ? Promise.resolve(slot?.report) : waiters.hold(id, ms, after, () => close(id))
    },
  }
}
