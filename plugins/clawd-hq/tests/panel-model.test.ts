import { expect, test } from 'claude-code/testing'
import {
  atWork, buildPeople, newestFirst, recentFailures, canLayOff, dayLabel, doneLine, doneThisSession, filterMemory, groupByDay, pluginOf,
  modelLabel, splitPeople, statusOf, tokensLabel, workLine,
} from '../hooks/panel-model'
import type { Person } from '../hooks/panel-model'
import type { Employee, Memory } from '../types'

const MIN = 60_000
const emp = (over: Partial<Employee>): Employee => ({
  id: 'a1', type: 'ecc:planner', description: 'Plan it', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})
const mem = (over: Partial<Memory>): Memory => ({ id: 'M1', kind: 'decision', text: 'Use Postgres', by: 'CEO', at: 0, source: 'desk', ...over })

test('a specialist stopped on purpose reads as stopped, not failed: calm line, no red, and Clawd does not report it as a failure', () => {
  const stopped = emp({ mood: 'stopped', startedAt: 0, endedAt: 90_000 })
  const failed = emp({ id: 'a2', mood: 'failed', startedAt: 0, endedAt: 90_000 })
  expect(doneLine(stopped, 100_000)).toMatchObject({ isFailed: false, isLost: false })
  expect(doneLine(stopped, 100_000).took).toMatch(/^Stopped after /)
  expect(doneLine(failed, 100_000)).toMatchObject({ isFailed: true })
  expect(recentFailures([stopped, failed], 100_000, 10 * MIN).map(e => e.id)).toEqual(['a2'])
  expect(statusOf(false, 0, recentFailures([stopped], 100_000, 10 * MIN).map(e => e.id))).toEqual({ tone: 'clear', text: 'All clear' })
})

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

test('a model id reads as its family and version, in plain words', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-5-5[1m]')).toBe('Haiku 5.5')
  expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelLabel('claude-opus-4')).toBe('Opus 4')
  expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelLabel('us.anthropic.claude-fable-5-1-v1:0')).toBe('Fable 5.1')
  expect(modelLabel('sonnet')).toBe('Sonnet')
  // An id that is not Claude's is shown as it is, cut if it runs long; none at all shows nothing.
  expect(modelLabel('gpt-x')).toBe('gpt-x')
  expect(modelLabel('m'.repeat(60))!.length).toBeLessThanOrEqual(24)
  // Line breaks and control characters never reach the panel.
  expect(modelLabel('local\n\u001b[31mmodel\tx')).toBe('local [31mmodel x')
  expect(modelLabel('\n\t')).toBeUndefined()
  expect(modelLabel('')).toBeUndefined()
  expect(modelLabel(undefined)).toBeUndefined()
})

test('a specialist at work shows its model ahead of its time and tokens, once the model is known', () => {
  const one = emp({ id: 'a1', startedAt: 0, activity: 'Reading scoring.ts', tokens: 84_000, model: 'claude-sonnet-5-5' })
  expect(workLine(one, 12 * MIN).stats).toBe('· Sonnet 5.5 · 12m · 84K tokens')
  expect(workLine(emp({ startedAt: 0, model: 'claude-haiku-5-5' }), 30_000).stats).toBe('· Haiku 5.5 · 30s')
})

test('a specialist at work shows its effort level right after its model, and none when no effort was recorded', () => {
  const one = emp({ startedAt: 0, tokens: 290_000, model: 'claude-sonnet-5-5', effort: 'high' })
  expect(workLine(one, 17 * MIN).stats).toBe('· Sonnet 5.5 · high · 17m · 290K tokens')
  expect(workLine({ ...one, effort: undefined }, 17 * MIN).stats).toBe('· Sonnet 5.5 · 17m · 290K tokens')
  // Without a known model the level still reads, ahead of the time.
  expect(workLine(emp({ startedAt: 0, effort: 'max' }), 30_000).stats).toBe('· max · 30s')
})

test('a specialist at work shows what it is doing, how long it has been at it and what it has used', () => {
  const one = emp({ id: 'a1', startedAt: 0, activity: 'Reading scoring.ts', tokens: 84_000 })
  expect(workLine(one, 12 * MIN)).toEqual({ said: undefined, sentence: 'Reading scoring.ts', stats: '· 12m · 84K tokens' })
  // Nothing used yet: no tokens in the stats. Nothing seen yet: it is reading the brief.
  expect(workLine(emp({ startedAt: 0 }), 30_000)).toEqual({ said: undefined, sentence: 'Reading the brief', stats: '· 30s' })
})

