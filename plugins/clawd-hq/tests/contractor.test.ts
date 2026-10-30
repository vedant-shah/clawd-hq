// Contractors, the pure parts: the agent type every contractor is hired under, how a role is cleaned, and the offer to make one staff.
import { expect, test } from 'claude-code/testing'
import { CONTRACTOR_TYPE, isContractorType } from '../hooks/contractor-name'
import { offerText, parseContractor, withOffer, withoutOffer } from '../hooks/contractor'
import { labelOf, typeTag } from '../hooks/office'
import { tagged } from '../hooks/panel-model'
import type { Employee } from '../types'

/** What the shipped agent file says it is for (agents/contractor.md). */
const BLURB = 'Clawd HQ\'s contractor, hired for one job. Hire it only as the hire_contractor tool says, with the line it gives at the top of the brief.'

test('every contractor is hired as the one agent the plugin ships, which the Agent tool knows from the start', () => {
  expect(CONTRACTOR_TYPE).toBe('clawd-hq:contractor')
})

test('only this plugin\'s contractor type is a contractor', () => {
  expect(isContractorType(CONTRACTOR_TYPE)).toBe(true)
  expect(isContractorType('clawd-hq:core-builder')).toBe(false)
  expect(isContractorType('other:contractor')).toBe(false)
  expect(isContractorType('general-purpose')).toBe(false)
})

test('a contractor reads as the role it was given as its name, with Contractor as the dim second part', () => {
  expect(labelOf({ type: CONTRACTOR_TYPE, name: 'ui-designer' }, BLURB)).toBe('Ui designer')
  expect(typeTag({ type: CONTRACTOR_TYPE }, BLURB)).toBe('Contractor')
  expect(typeTag({ type: CONTRACTOR_TYPE, name: 'designer' }, BLURB)).toBe('Contractor')
  // With no name, the general label.
  expect(labelOf({ type: CONTRACTOR_TYPE }, BLURB)).toBe('Generalist')
})

test('the card tag carries the visitor badge for a contractor and nothing extra for anyone else', () => {
  const one = (type: string, name?: string): Employee => ({ id: 'x', type, description: 'd', name, mood: 'working', tools: 0, startedAt: 0, joinedTick: 0 })
  const data = { blurbs: { [CONTRACTOR_TYPE]: BLURB } }
  expect(tagged(one(CONTRACTOR_TYPE, 'designer'), data)).toBe(' · 🪪 Contractor')
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
