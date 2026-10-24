// Payroll: which agent types Clawd is offered in this project, and the review that lays off, by itself, the types it does not use.
// register.tsx hands over the calls it may make (PayrollIo); nothing here touches `$` or an atom.
import type { Fx, Payroll } from '../types'
import { projectFiles, proposeLayoffs } from './desk'
import { isBuiltIn } from './helpers'
import { withLaidOff } from './office-state'

const OWN_PLUGIN = 'clawd-hq'

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
  /** The agent types the setup picked for this project, or none when no team was written down. */
  picks: () => Promise<readonly string[] | undefined>
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

/** Built-in agents and this plugin's own hires are always on the team. */
const isStanding = (type: string) => isBuiltIn(type) || type.startsWith(`${OWN_PLUGIN}:`)

/**
 * A payroll settled before the team was written down: the team is the setup's picks (else what is not laid off now), and every other
 * type the office knows of is laid off, so what crept in since is not on the team. Nobody is asked.
 */
async function settleTeam(io: PayrollIo, p: Payroll) {
  const types = await io.types()
  if (types.length === 0) return // nothing offered yet: try again on the next look
  const picks = await io.picks()
  const laid = new Set(p.laidOff)
  const kept = types.filter(t => isStanding(t) || (picks ? picks.includes(t) : !laid.has(t)))
  await savePayroll(io, { ...p, kept, laidOff: [...new Set([...p.laidOff, ...types.filter(t => !kept.includes(t))])] })
}

export async function reviewPayroll(io: PayrollIo) {
  const first = await io.get()
  if (first.isReviewed && first.kept === undefined) return settleTeam(io, first)
  if (isFiled || first.isReviewed) return
  const types = await io.types()
  if (types.length < 15) return
  isFiled = true
  const plan = await planOf(io, types)
  // The files took a moment to list: a payroll the person settled by hand meanwhile is left as it is.
  const now = await io.get()
  if (now.isReviewed) return
  // No question is asked: the types this project has no use for are laid off at once. A search in the People tab still finds them to rehire.
  const laidOff = [...new Set([...now.laidOff, ...plan.laidOff])]
  await savePayroll(io, { laidOff, isReviewed: true, stacks: plan.stacks, kept: types.filter(t => !laidOff.includes(t)) })
}

/**
 * Whether an offered type is held back from Clawd. A type the settled team does not know is new: it is laid off at once, so it waits
 * in the pool until the person hires it. Before the team is settled, only what was laid off is held back.
 */
export async function holdBack(io: PayrollIo, type: string): Promise<boolean> {
  const p = await io.get()
  if (p.laidOff.includes(type)) return true
  if (p.kept === undefined || p.kept.includes(type) || isStanding(type)) return false
  await savePayroll(io, { ...p, laidOff: [...p.laidOff, type] })
  return true
}

export const setLaidOff = async (io: PayrollIo, type: string, isOff: boolean) => savePayroll(io, withLaidOff(await io.get(), type, isOff))
