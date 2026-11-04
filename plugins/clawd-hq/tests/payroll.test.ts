// Payroll: a skill hire or contractor of another project is not on this project's team. It is set aside by the routine check
// and when it is offered, while the built-ins, the core helpers, the generic contractor and this folder's own hires stay.
import { expect, test } from 'claude-code/testing'
import { checkPayroll, holdBack, resetPayroll, reviewPayroll, setLaidOff } from '../hooks/payroll'
import type { PayrollIo } from '../hooks/payroll'
import type { Fx, Payroll } from '../types'

const MINE = 'clawd-hq:copywriting'
const STALE = 'clawd-hq:tdd-workflow'
const ALWAYS_ON = ['clawd-hq:core-builder', 'clawd-hq:core-planner', 'clawd-hq:core-researcher', 'clawd-hq:core-reviewer', 'clawd-hq:contractor', 'clawd-hq:scout']
const BUILT_IN = ['general-purpose', 'Explore', 'Plan', 'statusline-setup']

/** A fake io over a payroll in memory; `saved` is what was kept, `types` what the office knows of. */
function fakeIo(start: Payroll, types: string[], over: Partial<PayrollIo> = {}) {
  const box = { payroll: start }
  const io: PayrollIo = {
    cwd: '/work/proj',
    get: async () => box.payroll,
    set: async p => { box.payroll = p },
    keep: async () => undefined,
    types: async () => types,
    picks: async () => undefined,
    hires: async () => [MINE],
    list: async () => [],
    fx: async () => ({}) as Fx,
    setFx: async () => undefined,
    invalidate: () => undefined,
    ...over,
  }
  return { io, box }
}
const settled = (kept: string[], laidOff: string[] = []): Payroll => ({ laidOff, isReviewed: true, stacks: [], kept })

test('the routine check sets aside a stale hire from another project in an existing folder', async () => {
  resetPayroll()
  const { io, box } = fakeIo(settled([STALE, MINE, 'ecc:planner']), [STALE, MINE, 'ecc:planner'])
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([STALE])
})

test('the routine check leaves this folder\'s own hire, the core helpers, the contractor and the built-ins on the team', async () => {
  resetPayroll()
  const types = [MINE, ...ALWAYS_ON, ...BUILT_IN]
  const { io, box } = fakeIo(settled(types), types)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([])
})

test('the routine check does not save again when there is nothing to set aside', async () => {
  resetPayroll()
  let saves = 0
  const { io } = fakeIo(settled([STALE], [STALE]), [STALE], { set: async () => { saves += 1 } })
  await reviewPayroll(io)
  expect(saves).toBe(0)
})

test('a payroll settled before the team was written down sets the stale hire aside and keeps the rest', async () => {
  resetPayroll()
  const types = [STALE, MINE, ...ALWAYS_ON, ...BUILT_IN]
  const { io, box } = fakeIo({ laidOff: [], isReviewed: true, stacks: [] }, types)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([STALE])
  expect(box.payroll.kept).toEqual([MINE, ...ALWAYS_ON, ...BUILT_IN])
})

test('the first review of a big office sets a stale hire aside with the types the project has no use for', async () => {
  resetPayroll()
  const filler = Array.from({ length: 15 }, (_, i) => `ecc:helper-${i}`)
  const types = [...filler, STALE, MINE, ...ALWAYS_ON]
  const { io, box } = fakeIo({ laidOff: [], isReviewed: false, stacks: [] }, types)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([STALE])
  expect(box.payroll.kept).toEqual([...filler, MINE, ...ALWAYS_ON])
})

test('a stale hire that is offered is held back, even though the settled team once held it', async () => {
  resetPayroll()
  const { io, box } = fakeIo(settled([STALE]), [STALE])
  expect(await holdBack(io, STALE)).toBe(true)
  expect(box.payroll.laidOff).toEqual([STALE])
})

test('a stale hire that is offered before the team is settled is held back too', async () => {
  resetPayroll()
  const { io } = fakeIo({ laidOff: [], isReviewed: false, stacks: [] }, [STALE])
  expect(await holdBack(io, STALE)).toBe(true)
})

test('this folder\'s own hire, the core helpers, the contractor and the built-ins are never held back', async () => {
  resetPayroll()
  const { io } = fakeIo(settled(['ecc:planner']), [])
  for (const type of [MINE, ...ALWAYS_ON, ...BUILT_IN]) expect(await holdBack(io, type)).toBe(false)
})

const unreadable = async (): Promise<readonly string[]> => { throw new Error('store down') }

test('a type that is no hire of Clawd HQ is answered without reading the folder\'s hires', async () => {
  resetPayroll()
  const { io } = fakeIo(settled(['ecc:planner']), [], { hires: unreadable })
  for (const type of [...BUILT_IN, ...ALWAYS_ON, 'ecc:planner']) expect(await holdBack(io, type)).toBe(false)
  expect(await holdBack(io, 'ecc:fresh')).toBe(true)
})

