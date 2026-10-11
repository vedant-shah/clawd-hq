// The project's decisions as a plain Markdown file in its own .clawd-hq folder, read and written by people and by this plugin alike.
// Pure: no file is touched here. One line per entry, so a hand edit is a one-line change in git.
import { fit } from './desk'
import type { Memory } from '../types'

export const LOGBOOK_FILE = '.clawd-hq/decisions.md'

/** A line you add by hand is cut to this many characters, as an entry the plugin writes is. */
const TEXT_CHARS = 300

const HEADER = [
  '# Clawd HQ decisions',
  '',
  'What you decided and what your agents chose, one line each, oldest first.',
  'You can edit this file by hand: add a line starting with "- " and it is picked up (up to 300 characters).',
  'Other lines, such as notes and headings, are left as they are.',
  '',
].join('\n')

const KINDS = ['decision', 'choice'] as const
const SOURCES = ['desk', 'report', 'clawd'] as const

const stamp = (at: number) => new Date(at).toISOString().slice(0, 16).replace('T', ' ')
const FULL = /^- (M\d+) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (\S+) · (.+?) · (\S+) · (.*)$/

const oneOf = <T extends string>(list: readonly T[], value: string, otherwise: T): T => (list as readonly string[]).includes(value) ? (value as T) : otherwise

const line = (m: Memory) => `- ${m.id} · ${stamp(m.at)} · ${m.kind} · ${m.by.replace(/ · /g, ' - ')} · ${m.source} · ${m.text}`

/** The file's whole text for these entries, in the order given. */
export function toMarkdown(list: readonly Memory[]): string {
  return `${HEADER}${list.map(m => `${line(m)}\n`).join('')}`
}

/** One entry the file holds: the line it is on, the entry, and whether the line is in the form this plugin writes. */
export type Parsed = { line: number; memory: Memory; isFull: boolean }

/**
 * The entries a file holds. A line in the form this plugin writes comes back as it was (to the minute); any other
 * "- text" line is a decision of yours, dated `now`, with the next free id. Everything else is ignored.
 */
export function parseEntries(text: string, now: number): Parsed[] {
  const out: Parsed[] = []
  const taken = new Set<string>()
  const lines = text.split(/\r?\n/)
  const isEntry = (l: string) => l.startsWith('- ') && l.slice(2).trim() !== ''
  let next = lines.reduce((n, l) => Math.max(n, isEntry(l) ? Number(FULL.exec(l)?.[1]?.slice(1)) || 0 : 0), 0)
  const fresh = () => { next += 1; return `M${next}` }
  lines.forEach((raw, i) => {
    if (!isEntry(raw)) return
    const m = FULL.exec(raw)
    const at = m ? Date.parse(`${m[2]!.replace(' ', 'T')}:00Z`) : NaN
    const body = fit(m ? m[6]! : raw.slice(2), TEXT_CHARS)
    if (body === '') return
    const id = m && !taken.has(m[1]!) ? m[1]! : fresh()
    taken.add(id)
    const isFull = m !== null && Number.isFinite(at)
    out.push({
      line: i, isFull,
      memory: isFull
        ? { id, kind: oneOf(KINDS, m![3]!, 'decision'), text: body, by: m![4]!, at, source: oneOf(SOURCES, m![5]!, 'desk') }
        : { id, kind: 'decision', text: body, by: 'CEO', at: now, source: 'desk' },
    })
  })
  return out
}

export const fromMarkdown = (text: string, now: number): Memory[] => parseEntries(text, now).map(p => p.memory)

const same = (a: Memory, b: Memory) => a.id === b.id && a.kind === b.kind && a.text === b.text && a.by === b.by && a.source === b.source && a.at === b.at

/**
 * The file's text after a save: its own lines stay exactly as they were (notes, headings, an entry that did not
 * change); an entry gone from `after` loses its line; one that changed, or that you wrote by hand without an id, is
 * rewritten in place; a new one goes at the end. An empty file becomes the readable header and the entries.
 */
export function mergeMarkdown(existing: string, after: readonly Memory[], now: number): string {
  if (existing.trim() === '') return toMarkdown(after)
  const wanted = new Map(after.map(m => [m.id, m]))
  const on = new Map(parseEntries(existing, now).map(p => [p.line, p]))
  const seen = new Set<string>()
  const out: string[] = []
  existing.split(/\r?\n/).forEach((raw, i) => {
    const p = on.get(i)
    if (!p) { out.push(raw); return }
    const want = wanted.get(p.memory.id)
    if (!want || seen.has(want.id)) return
    seen.add(want.id)
    out.push(p.isFull && same(p.memory, want) ? raw : line(want))
  })
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return `${[...out, ...after.filter(m => !seen.has(m.id)).map(line)].join('\n')}\n`
}
