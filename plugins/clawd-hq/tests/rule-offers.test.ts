import { expect, test } from 'claude-code/testing'
import { MAX_OFFERS, MAX_RULE, parseRule, ruleLine, withOffer, withProblem, withoutOffer } from '../hooks/rule-offers'

// The "Add to CLAUDE.md" offers, pure: what a rule may say, and how the list of offers changes.

test('a rule is made one plain line: hidden marks and line breaks go, a leading bullet goes, spaces collapse', () => {
  expect(parseRule({ rule: '  Always run the tests\n before a commit  ' })).toEqual({ rule: 'Always run the tests before a commit' })
  expect(parseRule({ rule: '- Never push without asking' })).toEqual({ rule: 'Never push without asking' })
  expect(parseRule({ rule: '* Never push without asking' })).toEqual({ rule: 'Never push without asking' })
  expect(parseRule({ rule: 'Use​ tabs‮\u{e0041} only' })).toEqual({ rule: 'Use tabs only' })
  expect(parseRule({ rule: 'Line one\u0000\u0007 two' })).toEqual({ rule: 'Line one two' })
})

test('an empty rule, one that is not text, or one that is too long is refused with a plain reason, and never cut', () => {
  for (const rule of ['', '   ', '\n​', '- ', undefined, 7, null]) expect(parseRule({ rule })).toHaveProperty('error')
  const edge = 'a'.repeat(MAX_RULE)
  expect(parseRule({ rule: edge })).toEqual({ rule: edge })
  const over = parseRule({ rule: 'a'.repeat(MAX_RULE + 1) })
  expect(over).toHaveProperty('error')
  expect((over as { error: string }).error).toContain(String(MAX_RULE))
  expect(parseRule({})).toHaveProperty('error')
})

test('the length is counted in whole characters, so an emoji is one', () => {
  const rule = '🦀'.repeat(MAX_RULE)
  expect(parseRule({ rule })).toEqual({ rule })
  expect(parseRule({ rule: `${rule}🦀` })).toHaveProperty('error')
})

test('the line written to CLAUDE.md is the rule as a bullet', () => {
  expect(ruleLine('Always run the tests')).toBe('- Always run the tests')
})

test('an offer goes on top; the same rule again (any case or spacing) is one offer, moved to the top and cleared of its problem', () => {
  const one = withOffer([], 'Always run the tests', 100)
  expect(one).toHaveLength(1)
  expect(one[0]).toMatchObject({ text: 'Always run the tests', at: 100 })
  const two = withOffer(one, 'Never use tabs', 200)
  expect(two.map(o => o.text)).toEqual(['Never use tabs', 'Always run the tests'])
  const failed = withProblem(two, two[1]!.id, 'No room on the disk.')
  const again = withOffer(failed, 'always run the TESTS', 300)
  expect(again.map(o => o.text)).toEqual(['always run the TESTS', 'Never use tabs'])
  expect(again).toHaveLength(2)
  expect(again[0]!.at).toBe(300)
  expect(again[0]!.problem).toBeUndefined()
})

test('only the newest ten offers are kept', () => {
  let list = withOffer([], 'rule 0', 0)
  for (let i = 1; i <= MAX_OFFERS + 4; i += 1) list = withOffer(list, `rule ${i}`, i)
  expect(list).toHaveLength(MAX_OFFERS)
  expect(list[0]!.text).toBe(`rule ${MAX_OFFERS + 4}`)
  expect(list.some(o => o.text === 'rule 0')).toBe(false)
})

test('an offer is taken away by its id, and a problem is put on one offer only', () => {
  const list = withOffer(withOffer([], 'First', 1), 'Second', 2)
  const [second, first] = list
  expect(withoutOffer(list, first!.id).map(o => o.text)).toEqual(['Second'])
  expect(withoutOffer(list, 'nope')).toEqual(list)
  const bad = withProblem(list, second!.id, 'Could not write.')
  expect(bad[0]!.problem).toBe('Could not write.')
  expect(bad[1]!.problem).toBeUndefined()
  // The list given in is never changed.
  expect(list[0]!.problem).toBeUndefined()
})
