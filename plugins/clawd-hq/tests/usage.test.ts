import { expect, test } from 'claude-code/testing'
import { contextOf, effortLabel, localOffset, resetAt, resetIn, tokensShort, usageView, withRequest } from '../hooks/usage'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// A Wednesday, 12:00 in UTC.
const NOW = Date.parse('2026-10-14T12:00:00Z')
const inMs = (ms: number) => new Date(NOW + ms).toISOString()
const utc = () => 0

test('tokens read as Claude writes them', () => {
  expect(tokensShort(169_700)).toBe('169.7k')
  expect(tokensShort(3_000)).toBe('3k')
  expect(tokensShort(999)).toBe('999')
  expect(tokensShort(0)).toBe('0')
  expect(tokensShort(200_000)).toBe('200k')
  expect(tokensShort(1_000_000)).toBe('1M')
  expect(tokensShort(1_500_000)).toBe('1.5M')
  // Rounding never leaves 1000k.
  expect(tokensShort(999_999)).toBe('1M')
  expect(tokensShort(Number.NaN)).toBe('0')
  expect(tokensShort(-5)).toBe('0')
})

test('effort reads as a word; a number or an unknown word is not shown', () => {
  expect(effortLabel('low')).toBe('Low')
  expect(effortLabel('medium')).toBe('Medium')
  expect(effortLabel('high')).toBe('High')
  expect(effortLabel('max')).toBe('Max')
  expect(effortLabel('xhigh')).toBe('Extra high')
  expect(effortLabel(undefined)).toBeUndefined()
  expect(effortLabel(8000)).toBeUndefined()
  expect(effortLabel('turbo')).toBeUndefined()
})

test('a session reset reads in hours and minutes, with whole units dropped', () => {
  expect(resetIn(3 * HOUR + 52 * MIN)).toBe('Resets in 3 hr 52 min')
  expect(resetIn(HOUR)).toBe('Resets in 1 hr')
  expect(resetIn(2 * HOUR + 30_000)).toBe('Resets in 2 hr')
  expect(resetIn(48 * MIN)).toBe('Resets in 48 min')
  expect(resetIn(MIN)).toBe('Resets in 1 min')
  expect(resetIn(59_000)).toBe('Resets in under a minute')
  expect(resetIn(1)).toBe('Resets in under a minute')
})

test('a time that has passed, or is not a number, has no reset text', () => {
  expect(resetIn(0)).toBeUndefined()
  expect(resetIn(-MIN)).toBeUndefined()
  expect(resetIn(Number.NaN)).toBeUndefined()
})

test('a weekly reset reads as the weekday and the clock time in the local zone', () => {
  // Friday 2026-10-16, 07:30 in UTC.
  const friday = Date.parse('2026-10-16T07:30:00Z')
  expect(resetAt(friday, 0)).toBe('Resets Fri 7:30 AM')
  // Five and a half hours east (India): 13:00 the same day.
  expect(resetAt(friday, 330)).toBe('Resets Fri 1:00 PM')
  // Seven hours west: still Friday, just after midnight.
  expect(resetAt(friday, -420)).toBe('Resets Fri 12:30 AM')
  expect(resetAt(friday, -480)).toBe('Resets Thu 11:30 PM')
  // Noon and midnight are 12, not 0.
  expect(resetAt(Date.parse('2026-10-18T12:05:00Z'), 0)).toBe('Resets Sun 12:05 PM')
  expect(resetAt(Date.parse('2026-10-19T00:00:00Z'), 0)).toBe('Resets Mon 12:00 AM')
})

test('the local offset is the date\'s own, or nothing when it cannot be told', () => {
  const offset = localOffset(NOW)
  expect(offset === undefined || offset === -new Date(NOW).getTimezoneOffset()).toBe(true)
})

test('the context is kept as tokens, window and percent; what the engine leaves out stays out', () => {
  expect(contextOf({ tokens: 169_700, window: 1_000_000, percent: 17 })).toEqual({ contextTokens: 169_700, contextWindow: 1_000_000, contextPercent: 17 })
  expect(contextOf({ window: 200_000 })).toEqual({ contextTokens: undefined, contextWindow: 200_000, contextPercent: undefined })
})

