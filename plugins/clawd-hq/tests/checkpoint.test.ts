import { expect, test } from 'claude-code/testing'
import { isPersonMessage, withHandBack, withNewWork, withNotice, withPersonSpoke, withToolUsed, withTurnEnd } from '../hooks/checkpoint'
import { BOSS0 } from '../hooks/state'
import type { Boss } from '../types'

const boss = (over: Partial<Boss> = {}): Boss => ({ ...BOSS0, ...over })
const answered = (answer = 'All three are done.') => ({ reason: 'answer', answer })

test('a hand-back is noted with the turn count it came at, and is no checkpoint yet', () => {
  const b = withHandBack(boss({ turns: 4, isCheckpoint: true }))
  expect(b).toMatchObject({ handedBackAt: 4, isCheckpoint: false, turns: 4 })
})

test('the person speaking wipes the waiting hand-back but leaves a standing checkpoint', () => {
  const b = withPersonSpoke(boss({ turns: 4, handedBackAt: 3, isCheckpoint: true }))
  expect(b.handedBackAt).toBeUndefined()
  expect(b.isCheckpoint).toBe(true)
  expect(b.turns).toBe(4)
})

test('a standing checkpoint survives a plain turn, and a turn with work or a new hire ends it', () => {
  const standing = boss({ turns: 6, isCheckpoint: true })
  expect(withTurnEnd(standing, answered('Plain words.')).isCheckpoint).toBe(true)
  const worked = withTurnEnd(withToolUsed(standing, 'Read'), answered())
  expect(worked).toMatchObject({ isCheckpoint: false, hasWorked: undefined })
  expect(withTurnEnd(withToolUsed(standing, 'AskUserQuestion'), answered()).isCheckpoint).toBe(true)
  expect(withTurnEnd(withToolUsed(standing, 'ToolSearch'), answered()).isCheckpoint).toBe(true)
  expect(withNewWork(standing).isCheckpoint).toBe(false)
})

test('work in a turn does not stop that turn from reporting a fresh hand-back', () => {
  const b = withToolUsed(boss({ turns: 5, handedBackAt: 4 }), 'Read')
  expect(withTurnEnd(b, answered()).isCheckpoint).toBe(true)
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

test('a later turn that is not a report leaves an earlier checkpoint standing', () => {
  const b = boss({ turns: 6, handedBackAt: undefined, isCheckpoint: true })
  expect(withTurnEnd(b, answered('Which one do you want?')).isCheckpoint).toBe(true)
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

// ---- A notification that reaches Clawd's turn: the turn that sees a hand-back is the one that reports it ----

test('a notification that comes while Clawd is idle, after the hand-back, leaves it to the next turn', () => {
  const b = withNotice(boss({ turns: 4, handedBackAt: 4 }), false)
  expect(b.handedBackAt).toBe(4)
  expect(b.carriedAt).toBeUndefined()
})

test('a notification that joins the running turn after the hand-back makes that turn the report', () => {
  const b = withNotice(boss({ turns: 4, isBusy: true, handedBackAt: 4 }), true)
  expect(b.handedBackAt).toBe(3)
  expect(withTurnEnd(b, answered()).isCheckpoint).toBe(true)
})

test('a notification with no hand-back yet is kept for the turn that carries it, and the hand-back that follows in that turn is reported by it', () => {
  const idle = withNotice(boss({ turns: 4 }), false)
  expect(idle.carriedAt).toBe(5)
  const joined = withNotice(boss({ turns: 5, isBusy: true }), true)
  expect(joined.carriedAt).toBe(5)
  const b = withHandBack({ ...joined, handedBackAt: undefined })
  expect(b).toMatchObject({ handedBackAt: 4, isCheckpoint: false })
  expect(b.carriedAt).toBeUndefined()
  expect(withTurnEnd(b, answered()).isCheckpoint).toBe(true)
})

test('a hand-back is carried by the running turn only once: the next one waits for a turn of its own', () => {
  const first = withHandBack(boss({ turns: 5, isBusy: true, carriedAt: 5 }))
  expect(first.handedBackAt).toBe(4)
  const second = withHandBack({ ...first, isBusy: true })
  expect(second.handedBackAt).toBe(5)
  expect(withTurnEnd(second, answered()).isCheckpoint).toBe(false)
})

test('a carried mark of an earlier turn, or one while Clawd is idle, carries nothing', () => {
  expect(withHandBack(boss({ turns: 6, isBusy: true, carriedAt: 5 })).handedBackAt).toBe(6)
  expect(withHandBack(boss({ turns: 5, isBusy: false, carriedAt: 5 })).handedBackAt).toBe(5)
})

test('the person speaking takes the carried mark away, and keeps where the message came from', () => {
  const b = withPersonSpoke(boss({ turns: 4, carriedAt: 5, handedBackAt: 3 }), 'composer')
  expect(b.carriedAt).toBeUndefined()
  expect(b.spokeBy).toBe('composer')
  expect(withPersonSpoke(boss(), undefined).spokeBy).toBe('none')
})
