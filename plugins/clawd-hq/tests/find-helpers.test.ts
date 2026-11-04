// find_helpers, the ranking: word overlap between the job and each helper's name and description, with no model call.
import { expect, test } from 'claude-code/testing'
import { MATCHES, jobWords, keywordsOf, rankHelpers } from '../hooks/find-helpers'
import type { Listed } from '../hooks/find-helpers'

const item = (id: string, about: string, over: Partial<Listed> = {}): Listed => ({ id, kind: 'skill', about, status: 'not on team', ...over })

test('the job is cut to plain stems: stop words go, endings are folded, a trailing e does not matter', () => {
  expect([...jobWords('Please help me with the testing of our new designs')].sort()).toEqual(['design', 'test'])
  expect(jobWords('coding the codes')).toEqual(jobWords('code'))
  expect([...jobWords('')]).toEqual([])
  expect([...jobWords('the and of')]).toEqual([])
})

test('a name match counts more than a description match, and a helper that shares no word is left out', () => {
  const list = [
    item('ecc:frontend-design', 'Builds web pages.'),
    item('ecc:research-ops', 'Helps with frontend design reviews.'),
    item('ecc:postgres-patterns', 'Database tuning.'),
  ]
  expect(rankHelpers('design the frontend', list).map(h => h.id)).toEqual(['ecc:frontend-design', 'ecc:research-ops'])
})

test('endings do not hide a match: "testing" finds a tests skill, "reviews" finds a reviewer', () => {
  const list = [item('ecc:tdd-workflow', 'Writes tests first, then the code.'), item('ecc:code-reviewer', 'Reviews code.', { kind: 'agent' })]
  expect(rankHelpers('testing the parser', list).map(h => h.id)).toEqual(['ecc:tdd-workflow'])
  expect(rankHelpers('reviewed my change', list).map(h => h.id)).toEqual(['ecc:code-reviewer'])
})

test('only the top five come back', () => {
  const list = Array.from({ length: 9 }, (_, i) => item(`p:design-${i}`, 'Design help.'))
  expect(MATCHES).toBe(5)
  expect(rankHelpers('design', list)).toHaveLength(5)
})

test('a better fit wins over a status; at the same fit, staff come before not on team before laid off', () => {
  const list = [
    item('a:design-off', 'Design help.', { status: 'laid off' }),
    item('a:design-team', 'Design help.', { status: 'not on team' }),
    item('a:design-staff', 'Design help.', { status: 'staff' }),
    item('a:design-system', 'Design system work for design tokens.', { status: 'laid off' }),
  ]
  expect(rankHelpers('design system', list).map(h => h.id)).toEqual(['a:design-system', 'a:design-staff', 'a:design-team', 'a:design-off'])
})

const CORE_REVIEWER = item('clawd-hq:core-reviewer', 'Reviews the changes, tests and diffs.', { kind: 'agent', status: 'staff' })

test('an installed helper that fills a role ranks above Clawd HQ\'s own one for it, even when that one fits the job better', () => {
  const cover = item('ecc:code-reviewer', 'Reviews code.', { kind: 'agent', covers: 'clawd-hq:core-reviewer' })
  expect(rankHelpers('review the changes, tests and diffs', [CORE_REVIEWER, cover]).map(h => h.id)).toEqual(['ecc:code-reviewer', 'clawd-hq:core-reviewer'])
})

test('with no cover on the team, Clawd HQ\'s own helper ranks by its own fit', () => {
  const laidOff = item('ecc:code-reviewer', 'Reviews code.', { kind: 'agent', status: 'laid off' })
  expect(rankHelpers('review the changes, tests and diffs', [laidOff, CORE_REVIEWER]).map(h => h.id)).toEqual(['clawd-hq:core-reviewer', 'ecc:code-reviewer'])
})

test('a cover that shares no word with the job leaves Clawd HQ\'s own helper ranked by its own fit, in the top five', () => {
  const cover = item('ecc:code-reviewer', 'Reviews code.', { kind: 'agent', covers: 'clawd-hq:core-reviewer' })
  const others = Array.from({ length: 5 }, (_, i) => item(`p:helper-${i}`, 'Reads diffs.'))
  const top = rankHelpers('check the tests and diffs', [cover, ...others, CORE_REVIEWER]).map(h => h.id)
  expect(top[0]).toBe('clawd-hq:core-reviewer')
  expect(top).toHaveLength(MATCHES)
})

test('a cover that fits the job but falls outside the top five does not pull Clawd HQ\'s own helper down', () => {
  const cover = item('ecc:code-reviewer', 'Reviews code.', { kind: 'agent', covers: 'clawd-hq:core-reviewer' })
  const others = Array.from({ length: 4 }, (_, i) => item(`p:test-${i}`, 'Diffs and changes.'))
  const top = rankHelpers('review the changes, tests and diffs', [cover, ...others, CORE_REVIEWER]).map(h => h.id)
  expect(top[0]).toBe('clawd-hq:core-reviewer')
  expect(top).not.toContain('ecc:code-reviewer')
})

test('keywords widen the search: a paraphrased job finds the helper through the field\'s own words', () => {
  const list = [item('emil-design-eng', 'UI polish, layout and CSS details.'), item('ecc:postgres-patterns', 'Database tuning.')]
  expect(rankHelpers('make the settings screen look nicer', list)).toEqual([])
  expect(rankHelpers('make the settings screen look nicer', list, MATCHES, ['UI', 'layout', 'CSS', 'visual']).map(h => h.id)).toEqual(['emil-design-eng'])
  expect(rankHelpers('make the settings screen look nicer', list, MATCHES, [])).toEqual([])
})

test('keywords are cleaned: blanks and non-text are ignored, and only the first twelve count', () => {
  expect(keywordsOf(['  css ', '', '   ', 7, null, 'ui'])).toEqual(['css', 'ui'])
  expect(keywordsOf('css')).toEqual([])
  expect(keywordsOf(undefined)).toEqual([])
  expect(keywordsOf(Array.from({ length: 20 }, (_, i) => `k${i}`))).toHaveLength(12)
})

test('a job with no usable word, or a list with no fit, gives nothing; the list given is not changed', () => {
  const list = [item('a:x', 'Tax forms.')]
  const before = JSON.stringify(list)
  expect(rankHelpers('the and of', list)).toEqual([])
  expect(rankHelpers('a spreadsheet of poems', list)).toEqual([])
  expect(JSON.stringify(list)).toBe(before)
})
