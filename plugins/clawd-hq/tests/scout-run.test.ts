// Starting the scout and reading its picks from its final answer: no Clawd HQ hook runs inside the scout, so nothing here
// waits on one. The plugin looks at the scout's transcript every few seconds until the team block is there, the scout has
// ended, or time is up.
import { expect, test } from 'claude-code/testing'
import { POLL_MS, runScout } from '../hooks/scout-run'
import { TEAM_END, TEAM_START } from '../hooks/scout-answer'

const SCOUT = 'clawd-hq:scout'
const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
const ANSWER = `${TEAM_START}\nPlan | ecc:planner | README.md | Plans first.\n${TEAM_END}`

type Spawned = { subagentType: string; description: string; prompt: string }
type Said = { role: 'user' | 'assistant'; text: string; toolUses: Array<{ tool: string; input: Record<string, unknown> }> }
/**
 * A host whose start answers the id the test names (`null`: none, an Error: it fails), whose list is `listed`, whose transcript
 * is `said` (an Error: the read fails), and whose timers wait until the test fires them.
 */
function fakeHost(spawnAs: string | null | Error = 'sc1') {
  const timers: Array<{ ms: number; fn: () => void; isFired: boolean }> = []
  const spawned: Spawned[] = []
  const stopped: string[] = []
  const listed: Array<{ id: string; type: string; status: string }> = spawnAs === null || spawnAs instanceof Error ? [] : [{ id: spawnAs, type: SCOUT, status: 'running' }]
  const state = { said: [] as Said[] | Error, stopFails: false }
  return {
    timers, spawned, stopped, listed, state,
    spawn: async (args: Spawned) => {
      spawned.push(args)
      if (spawnAs instanceof Error) throw spawnAs
      return spawnAs === null ? {} : { agentId: spawnAs }
    },
    list: async () => listed,
    stop: async (id: string) => { stopped.push(id); if (state.stopFails) throw new Error('no such task') },
    messages: async (_id: string) => { if (state.said instanceof Error) throw state.said; return state.said },
    after(ms: number, fn: () => void) {
      const t = { ms, fn, isFired: false }
      timers.push(t)
      return { cancel: () => undefined }
    },
  }
}
type Host = ReturnType<typeof fakeHost>
/** Fires every timer that is waiting, as time passing would, and lets what follows run. */
async function tick(host: Host) {
  for (const t of host.timers.filter(one => !one.isFired)) { t.isFired = true; t.fn() }
  await settle()
}
const waiting = (host: Host) => host.timers.filter(t => !t.isFired)

test('the scout is started on its own type with the brief; once its answer holds the team block, the picks and the files it read come back', async () => {
  const host = fakeHost()
  const done = runScout(host, 'BRIEF', 90_000)
  await settle()
  expect(host.spawned).toEqual([{ subagentType: SCOUT, description: 'Look around the project', prompt: 'BRIEF' }])
  host.state.said = [{ role: 'assistant', text: '', toolUses: [{ tool: 'Read', input: { file_path: '/repo/README.md' } }] }]
  await tick(host) // still looking: no block yet
  // A block it wrote and then went on working past is not its final answer: still waiting.
  host.state.said = [...host.state.said, { role: 'assistant', text: ANSWER.replace('ecc:planner', 'ecc:early'), toolUses: [] }, { role: 'assistant', text: 'One more look.', toolUses: [{ tool: 'Glob', input: { pattern: '*' } }] }]
  await tick(host)
  expect(waiting(host)).toHaveLength(1)
  host.state.said = [...host.state.said, { role: 'assistant', text: ANSWER, toolUses: [] }]
  await tick(host)
  expect(await done).toEqual({ picks: { picks: [{ seat: 'Plan', name: 'ecc:planner', evidence: 'README.md', reason: 'Plans first.' }] }, reads: ['/repo/README.md'] })
  expect(waiting(host)).toEqual([])
  expect(host.stopped).toEqual([]) // it answered: nothing to stop
})

test('the transcript is looked at every two seconds, one timer at a time', async () => {
  const host = fakeHost()
  void runScout(host, 'BRIEF', 90_000)
  await settle()
  expect(POLL_MS).toBe(2_000)
  expect(waiting(host).map(t => t.ms)).toEqual([2_000])
  await tick(host)
  expect(waiting(host).map(t => t.ms)).toEqual([2_000])
})

