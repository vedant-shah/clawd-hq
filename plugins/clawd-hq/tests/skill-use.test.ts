// skill-use: whether a skill adds knowledge a model may lack, or only a way of working it already follows.
import { expect, test } from 'claude-code/testing'
import { useOf } from '../hooks/skill-use'

test('a way of working is process: test-first, review, planning, verification, workflows, checkpoints, commits', () => {
  for (const id of ['ecc:tdd-workflow', 'ecc:verification-loop', 'ecc:code-review', 'ecc:plan', 'ecc:checkpoint', 'ecc:git-workflow', 'ecc:django-tdd', 'ecc:quality-gate']) {
    expect(useOf(id, 'Some description.')).toBe('process')
  }
})

test('a skill whose description says it enforces test-driven work is process, whatever its name', () => {
  expect(useOf('ecc:go-test', 'Enforce TDD workflow for Go. Write table-driven tests first.')).toBe('process')
})

test('facts and taste are knowledge: a framework, a database, an API, a design style', () => {
  for (const id of ['emil-design-eng', 'ecc:postgres-patterns', 'ecc:react-patterns', 'ecc:api-design', 'ecc:liquid-glass-design', 'ecc:python-testing', 'shadcn']) {
    expect(useOf(id, 'Patterns and conventions for the tool.')).toBe('knowledge')
  }
})
