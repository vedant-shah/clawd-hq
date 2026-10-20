// Left undone, the list (pure): what is kept, how near-identical items are one, how the store's copy is cleaned, and the
// words the panel and the Do it now button use. register.tsx holds the atom; hooks/left-io.ts changes it through closures.
import type { LeftItem } from '../types'
import { fit } from './desk'
import { plainText } from './know'

/** DECIDED: the newest 30 are kept per project — enough to see what piled up, few enough that the list stays a list. */
export const LEFT_KEEP = 30
/** The Office tab draws the newest this many; the rest are counted. */
export const LEFT_SHOWN = 8
/** An item's text is one line of at most this many characters, cut at a word with no mark. */
export const LEFT_TEXT = 200

const SOURCES: ReadonlySet<string> = new Set<LeftItem['source']>(['answer', 'file', 'check'])
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
const isSame = (a: FreshItem, b: FreshItem) => a.file === b.file && isSimilar(a.text, b.text)

let seq = 0

/** The list with the fresh items on top, in the order found; an older near-identical copy is replaced by the new one. The newest `LEFT_KEEP` are kept. */
export function withLeft(list: readonly LeftItem[], fresh: readonly FreshItem[], at: number): LeftItem[] {
  const made = fresh.map((one): LeftItem => ({ ...one, id: `l${at.toString(36)}${(seq += 1).toString(36)}`, at }))
  const kept = made.filter((one, i) => !made.slice(0, i).some(earlier => isSame(earlier, one)))
  return [...kept, ...list.filter(old => !kept.some(one => isSame(one, old)))].slice(0, LEFT_KEEP)
}

/** The newest few to draw, and how many more there are. */
export function leftShown(list: readonly LeftItem[]): { rows: LeftItem[]; more: number } {
  return { rows: list.slice(0, LEFT_SHOWN), more: Math.max(0, list.length - LEFT_SHOWN) }
}

const SOURCE_NAME: Record<LeftItem['source'], string> = { answer: 'Answer', file: 'File', check: 'Second check' }

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

/** A list read back from the store, which anyone can edit: only well-formed items survive, as one clean line each, once each, the newest 30. */
export function cleanLeft(raw: unknown): LeftItem[] {
  if (!Array.isArray(raw)) return []
  const kept: LeftItem[] = []
  for (const one of raw as Array<Partial<LeftItem> | null>) {
    if (one === null || typeof one !== 'object' || typeof one.id !== 'string' || !SOURCES.has(String(one.source))) continue
    if (typeof one.at !== 'number' || !Number.isFinite(one.at)) continue
    const [text, by, file] = [line(one.text, LEFT_TEXT), line(one.by, 40), line(one.file, 200)]
    if (text === '' || by === '' || kept.some(k => isSame(k, { text, source: 'answer', by, file: file || undefined }))) continue
    kept.push({ id: one.id.slice(0, 40), text, source: one.source!, by, at: one.at, ...(file === '' ? {} : { file }), ...(file !== '' && isCount(one.line) ? { line: one.line } : {}) })
  }
  return kept.slice(0, LEFT_KEEP)
}
