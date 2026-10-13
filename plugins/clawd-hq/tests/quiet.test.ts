import { expect, test } from 'claude-code/testing'
import { NO_UPDATE, isHandback, isNoUpdate } from '../hooks/quiet'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({ id: 'a1', type: 'ecc:code-reviewer', description: 'Review', mood: 'done', tools: 0, startedAt: 0, joinedTick: 0, ...over })
const staff = [emp({}), emp({ id: 't1', type: 'general-purpose', name: 'judge' })]
const row = (over: Record<string, unknown>) => ({ isExpanded: false, originKind: 'task-notification', text: 'Message 5 of 6 received.', ...over })

test('a reply that is only the no-update mark is filler; anything more is not', () => {
  expect(NO_UPDATE).toBe('[no update]')
  expect(isNoUpdate('[no update]')).toBe(true)
  expect(isNoUpdate('  [No update].\n')).toBe(true)
  expect(isNoUpdate('[no update] but the tests failed')).toBe(false)
  expect(isNoUpdate('No update yet.')).toBe(false)
  expect(isNoUpdate('')).toBe(false)
})

test('a finished notice for one of the office\'s own specialists is a hand-back the chat can hide', () => {
  expect(isHandback(row({ task: { id: 'a1', status: 'completed' } }), staff)).toBe(true)
  // A failure, a stop, or a notice that does not say how it ended is always shown.
  expect(isHandback(row({ task: { id: 'a1', status: 'failed' } }), staff)).toBe(false)
  expect(isHandback(row({ task: { id: 'a1', status: 'killed' } }), staff)).toBe(false)
  expect(isHandback(row({ task: { id: 'a1' } }), staff)).toBe(false)
  // A background command or anything else the office did not hire is not ours to hide.
  expect(isHandback(row({ task: { id: 'shell-7', status: 'completed' } }), staff)).toBe(false)
})

test('a message from a teammate the office hired by name is a hand-back; one from anyone else is not', () => {
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' } }), staff)).toBe(true)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'Judge' } }), staff)).toBe(true)
  // Only a given name counts: an agent type is too easy for another sender to share.
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'ecc:code-reviewer' } }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'general-purpose' } }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'Another project' } }), staff)).toBe(false)
})

test('a message with a stamp of where it came from is never hidden, even under a teammate\'s name', () => {
  for (const originKind of ['peer', 'peer-send-message', 'channel', 'composer', 'bridge', 'sdk', 'scheduled-trigger', 'task-notification']) {
    expect(isHandback(row({ originKind, from: { name: 'judge' } }), staff)).toBe(false)
  }
})

test('a teammate\'s message that asks for something is never hidden', () => {
  const asks = ['Should I also score tone?', 'I need permission to run the build.', 'Plan ready: please approve it.', 'Requesting plan approval.', 'Shutdown requested: shall I stop?', 'shut down request']
  for (const text of asks) expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' }, text }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' }, text: 'Turn 3 of 3 sent. I am done.' }), staff)).toBe(true)
})

test('the person\'s own messages and the full view are never hidden', () => {
  expect(isHandback(row({ originKind: 'composer' }), staff)).toBe(false)
  expect(isHandback(row({ isExpanded: true, task: { id: 'a1', status: 'completed' } }), staff)).toBe(false)
  expect(isHandback(row({ isExpanded: true, originKind: 'unclassified', from: { name: 'judge' } }), staff)).toBe(false)
  expect(isHandback(row({ task: { id: 'a1', status: 'completed' } }), [])).toBe(false)
})
