// Onboarding, piece 6: the first job. One suggestion from the scan facts, by rule; no model call. The card offers it, and
// "Use this" fills the prompt box. Nothing is sent for the person.
import type { ProjectFacts } from './onboard-types'

export const TESTS_JOB = 'Set up tests for this project'
export const README_JOB = 'Write a README'
export const TOUR_JOB = 'Give me a tour of this project and its weak spots'

/** Manifest names of a test tool. */
const TEST_TOOLS = new Set(['vitest', 'jest', 'mocha', 'ava', 'jasmine', 'playwright', '@playwright/test', 'cypress', 'pytest', 'unittest', 'nose', 'rspec', 'minitest', 'phpunit'])
/** A test folder, or a test file by its common names. */
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs)\/?$|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py|rb)$/i

const hasTests = (facts: ProjectFacts) =>
  facts.deps.some(d => TEST_TOOLS.has(d.toLowerCase())) || facts.outline.some(p => TEST_PATH.test(p))

/** The first job to offer: tests for code that has none, then a README for a project without one, else a tour. */
export function firstJob(facts: ProjectFacts): string {
  if (facts.codeFiles > 0 && !hasTests(facts)) return TESTS_JOB
  if (facts.readmeHead.trim() === '') return README_JOB
  return TOUR_JOB
}
