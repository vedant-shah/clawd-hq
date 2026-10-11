import { expect, test } from 'claude-code/testing'
import {
  atWork, buildPeople, newestFirst, recentFailures, canLayOff, dayLabel, doneLine, doneThisSession, filterMemory, firstName, groupByDay, pluginOf,
  seeNeedsLabel, splitPeople, statusOf, tokensLabel, waitingSummary, workLine,
} from '../hooks/panel-model'
import type { Person } from '../hooks/panel-model'
import type { Ask, Employee, Memory } from '../types'

const MIN = 60_000
const emp = (over: Partial<Employee>): Employee => ({
  id: 'a1', type: 'ecc:planner', description: 'Plan it', prompt: '', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})
const ask = (over: Partial<Ask>): Ask => ({
  id: 'D1', kind: 'decision', title: 'OK?', options: [], from: 'Sage the Guard', source: 'tool', status: 'open', askedAt: 0, isDelivered: false, ...over,
})
const mem = (over: Partial<Memory>): Memory => ({ id: 'M1', kind: 'decision', text: 'Use Postgres', by: 'CEO', at: 0, source: 'desk', ...over })

test('tokens read as 850, 22K or 1.2M', () => {
  expect(tokensLabel(850)).toBe('850')
  expect(tokensLabel(22_400)).toBe('22K')
  expect(tokensLabel(1_250_000)).toBe('1.3M')
  expect(tokensLabel(undefined)).toBe('0')
})

test('at work lists active specialists only; arriving, working and thinking all count', () => {
  const list = [emp({ id: 'a', mood: 'arriving' }), emp({ id: 'b', mood: 'thinking' }), emp({ id: 'c', mood: 'done', endedAt: 5 }), emp({ id: 'd', mood: 'failed', endedAt: 5 })]
  expect(atWork(list).map(e => e.id)).toEqual(['a', 'b'])
})

test('done this session keeps only those that finished since the session began, newest first', () => {
  const list = [
    emp({ id: 'old', mood: 'done', endedAt: 100 }),
    emp({ id: 'one', mood: 'done', endedAt: 500 }),
    emp({ id: 'two', mood: 'failed', endedAt: 900 }),
    emp({ id: 'busy', mood: 'working' }),
    emp({ id: 'noend', mood: 'done' }),
  ]
  expect(doneThisSession(list, 400).map(e => e.id)).toEqual(['two', 'one'])
  expect(doneThisSession(list, 0).map(e => e.id)).toEqual(['two', 'one', 'old'])
  // Nothing was mutated.
  expect(list.map(e => e.id)).toEqual(['old', 'one', 'two', 'busy', 'noend'])
})

test('a specialist at work shows what it is doing, how long it has been at it and what it has used', () => {
  const one = emp({ id: 'a1', startedAt: 0, activity: 'Reading scoring.ts', tokens: 84_000 })
  expect(workLine(one, [], 12 * MIN)).toEqual({ isWaiting: false, sentence: 'Reading scoring.ts', stats: '· 12m · 84K tokens' })
  // Nothing used yet: no tokens in the stats. Nothing seen yet: it is reading the brief.
  expect(workLine(emp({ startedAt: 0 }), [], 30_000)).toEqual({ isWaiting: false, sentence: 'Reading the brief', stats: '· 30s' })
})

test('what a specialist says rides on its line, and waiting on you hides it', () => {
  const one = emp({ id: 'a1', startedAt: 0, activity: 'Reading scoring.ts', said: 'I will check the scoring rules first.' })
  expect(workLine(one, [], MIN).said).toBe('I will check the scoring rules first.')
  expect(workLine(emp({ startedAt: 0 }), [], MIN).said).toBeUndefined()
  expect(workLine(one, [ask({ fromId: 'a1' })], MIN).said).toBeUndefined()
})

