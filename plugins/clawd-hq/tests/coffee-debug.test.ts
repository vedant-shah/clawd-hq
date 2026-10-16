import { expect, test } from 'claude-code/testing'
import { DEBUG_KEY, coffeeRecord, keepCoffeeRecord } from '../hooks/coffee-debug'
import type { CoffeeDebugIo } from '../hooks/coffee-debug'
import { BOSS0, FX0, GAUGE0 } from '../hooks/state'
import type { Employee } from '../types'

const worker = (mood: Employee['mood']): Employee => ({ id: 'a1', type: 'ecc:planner', description: 'Plan', mood } as Employee)
const data = (over: { boss?: object; gauge?: object; fx?: object; staff?: Employee[] } = {}) => ({
  boss: { ...BOSS0, ...over.boss }, gauge: { ...GAUGE0, ...over.gauge }, fx: { ...FX0, ...over.fx }, staff: over.staff ?? [],
})

test('the record has the numbers behind the button and nothing of what was said', () => {
  const r = coffeeRecord(data({
    boss: { turns: 7, handedBackAt: 6, isCheckpoint: true, isBusy: false, carriedAt: 7, spokeBy: 'composer' },
    gauge: { contextTokens: 480_000, contextPercent: 48, contextWindow: 1_000_000, autoCompactAt: 950_000 },
    staff: [worker('working'), worker('done'), worker('thinking')],
  }), 1234, 'turn')
  expect(r).toEqual({
    at: 1234, by: 'turn', contextTokens: 480_000, threshold: 300_000, autoCompactAt: 950_000, isBusy: false, atWorkCount: 2,
    handedBackAt: 6, turns: 7, isCheckpoint: true, carriedAt: 7, spokeBy: 'composer', demo: false, shown: false,
  })
})

test('it says shown when the button is on the pane, and what it lacked when it is not', () => {
  const ready = data({ boss: { turns: 3, handedBackAt: 2, isCheckpoint: true }, gauge: { contextTokens: 400_000 } })
  expect(coffeeRecord(ready, 1, 'turn')).toMatchObject({ shown: true, atWorkCount: 0, demo: false })
  const busy = data({ boss: { isCheckpoint: true, isBusy: true }, gauge: { contextTokens: 400_000 } })
  expect(coffeeRecord(busy, 1, 'turn')).toMatchObject({ shown: false, isBusy: true })
  const touring = data({ boss: { isCheckpoint: true }, gauge: { contextTokens: 400_000 }, fx: { demo: { step: 1, total: 3, caption: 'x' } } })
  expect(coffeeRecord(touring, 1, 'turn')).toMatchObject({ shown: false, demo: true })
})

test('what is not known is null, so the key is still there to read', () => {
  const r = coffeeRecord(data(), 5, 'measure')
  expect(r).toMatchObject({ contextTokens: null, autoCompactAt: null, handedBackAt: null, carriedAt: null, spokeBy: null, threshold: 300_000, by: 'measure' })
})

test('the record is saved under one key, each time over the last, and a failing store is never thrown', async () => {
  const saved: Array<[string, unknown]> = []
  const io: CoffeeDebugIo = { now: async () => 9, data: async () => data(), save: async (key, value) => void saved.push([key, value]) }
  await keepCoffeeRecord(io, 'turn')
  await keepCoffeeRecord(io, 'measure')
  expect(saved.map(([key]) => key)).toEqual([DEBUG_KEY, DEBUG_KEY])
  expect(DEBUG_KEY).toBe('debug:coffee')
  const failing: CoffeeDebugIo = { ...io, save: async () => { throw new Error('the store refused the write') } }
  await expect(keepCoffeeRecord(failing, 'turn')).resolves.toBeUndefined()
  const unreadable: CoffeeDebugIo = { ...io, data: async () => { throw new Error('no state') } }
  await expect(keepCoffeeRecord(unreadable, 'turn')).resolves.toBeUndefined()
})
