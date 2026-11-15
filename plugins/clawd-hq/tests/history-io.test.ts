import { expect, test } from 'claude-code/testing'
import { ROTATE_BYTES, lineOf, parseHistory, toolRecord } from '../hooks/history'
import type { HistoryRecord } from '../hooks/history'
import { BACKOFF_MS, makeHistory, makeTabCache } from '../hooks/history-io'
import type { HistoryIo } from '../hooks/history-io'

// Writing the history: one file per session, records in batches (the host has no append, so each batch is one read and one write), never
// over a file it could not read, rebuilt from what it last wrote when a file comes back cut short; past 2 MB a file is kept under a number
// chosen once; a folder that is a link out of the project is refused; failing writes back off; records lost to the cap are counted.

const ROOT = '/repo'
const DIR = `${ROOT}/.clawd-hq`
const FILE = `${DIR}/history-s1.jsonl`
const IGNORE = `${DIR}/.gitignore`

function fake(files: Record<string, string> = {}, mtimes: Record<string, number> = {}) {
  const held = new Map(Object.entries(files))
  const marks = new Set<string>()
  const log: string[] = []
  const notes: string[] = []
  const links = new Map<string, string>()
  const fail = { read: false, writes: 0, truncateNext: false }
  const clock = { now: 1_000 }
  const hooks: { duringWrite?: () => void } = {}
  const later = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }
  const isDir = (path: string) => [...held.keys()].some(k => k.startsWith(`${path}/`))
  const io: HistoryIo = {
    root: () => ROOT, now: async () => clock.now,
    exists: async path => held.has(path) || isDir(path),
    read: async path => { log.push(`read ${path}`); await later(); if (fail.read) throw new Error('over 4 MiB'); const t = held.get(path); if (t === undefined) throw new Error('ENOENT'); return t },
    write: async (path, text) => {
      log.push(`write ${path}`); hooks.duringWrite?.(); hooks.duringWrite = undefined; await later()
      if (fail.writes > 0) { fail.writes -= 1; throw new Error('EACCES') }
      // A write that is cut short: half the text lands, and it says nothing.
      if (fail.truncateNext && path.endsWith('.jsonl')) { fail.truncateNext = false; held.set(path, text.slice(0, Math.floor(text.length / 2))); return }
      held.set(path, text)
    },
    list: async path => [...held.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(k => ({ name: k.slice(path.length + 1), kind: 'file', size: held.get(k)!.length, mtimeMs: mtimes[k] ?? clock.now })),
    stat: async path => ({ kind: held.has(path) ? 'file' : 'dir', isLink: links.has(path), realPath: links.get(path) ?? path }),
    isMarked: async key => marks.has(key),
    mark: async key => { marks.add(key) },
    debug: async line => { notes.push(line) },
  }
  return { io, held, log, fail, marks, hooks, links, notes, clock }
}
const rec = (at: number, session = 's1'): HistoryRecord => toolRecord({ at, session }, { name: 'Clawd', type: 'main', tool: 'Read', startedAt: at, endedAt: at, ok: true })
const ats = (text: string | undefined) => parseHistory(text ?? '').map(r => r.at)
const writesTo = (f: ReturnType<typeof fake>, path: string) => f.log.filter(l => l === `write ${path}`).length

// ---- One file per session, one folder per record ----

test('nothing is written until a flush; a flush writes every waiting record once, in order, to its session\'s own file', async () => {
  const f = fake()
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1), rec(2)])
  h.add(ROOT, [rec(3)])
  expect(f.held.has(FILE)).toBe(false)
  expect(await h.flush()).toBe('done')
  expect(ats(f.held.get(FILE))).toEqual([1, 2, 3])
  expect(h.pending()).toBe(0)
  await h.flush()
  expect(ats(f.held.get(FILE))).toEqual([1, 2, 3])
})

test('two sessions write two files, each only its own records, so they never race on one', async () => {
  const f = fake()
  const one = makeHistory(f.io)
  const two = makeHistory(f.io)
  one.add(ROOT, [rec(1, 's1')])
  two.add(ROOT, [rec(2, 's2')])
  await Promise.all([one.flush(), two.flush()])
  expect(ats(f.held.get(`${DIR}/history-s1.jsonl`))).toEqual([1])
  expect(ats(f.held.get(`${DIR}/history-s2.jsonl`))).toEqual([2])
})