test('a request from the main chat sets the model and effort; the same request changes nothing', () => {
  const g = { startedAt: 0, limits: [] }
  const next = withRequest(g, 'claude-opus-5-5', 'high')
  expect(next).toEqual({ startedAt: 0, limits: [], model: 'claude-opus-5-5', effort: 'high' })
  expect(g).toEqual({ startedAt: 0, limits: [] })
  expect(withRequest(next, 'claude-opus-5-5', 'high')).toBe(next)
  expect(withRequest(next, 'claude-opus-5-5', 'max')).toMatchObject({ model: 'claude-opus-5-5', effort: 'max' })
  expect(withRequest(next, 'claude-sonnet-5-1', 'high')).toMatchObject({ model: 'claude-sonnet-5-1', effort: 'high' })
})

test('a request that reports no effort, a number or an unknown word keeps the last known effort of the same model; only a new word changes it', () => {
  const g = { startedAt: 0, limits: [], model: 'm', effort: 'high' as const }
  expect(withRequest(g, 'm', 8000)).toBe(g)
  expect(withRequest(g, 'm', undefined)).toBe(g)
  expect(withRequest(g, 'm', 'turbo')).toBe(g)
  expect(withRequest(g, 'm', 'low').effort).toBe('low')
  // The effort is kept only for the model it was reported for: another model with none reported has none shown.
  expect(withRequest(g, 'other', undefined)).toEqual({ startedAt: 0, limits: [], model: 'other', effort: undefined })
  expect(withRequest(g, 'other', 8000)).toEqual({ startedAt: 0, limits: [], model: 'other', effort: undefined })
  expect(withRequest(g, 'other', 'max')).toEqual({ startedAt: 0, limits: [], model: 'other', effort: 'max' })
  // A request with no model named is not a change of model.
  expect(withRequest(g, '', undefined)).toBe(g)
  // Nothing known and nothing reported: no change.
  const empty = { startedAt: 0, limits: [] }
  expect(withRequest(empty, '', undefined)).toBe(empty)
  expect(withRequest(empty, '', 8000)).toBe(empty)
})

test('with no reading at all the button has a dash and the context row says so', () => {
  const view = usageView({ startedAt: 0, limits: [] }, NOW, utc)
  expect(view.button).toBe('Usage –')
  expect(view.rows).toEqual([{ key: 'context', label: 'Context window', detail: 'No reading yet', percent: undefined, value: 0 }])
  expect(view.model).toBeUndefined()
  expect(view.effort).toBeUndefined()
})

test('the context row reads tokens over the window with the percent, and the button agrees', () => {
  const view = usageView({ startedAt: 0, contextPercent: 17, contextTokens: 169_700, contextWindow: 1_000_000, limits: [] }, NOW, utc)
  expect(view.button).toBe('Usage 17%')
  expect(view.rows).toHaveLength(1)
  expect(view.rows[0]).toMatchObject({ key: 'context', label: 'Context window', detail: '169.7k / 1M (17%)', value: 17 })
})

test('a context without tokens still shows its percent', () => {
  const view = usageView({ startedAt: 0, contextPercent: 4, limits: [] }, NOW, utc)
  expect(view.rows[0]).toMatchObject({ detail: '4%', value: 4 })
  expect(view.button).toBe('Usage 4%')
})

test('the limits add a session row and a weekly row, with the button listing all three', () => {
  const view = usageView({
    startedAt: 0, contextPercent: 17, contextTokens: 169_700, contextWindow: 1_000_000,
    limits: [
      { kind: 'five_hour', percentUsed: 44.2, resetsAt: inMs(3 * HOUR + 52 * MIN) },
      { kind: 'seven_day', percentUsed: 75.6, resetsAt: '2026-10-16T07:30:00Z' },
    ],
  }, NOW, utc)
  expect(view.button).toBe('Usage 17% · 44% · 76%')
  expect(view.rows.map(r => r.key)).toEqual(['context', 'session', 'week'])
  expect(view.rows.map(r => r.label)).toEqual(['Context window', 'Session limit', 'Weekly · all models'])
  expect(view.rows[1]).toMatchObject({ detail: 'Resets in 3 hr 52 min', percent: '44%', value: 44.2 })
  expect(view.rows[2]).toMatchObject({ detail: 'Resets Fri 7:30 AM', percent: '76%', value: 75.6 })
})

