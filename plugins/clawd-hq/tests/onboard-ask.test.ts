// Onboarding, piece 8: the two setup questions, their answers from the box or the card, and the switch changes they make.
import { expect, test } from 'claude-code/testing'
import { QUESTIONS, answerOf, applyPending, nextQuestion, withAnswer } from '../hooks/onboard-ask'
import type { PendingToggle, ToggleField } from '../hooks/onboard-types'

const RUN = QUESTIONS[0]!.question
const QUIET = QUESTIONS[1]!.question

test('two questions, each with Yes (Recommended) first and No second', () => {
  expect(QUESTIONS.map(q => q.field)).toEqual(['chiefOfStaff', 'quietChat'])
  for (const q of QUESTIONS) {
    expect(q.options.map(o => o.label)).toEqual(['Yes (Recommended)', 'No'])
    expect(q.question.endsWith('?')).toBe(true)
    expect(q.header.length).toBeLessThanOrEqual(12)
  }
})

test('a Yes or a No answer is read, with or without the (Recommended) mark; anything else is no answer', () => {
  expect(answerOf('Yes (Recommended)')).toBe(true)
  expect(answerOf('Yes')).toBe(true)
  expect(answerOf('no')).toBe(false)
  expect(answerOf('Maybe later')).toBeUndefined()
  expect(answerOf(undefined)).toBeUndefined()
})

test('the two questions are told apart by their text', () => {
  expect(RUN).not.toBe(QUIET)
})

test('the card asks the first question not answered yet, and a second answer to one question replaces the first', () => {
  expect(nextQuestion([])?.field).toBe('chiefOfStaff')
  expect(nextQuestion([{ field: 'chiefOfStaff', value: true }])?.field).toBe('quietChat')
  expect(nextQuestion([{ field: 'quietChat', value: true }, { field: 'chiefOfStaff', value: false }])).toBeUndefined()
  expect(withAnswer([{ field: 'chiefOfStaff', value: true }], { field: 'chiefOfStaff', value: false })).toEqual([{ field: 'chiefOfStaff', value: false }])
})

type Fake = { options: Record<ToggleField, boolean>; isBusy: boolean; isRefused: boolean; sets: PendingToggle[]; saves: Array<readonly PendingToggle[]> }
const fake = (over: Partial<Fake> = {}): Fake => ({ options: { chiefOfStaff: true, quietChat: true }, isBusy: false, isRefused: false, sets: [], saves: [], ...over })
const ioOf = (f: Fake) => ({
  options: async () => f.options,
  isBusy: async () => f.isBusy,
  setToggle: async (field: ToggleField, value: boolean) => { f.sets.push({ field, value }); return !f.isRefused },
  keep: async (pending: readonly PendingToggle[]) => { f.saves.push(pending) },
})

test('only a value that differs from the switch now is set, and each answer leaves the waiting list once applied', async () => {
  const f = fake()
  const r = await applyPending(ioOf(f), [{ field: 'chiefOfStaff', value: true }, { field: 'quietChat', value: false }])
  expect(f.sets).toEqual([{ field: 'quietChat', value: false }])
  expect(f.saves).toEqual([[{ field: 'quietChat', value: false }], []])
  expect(r).toEqual({ pending: [], refused: [] })
})

test('while Clawd is busy nothing is set and every answer keeps waiting', async () => {
  const f = fake({ isBusy: true })
  const pending = [{ field: 'quietChat', value: false }] as const
  expect(await applyPending(ioOf(f), pending)).toEqual({ pending, refused: [] })
  expect(f.sets).toEqual([])
})

test('a change the switch path refuses is reported, not retried', async () => {
  const f = fake({ isRefused: true })
  expect(await applyPending(ioOf(f), [{ field: 'chiefOfStaff', value: false }])).toEqual({ pending: [], refused: ['chiefOfStaff'] })
})
