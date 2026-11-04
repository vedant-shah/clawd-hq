// The cover rule: an installed helper that fills the role of one of Clawd HQ's own four sets that one aside, and it comes back
// by itself once nothing on the team fills the role any more. A choice made by hand always wins.
import { expect, test } from 'claude-code/testing'
import { coveredCore, isSkillCover, withCoverRule, withHandChoice } from '../hooks/core-cover'
import type { Payroll } from '../types'

const PLANNER = 'clawd-hq:core-planner'
const BUILDER = 'clawd-hq:core-builder'
const REVIEWER = 'clawd-hq:core-reviewer'
const RESEARCHER = 'clawd-hq:core-researcher'
const CORE = [PLANNER, BUILDER, REVIEWER, RESEARCHER]
const NO_HIRES: ReadonlySet<string> = new Set()

const settled = (kept: string[], over: Partial<Payroll> = {}): Payroll => ({ laidOff: [], isReviewed: true, stacks: [], kept, ...over })

test('an agent made only of a role\'s words, and the plain words, fills that role', () => {
  expect(coveredCore('ecc:planner', NO_HIRES)).toBe(PLANNER)
  expect(coveredCore('ecc:code-reviewer', NO_HIRES)).toBe(REVIEWER)
  expect(coveredCore('acme:software-engineer', NO_HIRES)).toBe(BUILDER)
  expect(coveredCore('researcher', NO_HIRES)).toBe(RESEARCHER)
  for (const t of ['a:implementer', 'a:developer', 'a:senior-builder', 'a:lead-engineer', 'a:general-implementation-engineer']) expect(coveredCore(t, NO_HIRES)).toBe(BUILDER)
})

test('a specialist sits beside the helper: a word outside the role\'s and the plain words means no cover', () => {
  for (const t of ['security-reviewer', 'ecc:go-reviewer', 'ecc:typescript-reviewer', 'ecc:database-reviewer', 'ecc:architect', 'ecc:tdd-guide',
    'ecc:code-explorer', 'ecc:docs-lookup', 'acme:frontend-developer', 'a:planner-reviewer', 'a:code', 'a:senior-lead']) {
    expect(coveredCore(t, NO_HIRES)).toBeUndefined()
  }
})

test('built-ins, Clawd HQ\'s shipped agents and the contractors never cover a role', () => {
  for (const t of ['Plan', 'Explore', 'general-purpose', 'statusline-setup', ...CORE, 'clawd-hq:contractor', 'clawd-hq:contractor-reviewer', 'clawd-hq:scout']) {
    expect(coveredCore(t, new Set([t]))).toBeUndefined()
  }
})

test('a skill hire covers a role only when it is one of this folder\'s own saved hires', () => {
  expect(coveredCore('clawd-hq:planner', new Set(['clawd-hq:planner']))).toBe(PLANNER)
  expect(coveredCore('clawd-hq:code-reviewer', new Set(['clawd-hq:code-reviewer']))).toBe(REVIEWER)
  expect(coveredCore('clawd-hq:planner', NO_HIRES)).toBeUndefined()
  expect(coveredCore('clawd-hq:tdd-workflow', new Set(['clawd-hq:tdd-workflow']))).toBeUndefined()
})

test('only a skill hire whose name passes the word test needs the folder\'s hires read', () => {
  expect(isSkillCover('clawd-hq:planner')).toBe(true)
  expect(isSkillCover('clawd-hq:tdd-workflow')).toBe(false)
  expect(isSkillCover('ecc:planner')).toBe(false)
  expect(isSkillCover(PLANNER)).toBe(false)
})

test('an installed reviewer on the team sets the Reviewer aside, and it is off the kept list', () => {
  const p = settled(['ecc:code-reviewer', ...CORE])
  const next = withCoverRule(p, new Set(['ecc:code-reviewer', ...CORE]), NO_HIRES)
  expect(next?.laidOff).toEqual([REVIEWER])
  expect(next?.ruleLaidOff).toEqual([REVIEWER])
  expect(next?.kept).toEqual(['ecc:code-reviewer', PLANNER, BUILDER, RESEARCHER])
  expect(p.laidOff).toEqual([]) // the payroll given is not changed
})

test('a saved planner skill hire sets the Planner aside', () => {
  const p = settled(['clawd-hq:planner', ...CORE])
  const next = withCoverRule(p, new Set(['clawd-hq:planner', ...CORE]), new Set(['clawd-hq:planner']))
  expect(next?.laidOff).toEqual([PLANNER])
})

