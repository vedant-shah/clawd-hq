// Starting the scout and getting its picks back: the mailbox, the timeout, stopping it, and what each call the scout makes is answered with.
import { expect, test } from 'claude-code/testing'
import { createScoutBox } from '../hooks/scout-box'
import { NOT_SCOUT_DENY, runScout, scoutCall, scoutRoute } from '../hooks/scout-run'

const ROOT = '/home/me/shop'
const TEAM = 'mcp__clawd-hq__team_pick'
const SCOUT = 'clawd-hq:scout'
const io = { real: async (p: string) => p }
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }

type Spawned = { subagentType: string; description: string; prompt: string }
/** A host whose start answers the id the test names (`null`: none, an Error: it fails), whose list is `listed`, and whose timers wait until the test fires them. */
function fakeHost(spawnAs: string | null | Error = 'sc1', listed: Array<{ id: string; type: string }> = []) {
  const timers: Array<{ ms: number; fn: () => void; isCancelled: boolean }> = []
  const spawned: Spawned[] = []
  const stopped: string[] = []
  return {
    timers, spawned, stopped, listed,
    spawn: async (args: Spawned) => {
      spawned.push(args)
      if (spawnAs instanceof Error) throw spawnAs
      return spawnAs === null ? {} : { agentId: spawnAs }
    },
    list: async () => listed,
    stop: async (id: string) => { stopped.push(id) },
    after(ms: number, fn: () => void) {
      const t = { ms, fn, isCancelled: false }
      timers.push(t)
      return { cancel: () => { t.isCancelled = true } }
    },
  }
}
type Host = ReturnType<typeof fakeHost>
const start = (box: ReturnType<typeof createScoutBox>, host: Host, check: (i: unknown, r: readonly string[]) => string | undefined = () => undefined) =>
  runScout(box, host, 'BRIEF', check, 90_000)
const call = (box: ReturnType<typeof createScoutBox>, id: string, tool: string, input: Record<string, unknown>) => scoutCall(box, io, ROOT, id, tool, input)

test('the scout is started on its own type with the brief, and its team_pick call brings the picks back with the files it opened', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  expect(host.spawned).toEqual([{ subagentType: SCOUT, description: 'Look around the project', prompt: 'BRIEF' }])
  expect(box.isScout('sc1')).toBe(true)
  expect(await call(box, 'sc1', 'Read', { file_path: 'package.json' })).toEqual({ run: {} })
  expect(await call(box, 'sc1', 'Glob', { pattern: '*.md' })).toEqual({ run: {} })
  const input = { picks: [{ seat: 'Plan', name: 'ecc:planner' }] }
  expect(await call(box, 'sc1', TEAM, input)).toMatchObject({ result: expect.stringMatching(/noted/i) })
  expect(await done).toEqual({ picks: input, reads: ['/home/me/shop/package.json'] })
  expect(host.timers.every(t => t.isCancelled)).toBe(true)
  expect(host.stopped).toEqual([]) // it gave its picks: nothing to stop
})

test('the wait is the timeout given, and it is the only timer', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  void start(box, host)
  await settle()
  expect(host.timers.map(t => t.ms)).toEqual([90_000])
})

test('a start that returns no id is found in the engine\'s list by its type, among scouts not yet known', async () => {
  const box = createScoutBox()
  box.mark('old')
  const host = fakeHost(null, [{ id: 'old', type: SCOUT }, { id: 'other', type: 'ecc:planner' }, { id: 'sc7', type: SCOUT }])
  const done = start(box, host)
  await settle()
  expect(box.isScout('sc7')).toBe(true)
  await call(box, 'sc7', TEAM, { picks: ['x'] })
  expect((await done)?.picks).toEqual({ picks: ['x'] })
})

test('picks that arrive before the start call has even returned are not lost', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  let release: (r: { agentId: string }) => void = () => undefined
  host.spawn = () => new Promise(r => { release = r })
  const done = start(box, host)
  await settle()
  box.mark('sc1')
  await call(box, 'sc1', TEAM, { picks: [{ seat: 'Plan', name: 'ecc:planner' }] })
  release({ agentId: 'sc1' })
  expect((await done)?.picks).toEqual({ picks: [{ seat: 'Plan', name: 'ecc:planner' }] })
})

test('the timeout ends the wait with nothing, stops the scout, and refuses everything it calls from then on', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  host.timers[0]?.fn()
  expect(await done).toBeUndefined()
  expect(host.stopped).toEqual(['sc1'])
  expect(await call(box, 'sc1', 'Read', { file_path: 'a.md' })).toMatchObject({ deny: expect.stringMatching(/finished|time/i) })
  expect(await call(box, 'sc1', TEAM, { picks: [{ seat: 'Plan', name: 'ecc:planner' }] })).toMatchObject({ deny: expect.any(String) })
})

