import { expect, test } from 'claude-code/testing'
import { reasonOf, runEach, startNote } from '../hooks/state'

test('each step runs whatever the one before it did, and the ones that failed come back by name with why', async () => {
  const ran: string[] = []
  const failed = await runEach([
    ['tools', async () => { ran.push('tools'); throw new Error('already registered') }],
    ['memory', async () => { ran.push('memory') }],
    ['meters', async () => { ran.push('meters'); throw 'no reading' }],
    ['instructions', async () => { ran.push('instructions') }],
  ])
  expect(ran).toEqual(['tools', 'memory', 'meters', 'instructions'])
  expect(failed).toEqual(['tools (already registered)', 'meters (no reading)'])
  expect(await runEach([['a', async () => undefined]])).toEqual([])
})

test('a reason is the error\'s message, or the thrown value as text', () => {
  expect(reasonOf(new Error('EACCES'))).toBe('EACCES')
  expect(reasonOf('plain')).toBe('plain')
  expect(reasonOf(42)).toBe('42')
})

test('the start-up note names every part that failed and says the rest runs', () => {
  expect(startNote(['tools (already registered)', 'meters (no reading)'])).toBe(
    'Clawd HQ: part of its start-up failed: tools (already registered); meters (no reading). The rest is running.',
  )
})
