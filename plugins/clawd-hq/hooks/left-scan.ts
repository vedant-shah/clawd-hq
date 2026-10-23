// Left undone, the scanner (pure): unfinished-work lines in the text a file tool newly wrote, in a code file. It is strict
// on purpose: a marker counts only as code does, never as prose. A TODO, FIXME or XXX must open a real comment of the
// file's language; a skipped test or a not-implemented throw must be code, outside any string or comment.
import { fit } from './desk'
import { looksSecret, plainText } from './know'

/** A line from a file is cut at a word to this many characters. */
export const FILE_MAX = 160
/** At most this many items come out of one file change. */
const FILE_ITEMS = 5

/** The file tools whose newly written text is looked at. A notebook is no code file, so it is not one of them. */
export const FILE_TOOLS = ['Edit', 'Write', 'MultiEdit'] as const

// How a language opens a comment: double slash and slash-star (slash), hash, double dash (dash), and the markup opener (html).
export type Language = 'slash' | 'hash' | 'dash' | 'html'

/**
 * DECIDED: these extensions are programming languages; nothing else is read (not .md, .mdx, .txt, .rst, data or config files,
 * notebooks, or files with no extension) — prose and data are where a "TODO" is a word, not a marker.
 */
const LANGUAGE_OF: Readonly<Record<string, Language>> = Object.fromEntries([
  ...['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'java', 'kt', 'kts', 'swift', 'go', 'rs', 'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'cs', 'scala', 'dart', 'php', 'vue', 'svelte', 'groovy'].map(e => [e, 'slash']),
  ...['py', 'rb', 'sh', 'bash', 'zsh', 'pl', 'r', 'ex', 'exs'].map(e => [e, 'hash']),
  ...['sql', 'lua', 'hs'].map(e => [e, 'dash']),
  ...['html', 'htm'].map(e => [e, 'html']),
])
export const CODE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(LANGUAGE_OF))

/** The comment language of a code file by its extension, or nothing when it is not one. */
export function languageOf(path: string): Language | undefined {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? undefined : LANGUAGE_OF[name.slice(dot + 1).toLowerCase()]
}

/** Folders whose files are documentation or other people's code, whatever their extension. */
const SKIPPED_DIRS: ReadonlySet<string> = new Set(['docs', 'doc', 'node_modules'])

/**
 * Whether a path, given from the project folder, is a code file worth reading: a programming language's extension, not under
 * docs/ or node_modules/, and not outside the project (an absolute path or one that climbs out of it).
 */
export function isProjectCode(relative: string): boolean {
  const parts = relative.split(/[\\/]/)
  const isOutside = relative.startsWith('/') || relative.startsWith('\\') || /^[A-Za-z]:/.test(relative) || parts.includes('..')
  return !isOutside && languageOf(relative) !== undefined && !parts.slice(0, -1).some(p => SKIPPED_DIRS.has(p.toLowerCase()))
}

const TOKENS: Readonly<Record<Language, readonly string[]>> = { slash: ['//', '/*'], hash: ['#'], dash: ['--'], html: ['<!--'] }
const QUOTES = new Set(['"', "'", '`'])

/** A line read: its code (strings left in), which characters of it are inside a string, and the text of its first comment. */
type Scanned = { code: string; inStr: boolean[]; comment?: string }

/** What is open when a line starts: template literals and the `${` holes in them (a hole is its brace depth; a template is TPL), and a block comment. */
const TPL = -1
type Open = { frames: number[]; block: boolean }

/**
 * One line, read with what the lines before it left open. DECIDED: strings are tracked across the whole new text, not per line —
 * a backtick string runs over lines and holds `${…}` holes that can nest; a single or double quote ends with its line. Only
 * code outside a string can open a comment. If unsure, the line is read as string, so it is not reported.
 */
function scanLine(line: string, lang: Language, open: Open): Scanned {
  const frames = [...open.frames]
  let code = ''
  const inStr: boolean[] = []
  let comment: string | undefined
  let quote: string | undefined
  const put = (text: string, isStr: boolean) => { code += text; for (let k = 0; k < text.length; k += 1) inStr.push(isStr) }
  let i = 0
  if (lang === 'slash' && !open.block && frames.length === 0 && /^\s*\*(?!\/)/.test(line)) return { code: '', inStr: [], comment: line.replace(/^\s*\*/, '') } // a block comment's middle line, in text that began inside the comment
  let block = open.block
  if (block) {
    const end = line.indexOf('*/')
    comment = line.slice(0, end < 0 ? undefined : end)
    if (end < 0) return { code: '', inStr: [], comment }
    block = false
    i = end + 2
  }
  for (; i < line.length; i += 1) {
    const ch = line[i]!
    const top = frames.length === 0 ? undefined : frames[frames.length - 1]
    if (quote !== undefined) {
      if (ch === '\\') { put(line.slice(i, i + 2), true); i += 1 } else if (ch === quote) { quote = undefined; put(ch, false) } else put(ch, true)
    } else if (top === TPL) {
      if (ch === '\\') { put(line.slice(i, i + 2), true); i += 1 } else if (ch === '`') { frames.pop(); put(ch, false) } else if (ch === '$' && line[i + 1] === '{') { frames.push(0); put('${', false); i += 1 } else put(ch, true)
    } else if (top !== undefined && ch === '}' && top === 0) { frames.pop(); put(ch, false) } else if (top !== undefined && (ch === '{' || ch === '}')) {
      frames[frames.length - 1] = top + (ch === '{' ? 1 : -1)
      put(ch, false)
    } else if (QUOTES.has(ch)) {
      if (ch === '`' && lang === 'slash') frames.push(TPL)
      else quote = ch
      put(ch, false)
    } else {
      const token = TOKENS[lang].find(t => line.startsWith(t, i))
      if (token === undefined) { put(ch, false); continue }
      if (token !== '/*') { comment ??= line.slice(i + token.length); break }
      const end = line.indexOf('*/', i + 2)
      comment ??= line.slice(i + 2, end < 0 ? undefined : end)
      if (end < 0) { block = true; break }
      i = end + 1
    }
  }
  open.frames = frames
  open.block = block
  return { code, inStr, ...(comment === undefined ? {} : { comment }) }
}

