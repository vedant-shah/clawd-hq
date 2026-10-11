import { expect, test } from 'claude-code/testing'
import { endOfStatus, restart, withStep } from '../hooks/staff-model'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({
  id: 'a1', type: 'ecc:tdd-guide', description: 'Build', prompt: '', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, log: [], ...over,
})
const usage = (over: Partial<Record<'input_tokens' | 'output_tokens' | 'cache_read_input_tokens' | 'cache_creation_input_tokens', number>>) => ({
  input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...over,
})

test('a finished specialist that is resumed starts a new run: fresh clock, no end, no old tool count or tokens', () => {
  const ended = emp({ mood: 'done', startedAt: 10, endedAt: 500, doneTick: 3, tools: 12, tokens: 80_000, outTokens: 900, context: 70_000, tool: 'Read', target: 'a.ts' })
  const again = restart(ended, 9_000, 40)
  expect(again).toMatchObject({ mood: 'working', startedAt: 9_000, endedAt: undefined, doneTick: undefined, tools: 0, tokens: 0, outTokens: 0 })
  expect(again.log[again.log.length - 1]).toBe('back at it')
  // The old value was not touched.
  expect(ended).toMatchObject({ mood: 'done', startedAt: 10, endedAt: 500, tools: 12 })
})

test('a failed specialist is restarted the same way', () => {
  expect(restart(emp({ mood: 'failed', endedAt: 5 }), 100, 1)).toMatchObject({ mood: 'working', startedAt: 100, endedAt: undefined })
})

test('a specialist that is already at a desk is left exactly as it is', () => {
  for (const mood of ['arriving', 'working', 'thinking'] as const) {
    const one = emp({ mood, startedAt: 10 })
    expect(restart(one, 9_000, 40)).toBe(one)
  }
})

test('the token figure is the latest request\'s whole input plus the output of every request, not each request\'s context added up', () => {
  const first = withStep(emp({}), usage({ input_tokens: 10, cache_read_input_tokens: 80_000, output_tokens: 500 }), 'm')
  const second = withStep(first, usage({ input_tokens: 20, cache_read_input_tokens: 81_000, cache_creation_input_tokens: 400, output_tokens: 600 }), 'm')
  // 81 420 of input at the latest request, plus 500 + 600 generated.
  expect(second.tokens).toBe(81_420 + 1_100)
  expect(second.outTokens).toBe(1_100)
  // The context is how full the window is now: the latest input and the output.
  expect(second.context).toBe(81_420 + 600)
  expect(second.model).toBe('m')
  expect(first.tokens).toBe(80_010 + 500)
})

test('a request with no usage numbers adds nothing and keeps the model', () => {
  const one = withStep(emp({ model: 'old' }), usage({}), '')
  expect(one).toMatchObject({ tokens: 0, outTokens: 0, context: 0, model: 'old' })
})

test('what the engine says of an agent decides whether it is still at work', () => {
  expect(endOfStatus('running')).toBeUndefined()
  expect(endOfStatus('pending')).toBeUndefined()
  expect(endOfStatus('waiting')).toBeUndefined()
  expect(endOfStatus('completed')).toBe('done')
  expect(endOfStatus('idle')).toBe('done')
  expect(endOfStatus('failed')).toBe('failed')
  expect(endOfStatus('killed')).toBe('failed')
})
