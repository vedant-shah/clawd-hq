// The host's own task list while Clawd runs the chat, pure. Soft only: no call is refused. Its reminders are left out of
// Clawd's requests, and its three write tools carry a note that points at the plan and wait behind tool search.
// register-agents.ts wires it, reading "Clawd runs the chat" live; register-state.ts keeps what the session is.
import { isBriefed } from './instructions'

/** The task list's write tools: the older full-list one, and the newer one-task-at-a-time pair. Reads are left alone. */
export const TASK_WRITE_TOOLS: readonly string[] = ['TodoWrite', 'TaskCreate', 'TaskUpdate']

/**
 * The host's nudges to use its task list: `todo_reminder` (named in the host's types) and `task_reminder`, the newer
 * tools' own, which the types do not name: it was read off Claude Code 2.1.325 itself. A build without one never sends it.
 */
export const TASK_REMINDERS: readonly string[] = ['todo_reminder', 'task_reminder']

/** Added to each write tool's text. The text is the same for every loop of the process, so it tells specialists to carry on. */
export const TASK_LIST_NOTE =
  ' While Clawd HQ runs the chat, keep the plan with the plan tool; the Office tab cannot see this list. A specialist or teammate uses this list as usual.'

/**
 * What this session is, from the first system prompt the engine renders: a chief of staff's, or a teammate's or bare one.
 * `unknown` until then, and where another plugin routes that event past Clawd HQ (hooks/rules-reach.ts): taken as briefed.
 */
export type SessionKind = 'unknown' | 'briefed' | 'other'

/** The first render decides: a teammate's prompt rendered later in the same process is that teammate's, not this session's. */
export const kindAfter = (kind: SessionKind, traits: readonly string[]): SessionKind =>
  kind !== 'unknown' ? kind : isBriefed(traits) ? 'briefed' : 'other'

/** Whether the soft fix holds now: Clawd on (read live by the caller) and this session no teammate's or bare one. */
export const isSoftOn = (isOn: boolean, kind: SessionKind) => isOn && kind !== 'other'

/** A write tool's text with the note, moved behind tool search. */
export const withTaskNote = <R extends { description: string }>(r: R): R & { isDeferred: true } =>
  ({ ...r, description: r.description + TASK_LIST_NOTE, isDeferred: true })

/** A task-list reminder for the main chat (`agentId` absent) is left out while the fix holds; a specialist's or teammate's is kept. */
export const dropsReminder = (isOn: boolean, kind: SessionKind, agentId: string | undefined) =>
  agentId === undefined && isSoftOn(isOn, kind)