/** Every line of `text` read in turn, each knowing what the lines before it left open. */
function scanText(text: string, lang: Language): Scanned[] {
  const open: Open = { frames: [], block: false }
  return text.split(/\r?\n/).map(line => scanLine(line, lang, open))
}

const MARKER = /^[\s*]*((?:TODO|FIXME|XXX)\b.*)$/
/** What closes a block or markup comment after the note. */
const COMMENT_END = /\s*(?:\*\/\}?|-->)\s*\}?\s*$/
/** Skipped-test calls and not-implemented throws. A match counts only in the code part of a line (before any comment) and outside a string. */
const SKIP_CALLS = /\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe)\s*\(|@pytest\.mark\.skip\b|\bt\.Skip\(/
const NOT_DONE = /\bthrow\s+new\s+\w*Error\(\s*['"`]not implemented|\braise\s+NotImplementedError\b|\bthrow\s+new\s+NotImplemented(?:Error|Exception)\b/i

/** A match of `re` in the code of a scanned line that does not start inside a string. */
function codeMatch({ code, inStr }: Scanned, re: RegExp): boolean {
  const found = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  return [...code.matchAll(found)].some(m => !inStr[m.index ?? 0])
}

/** The line as it should be shown, or nothing when it is no unfinished-work line. */
function unfinishedText(line: string, scanned: Scanned): string | undefined {
  const { comment } = scanned
  const marker = comment === undefined ? undefined : MARKER.exec(comment)
  if (marker) return marker[1]!.replace(COMMENT_END, '').trim()
  return codeMatch(scanned, SKIP_CALLS) || codeMatch(scanned, NOT_DONE) ? line.trim() : undefined
}

/** An unfinished-work line: what to show, and its line in the text it was found in (1 is the first). */
export type FileHit = { text: string; line: number }

/**
 * The unfinished-work lines of `newText` that `oldText` did not already have. A line the old text had (compared trimmed, once
 * for each time it had it) is not new. Lines with a key or token are left out; at most five come back, each once.
 */
export function unfinishedLines(oldText: string, newText: string, lang: Language): FileHit[] {
  const had = new Map<string, number>()
  for (const line of oldText.split(/\r?\n/)) had.set(line.trim(), (had.get(line.trim()) ?? 0) + 1)
  const hits: FileHit[] = []
  const scanned = scanText(newText, lang)
  newText.split(/\r?\n/).forEach((raw, index) => {
    const seen = had.get(raw.trim()) ?? 0
    if (seen > 0) { had.set(raw.trim(), seen - 1); return }
    const found = unfinishedText(raw, scanned[index]!)
    const text = found === undefined ? '' : fit(plainText(found), FILE_MAX)
    if (text !== '' && !looksSecret(text) && !hits.some(h => h.text === text)) hits.push({ text, line: index + 1 })
  })
  return hits.slice(0, FILE_ITEMS)
}

/**
 * Whether a saved file item's text would still be reported for a file at `path`: as a comment's note (it is shown without the
 * comment token, so one is put back) or as a line of code. Text with `${` in it is template text, never a note.
 */
export function stillReported(text: string, path: string): boolean {
  const lang = languageOf(path)
  if (lang === undefined || text.includes('${')) return false
  const opener = TOKENS[lang][0]!
  return [text, `${opener} ${text}`].some(candidate => unfinishedLines('', candidate, lang).length > 0)
}

type Pair ={ before: string; after: string }

/** The old and new text a file tool call carries, one pair per edit; none when the input is not what the tool takes. */
function pairsOf(tool: string, input: Record<string, unknown>, before: string): Pair[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  if (tool === 'Write') return str(input.content) === undefined ? [] : [{ before, after: input.content as string }]
  if (tool === 'Edit') return str(input.new_string) === undefined ? [] : [{ before: str(input.old_string) ?? '', after: input.new_string as string }]
  if (tool !== 'MultiEdit' || !Array.isArray(input.edits)) return []
  return (input.edits as unknown[]).flatMap(one => {
    const edit = (one ?? {}) as Record<string, unknown>
    return str(edit.new_string) === undefined ? [] : [{ before: str(edit.old_string) ?? '', after: edit.new_string as string }]
  })
}

/** The unfinished-work lines one call to a file tool wrote, in a code file. `before` is the file as it was, which only a Write compares against. */
export function linesWritten(tool: string, input: Record<string, unknown>, before: string): FileHit[] {
  const lang = typeof input.file_path === 'string' ? languageOf(input.file_path) : undefined
  if (lang === undefined) return []
  const all = pairsOf(tool, input, before).flatMap(p => unfinishedLines(p.before, p.after, lang))
  return all.filter((h, at) => all.findIndex(o => o.text === h.text) === at).slice(0, FILE_ITEMS)
}