test('each record goes to the project folder it was made in, though the session moved since', async () => {
  const f = fake()
  const h = makeHistory(f.io)
  h.add('/a', [rec(1)])
  h.add('/b', [rec(2)])
  h.add('', [rec(3)]) // made with no project folder: not kept
  await h.flush()
  expect(ats(f.held.get('/a/.clawd-hq/history-s1.jsonl'))).toEqual([1])
  expect(ats(f.held.get('/b/.clawd-hq/history-s1.jsonl'))).toEqual([2])
  expect(h.pending()).toBe(0)
})

test('a flush adds to what the file holds, keeping its line endings and mending a last line with no break', async () => {
  const f = fake({ [FILE]: `${lineOf(rec(1))}\r\n${lineOf(rec(2))}` })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(3)])
  await h.flush()
  expect(f.held.get(FILE)).toBe(`${lineOf(rec(1))}\r\n${lineOf(rec(2))}\r\n${lineOf(rec(3))}\r\n`)
})

// ---- Never a file cut short ----

test('a file cut short by a write is rebuilt from what was last written, with the new lines', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1), rec(2)])
  await h.flush()
  f.fail.truncateNext = true
  h.add(ROOT, [rec(3)])
  await h.flush() // this write lands only in half
  h.add(ROOT, [rec(4)])
  await h.flush()
  expect(ats(f.held.get(FILE))).toEqual([1, 2, 3, 4])
})

test('a file that reads back empty after it was written is rebuilt too', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  await h.flush()
  f.held.set(FILE, '')
  h.add(ROOT, [rec(2)])
  await h.flush()
  expect(ats(f.held.get(FILE))).toEqual([1, 2])
})

test('a write that fails is tried once more at once; one that fails twice keeps the records, and the next flush rebuilds the file', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  f.fail.writes = 1
  expect(await h.flush()).toBe('done')
  expect(writesTo(f, FILE)).toBe(2)
  f.fail.writes = 2
  h.add(ROOT, [rec(2)])
  expect(await h.flush()).toBe('failed')
  expect(h.pending()).toBe(1)
  f.held.set(FILE, '{"half') // what a failed write may leave
  f.clock.now += BACKOFF_MS.first
  expect(await h.flush()).toBe('done')
  expect(ats(f.held.get(FILE))).toEqual([1, 2])
})

test('a file that cannot be read, and was never written in this session, is not written over: the records wait', async () => {
  const f = fake({ [FILE]: `${lineOf(rec(1))}\n`, [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(2)])
  f.fail.read = true
  expect(await h.flush()).toBe('failed')
  expect(writesTo(f, FILE)).toBe(0)
  f.fail.read = false
  f.clock.now += BACKOFF_MS.first
  await h.flush()
  expect(ats(f.held.get(FILE))).toEqual([1, 2])
})

// ---- Failing writes: backing off, batches, the cap ----

test('after a failed flush the next waits 30 seconds, then 60, doubling to at most 5 minutes; the session\'s end does not wait', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  const gaps: number[] = []
  for (let i = 0; i < 6; i += 1) {
    f.fail.writes = 2
    expect(await h.flush()).toBe('failed')
    expect(await h.flush()).toBe('waiting')
    gaps.push(await h.retryIn())
    f.clock.now += await h.retryIn()
  }
  expect(gaps).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
  f.fail.writes = 2
  await h.flush()
  expect(await h.flush(true)).toBe('done') // forced: the end of the session
})

test('a flush writes at most one batch; more waiting says so', async () => {
  const f = fake()
  const h = makeHistory(f.io, { maxWaiting: 100, perFlush: 3 })
  h.add(ROOT, [1, 2, 3, 4, 5].map(n => rec(n)))
  expect(await h.flush()).toBe('more')
  expect(ats(f.held.get(FILE))).toEqual([1, 2, 3])
  expect(await h.flush()).toBe('done')
  expect(ats(f.held.get(FILE))).toEqual([1, 2, 3, 4, 5])
})

