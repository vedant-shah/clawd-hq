// The progress a specialist reports with the step tool, pure: what a call may say, and how it lands on the specialist's record.
import type { Employee } from '../types'

/** A plan has between 1 and this many steps. */
export const MAX_PLAN = 12
/** The note is a few plain words: a longer one is refused, never cut. */
export const NOTE_CHARS = 80

export type StepReport = { done: number; total: number; note?: string }
/** A report that may be kept, or the plain reason it is refused. */
export type StepParsed = { report: StepReport } | { error: string }

const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n)

/** Untrusted display text as one plain line: control characters and invisible direction marks become spaces, runs of space one. */
const plain = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]+/g, ' ').replace(/\s+/g, ' ').trim()

export function parseStep(input: Record<string, unknown>): StepParsed {
  const { done, total, note } = input
  if (!isWhole(total) || total < 1 || total > MAX_PLAN) return { error: `total must be a whole number from 1 to ${MAX_PLAN}.` }
  if (!isWhole(done) || done < 0) return { error: 'done must be a whole number, 0 or more.' }
  if (note !== undefined && typeof note !== 'string') return { error: 'note must be text.' }
  const text = plain(note ?? '')
  // Counted in whole characters, on the clean text.
  const length = Array.from(text).length
  if (length > NOTE_CHARS) return { error: `note is ${length} characters; the most is ${NOTE_CHARS}. Say it in fewer words.` }
  return { report: { done: Math.min(done, total), total, ...(text === '' ? {} : { note: text }) } }
}

/** The specialist after a report: its steps and plan replace the last ones; a note left out clears the old note. The tool's report is the one that stands from here on. */
export const withProgress = (one: Employee, r: StepReport): Employee =>
  ({ ...one, stepDone: r.done, stepTotal: r.total, stepNote: r.note, stepBy: 'tool' })

// "Step 2 of 5" or "step 2/5": the only shape read from a specialist's words. Whole numbers of one or two digits, nothing around them.
const STEP_WORDS = /\bstep\s+(\d{1,2})\s*(?:of|\/)\s*(\d{1,2})(?!\d)/gi

/** The step a specialist says it is on, and its plan, from its own words: the latest mention that fits (a plan of 1 to 12, a step from 1). The step is brought down to the plan. */
export function stepLine(text: string): { done: number; total: number } | undefined {
  const fits = Array.from(text.matchAll(STEP_WORDS), m => ({ step: Number(m[1]), total: Number(m[2]) }))
    .filter(({ step, total }) => step >= 1 && total >= 1 && total <= MAX_PLAN)
  const last = fits[fits.length - 1]
  return last && { done: Math.min(last.step, last.total), total: last.total }
}

/**
 * The specialist after it says something: a "Step N of M" in its words is the step it is on (the count reads N/M and the bar
 * fills to it). The tool's report, once made, stands; words with no step in them change nothing. Nothing is drawn until
 * the specialist itself states a plan.
 */
export function withWords(one: Employee, said: string): Employee {
  const line = one.stepBy === 'tool' ? undefined : stepLine(said)
  return line === undefined ? one : { ...one, stepDone: line.done, stepTotal: line.total, stepBy: 'words' }
}
