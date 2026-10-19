// Starting the scout and getting its picks back: the mailbox, the timeout, and what each call the scout makes is answered with.
import { expect, test } from 'claude-code/testing'
import { createScoutBox } from '../hooks/scout-box'
import { runScout, scoutCall } from '../hooks/scout-run'

const ROOT = '/home/me/shop'
const TEAM = 'mcp__clawd-hq__team_pick'
const io = { real: async (p: string) => p }
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }

/** A host whose spawn answers the id the test names and whose timers wait until the test fires them. */
function fakeHost(spawnAs: string | null | Error = 'sc1') {
  const timers: Array<{ ms: number; fn: () => void; isCancelled: boolean }> = []
  return {
    timers, spawned: [] as string[],
    spawn: async function (this: { spawned: string[] }, brief: string) {
      this.spawned.push(brief)
      if (spawnAs instanceof Error) throw spawnAs
      return spawnAs ?? undefined
    },
    after(ms: number, fn: () => void) {
      const t = { ms, fn, isCancelled: false }
      timers.push(t)
      return { cancel: () => { t.isCancelled = true } }
    },
  }
}
const start = (box: ReturnType<typeof createScoutBox>, host: ReturnType<typeof fakeHost>, check: (i: unknown, r: readonly string[]) => string | undefined = () => undefined) =>
  runScout(box, { spawn: b => host.spawn.call(host, b), after: (ms, fn) => host.after(ms, fn) }, 'BRIEF', check, 90_000)
const call = (box: ReturnType<typeof createScoutBox>, id: string, tool: string, input: Record<string, unknown>) => scoutCall(box, io, ROOT, id, tool, input)

test('the scout is started with the brief, and its team_pick call brings the picks back with the files it opened', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  expect(host.spawned).toEqual(['BRIEF'])
  expect(box.isScout('sc1')).toBe(true)
  expect(await call(box, 'sc1', 'Read', { file_path: 'package.json' })).toEqual({ run: {} })
  expect(await call(box, 'sc1', 'Grep', { pattern: 'vitest' })).toEqual({ run: { output_mode: 'files_with_matches' } })
  const input = { picks: [{ seat: 'Plan', name: 'ecc:planner' }] }
  expect(await call(box, 'sc1', TEAM, input)).toMatchObject({ result: expect.stringMatching(/noted/i) })
  expect(await done).toEqual({ picks: input, reads: ['/home/me/shop/package.json'] })
  expect(host.timers.every(t => t.isCancelled)).toBe(true)
})

test('the wait is the timeout given, and it is the only timer', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  void start(box, host)
  await settle()
  expect(host.timers.map(t => t.ms)).toEqual([90_000])
})

test('picks that arrive before the start call has even returned are not lost', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const spawnHere = host.spawn
  let release: (id: string) => void = () => undefined
  host.spawn = async function (this: { spawned: string[] }, brief: string) { void spawnHere.call(this, brief); return new Promise<string>(r => { release = r }) }
  const done = start(box, host)
  await settle()
  box.mark('sc1')
  await call(box, 'sc1', TEAM, { picks: [{ seat: 'Plan', name: 'ecc:planner' }] })
  release('sc1')
  expect((await done)?.picks).toEqual({ picks: [{ seat: 'Plan', name: 'ecc:planner' }] })
})

test('the timeout ends the wait with nothing, and the scout is refused everything from then on', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  host.timers[0]?.fn()
  expect(await done).toBeUndefined()
  expect(await call(box, 'sc1', 'Read', { file_path: 'a.md' })).toMatchObject({ deny: expect.stringMatching(/finished|time/i) })
  expect(await call(box, 'sc1', TEAM, { picks: [{ seat: 'Plan', name: 'ecc:planner' }] })).toMatchObject({ deny: expect.any(String) })
})

test('a scout that ends without sending picks ends the wait at once', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  box.finish('someone-else')
  box.finish('sc1')
  expect(await done).toBeUndefined()
  expect(host.timers.every(t => t.isCancelled)).toBe(true)
})

test('a start that is refused, fails, or gives no id is no scout and leaves no timer running', async () => {
  for (const spawnAs of [null, new Error('no such agent')] as const) {
    const box = createScoutBox()
    const host = fakeHost(spawnAs)
    expect(await start(box, host)).toBeUndefined()
    expect(host.timers.every(t => t.isCancelled)).toBe(true)
  }
})

test('picks the check does not accept are sent back to the scout with the reason; three bad tries end the scout', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host, input => ((input as { ok?: boolean }).ok ? undefined : 'None of those names are on the list.'))
  await settle()
  expect(await call(box, 'sc1', TEAM, { ok: false })).toEqual({ deny: 'None of those names are on the list.' })
  expect(await call(box, 'sc1', TEAM, { ok: false })).toEqual({ deny: 'None of those names are on the list.' })
  expect(await call(box, 'sc1', TEAM, { ok: false })).toMatchObject({ deny: expect.stringMatching(/enough|finished/i) })
  expect(await done).toBeUndefined()
})

test('a second try that the check accepts is taken', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host, input => ((input as { ok?: boolean }).ok ? undefined : 'Try again.'))
  await settle()
  await call(box, 'sc1', TEAM, { ok: false })
  await call(box, 'sc1', TEAM, { ok: true })
  expect((await done)?.picks).toEqual({ ok: true })
})

test('only the first accepted picks count; a repeat is told the work is done', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  await call(box, 'sc1', TEAM, { picks: ['first'] })
  expect(await call(box, 'sc1', TEAM, { picks: ['second'] })).toMatchObject({ deny: expect.any(String) })
  expect((await done)?.picks).toEqual({ picks: ['first'] })
})

test('a refused read is answered with the guard\'s words and is not counted as read', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  expect(await call(box, 'sc1', 'Read', { file_path: '.env' })).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ/) })
  expect(await call(box, 'sc1', 'Bash', { command: 'cat .env' })).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ/) })
  await call(box, 'sc1', 'Read', { file_path: 'README.md' })
  await call(box, 'sc1', TEAM, { picks: ['x'] })
  expect((await done)?.reads).toEqual(['/home/me/shop/README.md'])
})

test('a real-path lookup that lands outside the folder is refused', async () => {
  const box = createScoutBox()
  box.mark('sc1')
  const linking = { real: async (p: string) => (p.endsWith('notes.txt') ? '/home/me/.ssh/id_rsa' : p) }
  expect(await scoutCall(box, linking, ROOT, 'sc1', 'Read', { file_path: 'notes.txt' })).toMatchObject({ deny: expect.any(String) })
})

test('the same id is not a scout until it is marked, and marked ids are remembered for a while', () => {
  const box = createScoutBox()
  expect(box.isScout('x1')).toBe(false)
  for (let i = 0; i < 30; i += 1) box.mark(`s${i}`)
  expect(box.isScout('s29')).toBe(true)
  expect(box.isScout('s0')).toBe(false)
})
