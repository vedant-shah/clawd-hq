import { expect, test } from 'claude-code/testing'
import type { Memory } from '../types'
import * as memoryIo from '../hooks/memory-io'
import { loadMemory, remember, saveBoxAnswer, saveMemory } from '../hooks/memory-io'
import type { MemoryIo } from '../hooks/memory-io'

type Fake = { io: MemoryIo; files: Map<string, string>; kept: Memory[][]; warned: string[]; quips: Array<[string, number]>; retitles: number }

function fake(over: { isWritable?: boolean } = {}): Fake {
  const files = new Map<string, string>()
  const f: Fake = { io: undefined as never, files, kept: [], warned: [], quips: [], retitles: 0 }
  f.io = {
    logbook: {
      cwd: '/proj', exists: async p => files.has(p), read: async p => files.get(p) ?? '',
      write: async (p, text) => { if (over.isWritable === false) throw new Error('read-only'); files.set(p, text) },
      now: async () => 1000, held: async () => f.kept[f.kept.length - 1] ?? [],
    },
    keep: async list => { f.kept.push(list) },
    warnOnce: text => { f.warned.push(text) },
    retitle: async () => { f.retitles += 1 },
    now: async () => 1000,
    quip: async (text, frames) => { f.quips.push([text, frames]) },
    byOf: async id => (id === 'a1' ? 'Planner' : 'agent'),
  }
  return f
}

test('a remembered decision is kept, saved to the file and the title follows', async () => {
  const f = fake()
  await remember(f.io, { kind: 'decision', text: '  Use   Postgres ', by: 'CEO', source: 'clawd' })
  expect(f.kept.at(-1)?.map(m => m.text)).toEqual(['Use Postgres'])
  expect([...f.files.values()].join('')).toContain('Use Postgres')
  expect(f.retitles).toBe(1)
  expect(f.warned).toEqual([])
})

test('a blank decision is not recorded', async () => {
  const f = fake()
  await remember(f.io, { kind: 'decision', text: '   ', by: 'CEO', source: 'clawd' })
  expect(f.kept).toEqual([])
  expect(f.retitles).toBe(0)
})

test('a file that cannot be written keeps the decision for the session and says so', async () => {
  const f = fake({ isWritable: false })
  await saveMemory(f.io, () => [{ id: 'm1', kind: 'decision', text: 'Keep', by: 'CEO', at: 1 } as Memory])
  expect(f.kept.at(-1)?.length).toBe(1)
  expect(f.warned.length).toBe(1)
  expect(f.warned[0]).toContain('kept for this session only')
  expect(f.retitles).toBe(1)
})

test('what the file holds is loaded back', async () => {
  const f = fake()
  await remember(f.io, { kind: 'choice', text: 'Tabs over spaces', by: 'Planner', source: 'report' })
  expect((await loadMemory(f.io)).map(m => m.text)).toEqual(['Tabs over spaces'])
})

test('a box answer is saved as the CEO decision and Clawd says so for 8 frames', async () => {
  const f = fake()
  await saveBoxAnswer(f.io, 'Which database?', 'Postgres')
  expect(f.kept.at(-1)?.[0]).toMatchObject({ kind: 'decision', by: 'CEO', source: 'desk', text: 'Which database? → Postgres' })
  expect(f.quips).toEqual([['On it, boss: “Postgres”', 8]])
})

test('the remember tool is gone: nothing files a call of it', () => {
  expect(memoryIo).not.toHaveProperty('rememberCall')
})

test('a new decision that supersedes an old one replaces it', async () => {
  const f = fake()
  await remember(f.io, { kind: 'decision', text: 'Old plan', by: 'CEO', source: 'clawd' })
  const id = f.kept.at(-1)?.[0]?.id ?? ''
  await remember(f.io, { kind: 'decision', text: 'New plan', by: 'CEO', source: 'clawd' }, id)
  expect(f.kept.at(-1)?.map(m => m.text)).toEqual(['New plan'])
})
