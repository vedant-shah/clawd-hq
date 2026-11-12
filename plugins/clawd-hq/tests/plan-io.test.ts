import { expect, test } from 'claude-code/testing'
import { changeGoal, loadGoals, plansDir, startGoal } from '../hooks/plan-io'
import type { PlanIo } from '../hooks/plan-io'

// Reading and writing the plan files, on a file system held in memory: what is there is never lost, and nothing is written that was not read.

const ROOT = '/repo'
const DIR = `${ROOT}/.clawd-hq/plans`
const FILE = `${DIR}/fix-login.md`
const BASE = '# Fix login\n\n- [ ] Find the bug  <!-- s1 -->\n- [ ] Fix it  <!-- s2 -->\n'
const none: ReadonlySet<string> = new Set()
const no = () => false
const eolize = (t: string, eol: string) => t.replace(/\n/g, eol)

/**
 * A project folder in memory. Folders are what files lie in; `links` makes a path lead somewhere else (as `stat` and `list` tell it);
 * `listAs` changes how `list` names an entry; `extra` adds entries to a listing that no file stands behind.
 */
function disk(files: Record<string, string> = {}) {
  const held = new Map(Object.entries(files))
  const writes: Array<{ path: string; text: string }> = []
  const notes: string[] = []
  const calls: string[] = []
  const fail = { exists: false, read: new Set<string>(), write: false, list: false, stat: false, debug: false }
  const mtimes = new Map<string, number>()
  const links = new Map<string, string>()
  const listAs = new Map<string, { kind: string; isLink?: boolean }>()
  const extra: Array<{ name: string; kind: string; isLink?: boolean }> = []
  // A few turns of the event loop, so two calls made at once would overlap if nothing queued them.
  const later = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }
  const isDir = (path: string) => path === ROOT || [...held.keys()].some(k => k.startsWith(`${path}/`))
  const io: PlanIo = {
    exists: async path => { calls.push(`exists ${path}`); if (fail.exists) throw new Error('the check failed'); return held.has(path) || isDir(path) },
    read: async path => { calls.push(`read ${path}`); await later(); if (fail.read.has(path)) throw new Error('too big to read'); const t = held.get(path); if (t === undefined) throw new Error('ENOENT'); return t },
    write: async (path, text) => { calls.push(`write ${path}`); await later(); if (fail.write) throw new Error('EACCES'); writes.push({ path, text }); held.set(path, text) },
    list: async path => {
      calls.push(`list ${path}`)
      if (fail.list) throw new Error('cannot list')
      const named = [...held.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(k => ({ name: k.slice(path.length + 1), kind: 'file', ...listAs.get(k) }))
      return [...named, ...extra]
    },
    stat: async path => {
      calls.push(`stat ${path}`)
      if (fail.stat) throw new Error('stat failed')
      if (!held.has(path) && !isDir(path)) throw new Error('ENOENT')
      return { kind: held.has(path) ? 'file' : 'dir', mtimeMs: mtimes.get(path) ?? 0, isLink: links.has(path), realPath: links.get(path) ?? path }
    },
    debug: async note => { if (fail.debug) throw new Error('the record failed'); notes.push(note) },
  }
  return { io, held, writes, notes, calls, fail, mtimes, links, listAs, extra }
}

const start = (io: PlanIo, over: Partial<{ goal: string; steps: string[]; hasCurrent: () => boolean | Promise<boolean> }> = {}) =>
  startGoal(io, ROOT, { goal: 'Fix login', steps: ['Find the bug', 'Fix it'], hasCurrent: no, ...over })

// ---- start ----

test('start writes the new plan in the project\'s plans folder and answers with the plan', async () => {
  const d = disk()
  const r = await start(d.io)
  expect(r).toMatchObject({ ok: true, slug: 'fix-login', plan: { title: 'Fix login', steps: [{ id: 's1', text: 'Find the bug' }, { id: 's2', text: 'Fix it' }] } })
  expect(d.held.get(FILE)).toBe(`${BASE}<!-- next: s3 l1 -->\n`)
  expect(plansDir(`${ROOT}/`)).toBe(DIR)
})

test('start takes the next free name when a plan file with that name is there, whatever its case', async () => {
  const d = disk({ [FILE]: BASE, [`${DIR}/Fix-Login-2.md`]: '# Other\n', [`${DIR}/notes.txt`]: 'x' })
  const r = await start(d.io, { steps: ['A'] })
  expect(r).toMatchObject({ ok: true, slug: 'fix-login-3' })
  expect(d.held.get(FILE)).toBe(BASE)
  expect(d.held.has(`${DIR}/fix-login-3.md`)).toBe(true)
})

