import { expect, test } from 'claude-code/testing'
import { parsePlanFile, serialisePlanFile, summaryOf } from '../hooks/plan-file'
import { applyOp, startPlan, viewOf } from '../hooks/plan'
import { parseCall, planText, stateFrom } from '../hooks/plan-live'

// A plan's optional one-sentence summary: a `> ` line straight under the title, kept through every read and write.

const WITH = '# Export scores as CSV\n> Teachers can download every score as one CSV file.\n\n- [ ] Find it  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n<!-- next: s3 l1 -->\n'
const WITHOUT = '# Export scores as CSV\n\n- [ ] Find it  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n<!-- next: s3 l1 -->\n'
const file = (text: string) => parsePlanFile(text)!
const none = new Set<string>()
const applyOk = (text: string, op: Parameters<typeof applyOp>[1]) => {
  const done = applyOp(file(text), op, none)
  if (!done.ok) throw new Error(done.reason)
  return done.file
}
const applied = (text: string, op: Parameters<typeof applyOp>[1]) => serialisePlanFile(applyOk(text, op))

// ---- The file ----

test('a file with or without the summary line reads and writes back byte for byte', () => {
  for (const text of [WITH, WITHOUT, WITH.replace(/\n/g, '\r\n')]) expect(serialisePlanFile(file(text))).toBe(text)
  expect(summaryOf(file(WITH))).toBe('Teachers can download every score as one CSV file.')
  expect(summaryOf(file(WITHOUT))).toBeUndefined()
})

test('only a `> ` line straight under the title is the summary; a quote anywhere else, and lines nobody knows, are kept as they were', () => {
  const text = '# Goal\n\n> not the summary: a blank line came first\n- [ ] Step  <!-- s1 -->\n> a quote under a step\nsome note   \n'
  expect(summaryOf(file(text))).toBeUndefined()
  expect(serialisePlanFile(file(text))).toBe(text)
  const kept = '# Goal\n> The summary.\nan unknown line  \n- [ ] Step  <!-- s1 -->\n'
  expect(summaryOf(file(kept))).toBe('The summary.')
  expect(serialisePlanFile(applyOk(kept, { op: 'summary', text: 'A new one.' }))).toBe('# Goal\n> A new one.\nan unknown line  \n- [ ] Step  <!-- s1 -->\n<!-- next: s2 l1 -->\n')
  expect(summaryOf(file('# Goal\n>   \n'))).toBeUndefined() // an empty quote is no summary
})

test('the plan as the plugin sees it carries the summary, tidied; a plan without one has none', () => {
  expect(viewOf(file(WITH)).summary).toBe('Teachers can download every score as one CSV file.')
  expect('summary' in viewOf(file(WITHOUT))).toBe(false)
  expect(viewOf(file('# Goal\n> Two   spaces​ here.\n- [ ] Step\n')).summary).toBe('Two spaces here.')
})

// ---- Starting and the summary op ----

test('start takes an optional summary, cleaned like a step and cut at a word to 120 characters; empty means none', () => {
  const made = startPlan({ goal: 'Export scores', steps: ['Find it'], summary: '  Teachers   can‮ download <!-- s9 --> scores.  ', hasCurrent: false, taken: [] })
  if (!made.ok) throw new Error(made.reason)
  expect(serialisePlanFile(made.file)).toBe('# Export scores\n> Teachers can download s9 scores.\n\n- [ ] Find it  <!-- s1 -->\n<!-- next: s2 l1 -->\n')
  const long = startPlan({ goal: 'G', steps: ['S'], summary: 'word '.repeat(40), hasCurrent: false, taken: [] })
  if (!long.ok) throw new Error(long.reason)
  expect(summaryOf(long.file)!.length).toBeLessThanOrEqual(120)
  for (const empty of [undefined, '', '   ', 42]) {
    const plain = startPlan({ goal: 'G', steps: ['S'], summary: empty, hasCurrent: false, taken: [] })
    if (!plain.ok) throw new Error(plain.reason)
    expect(serialisePlanFile(plain.file)).toBe('# G\n\n- [ ] S  <!-- s1 -->\n<!-- next: s2 l1 -->\n')
  }
})

test('the summary op sets one under the title, replaces it, and clears it with empty text; clearing none changes nothing', () => {
  expect(applied(WITHOUT, { op: 'summary', text: 'One sentence.' })).toBe(WITHOUT.replace('# Export scores as CSV\n', '# Export scores as CSV\n> One sentence.\n'))
  expect(applied(WITH, { op: 'summary', text: 'Another.' })).toBe(WITH.replace('Teachers can download every score as one CSV file.', 'Another.'))
  expect(applied(WITH, { op: 'summary', text: '  ' })).toBe(WITHOUT)
  expect(applyOk(WITHOUT, { op: 'summary', text: '' })).toEqual(file(WITHOUT))
  // A title that is the whole file still gets its line break before the summary.
  expect(applied('# Goal', { op: 'summary', text: 'Why.' })).toBe('# Goal\n> Why.\n<!-- next: s1 l1 -->\n')
})

test('a first step added to a plan with none goes under the summary, never between it and the title', () => {
  expect(applied('# Goal\n> Why.\n', { op: 'add', text: 'Step one' })).toBe('# Goal\n> Why.\n\n- [ ] Step one  <!-- s1 -->\n<!-- next: s2 l1 -->\n')
})

// ---- The tool ----

test('the tool reads summary on start and as an op of its own, its text empty to clear', () => {
  expect(parseCall({ op: 'start', goal: 'G', steps: ['S'], summary: 'Why.' })).toEqual({ call: { kind: 'start', goal: 'G', steps: ['S'], summary: 'Why.' } })
  expect(parseCall({ op: 'summary', text: 'Why.' })).toEqual({ call: { kind: 'op', op: { op: 'summary', text: 'Why.' } } })
  expect(parseCall({ op: 'summary' })).toEqual({ call: { kind: 'op', op: { op: 'summary', text: '' } } })
  expect(parseCall({ op: 'nope' })).toEqual({ error: expect.stringContaining('summary') })
})

test('the answer gives the summary on the line after the title and count; none, no line', () => {
  const state = stateFrom(viewOf(file(WITH)), 'export', 0, null, [])
  expect(state.summary).toBe('Teachers can download every score as one CSV file.')
  expect(planText(state, []).split('\n').slice(0, 2)).toEqual(['Plan: Export scores as CSV (0 of 2 done)', 'Summary: Teachers can download every score as one CSV file.'])
  const plain = stateFrom(viewOf(file(WITHOUT)), 'export', 0, null, [])
  expect('summary' in plain).toBe(false)
  expect(planText(plain, []).split('\n')[1]).toMatch(/^s1 /)
})
