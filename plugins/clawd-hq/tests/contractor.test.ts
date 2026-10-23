// Contractors, the pure parts: the agent type a skill is hired under, how a role is cleaned, and the offer to make one staff.
import { expect, test } from 'claude-code/testing'
import { contractorName, contractorType, isContractorType, roleFromBlurb } from '../hooks/contractor-name'
import { offerText, parseContractor, withOffer, withoutOffer } from '../hooks/contractor'
import { labelOf, typeTag } from '../hooks/office'
import { tagged } from '../hooks/panel-model'
import type { Employee } from '../types'

test('a skill is hired under a safe agent name made from its whole id, at most 64 characters', () => {
  expect(contractorName('ecc:frontend-design')).toBe('contractor-ecc-frontend-design')
  expect(contractorName('pitch deck!')).toBe('contractor-pitch-deck')
  expect(contractorName('a'.repeat(100))).toMatch(/^contractor-a+$/)
  expect(contractorName('a'.repeat(100)).length).toBeLessThanOrEqual(64)
  expect(contractorName('ecc:frontend-design')).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  expect(contractorType('ecc:frontend-design')).toBe('clawd-hq:contractor-ecc-frontend-design')
  // Two skills that share a short name stay two agents.
  expect(contractorName('a:planner')).not.toBe(contractorName('b:planner'))
})

test('only this plugin\'s contractor types are contractors', () => {
  expect(isContractorType('clawd-hq:contractor-ecc-frontend-design')).toBe(true)
  expect(isContractorType('clawd-hq:core-builder')).toBe(false)
  expect(isContractorType('other:contractor-x')).toBe(false)
  expect(isContractorType('general-purpose')).toBe(false)
})

test('the role is the words before the first colon of the registered description', () => {
  expect(roleFromBlurb('Designer: Makes pages look right.')).toBe('Designer')
  expect(roleFromBlurb('No colon here')).toBe('')
})

test('a contractor reads as its role, with Contractor as the dim second part, whether or not it was given a name', () => {
  const type = 'clawd-hq:contractor-ecc-frontend-design'
  const blurb = 'Designer: Makes pages look right.'
  expect(labelOf({ type }, blurb)).toBe('Designer')
  expect(labelOf({ type, name: 'ui-designer' }, blurb)).toBe('Ui designer')
  expect(typeTag({ type }, blurb)).toBe('Contractor')
  expect(typeTag({ type, name: 'designer' }, blurb)).toBe('Contractor')
  // A role with no usable words falls back to the general label.
  expect(labelOf({ type: 'clawd-hq:contractor-zzz' }, 'no colon')).toBe('Generalist')
})

test('the card tag carries the visitor badge for a contractor and nothing extra for anyone else', () => {
  const one = (type: string, name?: string): Employee => ({ id: 'x', type, description: 'd', name, mood: 'working', tools: 0, startedAt: 0, joinedTick: 0 })
  const data = { blurbs: { 'clawd-hq:contractor-s': 'Designer: Makes pages.' } }
  expect(tagged(one('clawd-hq:contractor-s', 'designer'), data)).toBe(' · 🪪 Contractor')
  expect(tagged(one('clawd-hq:core-builder', 'debugger'), data)).toBe(' · Builder')
  expect(tagged(one('general-purpose'), data)).toBeUndefined()
})

test('the call is read as an exact skill and a short role; anything else is refused with why', () => {
  expect(parseContractor({ skill: 'ecc:frontend-design', role: 'Designer' })).toEqual({ skill: 'ecc:frontend-design', role: 'Designer' })
  expect(parseContractor({ skill: '  pitch-deck ', role: '  Deck   maker ' })).toEqual({ skill: 'pitch-deck', role: 'Deck maker' })
  for (const input of [{}, { skill: 'x' }, { role: 'Designer' }, { skill: 7, role: 'Designer' }, { skill: 'x', role: 7 }, { skill: '', role: 'D' }, { skill: 'x', role: '  ' }, { skill: 'x', role: '123' }]) {
    expect(parseContractor(input)).toHaveProperty('error')
  }
  expect(parseContractor({ skill: 'x', role: 'a'.repeat(31) })).toHaveProperty('error')
  expect(JSON.stringify(parseContractor({ skill: 'x', role: 'Role: sneaky' }))).not.toContain('error')
  // A role is one plain line: a colon would move where the description is cut, and line breaks are not allowed.
  expect(parseContractor({ skill: 'x', role: 'Role: sneaky\nnew line' })).toEqual({ skill: 'x', role: 'Role sneaky new line' })
})

test('the offer says how often the contractor has worked here, and offers go in and out of the list', () => {
  expect(offerText('Designer', 2)).toBe('Designer has worked here twice. Make them staff?')
  expect(offerText('Designer', 3)).toBe('Designer has worked here 3 times. Make them staff?')
  const first = { id: 'a:one', role: 'Designer', times: 2 }
  const list = withOffer([], first)
  expect(list).toEqual([first])
  // The same skill again replaces its card; another skill adds one.
  expect(withOffer(list, { ...first, times: 3 })).toEqual([{ ...first, times: 3 }])
  expect(withOffer(list, { id: 'b:two', role: 'Writer', times: 2 }).map(o => o.id)).toEqual(['b:two', 'a:one'])
  expect(withoutOffer(list, 'a:one')).toEqual([])
  expect(list).toEqual([first])
})