test('a known zone gives the weekday and time on the weekly row, in each zone', () => {
  const limits = [{ kind: 'seven_day', percentUsed: 76, resetsAt: '2026-10-16T07:30:00Z' }]
  const at = (offset: number) => usageView({ startedAt: 0, limits }, NOW, () => offset).rows[1]!.detail
  expect(at(330)).toBe('Resets Fri 1:00 PM')
  expect(at(-420)).toBe('Resets Fri 12:30 AM')
  expect(at(0)).toBe('Resets Fri 7:30 AM')
})

test('where the zone is unknown the weekly reset reads as time left', () => {
  const limits = [{ kind: 'seven_day', percentUsed: 10, resetsAt: inMs(2 * DAY + 3 * HOUR) }]
  const view = usageView({ startedAt: 0, limits }, NOW, () => undefined)
  expect(view.rows[1]!.detail).toBe('Resets in 51 hr')
})

test('a window already past is hidden; one with no reset time shows without one; other kinds are ignored', () => {
  const view = usageView({
    startedAt: 0, contextPercent: 5, limits: [
      { kind: 'five_hour', percentUsed: 5, resetsAt: inMs(-MIN) },
      { kind: 'seven_day', percentUsed: 9 },
      { kind: 'spend_limit', percentUsed: 5, resetsAt: inMs(HOUR) },
    ],
  }, NOW, utc)
  expect(view.rows.map(r => r.key)).toEqual(['context', 'week'])
  expect(view.rows[1]).toMatchObject({ detail: undefined, percent: '9%' })
  expect(view.button).toBe('Usage 5% · – · 9%')
})

test('the button keeps fixed slots, context then session then weekly, with a dash for one that is missing or hidden', () => {
  const session = { kind: 'five_hour', percentUsed: 44, resetsAt: inMs(HOUR) }
  const week = { kind: 'seven_day', percentUsed: 76, resetsAt: inMs(DAY) }
  expect(usageView({ startedAt: 0, contextPercent: 17, limits: [week] }, NOW, utc).button).toBe('Usage 17% · – · 76%')
  expect(usageView({ startedAt: 0, contextPercent: 17, limits: [session] }, NOW, utc).button).toBe('Usage 17% · 44% · –')
  expect(usageView({ startedAt: 0, limits: [session, week] }, NOW, utc).button).toBe('Usage – · 44% · 76%')
  // No subscription: no limits, and one reading.
  expect(usageView({ startedAt: 0, contextPercent: 17, limits: [] }, NOW, utc).button).toBe('Usage 17%')
  // Every window already past: nothing to show but the context.
  const past = { ...session, resetsAt: inMs(-MIN) }
  expect(usageView({ startedAt: 0, contextPercent: 17, limits: [past, { ...week, resetsAt: inMs(-MIN) }] }, NOW, utc).button).toBe('Usage 17%')
})

test('the button and the rows always agree, and a percent past 100 reads 100; above zero reads at least 1', () => {
  const view = usageView({
    startedAt: 0, contextPercent: 140, limits: [
      { kind: 'five_hour', percentUsed: 0.4, resetsAt: inMs(HOUR) },
      { kind: 'seven_day', percentUsed: 0, resetsAt: inMs(HOUR) },
    ],
  }, NOW, utc)
  expect(view.button).toBe('Usage 100% · 1% · 0%')
  expect(view.rows.map(r => r.percent ?? r.detail)).toEqual(['100%', '1%', '0%'])
})

test('the model and effort are worded for a person; an effort that is not known is left out', () => {
  const view = usageView({ startedAt: 0, limits: [], model: 'claude-opus-5-5', effort: 'high' }, NOW, utc)
  expect([view.model, view.effort]).toEqual(['Opus 5.5', 'High'])
  expect(usageView({ startedAt: 0, limits: [], model: 'claude-opus-5-5' }, NOW, utc).effort).toBeUndefined()
  expect(usageView({ startedAt: 0, limits: [], effort: 'xhigh' }, NOW, utc).effort).toBe('Extra high')
})
