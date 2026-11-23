// The "You should know" prompts, pure: prompts/observer.md (the check) and prompts/explain.md (Learn more), read from the plugin
// folder by know-check.ts, and filled in here. The files are sent word for word; only their placeholders change, and the marker
// comments of explain.md, which hold its three follow-up texts, are taken out before it is sent.

export const OBSERVER_FILE = 'prompts/observer.md'
export const EXPLAIN_FILE = 'prompts/explain.md'
/** The newest this many of the shown and the knew lists ride in the check. */
export const LIST_KEEP = 10
/** What an empty list reads as. */
export const EMPTY_LIST = 'None yet.'
/** Clawd's reply rides after the prompt up to this length; past it the end is cut, with a mark in words. */
export const ANSWER_CHARS = 6_000

export const FOLLOW_UPS = ['simpler', 'shorter', 'more detail'] as const
export type FollowUp = (typeof FOLLOW_UPS)[number]

/** Every `{{NAME}}` with a value is replaced, in one pass: text put in is never read for placeholders again. */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name]! : whole))
}

const listOf = (items: readonly string[]) => (items.length === 0 ? EMPTY_LIST : items.slice(-LIST_KEEP).map(x => `- ${x}`).join('\n'))

/**
 * DECIDED: Clawd's reply rides after the prompt, fenced. The fork re-sends the main thread's last request, which may stop
 * before the reply that ended the turn (unconfirmed), and the prompt is about what the person has just been told.
 */
const REPLY_HEAD = "## Clawd's reply to the person\n\nThe reply that ended Clawd's turn, in case the conversation above stops before it:"

function replyOf(answer: string): string {
  const text = answer.trim().replace(/<\s*\/?\s*reply\b[^>]*>/gi, '[reply tag removed]')
  if (text === '') return ''
  const kept = text.length <= ANSWER_CHARS ? text : `${text.slice(0, ANSWER_CHARS)}\n[trimmed: ${text.length - ANSWER_CHARS} characters of the reply not shown]`
  return `\n\n${REPLY_HEAD}\n\n<reply>\n${kept}\n</reply>`
}

/** The check's one message: observer.md with the newest shown notes and knew topics in place, then Clawd's reply. */
export function observerPrompt(template: string, shown: readonly string[], knew: readonly string[], answer: string): string {
  return `${fill(template.trimEnd(), { SHOWN: listOf(shown), KNEW: listOf(knew) })}${replyOf(answer)}`
}

/** explain.md read: what is sent, and the three texts that can take the place of `{{FOLLOW_UP}}`. */
export type ExplainTemplate = { body: string; followUps: Readonly<Record<FollowUp, string>> }

const MARKER = /^<!--\s*follow-up:\s*(.+?)\s*-->$/
const isFollowUp = (name: string): name is FollowUp => (FOLLOW_UPS as readonly string[]).includes(name)

/** The body and the follow-up texts; none when the file is not in the shape the code fills (a placeholder or a text missing). */
export function explainTemplate(text: string): ExplainTemplate | undefined {
  const body: string[] = []
  const found: Partial<Record<FollowUp, string[]>> = {}
  let into: string[] | undefined
  for (const line of text.split(/\r?\n/)) {
    const marker = MARKER.exec(line.trim())
    if (marker) {
      if (!isFollowUp(marker[1]!)) return undefined
      into = found[marker[1]] = []
    } else if (/^\s*<!--.*-->\s*$/.test(line)) {
      into = undefined
    } else if (into && /^#{1,6}\s/.test(line)) {
      into = undefined
      body.push(line)
    } else {
      ;(into ?? body).push(line)
    }
  }
  const followUps = Object.fromEntries(FOLLOW_UPS.map(kind => [kind, (found[kind] ?? []).join('\n').trim()])) as Record<FollowUp, string>
  const joined = body.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const isWhole = joined.includes('{{NOTE}}') && joined.includes('{{FOLLOW_UP}}') && FOLLOW_UPS.every(kind => followUps[kind].includes('{{PREVIOUS}}'))
  return isWhole ? { body: joined, followUps } : undefined
}

/** Learn more's one message: the note, and for a follow-up its text with the explanation the person last read. */
export function explainPrompt(t: ExplainTemplate, note: string, followUp?: { kind: FollowUp; previous: string }): string {
  const text = followUp ? fill(t.followUps[followUp.kind], { PREVIOUS: followUp.previous }) : ''
  return fill(t.body, { NOTE: note, FOLLOW_UP: text })
}
