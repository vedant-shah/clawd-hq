// Left undone, the scanners (pure): a deferring sentence in a final answer, and an unfinished-work line in the text a
// file tool wrote. Both are conservative on purpose: a missed item costs less than a list that cries wolf.
import { fit } from './desk'
import { looksSecret, plainText } from './know'

/** A sentence from an answer is cut at a word to this many characters. */
export const ANSWER_MAX = 200
/** A line from a file is cut at a word to this many characters. */
export const FILE_MAX = 160
/** At most this many items come out of one answer, and out of one file change. */
const ANSWER_ITEMS = 3
const FILE_ITEMS = 5

/** The file tools whose newly written text is looked at. */
export const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const

// ---- Deferring sentences in an answer ----

/** Phrases that put work off. Each is narrow: a bare "skipped" or "for now" is not enough, and the speaker is "I" or "we". */
const DEFERS: readonly RegExp[] = [
  /\b(?:I|we)(?:'ll|’ll| will)\b(?!\s+(?:let you know|report|tell you|update you|get back|come back with))[^.!?\n]{0,80}\blater\b/i,
  /\b(?:left|leave|leaving|saved|deferred?|kept|put)\b[^.!?\n]{0,40}\bfor (?:later|a later (?:pass|step|time|date)|next time|a follow-?up)\b/i,
  /\bnot (?:been )?(?:done|finished|implemented|completed|built|handled|tested|wired(?: up)?) yet\b/i,
  /\b(?:I|we)(?:'ve| have)? (?:skipped|left out)\b/i,
  /\b(?:I|we) (?:did not|didn['’]t) (?:run|get to|finish|test)\b/i,
  /\b(?:I|we) (?:have not|haven['’]t) (?:run|done|tested|finished)\b/i,
  /\bout of scope for now\b/i,
  /\byou (?:may|might) want to (?:add|fix|handle|test|run|check|review|update|configure|set|verify|consider|tighten|clean|remove|move|migrate|write|wire|implement|finish)\b/i,
  /\bnext steps? (?:would be|will be|is to|are to)\b/i,
  /\bTODO\b(?!\s+(?:list|comments?|items?|app|file))/,
]

/** A negation or a clean-up in front of the marker: "nothing was skipped", "I removed the TODO", "no TODO is left". */
const NEGATED = /\b(?:no|nothing|none|never|without|removed|resolved|fixed|cleared|deleted|dropped|addressed|not)\b[^.!?\n]{0,30}\b(?:TODO|skipped|left|deferred)\b/i

const FENCED = /```[\s\S]*?(?:```|$)/g
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+/
const MARKDOWN = /\*\*|__|`/g
/** A sentence ends at . ! or ? followed by a space and the start of the next one. */
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/

/** The lines of an answer that are the answer's own words: no code blocks, no quoted lines. */
function ownLines(answer: string): string[] {
  return answer.replace(FENCED, '\n').split(/\r?\n/).filter(line => !line.trimStart().startsWith('>'))
}

/** Words that put work off, found in the sentences of a final answer: at most three, once each, each cut at a word with no mark. */
export function deferredIn(answer: string): string[] {
  const found: string[] = []
  for (const line of ownLines(answer)) {
    for (const part of line.replace(BULLET, '').split(SENTENCE_END)) {
      const sentence = fit(plainText(part).replace(MARKDOWN, ''), ANSWER_MAX)
      if (sentence.length < 10 || sentence.endsWith('?') || looksSecret(sentence)) continue
      if (!DEFERS.some(re => re.test(sentence)) || NEGATED.test(sentence) || found.includes(sentence)) continue
      found.push(sentence)
    }
  }
  return found.slice(0, ANSWER_ITEMS)
}

// ---- Unfinished-work lines in what a file tool wrote ----

/** An unfinished-work line: what to show, and its line in the text it was found in (1 is the first). */
export type FileHit = { text: string; line: number }

const COMMENT_TODO = /(?:\/\/|#|\/\*+|\*|<!--|--|;)\s*((?:TODO|FIXME)\b.*)$/
const SKIPPED_TEST = /\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe)\s*\(|@pytest\.mark\.skip\b|\bt\.Skip\(/
const NOT_DONE = /\bnot implemented\b|\bNotImplementedError\b/i
/** What closes a block or markup comment after the note. */
const COMMENT_END = /\s*(?:\*\/\}?|-->)\s*\}?\s*$/

/** The line as it should be shown, or nothing when it is no unfinished-work line. */
function unfinishedText(line: string): string | undefined {
  const todo = COMMENT_TODO.exec(line)
  if (todo) return todo[1]!.replace(COMMENT_END, '').trim()
  return SKIPPED_TEST.test(line) || NOT_DONE.test(line) ? line.trim() : undefined
}

/**
 * The unfinished-work lines of `newText` that `oldText` did not already have. A line the old text had (compared trimmed, once
 * for each time it had it) is not new. Lines with a key or token are left out; at most five come back, each once.
 */
export function unfinishedLines(oldText: string, newText: string): FileHit[] {
  const had = new Map<string, number>()
  for (const line of oldText.split(/\r?\n/)) had.set(line.trim(), (had.get(line.trim()) ?? 0) + 1)
  const hits: FileHit[] = []
  newText.split(/\r?\n/).forEach((raw, index) => {
    const seen = had.get(raw.trim()) ?? 0
    if (seen > 0) { had.set(raw.trim(), seen - 1); return }
    const found = unfinishedText(raw)
    const text = found === undefined ? '' : fit(plainText(found), FILE_MAX)
    if (text !== '' && !looksSecret(text) && !hits.some(h => h.text === text)) hits.push({ text, line: index + 1 })
  })
  return hits.slice(0, FILE_ITEMS)
}

type Pair = { before: string; after: string }

/** The old and new text a file tool call carries, one pair per edit; none when the input is not what the tool takes. */
function pairsOf(tool: string, input: Record<string, unknown>, before: string): Pair[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  if (tool === 'Write') return str(input.content) === undefined ? [] : [{ before, after: input.content as string }]
  if (tool === 'Edit') return str(input.new_string) === undefined ? [] : [{ before: str(input.old_string) ?? '', after: input.new_string as string }]
  if (tool === 'NotebookEdit') return str(input.new_source) === undefined || input.edit_mode === 'delete' ? [] : [{ before: '', after: input.new_source as string }]
  if (tool !== 'MultiEdit' || !Array.isArray(input.edits)) return []
  return (input.edits as unknown[]).flatMap(one => {
    const edit = (one ?? {}) as Record<string, unknown>
    return str(edit.new_string) === undefined ? [] : [{ before: str(edit.old_string) ?? '', after: edit.new_string as string }]
  })
}

/** The unfinished-work lines one call to a file tool wrote. `before` is the file as it was, which only a Write compares against. */
export function linesWritten(tool: string, input: Record<string, unknown>, before: string): FileHit[] {
  const all = pairsOf(tool, input, before).flatMap(p => unfinishedLines(p.before, p.after))
  return all.filter((h, at) => all.findIndex(o => o.text === h.text) === at).slice(0, FILE_ITEMS)
}
