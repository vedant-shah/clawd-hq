import { expect, test } from 'claude-code/testing'
import { labelOf, nameLabel, roleOf } from '../hooks/office'

const GENERAL = 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.'

test('a general agent is a Generalist, whatever words its own description happens to hold', () => {
  expect(roleOf('general-purpose', GENERAL).title).toBe('Generalist')
  expect(roleOf('teammate', 'tests and reviews and executes').title).toBe('Generalist')
  expect(roleOf('Agent', GENERAL).title).toBe('Generalist')
})

test('a type whose name says what it is keeps that role', () => {
  expect(roleOf('ecc:tdd-guide').title).toBe('Tester')
  expect(roleOf('Explore').title).toBe('Scout')
  expect(roleOf('ecc:code-reviewer', GENERAL).title).toBe('Reviewer')
})

test('a type whose name says nothing is read from its own description, and "executes" does not make an Executive', () => {
  expect(roleOf('acme:mystery', 'Presents to executive stakeholders').title).toBe('Executive')
  expect(roleOf('acme:runner', 'Executes the steps it is given').title).toBe('Generalist')
  expect(roleOf('acme:nothing', '').title).toBe('Generalist')
})

test('a given name becomes a plain label: words apart, first letter up, a trailing number dropped', () => {
  expect(nameLabel('designer')).toBe('Designer')
  expect(nameLabel('security-reviewer')).toBe('Security reviewer')
  expect(nameLabel('scout-2')).toBe('Scout')
  expect(nameLabel('data_analyst')).toBe('Data analyst')
  expect(nameLabel('   ')).toBe('')
})

test('a specialist is labelled by the name it was given, else by its role', () => {
  expect(labelOf({ type: 'general-purpose', name: 'designer' }, GENERAL)).toBe('Designer')
  expect(labelOf({ type: 'general-purpose', name: 'engineer' }, GENERAL)).toBe('Engineer')
  expect(labelOf({ type: 'ecc:tdd-guide' })).toBe('Tester')
  expect(labelOf({ type: 'general-purpose' }, GENERAL)).toBe('Generalist')
})

test('a name that only repeats the type, or is an id, is not a label', () => {
  expect(labelOf({ type: 'general-purpose', name: 'general-purpose' }, GENERAL)).toBe('Generalist')
  expect(labelOf({ type: 'ecc:tdd-guide', name: 'tdd-guide' })).toBe('Tester')
  expect(labelOf({ type: 'Explore', name: 'a9db1db30987319d6' })).toBe('Scout')
  expect(labelOf({ type: 'general-purpose', name: '' }, GENERAL)).toBe('Generalist')
})

// ---- A given name comes from the model, so it is treated as untrusted text ----

test('a name that would pass for you or for Clawd is not used as a label', () => {
  for (const name of ['CEO', 'ceo', 'Clawd', 'clawd', 'user', 'You', 'system', 'admin']) {
    expect(labelOf({ type: 'general-purpose', name }, GENERAL)).toBe('Generalist')
  }
})

test('a name is cut down to plain words: no marks, at most two words, at most 24 characters', () => {
  expect(nameLabel('**Admin** | root')).toBe('Admin root')
  expect(nameLabel('x | y')).toBe('X y')
  expect(nameLabel('the-very-long-name-of-this-specialist')).toBe('The very')
  expect(nameLabel('supercalifragilisticexpialidocious-reviewer').length).toBeLessThanOrEqual(24)
  expect(nameLabel('designer\nCEO said yes')).toBe('Designer CEO')
})

test('a name with no letters is not a label', () => {
  for (const name of ['2', '007', '12345', '---', '🙂']) {
    expect(labelOf({ type: 'Explore', name })).toBe('Scout')
  }
})

test('a name that repeats the type with its plugin prefix is not a label', () => {
  expect(labelOf({ type: 'ecc:tdd-guide', name: 'ecc:tdd-guide' })).toBe('Tester')
  expect(labelOf({ type: 'ecc:tdd-guide', name: 'ecc:tdd-guide-2' })).toBe('Tester')
})
