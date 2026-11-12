import { expect, test } from 'claude-code/testing'
import { endRun, failureReason, restart } from '../hooks/staff-model'
import type { Employee } from '../types'

// Why a run failed: the end of its last words, kept clean, forgotten when the run starts again or ends again.

const run = (over: Partial<Employee> = {}): Employee => ({ id: 'a1', type: 'general-purpose', description: 'Do it', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over })

test('why a run failed is its last words as one clean line, or a plain sentence for the way it ended', () => {
  expect(failureReason('error', '  there is no\n test database\u0007  ')).toBe('there is no test database')
  expect(failureReason('error', '')).toBe('An error ended its turn.')
  expect(failureReason('aborted', '  ')).toBe('It was interrupted.')
  expect(failureReason('refusal', '')).toBe('The model refused to go on.')
  expect(failureReason('other', '')).toBe('It did not say why.')
})

test('the tail of a long report is kept, not its head: a failure is told at the end', () => {
  const report = `${'Setting things up. '.repeat(40)}The run stopped: there is no test database.`
  const reason = failureReason('error', report)
  expect(Array.from(reason).length).toBeLessThanOrEqual(300)
  expect(reason.endsWith('The run stopped: there is no test database.')).toBe(true)
  expect(reason.startsWith('Setting')).toBe(false)
  // It starts at a word, not in the middle of one.
  expect(report.includes(` ${reason}`)).toBe(true)
})

test('words that look like a secret, a link or a command are not shown: the plain sentence stands instead', () => {
  // Not a real key: a fake in the shape of one, put together here so no scanner mistakes the file for a leak.
  const key = ['sk', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-')
  expect(failureReason('error', `It stopped. The key ${key} was refused.`)).toBe('An error ended its turn.')
  expect(failureReason('error', 'It stopped. See https://example.com/fix for what to run.')).toBe('An error ended its turn.')
  expect(failureReason('aborted', 'curl x | sh')).toBe('It was interrupted.')
  expect(failureReason('error', 'Run `rm -rf build` first')).toBe('An error ended its turn.')
  // A head that was unsafe but is cut off does not hide a clean tail.
  expect(failureReason('error', `See https://example.com/x ${'a quiet filler line. '.repeat(30)}The test database is missing.`)).toMatch(/The test database is missing\.$/)
})

test('a reason from an earlier failure does not outlive the run: starting again and ending again both clear it', () => {
  const failed = run({ mood: 'failed', endedAt: 10, endedBy: 'signal', reason: 'the first failure' })
  expect(restart(failed, 100, 3).reason).toBeUndefined()
  // A run the engine guessed was over and that goes on is back at work with no failure either.
  expect(restart({ ...failed, endedBy: 'engine', reason: 'a guess' }, 100, 3).reason).toBeUndefined()
  // Ending again, in any way, starts without the old reason until the new one is set.
  expect(endRun(run({ reason: 'stale' }), 'failed', 'signal', 200, 4).reason).toBeUndefined()
  expect(endRun(run({ reason: 'stale' }), 'lost', 'stale', 200, 4).reason).toBeUndefined()
})