test('a hire that is offered while the folder\'s hires cannot be read is not held back, and nothing is saved', async () => {
  resetPayroll()
  const { io, box } = fakeIo(settled([STALE]), [], { hires: unreadable })
  expect(await holdBack(io, STALE)).toBe(false)
  expect(box.payroll.laidOff).toEqual([])
})

test('the routine check tells once, in plain words, that it could not read the hires, and does not throw', async () => {
  resetPayroll()
  const told: string[] = []
  const { io } = fakeIo(settled([STALE, MINE]), [STALE, MINE], { hires: unreadable })
  await checkPayroll(io, text => { told.push(text) })
  await checkPayroll(io, text => { told.push(text) })
  expect(told).toHaveLength(1)
  expect(told[0]).toMatch(/team/i)
  resetPayroll()
  await checkPayroll(io, text => { told.push(text) })
  expect(told).toHaveLength(2) // a new session tells again
})

test('a first review that fails on a read is not lost: the next look files it', async () => {
  resetPayroll()
  const filler = Array.from({ length: 15 }, (_, i) => `ecc:helper-${i}`)
  const types = [...filler, STALE, MINE]
  let calls = 0
  const { io, box } = fakeIo({ laidOff: [], isReviewed: false, stacks: [] }, types, {
    hires: async () => { calls += 1; if (calls === 1) throw new Error('store down'); return [MINE] },
  })
  await expect(reviewPayroll(io)).rejects.toThrow('store down')
  expect(box.payroll.isReviewed).toBe(false)
  await reviewPayroll(io)
  expect(box.payroll.isReviewed).toBe(true)
  expect(box.payroll.laidOff).toEqual([STALE])
})

test('the routine check reads the folder\'s hires once for the hires it has already found to be its own', async () => {
  resetPayroll()
  let reads = 0
  const { io } = fakeIo(settled([MINE]), [MINE], { hires: async () => { reads += 1; return [MINE] } })
  await reviewPayroll(io)
  await reviewPayroll(io)
  await reviewPayroll(io)
  expect(reads).toBe(1)
})

test('the routine check still finds a stale hire that shows up after the first look', async () => {
  resetPayroll()
  const types = [MINE]
  const { io, box } = fakeIo(settled([MINE]), types, { types: async () => types })
  await reviewPayroll(io)
  types.push(STALE)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([STALE])
})

// ---- The cover rule: an installed helper on the team takes the place of Clawd HQ's own one for its role ----

const REVIEWER = 'clawd-hq:core-reviewer'
const PLANNER = 'clawd-hq:core-planner'
const COVER = 'ecc:code-reviewer'
/** The engine offers each type through holdBack, as at a session's start. */
const offerAll = async (io: PayrollIo, types: readonly string[]) => { for (const t of types) await holdBack(io, t) }

/** A settled team with an installed code reviewer, every type offered this session. */
async function withCover(over: Partial<PayrollIo> = {}) {
  const types = [COVER, ...ALWAYS_ON, ...BUILT_IN]
  const made = fakeIo(settled(types), types, over)
  await offerAll(made.io, types)
  return made
}

test('with an installed code reviewer on the team, the routine check sets Clawd HQ\'s Reviewer aside', async () => {
  resetPayroll()
  const { io, box } = await withCover()
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([REVIEWER])
  expect(box.payroll.ruleLaidOff).toEqual([REVIEWER])
})

test('once its cover is laid off by hand, the Reviewer comes back by itself', async () => {
  resetPayroll()
  const { io, box } = await withCover()
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([REVIEWER])
  await setLaidOff(io, COVER, true)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([COVER])
  expect(box.payroll.kept).toContain(REVIEWER)
})

test('a Reviewer brought back by hand stays, checked three times, with no save after the hand return', async () => {
  resetPayroll()
  let saves = 0
  const { io, box } = await withCover()
  await reviewPayroll(io)
  const set = io.set
  io.set = async p => { saves += 1; await set(p) }
  await setLaidOff(io, REVIEWER, false)
  for (let i = 0; i < 3; i += 1) await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([])
  expect(box.payroll.handHired).toEqual([REVIEWER])
  expect(saves).toBe(1)
})

test('a saved planner skill hire of this folder sets Clawd HQ\'s Planner aside', async () => {
  resetPayroll()
  const types = ['clawd-hq:planner', ...ALWAYS_ON]
  const { io, box } = fakeIo(settled(types), types, { hires: async () => ['clawd-hq:planner'] })
  await offerAll(io, types)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([PLANNER])
})

test('the rule waits until one of the four is offered this session', async () => {
  resetPayroll()
  const types = [COVER, ...ALWAYS_ON]
  const { io, box } = fakeIo(settled(types), types)
  await offerAll(io, [COVER])
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([])
  resetPayroll() // a new session: nothing offered yet
  await offerAll(io, ALWAYS_ON)
  await reviewPayroll(io)
  expect(box.payroll.laidOff).toEqual([])
})

test('the cover check reads the folder\'s hires only when a skill hire could fill a role', async () => {
  resetPayroll()
  let reads = 0
  const { io } = await withCover({ hires: async () => { reads += 1; return [MINE] } })
  await reviewPayroll(io)
  await reviewPayroll(io)
  expect(reads).toBe(0)
})