test('what a specialist says rides on its line', () => {
  const one = emp({ id: 'a1', startedAt: 0, activity: 'Reading scoring.ts', said: 'I will check the scoring rules first.' })
  expect(workLine(one, MIN).said).toBe('I will check the scoring rules first.')
  expect(workLine(emp({ startedAt: 0 }), MIN).said).toBeUndefined()
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

test('Clawd\'s status line says what he is doing and never repeats the at-work count; a failure comes first, and questions are never counted', () => {
  expect(statusOf(false, 0, [])).toEqual({ tone: 'clear', text: 'All clear' })
  expect(statusOf(false, 2, [])).toEqual({ tone: 'clear', text: 'Free' })
  expect(statusOf(true, 1, [])).toEqual({ tone: 'busy', text: 'Working' })
  expect(statusOf(true, 0, [])).toEqual({ tone: 'busy', text: 'Working' })
  expect(statusOf(false, 2, ['Reviewer'])).toEqual({ tone: 'alert', text: 'Reviewer failed' })
  expect(statusOf(true, 0, ['Reviewer', 'Tester'])).toEqual({ tone: 'alert', text: 'Reviewer failed +1' })
  for (const s of [statusOf(false, 3, []), statusOf(true, 3, []), statusOf(false, 3, ['Reviewer'])]) expect(s.text).not.toMatch(/no one|at work|\d/)
  for (const s of [statusOf(false, 0, []), statusOf(true, 3, []), statusOf(false, 1, ['Reviewer'])]) expect(s.text).not.toMatch(/need|waiting|question/i)
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
  expect(filterMemory(list, '  REVIEWER ').map(e => e.id)).toEqual(['M2'])
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
    { type: 'ecc:planner', name: 'Planner', plugin: 'ecc', jobs: 3, blurb: 'Plans work', isOff: false },
    { type: 'legal:review-contract', name: 'Lawyer', plugin: 'legal', jobs: 0, blurb: 'Reads contracts', isOff: true },
  ]
  expect(splitPeople(people, '').team.map(p => p.type)).toEqual(['ecc:planner'])
  expect(splitPeople(people, '').pool.map(p => p.type)).toEqual(['legal:review-contract'])
  expect(splitPeople(people, 'legal').pool).toHaveLength(1)
  expect(splitPeople(people, 'legal').team).toHaveLength(0)
  expect(splitPeople(people, 'contracts').pool).toHaveLength(1)
  expect(splitPeople(people, 'planner').team).toHaveLength(1)
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

test('people are built from the books: a plain role name, the plugin, the hire count and whether they are laid off', () => {
  const people = buildPeople(['ecc:planner', 'Explore', 'ecc:planner'], { 'ecc:planner': 'Plans work' }, { 'ecc:planner': { jobs: 4 } }, ['Explore'])
  expect(people).toHaveLength(2)
  const pip = people.find(p => p.type === 'ecc:planner')!
  expect(pip).toMatchObject({ name: 'Planner', plugin: 'ecc', jobs: 4, blurb: 'Plans work', isOff: false })
  expect(people.find(p => p.type === 'Explore')).toMatchObject({ plugin: 'built in', jobs: 0, isOff: true })
})

test('the memory search matches a note\'s role, not an old made-up name', () => {
  const list = [mem({ id: 'M1', text: 'Use Postgres', kind: 'choice', by: 'Taro the Tester' }), mem({ id: 'M2', text: 'Quiet mode', kind: 'choice', by: 'Reviewer' })]
  expect(filterMemory(list, 'tester').map(m => m.id)).toEqual(['M1'])
  expect(filterMemory(list, 'taro')).toEqual([])
  expect(filterMemory(list, 'reviewer').map(m => m.id)).toEqual(['M2'])
})

test('two types with the same role are told apart on the People tab by their type; a role held by one stands alone', () => {
  const people = buildPeople(['acme:foo', 'acme:bar', 'ecc:planner'], {}, {}, [])
  const names = people.map(p => p.name)
  expect(names).toContain('Planner')
  expect(names).toContain('Generalist (foo)')
  expect(names).toContain('Generalist (bar)')
})