test('start is refused while a goal is current, and touches no file', async () => {
  const d = disk()
  const r = await start(d.io, { hasCurrent: () => true })
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('finish the current goal first (done or stopped)')
  expect(d.writes).toHaveLength(0)
  expect(d.calls).toEqual([])
})

test('two starts at the same moment make one file: the second is asked about the goal after the first has been written', async () => {
  const d = disk()
  const hasCurrent = async () => (await loadGoals(d.io, ROOT)).length > 0
  const both = await Promise.all([start(d.io, { goal: 'First goal', hasCurrent }), start(d.io, { goal: 'Second goal', hasCurrent })])
  expect(both.map(r => r.ok)).toEqual([true, false])
  expect((both[1] as { reason: string }).reason).toContain('finish the current goal first')
  expect(d.writes.map(w => w.path)).toEqual([`${DIR}/first-goal.md`])
})

test('start with a refused plan (no steps) or no project folder writes nothing; a question about the goal that fails is no crash', async () => {
  const d = disk()
  expect(await start(d.io, { steps: [] })).toEqual({ ok: false, reason: 'A plan needs at least one step.' })
  expect(await startGoal(d.io, '', { goal: 'G', steps: ['A'], hasCurrent: no })).toMatchObject({ ok: false })
  const broke = await start(d.io, { hasCurrent: () => { throw new Error('the state is gone') } })
  expect(broke).toMatchObject({ ok: false })
  expect((broke as { reason: string }).reason).toContain('the state is gone')
  expect(d.writes).toHaveLength(0)
  expect(d.notes).toHaveLength(1)
})

test('start writes nothing when the folder cannot be listed, the check fails, or the name turns out to be taken', async () => {
  const a = disk({ [`${DIR}/other.md`]: '# Other\n' })
  a.fail.list = true
  expect(await start(a.io)).toMatchObject({ ok: false })
  expect(a.writes).toHaveLength(0)
  expect(a.notes).toHaveLength(1)
  const b = disk()
  b.fail.exists = true
  expect(await start(b.io)).toMatchObject({ ok: false })
  expect(b.writes).toHaveLength(0)
})

test('start answers with the reason when the write fails, and leaves a debug record', async () => {
  const d = disk()
  d.fail.write = true
  const r = await start(d.io)
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('EACCES')
  expect(d.notes).toHaveLength(1)
  expect(d.notes[0]).toContain('EACCES')
})

// ---- changing a plan ----

test('a change reads the file, applies the one operation, and writes the whole file', async () => {
  const d = disk({ [FILE]: BASE })
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(r).toMatchObject({ ok: true, slug: 'fix-login' })
  expect(d.held.get(FILE)).toBe(`${BASE}- [ ] Review  <!-- s3 -->\n<!-- next: s4 l1 -->\n`)
  expect(d.calls.filter(c => c.startsWith('read'))).toHaveLength(1)
})

test('the file is read again for every change: what the person added by hand meanwhile is kept, and its steps get ids', async () => {
  const d = disk({ [FILE]: BASE })
  await changeGoal(d.io, ROOT, 'fix-login', { op: 'done', id: 's1' }, none)
  d.held.set(FILE, `${d.held.get(FILE)!}A note by hand\n- [ ] Added by hand\n`)
  await changeGoal(d.io, ROOT, 'fix-login', { op: 'done', id: 's2' }, none)
  expect(d.held.get(FILE)).toBe('# Fix login\n\n- [x] Find the bug  <!-- s1 -->\n- [x] Fix it  <!-- s2 -->\n<!-- next: s4 l1 -->\nA note by hand\n- [ ] Added by hand  <!-- s3 -->\n')
})

test('changes made at the same moment all land, one after the other, on the latest contents', async () => {
  const d = disk({ [FILE]: BASE })
  const results = await Promise.all([
    changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Third' }, none),
    changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Fourth' }, none),
    changeGoal(d.io, ROOT, 'fix-login', { op: 'later', text: 'Put off' }, none),
  ])
  expect(results.every(r => r.ok)).toBe(true)
  expect(d.held.get(FILE)).toBe(`${BASE}- [ ] Third  <!-- s3 -->\n- [ ] Fourth  <!-- s4 -->\n\n## Later\n\n- [ ] Put off  <!-- l1 -->\n<!-- next: s5 l2 -->\n`)
})

