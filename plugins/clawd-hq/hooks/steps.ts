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

/** The specialist after a report: its steps and plan replace the last ones; a note left out clears the old note. */
export const withProgress = (one: Employee, r: StepReport): Employee => ({ ...one, stepDone: r.done, stepTotal: r.total, stepNote: r.note })
