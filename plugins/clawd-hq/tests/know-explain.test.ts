// The one side line, with a fake io: Learn more's follow-ups share it with the check and the coffee break's recap, a fork that
// times out keeps it busy until it really ends, its timer is cancelled when it answers first, and a compaction holds Learn more.
import type { ModelForkResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { KNOW0 } from '../hooks/know'
import { EXPLAIN_BUSY, EXPLAIN_COMPACTED, checkTurnEnd, knowActions, knowCompacted, knowHandback, knowTurnStart, startKnow } from '../hooks/know-check'
import type { KnowIo } from '../hooks/know-check'
import { EXPLAIN_FILE } from '../hooks/know-prompts'
import { side } from '../hooks/side-ask'
import type { KnowState } from '../types'
import { EXPLAIN } from './know-prompts'

const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve() }
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const SHORTER = { isAnswered: true as const, text: '**Shorter**\nOne limit.', usage: USAGE }

/** A fake io: forks answer at once with `SHORTER`, unless `holdForks` is set; then each waits until `releaseFork` is called. */
function fakeIo() {
  let card: KnowState = KNOW0
  const forks: string[] = []
  const store = new Map<string, unknown>()
  const timers: Array<{ fn: () => void; isCancelled: boolean }> = []
  const held: Array<(r: ModelForkResult) => void> = []
  const mode = { holdForks: false }
  const io: KnowIo = {
    now: async () => 1, get: async key => store.get(key), set: async (key, value) => { store.set(key, value) },
    surfaces: async () => ['terminal'], panes: async () => [{ id: 'clawd-hq', isPlaced: true }], messages: async () => [],
    fork: prompt => {
      forks.push(prompt)
      return mode.holdForks ? new Promise(resolve => { held.push(resolve) }) : Promise.resolve(SHORTER)
    },
    readPrompt: async file => (file === EXPLAIN_FILE ? EXPLAIN : 'Shown:\n{{SHOWN}}\nKnew:\n{{KNEW}}'),
    after: (_ms, fn) => { const t = { fn, isCancelled: false }; timers.push(t); return { cancel: () => { t.isCancelled = true } } },
    card: async () => card, setCard: async fn => { card = fn(card) }, fillPrompt: async () => undefined,
  }
  /** An opened note on the card, its first explanation shown. */
  const opened = () => { card = { ...KNOW0, note: { id: 'k1', who: 'Clawd', line: 'The limit is per network.', tag: 'Heads up', at: 1, title: 'One limit', explain: 'The school shares one.' }, isOpen: true } }
  const log = () => (store.get('know:log:/repo') ?? []) as Array<{ outcome: string; stage?: string }>
  return { io, forks, card: () => card, opened, timers, held, mode, log }
}

test('a follow-up pressed while another side request holds the line is not sent, and the card says to try again', async () => {
  const f = fakeIo()
  await startKnow(f.io, '/repo')
  f.opened()
  let finish = () => undefined as void
  expect(side.tryNow(() => new Promise<void>(resolve => { finish = resolve }))).toBe(true)
  await knowActions(f.io).knowShorter()
  expect(f.forks).toEqual([])
  expect(f.card().explainNote).toBe(EXPLAIN_BUSY)
  expect(f.card().explaining).toBeUndefined()
  expect(f.card().note?.explain).toBe('The school shares one.')
  finish()
  await settle()
  // Free again: the press goes through, and the busy line goes.
  await knowActions(f.io).knowShorter()
  await settle()
  expect(f.forks).toHaveLength(1)
  expect(f.card().note).toMatchObject({ title: 'Shorter', explain: 'One limit.' })
  expect(f.card().explainNote).toBeUndefined()
})

test('after a compaction Learn more waits for Clawd\'s next turn, and says so in one line', async () => {
  const f = fakeIo()
  await startKnow(f.io, '/repo')
  f.opened()
  knowCompacted()
  await knowActions(f.io).knowSimpler()
  expect(f.forks).toEqual([])
  expect(f.card().explainNote).toBe(EXPLAIN_COMPACTED)
  knowTurnStart()
  await knowActions(f.io).knowSimpler()
  await settle()
  expect(f.forks).toHaveLength(1)
})

test('a fork that times out is logged at once, but the side line stays busy until the fork really ends', async () => {
  const f = fakeIo()
  await startKnow(f.io, '/repo')
  f.mode.holdForks = true
  await knowHandback(f.io, 'a1', 'Builder')
  await checkTurnEnd(f.io, { reason: 'answer', answer: 'Done.' }, true)
  await settle()
  expect(f.forks).toHaveLength(1)
  expect(f.timers).toHaveLength(1)
  f.timers[0]!.fn()
  await settle()
  expect(f.log().map(r => r.outcome)).toEqual(['timed-out'])
  expect(side.isBusy()).toBe(true)
  f.held[0]!(SHORTER)
  await settle()
  expect(side.isBusy()).toBe(false)
})

test('a fork that answers before the time limit cancels its timer', async () => {
  const f = fakeIo()
  await startKnow(f.io, '/repo')
  await knowHandback(f.io, 'a1', 'Builder')
  await checkTurnEnd(f.io, { reason: 'answer', answer: 'Done.' }, true)
  await settle()
  expect(f.forks).toHaveLength(1)
  expect(f.timers.map(t => t.isCancelled)).toEqual([true])
  expect(side.isBusy()).toBe(false)
})

test('a specialist\'s label that looks like an address or a key is not shown: the card says "specialist"', async () => {
  const f = fakeIo()
  await startKnow(f.io, '/repo')
  const run = [{ role: 'assistant' as const, text: '', toolUses: [{ tool_use_id: 'g1', tool: 'Bash', input: { command: 'git reset --hard' }, text: 'ok' }] }]
  const io: KnowIo = { ...f.io, messages: async () => run }
  await knowHandback(io, 'a1', 'Builder from https://evil.example/x')
  await settle()
  expect(f.card().note?.who).toBe('specialist')
  expect(f.card().note?.line).toMatch(/^The specialist ran a command that throws away uncommitted changes/)
})