test('a start that returns no id is found in the engine\'s list: only a scout that was not there before this start', async () => {
  const host = fakeHost(null)
  host.listed.push({ id: 'old', type: SCOUT, status: 'completed' }, { id: 'older', type: SCOUT, status: 'running' }, { id: 'a7', type: 'ecc:planner', status: 'running' })
  const seen: string[] = []
  const spawn = async (args: Spawned) => { const r = await host.spawn(args); host.listed.push({ id: 'sc2', type: SCOUT, status: 'running' }); return r }
  const done = runScout({ ...host, spawn, messages: async (id: string) => { seen.push(id); return [{ role: 'assistant', text: ANSWER, toolUses: [] }] } }, 'BRIEF', 90_000)
  await settle()
  await tick(host)
  expect(await done).toMatchObject({ reads: [] })
  expect(seen).toEqual(['sc2'])
})

test('with no id back and no new scout listed, an ended or older scout is never taken for it: it could not start', async () => {
  const host = fakeHost(null)
  host.listed.push({ id: 'old', type: SCOUT, status: 'completed' }, { id: 'older', type: SCOUT, status: 'running' })
  expect(await runScout(host, 'BRIEF', 90_000)).toEqual({ why: expect.stringMatching(/could not start/i) })
  expect(host.timers).toEqual([])
})

test('a scout that ends without a team block hands over at once, says why, and is not stopped', async () => {
  const host = fakeHost()
  const done = runScout(host, 'BRIEF', 90_000)
  await settle()
  host.state.said = [{ role: 'assistant', text: 'The team_pick tool failed, so nothing was saved.', toolUses: [] }]
  host.listed[0]!.status = 'completed'
  await tick(host)
  expect(await done).toEqual({ why: expect.stringMatching(/ended without a team list/i) })
  expect(waiting(host)).toEqual([])
  expect(host.stopped).toEqual([])
})

test('a scout the engine no longer lists has ended too', async () => {
  const host = fakeHost()
  const done = runScout(host, 'BRIEF', 90_000)
  await settle()
  host.listed.length = 0
  await tick(host)
  expect(await done).toEqual({ why: expect.stringMatching(/ended without a team list/i) })
})

test('a scout that ends just after its answer is still read: the answer counts', async () => {
  const host = fakeHost()
  const done = runScout(host, 'BRIEF', 90_000)
  await settle()
  host.state.said = [{ role: 'assistant', text: ANSWER, toolUses: [] }]
  host.listed[0]!.status = 'completed'
  await tick(host)
  expect(await done).toMatchObject({ picks: { picks: [{ name: 'ecc:planner' }] } })
})

test('with no answer by the time given, the scout is stopped and the reason says it ran out of time', async () => {
  const host = fakeHost()
  const done = runScout(host, 'BRIEF', 6_000)
  await settle()
  for (let i = 0; i < 3; i += 1) await tick(host)
  expect(await done).toEqual({ why: expect.stringMatching(/no team list within 6 seconds/i) })
  expect(host.stopped).toEqual(['sc1'])
  expect(waiting(host)).toEqual([])
})

test('a stop that fails changes nothing: the run still ends with the reason', async () => {
  const host = fakeHost()
  host.state.stopFails = true
  const done = runScout(host, 'BRIEF', 2_000)
  await settle()
  await tick(host)
  expect(await done).toEqual({ why: expect.stringMatching(/no team list/i) })
})

test('a transcript that cannot be read yet is no answer: the scout is looked at again', async () => {
  const host = fakeHost()
  const done = runScout(host, 'BRIEF', 90_000)
  await settle()
  host.state.said = new Error('not readable')
  await tick(host)
  expect(waiting(host)).toHaveLength(1)
  host.state.said = [{ role: 'assistant', text: ANSWER, toolUses: [] }]
  await tick(host)
  expect(await done).toMatchObject({ picks: { picks: [{ name: 'ecc:planner' }] } })
})

test('a start that is refused, fails, or gives no id is no scout: the reason says so, and no timer is left', async () => {
  for (const host of [fakeHost(new Error('down')), fakeHost(null), { ...fakeHost(), spawn: async () => ({ deny: 'no' }) }]) {
    expect(await runScout(host, 'BRIEF', 90_000)).toEqual({ why: expect.stringMatching(/could not start/i) })
    expect(host.timers).toEqual([])
  }
})
