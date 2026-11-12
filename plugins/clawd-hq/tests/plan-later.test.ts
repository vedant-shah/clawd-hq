import { expect, test } from 'claude-code/testing'
import { leftAddItems } from '../hooks/left-io'
import { LEFT_KEEP, LEFT_PLAN_KEEP, cleanLeft, withLeft } from '../hooks/left-list'
import type { LeftItem } from '../types'

// The items a finished goal put off join the project's Later list, every one of them: the list's own limit of ten and its merging of
// near-identical items do not touch them, and a save that fails is a failure the goal's end answers with, not a loss.

const own = (n: number): LeftItem => ({ id: `o${n}`, text: `Check the report number ${n} carefully`, source: 'check', by: 'Clawd', at: n })
const FULL = Array.from({ length: LEFT_KEEP }, (_, i) => own(i))
const texts = (n: number) => Array.from({ length: n }, (_, i) => `Put off item ${i + 1} for the export`)

function list(start: LeftItem[] = [], opts: { folder?: string } = {}) {
  const held = { list: start, saved: [] as LeftItem[][], isSaveFailing: false, folder: opts.folder ?? '/repo' }
  const io = {
    folder: () => held.folder, now: async () => 1_000,
    change: async (fn: (l: LeftItem[]) => LeftItem[]) => { held.list = fn(held.list); return held.list },
    save: async (_folder: string, next: LeftItem[]) => { if (held.isSaveFailing) throw new Error('the store refused'); held.saved.push(next) },
  }
  return { io, held }
}

test('twelve put-off items join a full list: none is cut by the limit of ten, and the other items stay', async () => {
  const { io, held } = list(FULL)
  await leftAddItems(io, texts(12), 'Clawd')
  expect(held.list).toHaveLength(LEFT_KEEP + 12)
  expect(held.list.filter(i => i.source === 'plan').map(i => i.text)).toEqual(texts(12))
  expect(held.list.filter(i => i.source === 'check')).toHaveLength(LEFT_KEEP)
  expect(held.saved).toHaveLength(1)
  expect(held.saved[0]).toHaveLength(LEFT_KEEP + 12)
})

test('near-identical put-off items are not merged, with each other or with an item of the list', async () => {
  const { io, held } = list([own(1)])
  await leftAddItems(io, ['Check the report number 1 carefully', 'Add the XLSX option', 'Add the XLSX option please'], 'Clawd')
  expect(held.list.map(i => i.text)).toEqual(['Check the report number 1 carefully', 'Add the XLSX option', 'Add the XLSX option please', 'Check the report number 1 carefully'])
})

test('the list\'s own items are still cut at ten and merged by likeness, newest first, with put-off items among them', () => {
  const plan = [{ id: 'p1', text: 'Put off', source: 'plan' as const, by: 'Clawd', at: 1 }]
  const grown = withLeft([...plan, ...FULL], [{ text: 'A brand new thing left', source: 'check', by: 'Clawd' }], 9)
  expect(grown.filter(i => i.source === 'check')).toHaveLength(LEFT_KEEP)
  expect(grown.some(i => i.id === 'o9')).toBe(false)
  expect(grown.filter(i => i.source === 'plan')).toHaveLength(1)
  const merged = withLeft(FULL, [{ text: 'Check the report number 3 carefully', source: 'check', by: 'Clawd' }], 9)
  expect(merged.filter(i => i.text === 'Check the report number 3 carefully')).toHaveLength(1)
})

test('a save that fails is a failure, and the list is put back as it was', async () => {
  const { io, held } = list(FULL)
  held.isSaveFailing = true
  await expect(leftAddItems(io, texts(3), 'Clawd')).rejects.toThrow('the store refused')
  expect(held.list).toEqual(FULL)
  held.isSaveFailing = false
  await leftAddItems(io, texts(3), 'Clawd')
  expect(held.list.filter(i => i.source === 'plan')).toHaveLength(3)
})

test('a list that cannot hold the items refuses them whole, and nothing is added', async () => {
  const held = Array.from({ length: LEFT_PLAN_KEEP - 2 }, (_, i): LeftItem => ({ id: `p${i}`, text: `Earlier put-off ${i}`, source: 'plan', by: 'Clawd', at: i }))
  const { io, held: state } = list(held)
  await expect(leftAddItems(io, texts(3), 'Clawd')).rejects.toThrow(`keeps ${LEFT_PLAN_KEEP} at most`)
  expect(state.list).toEqual(held)
  expect(state.saved).toHaveLength(0)
  await leftAddItems(io, texts(2), 'Clawd')
  expect(state.list).toHaveLength(LEFT_PLAN_KEEP)
})

test('with no project folder, or a session that moved on, the items are refused', async () => {
  const none = list(FULL, { folder: '' })
  await expect(leftAddItems(none.io, texts(1), 'Clawd')).rejects.toThrow('no project folder')
  const moved = list(FULL)
  const folders = ['/repo', '/other']
  moved.io.folder = () => folders.shift() ?? '/other'
  await expect(leftAddItems(moved.io, texts(1), 'Clawd')).rejects.toThrow('moved')
  expect(moved.held.list).toEqual(FULL)
  await leftAddItems(none.io, [], 'Clawd')
})

test('a list read back from the store keeps every put-off item and does not merge them, and still cuts its own at ten', () => {
  const stored = [...texts(14).map((text, i) => ({ id: `p${i}`, text, source: 'plan', by: 'Clawd', at: 100 - i })), ...Array.from({ length: 12 }, (_, i): LeftItem => ({ ...own(i), text: `Alpha${i} Beta${i} Gamma${i}` }))]
  const clean = cleanLeft(stored)
  expect(clean.filter(i => i.source === 'plan')).toHaveLength(14)
  expect(clean.filter(i => i.source === 'check')).toHaveLength(LEFT_KEEP)
})