test('a laid-off helper is no cover', () => {
  const p = settled(CORE, { laidOff: ['ecc:code-reviewer'] })
  expect(withCoverRule(p, new Set(['ecc:code-reviewer', ...CORE]), NO_HIRES)).toBeUndefined()
})

test('the Reviewer comes back once its cover is laid off, or is not offered this session', () => {
  const aside = settled(['ecc:code-reviewer', PLANNER], { laidOff: [REVIEWER], ruleLaidOff: [REVIEWER] })
  const offLaid = withCoverRule({ ...aside, laidOff: [REVIEWER, 'ecc:code-reviewer'] }, new Set(['ecc:code-reviewer', ...CORE]), NO_HIRES)
  expect(offLaid?.laidOff).toEqual(['ecc:code-reviewer'])
  expect(offLaid?.ruleLaidOff).toEqual([])
  expect(offLaid?.kept).toEqual(['ecc:code-reviewer', PLANNER, REVIEWER])
  const gone = withCoverRule(aside, new Set(CORE), NO_HIRES)
  expect(gone?.laidOff).toEqual([])
  expect(gone?.kept).toContain(REVIEWER)
})

test('nothing happens before any of the four is offered this session, or on a payroll never reviewed', () => {
  expect(withCoverRule(settled(['ecc:code-reviewer', ...CORE]), new Set(['ecc:code-reviewer']), NO_HIRES)).toBeUndefined()
  const fresh: Payroll = { laidOff: [], isReviewed: false, stacks: [] }
  expect(withCoverRule(fresh, new Set(['ecc:code-reviewer', ...CORE]), NO_HIRES)).toBeUndefined()
})

test('a helper laid off by hand is not brought back, and one brought back by hand is not set aside again', () => {
  const byHand = settled([], { laidOff: [REVIEWER] })
  expect(withCoverRule(byHand, new Set(CORE), NO_HIRES)).toBeUndefined()
  const returned = settled(['ecc:code-reviewer', ...CORE], { handHired: [REVIEWER] })
  expect(withCoverRule(returned, new Set(['ecc:code-reviewer', ...CORE]), NO_HIRES)).toBeUndefined()
})

test('a hand return lasts only while a cover is on the team: once the cover goes, a later cover lays the helper off again', () => {
  const returned = settled(['ecc:code-reviewer', ...CORE], { handHired: [REVIEWER] })
  const offered = new Set(['ecc:code-reviewer', ...CORE])
  const coverGone = withCoverRule({ ...returned, laidOff: ['ecc:code-reviewer'] }, offered, NO_HIRES)
  expect(coverGone?.handHired).toEqual([])
  expect(coverGone?.laidOff).toEqual(['ecc:code-reviewer'])
  expect(withCoverRule(coverGone as Payroll, offered, NO_HIRES)).toBeUndefined() // no loop
  const uninstalled = withCoverRule(returned, new Set(CORE), NO_HIRES)
  expect(uninstalled?.handHired).toEqual([])
  const later = { ...(coverGone as Payroll), kept: [...(coverGone?.kept ?? []), 'acme:reviewer'] }
  expect(withCoverRule(later, new Set([...offered, 'acme:reviewer']), NO_HIRES)?.laidOff).toEqual(['ecc:code-reviewer', REVIEWER])
})

test('no loop: the rule run on its own result changes nothing', () => {
  const offered = new Set(['ecc:code-reviewer', 'ecc:planner', ...CORE])
  const aside = withCoverRule(settled(['ecc:code-reviewer', 'ecc:planner', ...CORE]), offered, NO_HIRES)
  expect(aside?.laidOff).toEqual([PLANNER, REVIEWER])
  expect(withCoverRule(aside as Payroll, offered, NO_HIRES)).toBeUndefined()
  const back = withCoverRule(aside as Payroll, new Set(CORE), NO_HIRES)
  expect(back?.laidOff).toEqual([])
  expect(withCoverRule(back as Payroll, new Set(CORE), NO_HIRES)).toBeUndefined()
})

test('a hand return is remembered and the rule\'s mark is dropped; a hand layoff drops both marks', () => {
  const aside = settled(['ecc:code-reviewer'], { laidOff: [REVIEWER], ruleLaidOff: [REVIEWER] })
  const hired = withHandChoice(aside, REVIEWER, false)
  expect(hired.handHired).toEqual([REVIEWER])
  expect(hired.ruleLaidOff).toEqual([])
  const fired = withHandChoice(hired, REVIEWER, true)
  expect(fired.handHired).toEqual([])
  expect(fired.ruleLaidOff).toEqual([])
  expect(withHandChoice(aside, 'ecc:code-reviewer', true)).toBe(aside) // any other type: nothing to record
})