test('a specialist with a question waiting on the desk is waiting on you, named by the oldest question', () => {
  const one = emp({ id: 'a1', startedAt: 0, activity: 'Reading scoring.ts', tokens: 1_500 })
  const asks = [
    ask({ id: 'D2', title: 'Newer question?', fromId: 'a1', askedAt: 3 * MIN }),
    ask({ id: 'D1', title: 'Store scores in DynamoDB or Postgres?', fromId: 'a1', askedAt: 2 * MIN }),
    ask({ id: 'D3', title: 'Not mine?', fromId: 'zz', askedAt: 0 }),
  ]
  expect(workLine(one, asks, 4 * MIN)).toEqual({ isWaiting: true, sentence: 'Waiting on you: Store scores in DynamoDB or Postgres?', stats: '· 4m · 2K tokens' })
  // An answered question no longer holds it up.
  expect(workLine(one, [ask({ fromId: 'a1', status: 'answered' })], 4 * MIN).isWaiting).toBe(false)
  // A long question is kept as the specialist wrote it; the pane wraps it.
  const long = workLine(one, [ask({ title: 'Should we '.repeat(30), fromId: 'a1' })], 4 * MIN).sentence
  expect(long.startsWith('Waiting on you: Should we')).toBe(true)
  expect(long).not.toMatch(/…/)
})

test('a finished row says when, how long it took and the tokens; a failure says so', () => {
  const done = emp({ mood: 'done', startedAt: 0, endedAt: 3 * MIN, tokens: 22_000 })
  expect(doneLine(done, 9 * MIN)).toEqual({ when: '6m ago', took: 'took 3m · 22K tokens', isFailed: false, isLost: false })
  const failed = emp({ mood: 'failed', startedAt: 0, endedAt: 3 * MIN })
  expect(doneLine(failed, 9 * MIN)).toEqual({ when: '6m ago', took: 'Failed after 3m', isFailed: true, isLost: false })
  // Lost contact is a third outcome: how long it was silent, not how long the run lasted.
  const lost = emp({ mood: 'lost', startedAt: 0, lastSeen: 2 * MIN, endedAt: 33 * MIN })
  expect(doneLine(lost, 40 * MIN)).toEqual({ when: '7m ago', took: 'Lost contact after 31m', isFailed: false, isLost: true })
  expect(recentFailures([lost], 40 * MIN, 60 * MIN)).toEqual([])
  expect(doneThisSession([lost], 0)).toEqual([lost])
})

test('Clawd says "All clear", or how many need the CEO, or who failed', () => {
  expect(statusOf(0, [])).toEqual({ isClear: true, text: 'All clear' })
  expect(statusOf(1, [])).toEqual({ isClear: false, text: '1 needs you' })
  expect(statusOf(2, [])).toEqual({ isClear: false, text: '2 need you' })
  expect(statusOf(0, ['Rex'])).toEqual({ isClear: false, text: 'Rex failed' })
  expect(statusOf(0, ['Rex', 'Pip'])).toEqual({ isClear: false, text: 'Rex failed +1' })
  expect(statusOf(1, ['Rex'])).toEqual({ isClear: false, text: '1 needs you · Rex failed' })
})

test('the button names who is waiting', () => {
  expect(firstName('Sage the Guard')).toBe('Sage')
  expect(firstName('Clawd')).toBe('Clawd')
  expect(firstName('Bean 71 the Writer')).toBe('Bean 71')
  expect(seeNeedsLabel([ask({}), ask({ id: 'D2' })])).toBe('See what Sage needs')
  expect(seeNeedsLabel([ask({}), ask({ id: 'D2', from: 'Rex the Reviewer' })])).toBe('See what Sage and Rex need')
  expect(seeNeedsLabel([ask({}), ask({ from: 'Rex the Reviewer' }), ask({ from: 'Pip the Planner' })])).toBe('See what 3 people need')
})

test('a day reads as OCTOBER 10, with the year only when it is not this one', () => {
  const noon = new Date(2026, 9, 10, 12).getTime()
  expect(dayLabel(noon, new Date(2026, 9, 11, 9).getTime())).toBe('OCTOBER 10')
  expect(dayLabel(noon, new Date(2027, 0, 2, 9).getTime())).toBe('OCTOBER 10, 2026')
})

test('decisions group by day, newest first, and keep both kinds', () => {
  const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime()
  const list = [mem({ id: 'M1', at: at(8, 9) }), mem({ id: 'M2', at: at(10, 9), kind: 'choice', by: 'Rex the Reviewer' }), mem({ id: 'M3', at: at(10, 15) })]
  const groups = groupByDay(list, at(11, 9))
  expect(groups.map(g => g.label)).toEqual(['OCTOBER 10', 'OCTOBER 8'])
  expect(groups[0]!.entries.map(e => e.id)).toEqual(['M3', 'M2'])
  expect(list.map(e => e.id)).toEqual(['M1', 'M2', 'M3'])
})

