import { expect, test } from 'claude-code/testing'
import type { ProjectFacts } from '../hooks/onboard-types'
import { firstJob } from '../hooks/first-job'

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  tells: [], fileTypes: { '.ts': 20 }, outline: ['src/', 'package.json'], deps: ['typescript'], readmeHead: '# App', instructions: '', codeFiles: 20, ...over,
})

test('code with no tests found suggests setting up tests', () => {
  expect(firstJob(facts())).toBe('Set up tests for this project')
})

test('a tests folder, a test file or a test tool in the manifests counts as tests', () => {
  expect(firstJob(facts({ outline: ['src/', 'tests/'] }))).toBe('Give me a tour of this project and its weak spots')
  expect(firstJob(facts({ outline: ['src/', 'src/app.test.ts'] }))).toBe('Give me a tour of this project and its weak spots')
  expect(firstJob(facts({ outline: ['pkg/', 'pkg/test_app.py'] }))).toBe('Give me a tour of this project and its weak spots')
  expect(firstJob(facts({ deps: ['vitest'] }))).toBe('Give me a tour of this project and its weak spots')
  expect(firstJob(facts({ deps: ['pytest'] }))).toBe('Give me a tour of this project and its weak spots')
})

test('a project with tests but no README suggests writing one', () => {
  expect(firstJob(facts({ outline: ['tests/'], readmeHead: '' }))).toBe('Write a README')
})

test('tests come before the README when both are missing', () => {
  expect(firstJob(facts({ readmeHead: '' }))).toBe('Set up tests for this project')
})

test('a folder with no code is not asked to have tests', () => {
  expect(firstJob(facts({ codeFiles: 0, fileTypes: { '.md': 9 } }))).toBe('Give me a tour of this project and its weak spots')
  expect(firstJob(facts({ codeFiles: 0, readmeHead: '' }))).toBe('Write a README')
})

test('the same facts always give the same suggestion', () => {
  const f = facts()
  expect(firstJob(f)).toBe(firstJob(f))
})