test('a stop that fails changes nothing: the wait still ends with nothing', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  host.stop = async () => { throw new Error('no such task') }
  const done = start(box, host)
  await settle()
  host.timers[0]?.fn()
  expect(await done).toBeUndefined()
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
    expect(host.timers).toEqual([])
    expect(host.stopped).toEqual([])
  }
})

test('picks the check does not accept are sent back to the scout with the reason; three bad tries end the scout and stop it', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host, input => ((input as { ok?: boolean }).ok ? undefined : 'None of those names are on the list.'))
  await settle()
  expect(await call(box, 'sc1', TEAM, { ok: false })).toEqual({ deny: 'None of those names are on the list.' })
  expect(await call(box, 'sc1', TEAM, { ok: false })).toEqual({ deny: 'None of those names are on the list.' })
  expect(host.stopped).toEqual([])
  expect(await call(box, 'sc1', TEAM, { ok: false })).toMatchObject({ deny: expect.stringMatching(/enough|finished/i) })
  expect(await done).toBeUndefined()
  expect(host.stopped).toEqual(['sc1'])
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

test('a refused read is answered with the guard\'s words and is not counted as read; Grep is refused too', async () => {
  const box = createScoutBox()
  const host = fakeHost()
  const done = start(box, host)
  await settle()
  expect(await call(box, 'sc1', 'Read', { file_path: '.env' })).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ/) })
  expect(await call(box, 'sc1', 'Read', { file_path: 'src/../README.md' })).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ/) })
  expect(await call(box, 'sc1', 'Grep', { pattern: 'KEY' })).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ/) })
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

// ---- which calls are the scout's: a scout is known by its type from its very first call ----

/** The route's questions: who is on the books as a hire, and what type the engine lists an id as. */
const route = (over: { hired?: string[]; types?: Record<string, string> } = {}) => {
  const asked: string[] = []
  return {
    asked,
    io: { real: async (p: string) => p, isHired: async (id: string) => (over.hired ?? []).includes(id), typeOf: async (id: string) => (asked.push(id), over.types?.[id]) },
  }
}

test('a call from an id nobody marked, which the engine lists as a scout, is guarded as one and marks it', async () => {
  const box = createScoutBox()
  const r = route({ types: { sc9: SCOUT } })
  expect(await scoutRoute(box, r.io, ROOT, 'sc9', 'Read', { file_path: '.env' })).toMatchObject({ deny: expect.stringMatching(/^Refused by Clawd HQ/) })
  expect(box.isScout('sc9')).toBe(true)
  expect(await scoutRoute(box, r.io, ROOT, 'sc9', 'Read', { file_path: 'README.md' })).toEqual({ run: {} })
  expect(r.asked).toEqual(['sc9']) // once: after that it is known
})

test('a specialist on the books, an unknown agent and the main chat are not the scout\'s to guard: the route passes them by', async () => {
  const box = createScoutBox()
  const r = route({ hired: ['w1'], types: { a7: 'ecc:planner' } })
  expect(await scoutRoute(box, r.io, ROOT, 'w1', 'Read', { file_path: '.env' })).toBeUndefined()
  expect(await scoutRoute(box, r.io, ROOT, 'a7', 'Read', { file_path: '.env' })).toBeUndefined()
  expect(await scoutRoute(box, r.io, ROOT, 'zz', 'Read', { file_path: '.env' })).toBeUndefined()
  expect(await scoutRoute(box, r.io, ROOT, undefined, 'Read', { file_path: '.env' })).toBeUndefined()
  expect(r.asked).toEqual(['a7', 'zz']) // a hire on the books is never looked up
})

test('the pick tool is turned away from the main chat and from every agent that is not the scout', async () => {
  const box = createScoutBox()
  const r = route({ types: { a7: 'ecc:planner' } })
  expect(await scoutRoute(box, r.io, ROOT, undefined, TEAM, {})).toEqual({ deny: NOT_SCOUT_DENY })
  expect(await scoutRoute(box, r.io, ROOT, 'a7', TEAM, {})).toEqual({ deny: NOT_SCOUT_DENY })
})

test('a scout the box knows is guarded without any lookup', async () => {
  const box = createScoutBox()
  box.mark('sc1')
  const r = route()
  expect(await scoutRoute(box, r.io, ROOT, 'sc1', 'Bash', { command: 'ls' })).toMatchObject({ deny: expect.any(String) })
  expect(r.asked).toEqual([])
})

test('a lookup that fails is no scout: the call goes on as any other agent\'s would', async () => {
  const box = createScoutBox()
  const io2 = { real: async (p: string) => p, isHired: async () => false, typeOf: async (): Promise<string | undefined> => { throw new Error('list failed') } }
  expect(await scoutRoute(box, io2, ROOT, 'zz', 'Read', { file_path: 'a.md' })).toBeUndefined()
})
