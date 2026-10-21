// The lasting rules Clawd offers to put in the project's CLAUDE.md, pure: what a rule may say, and how the list of offers changes.
// register.tsx holds the list's atom; hooks/rule-io.ts changes it and writes the file through closures.
import type { RuleOffer } from '../types'
import { hash } from './office'
import { HIDDEN_MARKS } from './plain'

/** A rule is one line of at most this many characters. A longer one is refused, never cut: a cut rule would say something else. */
export const MAX_RULE = 300
/** The newest this many offers are kept; they last for the session only. */
export const MAX_OFFERS = 10

/** A rule, or the plain reason it is refused. */
export type RuleParsed = { rule: string } | { error: string }

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const BULLET = /^[-*•]\s+/
const ONLY_BULLET = /^[-*•]$/

/** Untrusted text as one plain line: control characters and hidden marks become spaces, runs of space one, a leading bullet mark goes. */
function oneLine(text: string): string {
  const flat = text.replace(CONTROL, ' ').replace(HIDDEN_MARKS, ' ').replace(/\s+/g, ' ').trim()
  return ONLY_BULLET.test(flat) ? '' : flat.replace(BULLET, '').trim()
}

/** What `offer_rule` was given: the rule as one clean line, or why it is refused. */
export function parseRule(input: Record<string, unknown>): RuleParsed {
  const { rule } = input
  if (typeof rule !== 'string') return { error: 'rule must be text: the rule in one line.' }
  const text = oneLine(rule)
  if (text === '') return { error: 'rule is empty. Give the rule in one line, in the person\'s words.' }
  const length = Array.from(text).length
  if (length > MAX_RULE) return { error: `rule is ${length} characters; the most is ${MAX_RULE}. Say it in one shorter line.` }
  return { rule: text }
}

/** The line written into CLAUDE.md. */
export const ruleLine = (rule: string) => `- ${rule}`

/** The same rule in any case or spacing. */
export const ruleKey = (rule: string) => rule.replace(/\s+/g, ' ').trim().toLowerCase()

/** The offer's id: the same rule always has the same one, so it stays while the offer stands. */
const idOf = (rule: string) => `rule-${hash(ruleKey(rule)).toString(36)}`

/** The list with this rule on top; an offer of the same rule is replaced by it (a problem it had is gone). The newest `MAX_OFFERS` are kept. */
export function withOffer(list: readonly RuleOffer[], rule: string, at: number): RuleOffer[] {
  const id = idOf(rule)
  return [{ id, text: rule, at }, ...list.filter(one => one.id !== id)].slice(0, MAX_OFFERS)
}

/** The list without that offer. */
export const withoutOffer = (list: readonly RuleOffer[], id: string): RuleOffer[] => list.filter(one => one.id !== id)

/** The list with the reason the last press of Add to CLAUDE.md failed, on that offer. */
export const withProblem = (list: readonly RuleOffer[], id: string, problem: string): RuleOffer[] =>
  list.map(one => (one.id === id ? { ...one, problem } : one))
