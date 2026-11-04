// The cover rule: Clawd HQ's own four helpers are backups. One whose role a helper on the team already fills is laid off by the
// rule, and comes back by itself once nothing on the team fills that role. A choice made by hand always wins. Pure, and no engine
// calls here: hooks/payroll.ts runs it in the routine check and records the hand choices.
import type { Payroll } from '../types'
import { CONTRACTOR_TYPE } from './contractor-name'
import { CORE_FOUR } from './core-four'
import { isBuiltIn } from './helpers'
import { isHireType, SHIPPED_TYPES } from './standing'

/** Plain words a name may carry beside its role's words and still fill only that role. */
const PLAIN_WORDS: ReadonlySet<string> = new Set(['code', 'general', 'senior', 'lead', 'software', 'implementation'])
/** The words that name each role, by the shipped helper's plain name. */
const ROLE_WORDS: Readonly<Record<string, readonly string[]>> = {
  Planner: ['planner'],
  Builder: ['builder', 'implementer', 'developer', 'engineer'],
  Reviewer: ['reviewer'],
  Researcher: ['researcher'],
}
const ROLES = CORE_FOUR.map(h => ({ type: h.type, words: new Set(ROLE_WORDS[h.label] ?? []) }))
const CORE_TYPES: ReadonlySet<string> = new Set(CORE_FOUR.map(h => h.type))

const wordsOf = (type: string) => type.slice(type.lastIndexOf(':') + 1).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** The shipped helper whose role a name fills: every word of its short name is that role's or a plain one, and one at least is the role's. */
function byWords(type: string): string | undefined {
  const words = wordsOf(type)
  return ROLES.find(r => words.some(w => r.words.has(w)) && words.every(w => r.words.has(w) || PLAIN_WORDS.has(w)))?.type
}

/** Built-ins, the shipped agents and every contractor never cover a role. */
const isNeverCover = (type: string) => isBuiltIn(type) || SHIPPED_TYPES.has(type) || type.startsWith(CONTRACTOR_TYPE)

/** Which of the four an agent type covers, if any. A skill hire covers only when it is one of this folder's own (`ownHires`, as listed). */
export function coveredCore(type: string, ownHires: ReadonlySet<string>): string | undefined {
  if (isNeverCover(type) || (isHireType(type) && !ownHires.has(type))) return undefined
  return byWords(type)
}

/** Whether a type is a skill hire that would cover a role if it is this folder's own: only then are the folder's hires worth reading. */
export const isSkillCover = (type: string): boolean => isHireType(type) && !isNeverCover(type) && byWords(type) !== undefined

const without = (list: readonly string[] | undefined, type: string) => (list ?? []).filter(t => t !== type)
const withOne = (list: readonly string[] | undefined, type: string) => [...new Set([...(list ?? []), type])]

function setAside(p: Payroll, core: string): Payroll {
  const kept = p.kept === undefined ? {} : { kept: without(p.kept, core) }
  return { ...p, ...kept, laidOff: withOne(p.laidOff, core), ruleLaidOff: withOne(p.ruleLaidOff, core) }
}

function bringBack(p: Payroll, core: string): Payroll {
  const kept = p.kept === undefined ? {} : { kept: withOne(p.kept, core) }
  return { ...p, ...kept, laidOff: without(p.laidOff, core), ruleLaidOff: without(p.ruleLaidOff, core) }
}

/**
 * One shipped helper judged: set aside when covered (unless laid off already or brought back by hand), back when the rule set it aside and
 * nothing covers it. A hand return lasts only while a cover is on the team: once none is, it is forgotten, so a later cover sets it aside again.
 */
function judged(p: Payroll, core: string, isCovered: boolean): Payroll {
  if (isCovered && !p.laidOff.includes(core) && !(p.handHired ?? []).includes(core)) return setAside(p, core)
  if (!isCovered && (p.ruleLaidOff ?? []).includes(core)) return bringBack(p, core)
  if (!isCovered && (p.handHired ?? []).includes(core)) return { ...p, handHired: without(p.handHired, core) }
  return p
}

/**
 * The payroll with the rule applied, or nothing when it changes nothing. A cover is a type offered this session (`offered`) and not laid
 * off. Nothing is judged on a payroll never reviewed, or before one of the four has been offered this session.
 */
export function withCoverRule(p: Payroll, offered: ReadonlySet<string>, ownHires: ReadonlySet<string>): Payroll | undefined {
  if (!p.isReviewed || !CORE_FOUR.some(h => offered.has(h.type))) return undefined
  const laid = new Set(p.laidOff)
  const covered = new Set([...offered].filter(t => !laid.has(t)).map(t => coveredCore(t, ownHires)))
  const next = CORE_FOUR.reduce((acc, h) => judged(acc, h.type, covered.has(h.type)), p)
  return next === p ? undefined : next
}

/** A hand layoff (`isOff`) or hand return of one of the four, recorded: a return is not set aside again while a cover stays; a layoff is not brought back. Any other type: unchanged. */
export function withHandChoice(p: Payroll, type: string, isOff: boolean): Payroll {
  if (!CORE_TYPES.has(type)) return p
  return { ...p, ruleLaidOff: without(p.ruleLaidOff, type), handHired: isOff ? without(p.handHired, type) : withOne(p.handHired, type) }
}
