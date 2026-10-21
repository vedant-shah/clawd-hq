// The "Add to CLAUDE.md" card, the work (no `$`): Clawd's offer, and the two buttons. The press writes the exact line shown into the
// project's CLAUDE.md, straight from the plugin, with no model in between: the press is the consent. This is the one place the
// plugin writes that file; it only ever adds a line, and it will not write when it cannot first read what is there.
// register.tsx holds the list's atom and hands in what each call may do as `RuleIo`.
import type { RuleOffer } from '../types'
import { parseRule, ruleKey, ruleLine, withOffer, withProblem, withoutOffer } from './rule-offers'
import { inLine, reasonOf } from './state'

/** What a specialist is told when it calls the tool: its note goes in its report, for Clawd to offer. */
export const RULE_SPECIALIST_DENY = 'Put it in your report for Clawd.'
/** How long the confirmation stays on the card. */
export const DONE_MS = 6000

/** The file calls the append needs. */
export type ClaudeMdIo = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
}

/** `added: false`: the rule was already in the file, so nothing was written. */
export type AppendResult = { ok: true; added: boolean } | { ok: false; reason: string }

/** A line of the file that is this rule: the bullet mark and the case and spacing do not matter. */
const isRuleLine = (line: string, key: string) => ruleKey(line.replace(/^\s*[-*•]\s+/, '')) === key

/**
 * Adds the rule as a bullet at the end of the file, creating the file when there is none. What is there is kept exactly (the line
 * breaks it uses too); a rule already in it is not added again. A file that cannot be read is never written to, since the
 * write replaces the whole text. A failure comes back as its reason, never thrown.
 */
export async function appendRule(io: ClaudeMdIo, path: string, rule: string): Promise<AppendResult> {
  if (path === '') return { ok: false, reason: 'there is no project folder to write in.' }
  try {
    const before = (await io.exists(path)) ? await io.read(path) : ''
    const key = ruleKey(rule)
    if (before.split(/\r?\n/).some(line => isRuleLine(line, key))) return { ok: true, added: false }
    const eol = before.includes('\r\n') ? '\r\n' : '\n'
    const gap = before === '' || before.endsWith('\n') ? '' : eol
    await io.write(path, `${before}${gap}${ruleLine(rule)}${eol}`)
    return { ok: true, added: true }
  } catch (err) {
    return { ok: false, reason: reasonOf(err) }
  }
}

/** What the card may do, each one a `$` call made in register.tsx. */
export type RuleIo = ClaudeMdIo & {
  /** The project's CLAUDE.md; '' when the session has no project folder. */
  path: () => string
  now: () => Promise<number>
  /** The list as it stands when the write lands: the change is made on that, so changes made at the same moment all land. */
  change: (fn: (list: RuleOffer[]) => RuleOffer[]) => Promise<RuleOffer[]>
  /** The confirmation the card shows for a moment. */
  setDone: (fn: (cur: { text: string; at: number } | undefined) => { text: string; at: number } | undefined) => Promise<unknown>
  after: (ms: number, fn: () => void) => unknown
}

export type RuleActions = { ruleAdd: (id: string) => unknown; ruleDismiss: (id: string) => unknown }

/** Clawd's call of `offer_rule`: the answer for him. A specialist's call is refused; a rule that is empty or too long is refused with why. */
export async function offerRule(io: RuleIo, agentId: string | undefined, input: Record<string, unknown>): Promise<{ result: string } | { deny: string }> {
  if (agentId !== undefined) return { deny: RULE_SPECIALIST_DENY }
  const parsed = parseRule(input)
  if ('error' in parsed) return { deny: parsed.error }
  const at = await io.now()
  await inLine(() => io.change(list => withOffer(list, parsed.rule, at)))
  return { result: `Offered to the person on the Office tab: “${parsed.rule}”. They add it to CLAUDE.md with one press; do not write it there yourself.` }
}

async function confirm(io: RuleIo, text: string) {
  const at = await io.now()
  await io.setDone(() => ({ text, at }))
  io.after(DONE_MS, () => void io.setDone(cur => (cur?.at === at ? undefined : cur)).catch(() => undefined))
}

/** The buttons. Add writes the line and, once it is in the file, takes the offer away; when it cannot, the offer stays with the reason. */
export function ruleActions(io: RuleIo): RuleActions {
  return {
    ruleAdd: id => inLine(async () => {
      const offer = (await io.change(list => list)).find(one => one.id === id)
      if (!offer) return
      const done = await appendRule(io, io.path(), offer.text)
      if (!done.ok) {
        await io.change(list => withProblem(list, id, `Could not add it to CLAUDE.md: ${done.reason}`))
        return
      }
      await io.change(list => withoutOffer(list, id))
      await confirm(io, done.added ? 'Added to CLAUDE.md' : 'Already in CLAUDE.md')
    }),
    ruleDismiss: id => inLine(async () => { await io.change(list => withoutOffer(list, id)) }),
  }
}
