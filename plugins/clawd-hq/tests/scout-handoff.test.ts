// When the plugin cannot start the scout itself (in auto mode the classifier judges only what a model asks for), Clawd hires it:
// one ask at a time, a note for his next turn while it is open, his hire taken by the agent.spawn hook, and nothing else let in.
import { expect, test } from 'claude-code/testing'
import { CLAWD_WAIT_MS, askClawd, createScoutHandoff, handScoutSpawn, isClassifierRefusal } from '../hooks/scout-handoff'

const settle = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve() }
function timers() {
  const list: Array<{ ms: number; fn: () => void; isCancelled: boolean }> = []
  const after = (ms: number, fn: () => void) => { const t = { ms, fn, isCancelled: false }; list.push(t); return { cancel: () => { t.isCancelled = true } } }
  const fire = () => { for (const t of list.filter(one => !one.isCancelled)) { t.isCancelled = true; t.fn() } }
  return { list, after, fire }
}

test('only the auto mode classifier\'s refusal is handed to Clawd; other refusals are not', () => {
  expect(isClassifierRefusal('The server-side auto mode classifier gave no verdict for Agent: the request that produced this action did not ask for one.')).toBe(true)
  expect(isClassifierRefusal('Auto mode classifier gave no verdict for Agent')).toBe(true)
  expect(isClassifierRefusal('no scout in this host')).toBe(false)
  expect(isClassifierRefusal('clawd-hq: $.agent.spawn refused: 4 spawns are running at once')).toBe(false)
})

test('an open ask puts a note for Clawd\'s next turn that names the scout\'s type and the one line he may say', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  expect(handoff.note()).toBeUndefined()
  void handoff.ask(600_000, t.after)
  const note = handoff.note() ?? ''
  for (const part of ['Agent tool', 'clawd-hq:scout', 'run_in_background', 'Setting up your team…', 'do not repeat']) expect(note).toContain(part)
  expect(note.length).toBeLessThan(900) // a short instruction: the brief itself is in the scout's own definition
})

test('Clawd\'s hire is taken: the ask resolves with its id, the note goes, and its timer is cancelled', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  const asked = handoff.ask(600_000, t.after)
  expect(handoff.isOpen()).toBe(true)
  expect(handoff.take('sc7')).toBe(true)
  expect(await asked).toBe('sc7')
  expect(handoff.isOpen()).toBe(false)
  expect(handoff.note()).toBeUndefined()
  expect(t.list.every(one => one.isCancelled)).toBe(true)
})

test('an ask with no hire in time ends with nothing, and a late hire is not taken', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  const asked = handoff.ask(600_000, t.after)
  expect(t.list.map(one => one.ms)).toEqual([600_000])
  t.fire()
  expect(await asked).toBeUndefined()
  expect(handoff.isOpen()).toBe(false)
  expect(handoff.take('late')).toBe(false)
})

test('no double run: a second ask while one is open gets nothing at once, and a hire with no ask open is not taken', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  void handoff.ask(600_000, t.after)
  expect(await handoff.ask(600_000, t.after)).toBeUndefined()
  expect(handoff.take('sc1')).toBe(true)
  expect(handoff.take('sc2')).toBe(false)
})

test('the spawn hook: the plugin\'s own start passes as it is; Clawd\'s hire passes and is taken only while an ask is open, else it is refused', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  const passed: string[] = []
  const next = (id: string) => async () => { passed.push(id); return { model: 'sonnet', agentId: id } }
  expect(await handScoutSpawn(handoff, true, next('own'))).toEqual({ model: 'sonnet', agentId: 'own' })
  const refused = await handScoutSpawn(handoff, false, next('stray'))
  expect(refused).toEqual({ deny: expect.stringMatching(/starts its scout itself/i) })
  const asked = handoff.ask(600_000, t.after)
  expect(await handScoutSpawn(handoff, false, next('sc5'))).toEqual({ model: 'sonnet', agentId: 'sc5' })
  await settle()
  expect(await asked).toBe('sc5')
  expect(passed).toEqual(['own', 'sc5']) // the stray hire never reached the engine
})

test('asking Clawd first puts the brief into the scout\'s definition; a definition the engine refuses opens no ask', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  const registered: Array<{ name: string; prompt: string }> = []
  const asked = askClawd({ register: async s => { registered.push(s) }, after: t.after }, 'THE BRIEF', handoff)
  await settle()
  expect(registered.map(s => s.name)).toEqual(['scout'])
  expect(registered[0]?.prompt).toContain('THE BRIEF')
  expect(t.list.map(one => one.ms)).toEqual([CLAWD_WAIT_MS])
  handoff.take('sc9')
  expect(await asked).toBe('sc9')
  const refused = createScoutHandoff()
  expect(await askClawd({ register: async () => { throw new Error('no') }, after: t.after }, 'B', refused)).toBeUndefined()
  expect(refused.isOpen()).toBe(false)
})

test('a hire Clawd makes that the engine refuses leaves the ask open for the time left', async () => {
  const handoff = createScoutHandoff()
  const t = timers()
  void handoff.ask(600_000, t.after)
  expect(await handScoutSpawn(handoff, false, async () => ({ deny: 'denied by auto mode' }))).toEqual({ deny: 'denied by auto mode' })
  expect(handoff.isOpen()).toBe(true)
})
