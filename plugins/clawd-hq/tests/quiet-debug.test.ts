import { expect, test } from 'claude-code/testing'
import { QUIET_DEBUG_KEY, quietRecord, quietRecorder } from '../hooks/quiet-debug'
import type { QuietDebugIo } from '../hooks/quiet-debug'

const SECRET = 'the words of the row, which never reach the record'
const row = (over: Record<string, unknown> = {}) => ({ isExpanded: false, originKind: 'peer', text: `[Subagent hand-back] ${SECRET}`, from: { name: 'Researcher-Vacuum' }, ...over })

test('a peer row\'s record says its kind, sender, hand-back line and look, and never its text', () => {
  const r = quietRecord(row(), 'hide', 7)
  expect(r).toEqual({ at: 7, kind: 'peer', from: 'Researcher-Vacuum', isHandbackLine: true, status: null, type: null, isExpanded: false, look: 'hide' })
  expect(JSON.stringify(r)).not.toContain('words of the row')
})

test('a notice\'s record carries its task status and type; a missing sender is null', () => {
  const r = quietRecord(row({ originKind: 'task-notification', text: SECRET, from: undefined, task: { id: 'b1', status: 'completed', type: 'remote_agent' }, isExpanded: true }), 'show', 8)
  expect(r).toEqual({ at: 8, kind: 'task-notification', from: null, isHandbackLine: false, status: 'completed', type: 'remote_agent', isExpanded: true, look: 'show' })
})

test('other kinds of row make no record', () => {
  for (const originKind of ['composer', 'unclassified', 'peer-send-message', 'channel']) expect(quietRecord(row({ originKind }), 'show', 1)).toBeUndefined()
})

function store(start: unknown = undefined) {
  const box = { value: start, writes: 0 }
  // A store that answers a beat later, as the real one does: two writes started together would each read the old list.
  const later = <T>(v: T) => Promise.resolve().then(() => v)
  const io: QuietDebugIo = { now: async () => 5, get: () => later(box.value), save: async (_key, value) => { await later(0); box.value = value; box.writes++ } }
  return { box, io }
}

test('each new decision is kept once, newest last, under one key; the same decision drawn again writes nothing', async () => {
  const log = quietRecorder()
  const { box, io } = store()
  log.keep(io, row(), 'hide')
  log.keep(io, row(), 'hide')
  log.keep(io, row({ isExpanded: true }), 'show')
  log.keep(io, row({ originKind: 'composer' }), 'show')
  await log.flush()
  expect(box.writes).toBe(2)
  expect((box.value as Array<{ look: string }>).map(r => r.look)).toEqual(['hide', 'show'])
  expect(QUIET_DEBUG_KEY).toBe('debug:quiet')
})

test('writes started at the same moment go one after another, so none is lost', async () => {
  const log = quietRecorder()
  const { box, io } = store()
  for (let n = 0; n < 5; n++) log.keep(io, row({ from: { name: `R${n}` } }), 'hide')
  await log.flush()
  expect((box.value as Array<{ from: string }>).map(r => r.from)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4'])
})

test('the list holds the latest 20, and a stored value that is not a list starts a new one', async () => {
  const log = quietRecorder()
  const { box, io } = store('not a list')
  for (let n = 0; n < 25; n++) log.keep(io, row({ from: { name: `R${n}` } }), 'hide')
  await log.flush()
  const kept = box.value as Array<{ from: string }>
  expect(kept.length).toBe(20)
  expect(kept[0]!.from).toBe('R5')
  expect(kept[19]!.from).toBe('R24')
})

test('after a reset (a new session, a clear, a resume) the same decision is written again', async () => {
  const log = quietRecorder()
  const { box, io } = store()
  log.keep(io, row(), 'hide')
  log.reset()
  log.keep(io, row(), 'hide')
  await log.flush()
  expect(box.writes).toBe(2)
})

test('a store that fails is never thrown, and the next write still goes: the record is only a way to look', async () => {
  const log = quietRecorder()
  const failing: QuietDebugIo = { now: async () => 1, get: async () => { throw new Error('no store') }, save: async () => { throw new Error('refused') } }
  expect(() => log.keep(failing, row(), 'hide')).not.toThrow()
  await expect(log.flush()).resolves.toBeUndefined()
  const { box, io } = store()
  log.keep(io, row({ isExpanded: true }), 'show')
  await log.flush()
  expect(box.writes).toBe(1)
})
