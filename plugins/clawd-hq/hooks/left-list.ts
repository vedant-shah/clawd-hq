// Left undone, the list (pure): what is kept, how near-identical items are one, how the store's copy is cleaned, and the
// words the panel and the Do it now button use. register-state.ts holds the atom; hooks/left-io.ts changes it through closures.
import type { LeftItem } from '../types'
import { fit } from './desk'
import { plainText } from './know'
import { isProjectCode, stillReported } from './left-scan'

/** DECIDED: the newest 10 are kept per project — the list is rare by design, and a long one would only be noise. */
export const LEFT_KEEP = 10
/** DECIDED: the Office tab draws the newest 3; the rest are counted. */
/**
 * DECIDED: items a finished goal put off (source `plan`) are kept apart from those: never merged with another by likeness, never cut by the
 * ten. One plan holds at most 20, so this holds the Later items of five full goals; a finish that would pass it is refused, not trimmed.
 */
export const LEFT_PLAN_KEEP = 100
export const LEFT_SHOWN = 3
/** An item's text is one line of at most this many characters, cut at a word with no mark. */
export const LEFT_TEXT = 200

const SOURCES: ReadonlySet<string> = new Set<LeftItem['source']>(['file', 'check', 'plan'])
/** Two items are the same when this share of their words is shared. */
const SAME_SHARE = 0.7
const WORDS = (text: string) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean))

/** Whether two texts say the same thing: the same words, or nearly all of them. Nothing is the same as nothing. */
export function isSimilar(a: string, b: string): boolean {
  const [x, y] = [WORDS(a), WORDS(b)]
  if (x.size === 0 || y.size === 0) return false
  const shared = [...x].filter(w => y.has(w)).length
  return shared / (x.size + y.size - shared) >= SAME_SHARE
}

/** An item as found, before it has an id and a time. */
export type FreshItem = Omit<LeftItem, 'id' | 'at'>

/** The same item: the same file (for a file's) and near-identical words. A line that moved in its file is still one item. */
const isSame = (a: FreshItem, b: FreshItem) => a.source !== 'plan' && b.source !== 'plan' && a.file === b.file && isSimilar(a.text, b.text)

/** The list with the newest `LEFT_KEEP` of its own kind and the newest `LEFT_PLAN_KEEP` of the plan's, in the order they were. */
export function capList(list: readonly LeftItem[]): LeftItem[] {
  const seen = list.reduce<{ kept: LeftItem[]; own: number; plan: number }>((at, one) => {
    const isPlan = one.source === 'plan'
    const fits = isPlan ? at.plan < LEFT_PLAN_KEEP : at.own < LEFT_KEEP
    return fits ? { kept: [...at.kept, one], own: at.own + (isPlan ? 0 : 1), plan: at.plan + (isPlan ? 1 : 0) } : at
  }, { kept: [], own: 0, plan: 0 })
  return seen.kept
}

let seq = 0

/** The list with the fresh items on top, in the order found; an older near-identical copy is replaced by the new one. The newest `LEFT_KEEP` are kept. */
export function withLeft(list: readonly LeftItem[], fresh: readonly FreshItem[], at: number): LeftItem[] {
  const made = fresh.map((one): LeftItem => ({ ...one, id: `l${at.toString(36)}${(seq += 1).toString(36)}`, at }))
  const kept = made.filter((one, i) => !made.slice(0, i).some(earlier => isSame(earlier, one)))
  return capList([...kept, ...list.filter(old => !kept.some(one => isSame(one, old)))])
}

/** The newest few to draw, and how many more there are. */
export function leftShown(list: readonly LeftItem[]): { rows: LeftItem[]; more: number } {
  return { rows: list.slice(0, LEFT_SHOWN), more: Math.max(0, list.length - LEFT_SHOWN) }
}

const MARKER_KINDS = ['TODO', 'FIXME', 'XXX'] as const
const markerKind = (one: LeftItem) => (one.source === 'file' ? MARKER_KINDS.find(kind => new RegExp(`^${kind}\\b`).test(one.text)) : undefined)

/** The list split in two: code markers (TODO, FIXME, XXX written in a file) and every other item, each in its order. Skipped tests and not-implemented lines are other items. */
export function splitMarkers(list: readonly LeftItem[]): { rows: LeftItem[]; markers: LeftItem[] } {
  return { rows: list.filter(one => markerKind(one) === undefined), markers: list.filter(one => markerKind(one) !== undefined) }
}

/**
 * The one dim line for the code markers, such as "3 code markers (TODO, FIXME)".
 * DECIDED: it only counts them; it does not open to list them — the simplest thing, and they stay in the stored list until cleared.
 */
export function markerLine(markers: readonly LeftItem[]): string {
  const kinds = MARKER_KINDS.filter(kind => markers.some(one => markerKind(one) === kind))
  return `${markers.length} code marker${markers.length === 1 ? '' : 's'} (${kinds.join(', ')})`
}

const SOURCE_NAME: Record<LeftItem['source'], string> = { file: 'File', check: 'Second check', plan: 'Put off in a plan' }

/** The dim note under an item: where it came from, for a file the file and line, and who left it. */
export function noteOf(item: LeftItem): string {
  const where = item.source === 'file' && item.file !== undefined ? `${item.file}${item.line === undefined ? '' : `:${item.line}`}` : undefined
  return [SOURCE_NAME[item.source], where, item.by].filter((part): part is string => part !== undefined).join(' · ')
}

/** What Do it now puts in the prompt box. A file's item says where it is; a closing stop is not doubled. */
export function promptOf(item: LeftItem): string {
  const where = item.source === 'file' && item.file !== undefined ? ` (${item.file}${item.line === undefined ? '' : `:${item.line}`})` : ''
  return `You left this undone: ${item.text.replace(/[.!?]+$/, '')}${where}. Do it now.`
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0
const line = (text: unknown, max: number) => (typeof text === 'string' ? fit(plainText(text), max) : '')

/**
 * A list read back from the store, which anyone can edit: only well-formed items survive, as one clean line each, once each,
 * the newest 10. DECIDED: this is also how an older version's list is cleaned, on every load, with no version number to keep
 * — the rule is the same each time, so a second load changes nothing. Items that came from an answer (that source is gone),
 * and file items that are not in a code file inside the project (a README, a docs/ note, a full local path), or that the
 * scanner would no longer report (template text with `${` in it, a line that is no marker), are dropped;
 * the store is rewritten without them the next time the list changes.
 */
export function cleanLeft(raw: unknown): LeftItem[] {
  if (!Array.isArray(raw)) return []
  const kept: LeftItem[] = []
  for (const one of raw as Array<Partial<LeftItem> | null>) {
    if (one === null || typeof one !== 'object' || typeof one.id !== 'string' || !SOURCES.has(String(one.source))) continue
    if (typeof one.at !== 'number' || !Number.isFinite(one.at)) continue
    const source = one.source!
    const [text, by, file] = [line(one.text, LEFT_TEXT), line(one.by, 40), source === 'file' ? line(one.file, 200) : '']
    if (text === '' || by === '' || (source === 'file' && !(isProjectCode(file) && stillReported(text, file)))) continue
    if (kept.some(k => isSame(k, { text, source, by, file: file || undefined }))) continue
    kept.push({ id: one.id.slice(0, 40), text, source, by, at: one.at, ...(file === '' ? {} : { file }), ...(file !== '' && isCount(one.line) ? { line: one.line } : {}) })
  }
  return capList(kept)
}
