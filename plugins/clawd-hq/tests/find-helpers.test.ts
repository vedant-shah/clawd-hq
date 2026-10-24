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
