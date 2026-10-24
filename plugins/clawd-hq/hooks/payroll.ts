// Payroll: which agent types Clawd is offered in this project, and the review that lays off, by itself, the types it does not use.
// register.tsx hands over the calls it may make (PayrollIo); nothing here touches `$` or an atom.
import type { Fx, Payroll } from '../types'
import { projectFiles, proposeLayoffs } from './desk'
import { withLaidOff } from './office-state'

export type PayrollIo = {
  /** The project folder; payroll is kept per project. */
  cwd: string
  get: () => Promise<Payroll>
  /** Into this session's state. */
  set: (p: Payroll) => Promise<void>
  /** Into the store, across sessions. */
  keep: (key: string, p: Payroll) => Promise<void>
  /** Every agent type the office knows of. */
  types: () => Promise<string[]>
  list: (path: string) => Promise<ReadonlyArray<{ name: string; kind: string }>>
  fx: () => Promise<Fx>
  setFx: (fn: (f: Fx) => Fx) => Promise<void>
  /** The agent listing is drawn from the offer: ask for it again. */
  invalidate: () => void
}

/** The review is filed once a session. */
let isFiled = false
export const resetPayroll = () => { isFiled = false }

export async function savePayroll(io: PayrollIo, p: Payroll) {
  await io.set(p)
  if (io.cwd) await io.keep(`payroll:${io.cwd}`, p)
  // Once the payroll is settled, by the review or by hand, the review leaves the People tab.
  if (p.isReviewed && (await io.fx()).layoffs) await io.setFx(f => ({ ...f, layoffs: undefined }))
  io.invalidate()
}

const planOf = async (io: PayrollIo, types: string[]) => proposeLayoffs(types, await projectFiles(io.cwd, io.list))

export async function reviewPayroll(io: PayrollIo) {
  if (isFiled || (await io.get()).isReviewed) return
  const types = await io.types()
  if (types.length < 15) return
  isFiled = true
  const plan = await planOf(io, types)
  if (plan.laidOff.length === 0) {
    await savePayroll(io, { ...(await io.get()), isReviewed: true, stacks: plan.stacks })
    return
  }
  // The files took a moment to list: a payroll the person settled by hand meanwhile is left as it is.
  const now = await io.get()
  if (now.isReviewed) return
  // No question is asked: the types this project has no use for are laid off at once. A search in the People tab still finds them to rehire.
  await savePayroll(io, { laidOff: [...new Set([...now.laidOff, ...plan.laidOff])], isReviewed: true, stacks: plan.stacks })
}

export const setLaidOff = async (io: PayrollIo, type: string, isOff: boolean) => savePayroll(io, withLaidOff(await io.get(), type, isOff))
