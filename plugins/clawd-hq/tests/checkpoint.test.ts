import { expect, test } from 'claude-code/testing'
import { isPersonMessage, withHandBack, withPersonSpoke, withTurnEnd } from '../hooks/checkpoint'
import { BOSS0 } from '../hooks/state'
import type { Boss } from '../types'

const boss = (over: Partial<Boss> = {}): Boss => ({ ...BOSS0, ...over })
const answered = (answer = 'All three are done.') => ({ reason: 'answer', answer })

test('a hand-back is noted with the turn count it came at, and is no checkpoint yet', () => {
  const b = withHandBack(boss({ turns: 4, isCheckpoint: true }))
  expect(b).toMatchObject({ handedBackAt: 4, isCheckpoint: false, turns: 4 })
})

test('the person speaking wipes the hand-back and the checkpoint', () => {
  const b = withPersonSpoke(boss({ turns: 4, handedBackAt: 3, isCheckpoint: true }))
  expect(b.handedBackAt).toBeUndefined()
  expect(b.isCheckpoint).toBe(false)
  expect(b.turns).toBe(4)
})

test('the turn after a hand-back that ends in an answer closes the piece of work', () => {
  // The hand-back came while Clawd was idle at turn 4; his report is turn 5.
  expect(withTurnEnd(boss({ turns: 5, handedBackAt: 4 }), answered()).isCheckpoint).toBe(true)
})

test('a plain chat reply with no hand-back is no checkpoint', () => {
  expect(withTurnEnd(boss({ turns: 1 }), answered()).isCheckpoint).toBe(false)
})

test('the turn a hand-back arrived in is not its report: the report is the turn after', () => {
  expect(withTurnEnd(boss({ turns: 4, handedBackAt: 4 }), answered()).isCheckpoint).toBe(false)
})

test('a report that ends in a plain-text question still closes the piece of work', () => {
  const b = boss({ turns: 5, handedBackAt: 4 })
  expect(withTurnEnd(b, answered('Done. Should I ship it on Friday?')).isCheckpoint).toBe(true)
  expect(withTurnEnd(b, answered('All three are done. Shall I start step 1?')).isCheckpoint).toBe(true)
})

test('a turn that was stopped or failed is no checkpoint', () => {
  const b = boss({ turns: 5, handedBackAt: 4 })
  expect(withTurnEnd(b, { reason: 'aborted' }).isCheckpoint).toBe(false)
  expect(withTurnEnd(b, { reason: 'error' }).isCheckpoint).toBe(false)
  expect(withTurnEnd(b, { reason: 'answer' }).isCheckpoint).toBe(true)
})

test('a later turn that is not a report takes an earlier checkpoint away', () => {
  const b = boss({ turns: 6, handedBackAt: undefined, isCheckpoint: true })
  expect(withTurnEnd(b, answered('Which one do you want?')).isCheckpoint).toBe(false)
})

test('only what the person sends counts as a message: not a notification, a peer, a schedule or a command', () => {
  const sent = (text: string, kind?: string) => isPersonMessage({ text, origin: kind === undefined ? undefined : { kind } })
  for (const kind of ['composer', 'bridge', 'sdk', undefined]) expect(sent('Fix the bug', kind)).toBe(true)
  for (const kind of ['task-notification', 'scheduled-trigger', 'peer', 'plugin', 'unclassified']) expect(sent('Fix the bug', kind)).toBe(false)
  expect(sent('/office', 'composer')).toBe(false)
  expect(sent('  /compact keep the plan', 'composer')).toBe(false)
  // A message that is only a picture has no text, but it is the person speaking.
  expect(sent('', 'composer')).toBe(true)
})
