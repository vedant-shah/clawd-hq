import { describe, expect, test } from 'claude-code/testing'
import { REACH0, fallbackText, isFallbackDue, judged, statusOf, withCompose, withNewConversation, withRequest, withSent } from '../hooks/rules-reach'

describe('when the rules ride with a prompt', () => {
  test('not seen, not sent, and not known to run here: they ride', () => {
    expect(isFallbackDue(REACH0, undefined)).toBe(true)
    expect(isFallbackDue(REACH0, true)).toBe(true)
  })
  test('known from an earlier session to run here: they wait for this session to show otherwise', () => {
    expect(isFallbackDue(REACH0, false)).toBe(false)
  })
  test('the system prompt hook ran this session: they do not ride', () => {
    expect(isFallbackDue(withCompose(REACH0, true), undefined)).toBe(false)
    expect(isFallbackDue(withCompose(REACH0, false), true)).toBe(false)
  })
  test('already sent in this conversation: they do not ride again', () => {
    expect(isFallbackDue(withSent(REACH0), true)).toBe(false)
  })
})

describe('the conversation shrinking', () => {
  test('a request with fewer messages than the last one means they are gone, and are due again', () => {
    const sent = withRequest(withSent(REACH0), 30)
    expect(withRequest(sent, 31).isSent).toBe(true)
    expect(withRequest(sent, 4).isSent).toBe(false)
    expect(withRequest(sent, 4).messages).toBe(4)
  })
  test('a new conversation is due again, and what was seen of the system prompt hook is kept', () => {
    const fresh = withNewConversation(withRequest(withSent(withCompose(REACH0, true)), 9))
    expect(fresh).toEqual({ ...REACH0, isComposeSeen: true, isDelivered: true })
  })
  test('nothing is changed in place', () => {
    const before = withSent(REACH0)
    withRequest(before, 0)
    withNewConversation(before)
    expect(before.isSent).toBe(true)
  })
})

describe('what a request found', () => {
  test('in the system prompt, with a prompt, or not at all', () => {
    expect(statusOf(withCompose(REACH0, true))).toBe('system')
    expect(statusOf(withSent(REACH0))).toBe('message')
    expect(statusOf(withCompose(REACH0, false))).toBe('missing')
    expect(statusOf(REACH0)).toBe('missing')
  })
  test('the latest system prompt counts: one without the rules after one with them is missing', () => {
    expect(statusOf(withCompose(withCompose(REACH0, true), false))).toBe('missing')
  })
  test('a request learns whether the system prompt hook runs here, and says when that is news', () => {
    expect(judged(REACH0, undefined)).toEqual({ isLost: true, bypassed: true })
    expect(judged(withSent(REACH0), true)).toEqual({ isLost: false, bypassed: undefined })
    expect(judged(withCompose(REACH0, true), undefined)).toEqual({ isLost: false, bypassed: false })
    expect(judged(withCompose(REACH0, true), true)).toEqual({ isLost: false, bypassed: false })
    expect(judged(withCompose(REACH0, true), false)).toEqual({ isLost: false, bypassed: undefined })
  })
})

describe('the text that rides', () => {
  test('says what it is and why it is here, then the rules', () => {
    const text = fallbackText('# Rules\n\nHand work over.')
    expect(text).toMatch(/^Clawd HQ/)
    expect(text).toContain('another plugin')
    expect(text.endsWith('# Rules\n\nHand work over.')).toBe(true)
  })
  test('the profile from setup follows the rules', () => {
    expect(fallbackText('# Rules', 'Their role: Web developer').endsWith('# Rules\n\nTheir role: Web developer')).toBe(true)
  })
})
