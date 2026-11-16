// How Clawd's rules reach the model, pure. The usual road is the system prompt (the prompt.compose hook). Claude Code's
// built-in security plugin, cc-plugin-sec-default, sits outermost for Team and Enterprise organizations and on machines
// with managed settings, and sends prompt.compose and prompt.context past every plugin a person installs
// (`next.to(e, 'append')`), so those hooks of ours never run there. Then the rules ride with a prompt instead: once per
// conversation, and again once the conversation has shrunk (a compaction, a rewind, /clear). register-state.ts keeps the
// value, register-rules.ts hands in what it saw, and does the reads and writes.

/** What this session has seen of the two roads. */
export type Reach = {
  /** Our system prompt hook ran this session: nothing routes the event past it here. */
  isComposeSeen: boolean
  /** The latest system prompt it ran for got the rules. */
  isDelivered: boolean
  /** The rules rode with a prompt in this conversation. */
  isSent: boolean
  /** The message count of the main chat's latest request: a smaller one means the conversation shrank. */
  messages: number
}

export const REACH0: Reach = { isComposeSeen: false, isDelivered: false, isSent: false, messages: 0 }

/** The store key of what the last request learnt: true when the system prompt hook did not run on this machine. */
export const BYPASS_KEY = 'brief:composeBypassed'

/** The warning on Clawd's card when the latest request of the main chat went without the rules. */
export const LOST_LINE = 'Clawd\'s instructions did not reach Claude on its last request, so it worked without them.'

const FRAME = [
  'Clawd HQ: your standing instructions as chief of staff for this conversation. They usually sit in the system prompt;',
  'in this session another plugin routes the system prompt past Clawd HQ, so they come with this message and hold for the rest of the conversation.',
].join(' ')

export const withCompose = (r: Reach, isDelivered: boolean): Reach => ({ ...r, isComposeSeen: true, isDelivered })
export const withSent = (r: Reach): Reach => ({ ...r, isSent: true })
/** A main chat request: one carrying fewer messages than the last means the copy that rode is gone. */
export const withRequest = (r: Reach, messages: number): Reach => (messages < r.messages ? { ...r, isSent: false, messages } : { ...r, messages })
/**
 * /clear, a resume, or a compaction of the main chat: the copy that rode is gone. What was seen of the system prompt hook stays,
 * as it is the machine's. The count starts over, so the shorter chat's next request is not taken for another shrink.
 */
export const withNewConversation = (r: Reach): Reach => ({ ...r, isSent: false, messages: 0 })

/**
 * Whether the rules ride with this prompt: the system prompt hook has not run this session, they have not ridden in this
 * conversation, and no earlier session learnt that the hook runs here (`wasBypassed` false).
 */
export const isFallbackDue = (r: Reach, wasBypassed: boolean | undefined): boolean => !r.isComposeSeen && !r.isSent && wasBypassed !== false

export const statusOf = (r: Reach): 'system' | 'message' | 'missing' => (r.isDelivered ? 'system' : r.isSent ? 'message' : 'missing')

/** After a main chat request: whether it went without the rules, and what to store (undefined: nothing new was learnt). */
export function judged(r: Reach, wasBypassed: boolean | undefined): { isLost: boolean; bypassed?: boolean } {
  const bypassed = !r.isComposeSeen
  return { isLost: statusOf(r) === 'missing', bypassed: bypassed === wasBypassed ? undefined : bypassed }
}

/** The text that rides with a prompt: what it is and why it is there, the rules, then the profile from setup. */
export const fallbackText = (rules: string, profile?: string): string =>
  [FRAME, rules, ...(profile === undefined ? [] : [profile])].join('\n\n')

/**
 * One line after Claude Code compacts the chat by itself. Its summary ends by telling the model to carry on with no questions,
 * which can outweigh the system prompt on the first reply after it, so this says the rules still stand.
 */
export const COMPACT_REMINDER = 'Clawd HQ: the chat was just compacted. You are still Clawd, the chief of staff, and your standing instructions still apply to the work you resume.'

/** A message Clawd HQ adds to the compacted chat: built from its text, with no handle, as `session.compact` takes one. */
export type AddedRow = { role: 'user'; text: string; toolUses: never[] }
const added = (text: string): AddedRow => ({ role: 'user', text, toolUses: [] })

/**
 * The compacted chat with what Clawd HQ adds, right after the summary (the first message) and ahead of the messages kept
 * verbatim: the rules when they ride with messages (`copy`), then the reminder after an automatic compaction. Nothing to add: the same list.
 */
export function afterCompaction<T>(rows: readonly T[], add: { copy?: string; isAuto: boolean }): readonly (T | AddedRow)[] {
  const extra = [...(add.copy === undefined ? [] : [added(add.copy)]), ...(add.isAuto ? [added(COMPACT_REMINDER)] : [])]
  if (extra.length === 0) return rows
  return [...rows.slice(0, 1), ...extra, ...rows.slice(1)]
}