test('the file\'s own line breaks are kept', async () => {
  const d = disk({ [FILE]: eolize(BASE, '\r\n') })
  await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(d.held.get(FILE)).toBe(eolize(`${BASE}- [ ] Review  <!-- s3 -->\n<!-- next: s4 l1 -->\n`, '\r\n'))
})

test('a step with a specialist at work on it is not dropped: the live ids are passed in', async () => {
  const d = disk({ [FILE]: BASE })
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'drop', id: 's2' }, new Set(['s2']))
  expect(r).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
})

test('an operation that is refused, does not exist, or changes nothing writes nothing', async () => {
  const d = disk({ [FILE]: BASE })
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'drop', id: 's9' }, none)).toEqual({ ok: false, reason: 'There is no step s9.' })
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'explode' } as never, none)).toMatchObject({ ok: false })
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'reopen', id: 's1' }, none)).toMatchObject({ ok: true })
  expect(d.writes).toHaveLength(0)
  expect(d.held.get(FILE)).toBe(BASE)
})

test('even an operation that throws is an answer and a debug record, never a crash, and writes nothing', async () => {
  const d = disk({ [FILE]: BASE })
  const r = await changeGoal(d.io, ROOT, 'fix-login', null as never, none)
  expect(r).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
  expect(d.notes).toHaveLength(1)
})

test('dropping the highest step keeps its number for good: the next step added does not take it', async () => {
  const d = disk({ [FILE]: BASE })
  await changeGoal(d.io, ROOT, 'fix-login', { op: 'drop', id: 's2' }, none)
  expect(d.held.get(FILE)).toBe('# Fix login\n\n- [ ] Find the bug  <!-- s1 -->\n<!-- next: s3 l1 -->\n')
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'New' }, none)
  expect(r).toMatchObject({ ok: true, plan: { steps: [{ id: 's1' }, { id: 's3' }] } })
})

// ---- never write what could not be read ----

test('a file that cannot be read is never written to: the reason comes back and nothing is written', async () => {
  const d = disk({ [FILE]: BASE })
  d.fail.read.add(FILE)
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('too big to read')
  expect(d.writes).toHaveLength(0)
  expect(d.held.get(FILE)).toBe(BASE)
  expect(d.notes).toHaveLength(1)
})

test('a check that fails is no licence to write either', async () => {
  const d = disk({ [FILE]: BASE })
  d.fail.exists = true
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)).toMatchObject({ ok: false })
  d.fail.exists = false
  d.fail.stat = true
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
})

test('a plan file that is gone is not made again by a change', async () => {
  const d = disk()
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(r).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
  expect(d.held.size).toBe(0)
})

test('a file with no title line is not a plan: it is left alone, however the operation would have changed it', async () => {
  const notAPlan = 'Some notes\n- [ ] A task of mine\n'
  const d = disk({ [FILE]: notAPlan })
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('not a plan')
  expect(d.writes).toHaveLength(0)
  expect(d.held.get(FILE)).toBe(notAPlan)
})

test('a write that fails comes back as its reason, with a debug record, and the old file stays', async () => {
  const d = disk({ [FILE]: BASE })
  d.fail.write = true
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('EACCES')
  expect(d.held.get(FILE)).toBe(BASE)
  expect(d.notes).toHaveLength(1)
})

test('a debug record that cannot be written does not turn a failure into a crash', async () => {
  const d = disk({ [FILE]: BASE })
  d.fail.read.add(FILE)
  d.fail.debug = true
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)).toMatchObject({ ok: false })
})

test('a name that could lead out of the plans folder is refused before any file is touched', async () => {
  const d = disk({ [`${ROOT}/.clawd-hq/secret.md`]: '# Secret\n' })
  for (const slug of ['../secret', 'a/b', '', 'Fix Login', '..']) {
    expect(await changeGoal(d.io, ROOT, slug, { op: 'add', text: 'x' }, none)).toMatchObject({ ok: false })
  }
  expect(await changeGoal(d.io, '', 'fix-login', { op: 'add', text: 'x' }, none)).toMatchObject({ ok: false })
  expect(d.calls).toEqual([])
})

// ---- links ----

test('a plan file that is a link is neither read nor written', async () => {
  const d = disk({ [FILE]: BASE })
  d.links.set(FILE, '/elsewhere/fix-login.md')
  const r = await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('not a plain file')
  expect(d.calls.some(c => c.startsWith('read') || c.startsWith('write'))).toBe(false)
})