test('records lost to the cap while writing fails are counted, and a dropped record says how many once writing works again', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io, { maxWaiting: 3, perFlush: 500 })
  f.fail.writes = 2
  h.add(ROOT, [rec(1)])
  await h.flush()
  h.add(ROOT, [rec(2), rec(3), rec(4), rec(5)])
  f.clock.now += BACKOFF_MS.first
  expect(await h.flush()).toBe('more')
  expect(ats(f.held.get(FILE))).toEqual([3, 4, 5])
  await h.flush()
  const dropped = parseHistory(f.held.get(FILE)!).find(r => r.kind === 'dropped')
  expect(dropped).toMatchObject({ kind: 'dropped', count: 2, session: 's1' })
})

test('records added while a batch is written, and the cap trimming meanwhile, never cost a record written or one still waiting', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io, { maxWaiting: 4, perFlush: 500 })
  h.add(ROOT, [rec(1), rec(2)])
  f.hooks.duringWrite = () => h.add(ROOT, [rec(3), rec(4), rec(5), rec(6)])
  expect(await h.flush()).toBe('more')
  expect(ats(f.held.get(FILE))).toEqual([1, 2])
  expect(h.pending()).toBe(4)
  await h.flush()
  expect(ats(f.held.get(FILE))).toEqual([1, 2, 3, 4, 5, 6])
  expect(parseHistory(f.held.get(FILE)!).some(r => r.kind === 'dropped')).toBe(false)
})

test('two flushes at once take turns: a read and a write, then the next', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  f.hooks.duringWrite = () => h.add(ROOT, [rec(2)])
  await Promise.all([h.flush(), h.flush()])
  expect(ats(f.held.get(FILE))).toEqual([1, 2])
  expect(f.log.filter(l => l.endsWith('history-s1.jsonl')).map(l => l.split(' ')[0])).toEqual(['write', 'read', 'write'])
})

// ---- Rotation ----

const big = () => `${lineOf(rec(1))}\n`.repeat(Math.ceil(ROTATE_BYTES / (lineOf(rec(1)).length + 1)))