test('the filter matches the text or who said it, ignoring case and blanks', () => {
  const list = [mem({ id: 'M1', text: 'Use Postgres' }), mem({ id: 'M2', text: 'Quiet mode', kind: 'choice', by: 'Rex the Reviewer' })]
  expect(filterMemory(list, 'postgres').map(e => e.id)).toEqual(['M1'])
  expect(filterMemory(list, '  REX ').map(e => e.id)).toEqual(['M2'])
  expect(filterMemory(list, '   ')).toHaveLength(2)
  expect(filterMemory(list, 'zzz')).toHaveLength(0)
})

test('a type shows its plugin, and only plugin types can be laid off', () => {
  expect(pluginOf('ecc:planner')).toBe('ecc')
  expect(pluginOf('Explore')).toBe('built in')
  expect(canLayOff('ecc:planner')).toBe(true)
  expect(canLayOff('general-purpose')).toBe(false)
})

test('people split into team and talent pool, and the search covers name, plugin and blurb', () => {
  const people: Person[] = [
    { type: 'ecc:planner', name: 'Pip the Planner', plugin: 'ecc', jobs: 3, blurb: 'Plans work', isOff: false },
    { type: 'legal:review-contract', name: 'Lex the Lawyer', plugin: 'legal', jobs: 0, blurb: 'Reads contracts', isOff: true },
  ]
  expect(splitPeople(people, '').team.map(p => p.type)).toEqual(['ecc:planner'])
  expect(splitPeople(people, '').pool.map(p => p.type)).toEqual(['legal:review-contract'])
  expect(splitPeople(people, 'legal').pool).toHaveLength(1)
  expect(splitPeople(people, 'legal').team).toHaveLength(0)
  expect(splitPeople(people, 'contracts').pool).toHaveLength(1)
  expect(splitPeople(people, 'pip').team).toHaveLength(1)
})

test('recent failures are real specialists that failed lately, newest first', () => {
  const list = [
    emp({ id: 'a', mood: 'failed', endedAt: 100 }), emp({ id: 'b', mood: 'failed', endedAt: 900 }),
    emp({ id: 'demo-x', mood: 'failed', endedAt: 950 }), emp({ id: 'old', mood: 'failed', endedAt: 1 }), emp({ id: 'ok', mood: 'done', endedAt: 990 }),
  ]
  expect(recentFailures(list, 1000, 500).map(e => e.id)).toEqual(['b'])
  expect(recentFailures(list, 1000, 950).map(e => e.id)).toEqual(['b', 'a'])
})

test('decisions made in the same instant come newest id first', () => {
  const list = [mem({ id: 'M2', at: 5 }), mem({ id: 'M10', at: 5 }), mem({ id: 'M3', at: 5 })]
  expect(newestFirst(list, 3).map(m => m.id)).toEqual(['M10', 'M3', 'M2'])
  expect(groupByDay(list, 5)[0]!.entries.map(m => m.id)).toEqual(['M10', 'M3', 'M2'])
})

test('the newest decisions come first and are cut to the limit', () => {
  const list = [mem({ id: 'M1', at: 1 }), mem({ id: 'M2', at: 3 }), mem({ id: 'M3', at: 2 })]
  expect(newestFirst(list, 2).map(m => m.id)).toEqual(['M2', 'M3'])
  expect(newestFirst(list, 10)).toHaveLength(3)
})

test('people are built from the books: a name, the plugin, the hire count and whether they are laid off', () => {
  const people = buildPeople(['ecc:planner', 'Explore', 'ecc:planner'], { 'ecc:planner': 'Plans work' }, { 'ecc:planner': { name: 'Pip', jobs: 4 } }, ['Explore'])
  expect(people).toHaveLength(2)
  const pip = people.find(p => p.type === 'ecc:planner')!
  expect(pip).toMatchObject({ name: 'Pip the Planner', plugin: 'ecc', jobs: 4, blurb: 'Plans work', isOff: false })
  expect(people.find(p => p.type === 'Explore')).toMatchObject({ plugin: 'built in', jobs: 0, isOff: true })
})

test('the band above the prompt counts decisions and questions, each only when there are some', () => {
  const [d1, d2, q1] = [ask({ id: 'D1' }), ask({ id: 'D2' }), ask({ id: 'Q1', kind: 'question' })]
  expect(waitingSummary([d1!])).toBe('1 decision')
  expect(waitingSummary([d1!, d2!, q1!])).toBe('2 decisions · 1 question')
  expect(waitingSummary([q1!])).toBe('1 question')
  expect(waitingSummary([])).toBe('')
})
