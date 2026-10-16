import { expect, test } from 'claude-code/testing'
import { resumedEffort } from '../hooks/resume-effort'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({
  id: 'a1', type: 'ecc:tdd-guide', description: 'Build', mood: 'done', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})

test('a new [effort: …] line on the follow-up wins over everything remembered', () => {
  expect(resumedEffort('high', ['a1'], [emp({ effort: 'medium' })], new Map([['a1', 'low' as const]]))).toBe('high')
})

test('with no line, the in-memory level of the resumed agent is kept', () => {
  expect(resumedEffort(undefined, ['a1'], [], new Map([['a1', 'medium' as const]]))).toBe('medium')
})

test('after a reload (empty memory) the level on the staff record is the durable copy', () => {
  expect(resumedEffort(undefined, ['a1'], [emp({ effort: 'medium' })], new Map())).toBe('medium')
})

test('an answer under a new id still inherits from the id that was resumed', () => {
  expect(resumedEffort(undefined, ['new9', 'a1'], [emp({ id: 'new9' }), emp({ id: 'a1', effort: 'medium' })], new Map())).toBe('medium')
})

test('nothing known anywhere gives no level', () => {
  expect(resumedEffort(undefined, ['a1', undefined], [emp({})], new Map())).toBeUndefined()
})