test('past 2 MB the session\'s file is kept as history-<session>-<n>.jsonl and a new one starts; other files are kept', async () => {
  const f = fake({ [FILE]: big(), [`${DIR}/history-s1-1.jsonl`]: 'old one\n', [`${DIR}/history-s2-5.jsonl`]: 'another session\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(9)])
  await h.flush()
  expect(f.held.get(`${DIR}/history-s1-2.jsonl`)).toBe(big())
  expect(ats(f.held.get(FILE))).toEqual([9])
  expect([f.held.get(`${DIR}/history-s1-1.jsonl`), f.held.get(`${DIR}/history-s2-5.jsonl`)]).toEqual(['old one\n', 'another session\n'])
})

test('the numbering survives a restart: a new load goes on after the session\'s highest rotated file', async () => {
  const f = fake({ [FILE]: 'x'.repeat(ROTATE_BYTES + 1), [`${DIR}/history-s1-4.jsonl`]: 'four\n' })
  makeHistory(f.io) // the first load's, gone
  const next = makeHistory(f.io)
  next.add(ROOT, [rec(1)])
  await next.flush()
  expect(f.held.get(`${DIR}/history-s1-5.jsonl`)).toBe('x'.repeat(ROTATE_BYTES + 1))
  expect(f.held.get(`${DIR}/history-s1-4.jsonl`)).toBe('four\n')
})

test('a rotation whose new file fails is retried under the same name: no second copy, and readers count each line once', async () => {
  const f = fake({ [FILE]: big(), [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(9)])
  let n = 0
  f.hooks.duringWrite = () => undefined
  const write = f.io.write
  f.io.write = async (path, text) => { if (path === FILE && (n += 1) <= 2) throw new Error('EACCES'); return write(path, text) }
  expect(await h.flush()).toBe('failed')
  expect([...f.held.keys()].filter(k => /history-s1-\d+/.test(k))).toEqual([`${DIR}/history-s1-1.jsonl`])
  // Meanwhile the copy and the file it came from hold the same lines: a reader counts them once.
  const copyLines = big().split('\n').filter(Boolean).length
  expect((await h.readSince(0)).filter(r => r.at === 1)).toHaveLength(copyLines)
  f.clock.now += BACKOFF_MS.first
  expect(await h.flush()).toBe('done')
  expect([...f.held.keys()].filter(k => /history-s1-\d+/.test(k))).toEqual([`${DIR}/history-s1-1.jsonl`])
  expect(ats(f.held.get(FILE))).toEqual([9])
  expect((await h.readSince(0)).filter(r => r.at === 1)).toHaveLength(copyLines)
})

// ---- Links, the ignore file, a new load ----

test('a .clawd-hq folder or a history file that is a link out of the project is refused, with a debug note, and nothing is written there', async () => {
  const f = fake({ [`${DIR}/plans/x.md`]: '# X\n' })
  f.links.set(DIR, '/elsewhere/.clawd-hq')
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  await h.flush()
  expect(f.log.filter(l => l.startsWith('write'))).toEqual([])
  expect(f.notes.join('\n')).toMatch(/leads out of the project/)
  const g = fake({ [FILE]: '' })
  g.links.set(FILE, '/etc/history-s1.jsonl')
  const other = makeHistory(g.io)
  other.add(ROOT, [rec(1)])
  await other.flush()
  expect(g.log.filter(l => l.startsWith('write'))).toEqual([])
  expect(g.notes.join('\n')).toMatch(/not a plain file/)
})

test('.clawd-hq/.gitignore: written when absent; added to, as one line, when the rule is missing; untouched when it is there; never again once done', async () => {
  const f = fake()
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  await h.flush()
  expect(f.held.get(IGNORE)).toBe('history*.jsonl\n')
  f.held.delete(IGNORE) // the person deleted it: it stays gone
  h.add(ROOT, [rec(2)])
  await h.flush()
  expect(f.held.has(IGNORE)).toBe(false)
  const g = fake({ [IGNORE]: 'notes.md\r\n# mine' })
  const other = makeHistory(g.io)
  other.add(ROOT, [rec(1)])
  await other.flush()
  expect(g.held.get(IGNORE)).toBe('notes.md\r\n# mine\r\nhistory*.jsonl\r\n')
  const k = fake({ [IGNORE]: '*\n' })
  const third = makeHistory(k.io)
  third.add(ROOT, [rec(1)])
  await third.flush()
  expect(k.held.get(IGNORE)).toBe('*\n')
})

test('a forced flush (the session\'s end, or a load being replaced) writes even while a backoff is waited out', async () => {
  const f = fake({ [IGNORE]: 'history*.jsonl\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(1)])
  f.fail.writes = 2
  await h.flush()
  expect(await h.flush()).toBe('waiting')
  expect(await h.flush(true)).toBe('done')
  expect(ats(f.held.get(FILE))).toEqual([1])
})

// ---- Reading back ----

test('reading since a time: every history file changed since then, newest first, none over the read limit, and what waits, in time order', async () => {
  const f = fake({
    [FILE]: `${lineOf(rec(50))}\nnot json\n`,
    [`${DIR}/history-s2.jsonl`]: `${lineOf(rec(40, 's2'))}\n`,
    [`${DIR}/history-s1-1.jsonl`]: `${lineOf(rec(5))}\n`,
    [`${DIR}/history-s1-2.jsonl`]: `${lineOf(rec(20))}\n${lineOf(rec(30))}\n`,
    [`${DIR}/history.jsonl`]: `${lineOf(rec(35, 'old'))}\n`,
    [`${DIR}/notes.jsonl`]: `${lineOf(rec(36))}\n`,
  }, { [`${DIR}/history-s1-1.jsonl`]: 6, [`${DIR}/history-s1-2.jsonl`]: 31 })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(60)])
  expect((await h.readSince(25)).map(r => r.at)).toEqual([30, 35, 40, 50, 60])
  expect(f.log).not.toContain(`read ${DIR}/history-s1-1.jsonl`) // older than what is needed: not read
})

// ---- What the History tab reads: its kinds only, within a strict cap, never through a link ----

const runAt = (at: number, id = `r${at}`): HistoryRecord => parseHistory(JSON.stringify({ v: 1, at, kind: 'run', session: 's1', run: id, type: 't', task: 'x', startedAt: at - 1, endedAt: at, outcome: 'done', tokens: { inPeak: 0, out: 0 } }))[0]!
const goalEndAt = (at: number): HistoryRecord => parseHistory(JSON.stringify({ v: 1, at, kind: 'goal_end', session: 's1', goal: 'g', title: 'G', outcome: 'done', startedAt: 0, steps: [] }))[0]!

test('the tab\'s read keeps only the runs, goal ends, dropped and note records: tool calls and requests stay in the file', async () => {
  const f = fake({ [FILE]: [rec(1), runAt(2), goalEndAt(3)].map(lineOf).join('\n') + '\n' })
  const h = makeHistory(f.io)
  h.add(ROOT, [rec(4), runAt(5)])
  expect((await h.readRecent(1_000_000)).map(r => `${r.kind}@${r.at}`)).toEqual(['run@2', 'goal_end@3', 'run@5'])
})

test('the tab\'s read never goes past its cap: the newest files that fit, and not one byte more', async () => {
  const newest = `${lineOf(runAt(30))}\n`
  const older = `${lineOf(runAt(20))}\n`
  const f = fake({ [FILE]: newest, [`${DIR}/history-s1-1.jsonl`]: older }, { [FILE]: 30, [`${DIR}/history-s1-1.jsonl`]: 20 })
  const h = makeHistory(f.io)
  expect((await h.readRecent(newest.length + older.length - 1)).map(r => r.at)).toEqual([30])
  expect(f.log).not.toContain(`read ${DIR}/history-s1-1.jsonl`)
  expect((await h.readRecent(newest.length + older.length)).map(r => r.at)).toEqual([20, 30])
})

test('the tab reads nothing through a .clawd-hq that leads out of the project, nor a history file that is a link', async () => {
  const f = fake({ [FILE]: `${lineOf(runAt(1))}\n` })
  f.links.set(DIR, '/elsewhere/.clawd-hq')
  expect(await makeHistory(f.io).readRecent(1_000_000)).toEqual([])
  expect(f.log.filter(l => l.startsWith('read '))).toEqual([])
  expect(f.notes.join('\n')).toMatch(/leads out of the project/)
  const g = fake({ [FILE]: `${lineOf(runAt(1))}\n` })
  const list = g.io.list
  g.io.list = async path => (await list(path)).map(e => ({ ...e, isLink: true }))
  expect(await makeHistory(g.io).readRecent(1_000_000)).toEqual([])
  expect(await makeHistory(g.io).readSince(0)).toEqual([])
})

// ---- The tab's records, kept once read ----

test('a goal_end written while the first read is under way still shows once the read is done, and a record the read held already counts once', async () => {
  const cache = makeTabCache()
  const both = runAt(2)
  let finish: (records: HistoryRecord[]) => void = () => undefined
  const reading = cache.get(ROOT, () => new Promise(resolve => { finish = resolve }))
  await Promise.resolve()
  expect(cache.add(ROOT, [goalEndAt(3), both])).toBe(false) // held: nothing to redraw yet
  finish([runAt(1), both])
  expect((await reading).map(r => `${r.kind}@${r.at}`)).toEqual(['run@1', 'run@2', 'goal_end@3'])
  expect((await cache.get(ROOT, async () => { throw new Error('read again') })).length).toBe(3)
})

test('once read, a record the tab shows redraws it; tool calls and requests alone do not, and are not kept', async () => {
  const cache = makeTabCache()
  await cache.get(ROOT, async () => [runAt(1)])
  expect(cache.add(ROOT, [rec(2)])).toBe(false)
  expect(cache.add(ROOT, [goalEndAt(3)])).toBe(true)
  expect(cache.add('/other', [goalEndAt(4)])).toBe(false)
  expect((await cache.get(ROOT, async () => [])).map(r => r.kind)).toEqual(['run', 'goal_end'])
})