test('a plan file whose real place is outside the plans folder is refused, link or no link', async () => {
  const d = disk({ [FILE]: BASE })
  d.links.set(FILE, '/repo/.clawd-hq/other/fix-login.md')
  expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
})

test('a plans folder, or a .clawd-hq folder, that leads outside the project is refused for a start, a change and a load', async () => {
  for (const linked of [DIR, `${ROOT}/.clawd-hq`]) {
    const d = disk({ [FILE]: BASE })
    d.links.set(linked, `/elsewhere${linked.slice(ROOT.length)}`)
    expect(await start(d.io)).toMatchObject({ ok: false })
    expect(await changeGoal(d.io, ROOT, 'fix-login', { op: 'add', text: 'Review' }, none)).toMatchObject({ ok: false })
    expect(await loadGoals(d.io, ROOT)).toEqual([])
    expect(d.writes).toHaveLength(0)
    expect(d.calls.some(c => c.startsWith('read'))).toBe(false)
    expect(d.notes.length).toBeGreaterThan(0)
  }
})

test('a project folder that cannot be placed leaves the plans alone', async () => {
  const d = disk({ [FILE]: BASE })
  d.links.set(ROOT, '')
  const placed = d.io.stat
  d.io.stat = async path => ({ ...(await placed(path)), realPath: path === ROOT ? undefined : path })
  expect(await start(d.io)).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
})

// ---- loading ----

test('loading gives each plan in the folder, the one modified most recently first, by the file\'s own time', async () => {
  const d = disk({ [FILE]: BASE, [`${DIR}/older.md`]: '# Older\n- [ ] x  <!-- s1 -->\n', [`${DIR}/notes.md`]: 'not a plan\n', [`${DIR}/readme.txt`]: '# Not markdown\n' })
  d.mtimes.set(FILE, 200)
  d.mtimes.set(`${DIR}/older.md`, 100)
  const goals = await loadGoals(d.io, ROOT)
  expect(goals.map(g => [g.slug, g.plan.title, g.mtimeMs])).toEqual([['fix-login', 'Fix login', 200], ['older', 'Older', 100]])
  expect(d.writes).toHaveLength(0)
})

test('loading skips names that are not <slug>.md, a folder called x.md, and links, however the listing names them', async () => {
  const good = '# Good\n- [ ] x  <!-- s1 -->\n'
  const d = disk({ [FILE]: BASE, [`${DIR}/Weird Name.md`]: good, [`${DIR}/..md`]: good, [`${DIR}/linked.md`]: good, [`${DIR}/hidden.md`]: good })
  d.extra.push({ name: 'x.md', kind: 'dir' })
  d.listAs.set(`${DIR}/linked.md`, { kind: 'other', isLink: true })
  // Listed as a plain file, but its real place says otherwise.
  d.links.set(`${DIR}/hidden.md`, '/elsewhere/hidden.md')
  expect((await loadGoals(d.io, ROOT)).map(g => g.slug)).toEqual(['fix-login'])
  expect(d.calls.filter(c => c.startsWith('read'))).toEqual([`read ${FILE}`])
})

test('loading never writes: a step added by hand keeps no id in the file, and the plan shows the one it will get', async () => {
  const d = disk({ [FILE]: '# Hand\n- [ ] By hand\n' })
  const goals = await loadGoals(d.io, ROOT)
  expect(goals[0]!.plan.steps).toEqual([{ id: 's1', text: 'By hand', isDone: false, choices: [] }])
  expect(d.writes).toHaveLength(0)
  expect(d.held.get(FILE)).toBe('# Hand\n- [ ] By hand\n')
})

test('loading with no plans folder, an unlistable one, or an unreadable file gives what could be read, and never throws', async () => {
  expect(await loadGoals(disk().io, ROOT)).toEqual([])
  const a = disk({ [FILE]: BASE })
  a.fail.list = true
  expect(await loadGoals(a.io, ROOT)).toEqual([])
  expect(a.notes).toHaveLength(1)
  const b = disk({ [FILE]: BASE, [`${DIR}/other.md`]: '# Other\n- [ ] x  <!-- s1 -->\n' })
  b.fail.read.add(FILE)
  expect((await loadGoals(b.io, ROOT)).map(g => g.slug)).toEqual(['other'])
  expect(b.notes).toHaveLength(1)
  expect(await loadGoals(a.io, '')).toEqual([])
})
