// Payroll: which agent types Clawd is offered in this project, and the review that lays off, by itself, the types it does not use.
// register.tsx hands over the calls it may make (PayrollIo); nothing here touches `$` or an atom.
import type { Fx, Payroll } from '../types'
import { isSkillCover, withCoverRule, withHandChoice } from './core-cover'
import { projectFiles, proposeLayoffs } from './desk'
import { withLaidOff } from './office-state'
import { isHireType, isStanding } from './standing'

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
  /** The agent types of this folder's own saved hires, as listed (`clawd-hq:<name>`): the only hires of Clawd HQ on this team. */
  hires: () => Promise<readonly string[]>
  list: (path: string) => Promise<ReadonlyArray<{ name: string; kind: string }>>
  fx: () => Promise<Fx>
  setFx: (fn: (f: Fx) => Fx) => Promise<void>
  /** The agent listing is drawn from the offer: ask for it again. */
  invalidate: () => void
}

/** The review is filed once a session. */
let isFiled = false
/** The skill hires the routine check has found to be this folder's own this session: not asked about again. */
let ownFound: ReadonlySet<string> = new Set()
/** A failed check is told once a session. */
let isFailureTold = false
/** Every type offered this session (each passes through holdBack): what the cover rule counts as installed. */
let offered: ReadonlySet<string> = new Set()
export const resetPayroll = () => { isFiled = false; ownFound = new Set(); isFailureTold = false; offered = new Set() }

export async function savePayroll(io: PayrollIo, p: Payroll) {
  await io.set(p)
  if (io.cwd) await io.keep(`payroll:${io.cwd}`, p)
  // Once the payroll is settled, by the review or by hand, the review leaves the People tab.
  if (p.isReviewed && (await io.fx()).layoffs) await io.setFx(f => ({ ...f, layoffs: undefined }))
  io.invalidate()
}

const planOf = async (io: PayrollIo, types: string[]) => proposeLayoffs(types, await projectFiles(io.cwd, io.list))

/** Who is on the team here, whatever the picks say, and which Clawd HQ types belong to another project's team. */
type Standing = { readonly isOn: (type: string) => boolean; readonly isStale: (type: string) => boolean }

/**
 * Built-in agents, the shipped helpers, the contractor and this folder's own hires are always on the team; a skill hire made in another
 * project is stale: it cannot be used here. A failed read of the folder's hires is thrown, so an own hire is never set aside for want of it.
 */
async function standingFor(io: PayrollIo): Promise<Standing> {
  const own = new Set(await io.hires())
  return { isOn: t => isStanding(t, own), isStale: t => isHireType(t) && !own.has(t) }
}

/**
 * A payroll settled before the team was written down: the team is the setup's picks (else what is not laid off now), and every other
 * type the office knows of is laid off, so what crept in since is not on the team. Nobody is asked.
 */
async function settleTeam(io: PayrollIo, p: Payroll) {
  const types = await io.types()
  if (types.length === 0) return // nothing offered yet: try again on the next look
  const picks = await io.picks()
  const { isOn, isStale } = await standingFor(io)
  const laid = new Set(p.laidOff)
  const kept = types.filter(t => isOn(t) || (!isStale(t) && (picks ? picks.includes(t) : !laid.has(t))))
  await savePayroll(io, { ...p, kept, laidOff: [...new Set([...p.laidOff, ...types.filter(t => !kept.includes(t))])] })
}

/** A settled payroll: the skill hires of other projects the office knows of are laid off, so an older project is cleaned up too. */
async function setAsideStale(io: PayrollIo, p: Payroll) {
  const maybe = (await io.types()).filter(t => isHireType(t) && !p.laidOff.includes(t) && !ownFound.has(t))
  if (maybe.length === 0) return // the common look: nothing to ask the store
  const { isStale } = await standingFor(io)
  const stale = maybe.filter(isStale)
  ownFound = new Set([...ownFound, ...maybe.filter(t => !isStale(t))])
  if (stale.length > 0) await savePayroll(io, { ...p, laidOff: [...p.laidOff, ...stale], ...(p.kept ? { kept: p.kept.filter(t => !stale.includes(t)) } : {}) })
}

/**
 * The cover rule (hooks/core-cover.ts) on the payroll as it is now: saved only when it changes something. The folder's hires are read
 * only when an offered skill hire could fill a role.
 */
async function applyCover(io: PayrollIo) {
  const own = [...offered].some(isSkillCover) ? new Set(await io.hires()) : new Set<string>()
  const next = withCoverRule(await io.get(), offered, own)
  if (next) await savePayroll(io, next)
}

export async function reviewPayroll(io: PayrollIo) {
  await reviewTeam(io)
  await applyCover(io)
}

async function reviewTeam(io: PayrollIo) {
  const first = await io.get()
  if (first.isReviewed && first.kept === undefined) return settleTeam(io, first)
  if (first.isReviewed) return setAsideStale(io, first)
  if (isFiled) return
  const types = await io.types()
  if (types.length < 15) return
  const plan = await planOf(io, types)
  // The files took a moment to list: a payroll the person settled by hand meanwhile is left as it is.
  const now = await io.get()
  if (now.isReviewed) return
  const { isStale } = await standingFor(io)
  // No question is asked: the types this project has no use for are laid off at once. A search in the People tab still finds them to rehire.
  const laidOff = [...new Set([...now.laidOff, ...plan.laidOff, ...types.filter(isStale)])]
  await savePayroll(io, { laidOff, isReviewed: true, stacks: plan.stacks, kept: types.filter(t => !laidOff.includes(t)) })
  isFiled = true // only once it is filed: a read that failed above is tried again on the next look
}

/**
 * The routine look, as the frame clock makes it. A failure is not thrown into the frame: it is told once a session, in plain words
 * through `tell`, and the next look tries again.
 */
export async function checkPayroll(io: PayrollIo, tell: (text: string) => void): Promise<void> {
  try {
    await reviewPayroll(io)
  } catch {
    if (isFailureTold) return
    isFailureTold = true
    tell('Clawd HQ could not check who is on the team just now. It tries again shortly.')
  }
}

const NO_HIRES: ReadonlySet<string> = new Set()

/** Whether a skill hire is one of this folder's own. A read that fails counts as own: an offer is never laid off for want of the read (the routine check tells of it). */
const isOwnHire = (io: PayrollIo, type: string): Promise<boolean> => io.hires().then(h => h.includes(type), () => true)

/**
 * Whether an offered type is held back from Clawd. A type the settled team does not know is new: it is laid off at once, so it waits
 * in the pool until the person hires it. Before the team is settled, only what was laid off is held back.
 */
export async function holdBack(io: PayrollIo, type: string): Promise<boolean> {
  if (!offered.has(type)) offered = new Set([...offered, type])
  const p = await io.get()
  if (p.laidOff.includes(type)) return true
  // Only a skill hire of Clawd HQ needs the folder's saved hires: every other type is answered without a store read. A skill hire of
  // another project is held back whatever the team held before; any other type only when the settled team does not know it.
  const isKept = isHireType(type) ? await isOwnHire(io, type) : isStanding(type, NO_HIRES) || p.kept === undefined || p.kept.includes(type)
  if (isKept) return false
  await savePayroll(io, { ...p, laidOff: [...p.laidOff, type] })
  return true
}

/** A layoff or rehire by hand; for one of Clawd HQ's own four it is also recorded as a hand choice, which the cover rule leaves alone. */
export const setLaidOff = async (io: PayrollIo, type: string, isOff: boolean) =>
  savePayroll(io, withHandChoice(withLaidOff(await io.get(), type, isOff), type, isOff))
