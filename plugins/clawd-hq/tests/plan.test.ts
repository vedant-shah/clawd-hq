import { expect, test } from 'claude-code/testing'
import { MAX_ID, parsePlanFile, sectionsOf, serialisePlanFile } from '../hooks/plan-file'
import { HAND_EDITED } from './plan-fixtures'
import { MAX_CHOICES, MAX_LATER, MAX_STEPS, TEXT_CHARS, applyOp, cleanText, slugOf, startPlan, viewOf, withSavedIds } from '../hooks/plan'
import type { PlanOp } from '../hooks/plan'

// The plan's operations (pure): what each one does to the file's text, and each reason it refuses. A refusal changes nothing.

const BASE = '# G\n\n- [ ] A  <!-- s1 -->\n  - Decided: use one file\n- [x] B  <!-- s2 -->\n- [ ] C  <!-- s3 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n'
const none: ReadonlySet<string> = new Set()

/** The line that keeps the next ids; most tests are about the other lines, so `run` leaves it out and `runRaw` keeps it. */
const MARK_LINE = /<!-- next: s\d+ l\d+ -->\r?\n?/

/** Runs one operation on a text: the new text, or the reason it was refused. */
function runRaw(text: string, op: PlanOp, active: ReadonlySet<string> = none): { text: string } | { reason: string } {
  const done = applyOp(parsePlanFile(text)!, op, active)
  return done.ok ? { text: serialisePlanFile(done.file) } : { reason: done.reason }
}
const run = (text: string, op: PlanOp, active: ReadonlySet<string> = none) => {
  const r = runRaw(text, op, active)
  return 'text' in r ? { text: r.text.replace(MARK_LINE, '') } : r
}
const text = (r: ReturnType<typeof run>) => ('text' in r ? r.text : `REFUSED: ${r.reason}`)
const stepIds = (t: string) => sectionsOf(parsePlanFile(t)!).steps.map(s => s.id)
const many = (n: number) => Array.from({ length: n }, (_, i) => `Step number ${i + 1}`)
const planOf = (n: number) => `# G\n\n${many(n).map((s, i) => `- [ ] ${s}  <!-- s${i + 1} -->`).join('\n')}\n`

// ---- Text and names ----

test('text from a model is one clean line: spaces folded, cut at a word to 120 characters, and no comment marks that could pass as an id', () => {
  expect(cleanText('  Add\n the\tbutton ')).toBe('Add the button')
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
  expect(cleanText(long).length).toBeLessThanOrEqual(TEXT_CHARS)
  expect(long.startsWith(cleanText(long))).toBe(true)
  expect(cleanText('Do it <!-- s9 --> now')).toBe('Do it s9 now')
  expect(cleanText('x <!<!---- s9 -->-- y')).not.toMatch(/<!--|-->/)
  expect(cleanText(undefined)).toBe('')
  expect(cleanText(42)).toBe('')
})

test('a slug is the title in lower case with the rest turned to dashes, at most 40 characters', () => {
  expect(slugOf('Export scores as CSV', [])).toBe('export-scores-as-csv')
  expect(slugOf('  Fix: the (login) bug!!  ', [])).toBe('fix-the-login-bug')
  const long = slugOf('A very long goal title that goes on and on and on', [])
  expect(long.length).toBeLessThanOrEqual(40)
  expect(long.endsWith('-')).toBe(false)
  expect(slugOf('日本語', [])).toBe('goal')
  expect(slugOf('???', [])).toBe('goal')
})

test('a slug already taken gets -2, then -3', () => {
  expect(slugOf('Fix login', ['fix-login'])).toBe('fix-login-2')
  expect(slugOf('Fix login', ['fix-login', 'fix-login-2'])).toBe('fix-login-3')
  expect(slugOf('Fix login', ['other'])).toBe('fix-login')
})

// ---- start ----

test('start makes a file with the title and the steps, numbered from s1', () => {
  const r = startPlan({ goal: 'Export scores', steps: ['Find how it works', 'Build it'], hasCurrent: false, taken: [] })
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.slug).toBe('export-scores')
  expect(serialisePlanFile(r.file)).toBe('# Export scores\n\n- [ ] Find how it works  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n<!-- next: s3 l1 -->\n')
  expect(parsePlanFile(serialisePlanFile(r.file))).toBeDefined()
})

test('start is refused while a goal is current, with the reason the owner chose', () => {
  const r = startPlan({ goal: 'Second', steps: ['A'], hasCurrent: true, taken: [] })
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('finish the current goal first (done or stopped)')
})

test('start is refused with no title, no steps, or too many steps; steps that are empty after cleaning are left out', () => {
  expect(startPlan({ goal: '  ', steps: ['A'], hasCurrent: false, taken: [] })).toEqual({ ok: false, reason: 'A goal needs a title.' })
  expect(startPlan({ goal: 'G', steps: [], hasCurrent: false, taken: [] })).toEqual({ ok: false, reason: 'A plan needs at least one step.' })
  expect(startPlan({ goal: 'G', steps: ['', '  ', '<!-- -->'], hasCurrent: false, taken: [] })).toEqual({ ok: false, reason: 'A plan needs at least one step.' })
  expect(startPlan({ goal: 'G', steps: many(MAX_STEPS + 1), hasCurrent: false, taken: [] })).toEqual({ ok: false, reason: `A plan holds at most ${MAX_STEPS} steps.` })
  const ok = startPlan({ goal: 'G', steps: many(MAX_STEPS), hasCurrent: false, taken: [] })
  expect(ok.ok).toBe(true)
  const some = startPlan({ goal: 'G', steps: ['A', '', 'B'], hasCurrent: false, taken: [] })
  expect(some.ok && sectionsOf(some.file).steps.map(s => s.text)).toEqual(['A', 'B'])
})

test('start cannot be made to write an id of its own choosing, and clashes get a new slug', () => {
  const r = startPlan({ goal: 'G <!-- s5 -->', steps: ['Sneaky <!-- s9 -->', 'Next'], hasCurrent: false, taken: ['g-s5'] })
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.slug).toBe('g-s5-2')
  expect(sectionsOf(parsePlanFile(serialisePlanFile(r.file))!).steps.map(s => s.id)).toEqual(['s1', 's2'])
})

// ---- add ----

test('add puts the step at the end of the steps, before Later, with the next id', () => {
  expect(text(run(BASE, { op: 'add', text: 'D' }))).toBe(BASE.replace('- [ ] C  <!-- s3 -->\n', '- [ ] C  <!-- s3 -->\n- [ ] D  <!-- s4 -->\n'))
})

test('add after a step goes below that step and its choices', () => {
  expect(text(run(BASE, { op: 'add', text: 'D', after: 's1' }))).toBe(BASE.replace('  - Decided: use one file\n', '  - Decided: use one file\n- [ ] D  <!-- s4 -->\n'))
})

test('add is refused for text that is empty, an unknown step, a step of the Later list, or a full plan; nothing changes', () => {
  expect(run(BASE, { op: 'add', text: ' <!-- --> ' })).toEqual({ reason: 'A step needs some text.' })
  expect(run(BASE, { op: 'add', text: 'D', after: 's9' })).toEqual({ reason: 'There is no step s9.' })
  expect(run(BASE, { op: 'add', text: 'D', after: 'l1' })).toEqual({ reason: 'There is no step l1.' })
  expect(run(planOf(MAX_STEPS), { op: 'add', text: 'one more' })).toEqual({ reason: `The plan already has ${MAX_STEPS} steps; drop one first.` })
  expect('text' in run(planOf(MAX_STEPS - 1), { op: 'add', text: 'the last one' })).toBe(true)
})

test('add keeps the notes and the person\'s own lines where they are, and gives the by-hand steps their ids in the same write', () => {
  const edited = '# G\nnote\n- [ ] By hand\nmore words\n- [ ] A  <!-- s4 -->\n'
  expect(text(run(edited, { op: 'add', text: 'New' }))).toBe('# G\nnote\n- [ ] By hand  <!-- s5 -->\nmore words\n- [ ] A  <!-- s4 -->\n- [ ] New  <!-- s6 -->\n')
})

test('add to a plan with no steps, and to a file with no final line break or with Windows line breaks', () => {
  expect(text(run('# G\n', { op: 'add', text: 'X' }))).toBe('# G\n\n- [ ] X  <!-- s1 -->\n')
  expect(text(run('# G\n\n## Later\n\n- [ ] L  <!-- l1 -->\n', { op: 'add', text: 'X' }))).toBe('# G\n\n- [ ] X  <!-- s1 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n')
  expect(text(run('# G\n- [ ] A  <!-- s1 -->', { op: 'add', text: 'X' }))).toBe('# G\n- [ ] A  <!-- s1 -->\n- [ ] X  <!-- s2 -->\n')
  expect(text(run('# G\r\n- [ ] A  <!-- s1 -->\r\n', { op: 'add', text: 'X' }))).toBe('# G\r\n- [ ] A  <!-- s1 -->\r\n- [ ] X  <!-- s2 -->\r\n')
})

// ---- drop ----

test('drop removes the step with its choices and nothing else', () => {
  expect(text(run(BASE, { op: 'drop', id: 's1' }))).toBe('# G\n\n- [x] B  <!-- s2 -->\n- [ ] C  <!-- s3 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n')
  expect(text(run('# G\nnote\n- [ ] A  <!-- s1 -->\nkept\n', { op: 'drop', id: 's1' }))).toBe('# G\nnote\nkept\n')
})

test('drop is refused for an unknown step, a Later item, and a step a specialist is working on', () => {
  expect(run(BASE, { op: 'drop', id: 's9' })).toEqual({ reason: 'There is no step s9.' })
  expect(run(BASE, { op: 'drop', id: 'l1' })).toEqual({ reason: 'There is no step l1.' })
  expect(run(BASE, { op: 'drop', id: 's3' }, new Set(['s3']))).toEqual({ reason: 'Step s3 has a specialist at work on it; wait for it to finish first.' })
  expect('text' in run(BASE, { op: 'drop', id: 's3' }, new Set(['s1']))).toBe(true)
})

// ---- move ----

test('move with no "after" puts the step first; with one, right after that step; choices travel with it', () => {
  expect(text(run(BASE, { op: 'move', id: 's3' }))).toBe('# G\n\n- [ ] C  <!-- s3 -->\n- [ ] A  <!-- s1 -->\n  - Decided: use one file\n- [x] B  <!-- s2 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n')
  expect(text(run(BASE, { op: 'move', id: 's1', after: 's2' }))).toBe('# G\n\n- [x] B  <!-- s2 -->\n- [ ] A  <!-- s1 -->\n  - Decided: use one file\n- [ ] C  <!-- s3 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n')
})

test('move leaves the lines between steps that are not indented where they are', () => {
  const edited = '# G\n- [ ] A  <!-- s1 -->\nnote one\n- [ ] B  <!-- s2 -->\nnote two\n- [ ] C  <!-- s3 -->\n'
  expect(text(run(edited, { op: 'move', id: 's3' }))).toBe('# G\n- [ ] C  <!-- s3 -->\nnote one\n- [ ] A  <!-- s1 -->\nnote two\n- [ ] B  <!-- s2 -->\n')
})

test('move of a step to where it already is changes nothing; move is refused for unknown steps and for "after itself"', () => {
  expect(text(run(BASE, { op: 'move', id: 's1' }))).toBe(BASE)
  expect(text(run(BASE, { op: 'move', id: 's2', after: 's1' }))).toBe(BASE)
  expect(run(BASE, { op: 'move', id: 's9' })).toEqual({ reason: 'There is no step s9.' })
  expect(run(BASE, { op: 'move', id: 's1', after: 's9' })).toEqual({ reason: 'There is no step s9.' })
  expect(run(BASE, { op: 'move', id: 'l1' })).toEqual({ reason: 'There is no step l1.' })
  expect(run(BASE, { op: 'move', id: 's1', after: 's1' })).toEqual({ reason: 'A step cannot be moved after itself.' })
})

// ---- split ----

test('split replaces a step with new ones; its choices stay with the first; the old id is not used again', () => {
  const r = text(run(BASE, { op: 'split', id: 's1', steps: ['A one', 'A two'] }))
  expect(r).toBe('# G\n\n- [ ] A one  <!-- s4 -->\n  - Decided: use one file\n- [ ] A two  <!-- s5 -->\n- [x] B  <!-- s2 -->\n- [ ] C  <!-- s3 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n')
  // The step with the highest number: its number still is not given out again.
  expect(stepIds(text(run(BASE, { op: 'split', id: 's3', steps: ['C one', 'C two'] })))).toEqual(['s1', 's2', 's4', 's5'])
})

test('split of a ticked step gives open steps', () => {
  expect(text(run(BASE, { op: 'split', id: 's2', steps: ['B one', 'B two'] }))).toContain('- [ ] B one  <!-- s4 -->\n- [ ] B two  <!-- s5 -->\n')
})

test('split is refused for an unknown step, fewer than two steps, empty text, too many steps, or a step a specialist is working on', () => {
  expect(run(BASE, { op: 'split', id: 's9', steps: ['a', 'b'] })).toEqual({ reason: 'There is no step s9.' })
  expect(run(BASE, { op: 'split', id: 's1', steps: ['only'] })).toEqual({ reason: 'A split needs at least two steps.' })
  expect(run(BASE, { op: 'split', id: 's1', steps: ['one', '  '] })).toEqual({ reason: 'A split needs at least two steps.' })
  expect(run(BASE, { op: 'split', id: 's1', steps: ['a', 'b'] }, new Set(['s1']))).toEqual({ reason: 'Step s1 has a specialist at work on it; wait for it to finish first.' })
  expect(run(planOf(MAX_STEPS), { op: 'split', id: 's1', steps: ['a', 'b'] })).toEqual({ reason: `A plan holds at most ${MAX_STEPS} steps.` })
  expect('text' in run(planOf(MAX_STEPS - 1), { op: 'split', id: 's1', steps: ['a', 'b'] })).toBe(true)
})

// ---- done and reopen ----

test('done ticks a step and reopen unticks it; doing either twice changes nothing', () => {
  expect(text(run(BASE, { op: 'done', id: 's1' }))).toBe(BASE.replace('- [ ] A', '- [x] A'))
  expect(text(run(BASE, { op: 'reopen', id: 's2' }))).toBe(BASE.replace('- [x] B', '- [ ] B'))
  expect(text(run(BASE, { op: 'done', id: 's2' }))).toBe(BASE)
  expect(text(run(BASE, { op: 'reopen', id: 's1' }))).toBe(BASE)
})

test('done and reopen are refused for an unknown step or a Later item', () => {
  for (const op of ['done', 'reopen'] as const) {
    expect(run(BASE, { op, id: 's9' })).toEqual({ reason: 'There is no step s9.' })
    expect(run(BASE, { op, id: 'l1' })).toEqual({ reason: 'There is no step l1.' })
  }
})

// ---- later ----

test('later adds an item at the end of the Later list, with the next l id', () => {
  expect(text(run(BASE, { op: 'later', text: 'M' }))).toBe(`${BASE}- [ ] M  <!-- l2 -->\n`)
})

test('later makes the Later heading when the file has none, and fills a heading with no items', () => {
  expect(text(run('# G\n\n- [ ] A  <!-- s1 -->\n', { op: 'later', text: 'P' }))).toBe('# G\n\n- [ ] A  <!-- s1 -->\n\n## Later\n\n- [ ] P  <!-- l1 -->\n')
  expect(text(run('# G\n- [ ] A  <!-- s1 -->\n\n', { op: 'later', text: 'P' }))).toBe('# G\n- [ ] A  <!-- s1 -->\n\n## Later\n\n- [ ] P  <!-- l1 -->\n')
  expect(text(run('# G\n\n## Later\n', { op: 'later', text: 'P' }))).toBe('# G\n\n## Later\n\n- [ ] P  <!-- l1 -->\n')
  expect(text(run('# G\n\n## Later\n\n', { op: 'later', text: 'P' }))).toBe('# G\n\n## Later\n\n- [ ] P  <!-- l1 -->\n')
  expect(text(run('# G\r\n- [ ] A  <!-- s1 -->', { op: 'later', text: 'P' }))).toBe('# G\r\n- [ ] A  <!-- s1 -->\r\n\r\n## Later\r\n\r\n- [ ] P  <!-- l1 -->\r\n')
})

test('later is refused for empty text and for a full list', () => {
  expect(run(BASE, { op: 'later', text: ' ' })).toEqual({ reason: 'A Later item needs some text.' })
  const full = `${BASE}${Array.from({ length: MAX_LATER - 1 }, (_, i) => `- [ ] More ${i}  <!-- l${i + 2} -->\n`).join('')}`
  expect(run(full, { op: 'later', text: 'one more' })).toEqual({ reason: `The Later list holds at most ${MAX_LATER} items.` })
  expect('text' in run(full.replace(/- \[ \] More 0.*\n/, ''), { op: 'later', text: 'fits' })).toBe(true)
})

// ---- what they all share ----

test('a refusal leaves the file it was given untouched', () => {
  const file = parsePlanFile(BASE)!
  const before = serialisePlanFile(file)
  applyOp(file, { op: 'drop', id: 's9' }, none)
  applyOp(file, { op: 'add', text: 'D' }, none)
  expect(serialisePlanFile(file)).toBe(before)
})

test('the view of a plan gives the title, the steps with their choices, and the later items, with ids for steps that had none', () => {
  const view = viewOf(parsePlanFile('# G\n- [ ] By hand\n- [x] B  <!-- s4 -->\n  - Decided: x\n  - Decided: y\n\n## Later\n- [ ] L  <!-- l1 -->\n')!)
  expect(view).toEqual({
    title: 'G',
    steps: [{ id: 's5', text: 'By hand', isDone: false, choices: [] }, { id: 's4', text: 'B', isDone: true, choices: ['x', 'y'] }],
    later: [{ id: 'l1', text: 'L' }],
  })
})

// ---- Indented lines under a step ----

const TAIL = '# G\n- [ ] A  <!-- s1 -->\n  - Decided: x\n  my note\n- [ ] B  <!-- s2 -->\n  b note\n- [ ] C  <!-- s3 -->\n'

test('an indented note under a step moves with it', () => {
  expect(text(run(TAIL, { op: 'move', id: 's2' }))).toBe('# G\n- [ ] B  <!-- s2 -->\n  b note\n- [ ] A  <!-- s1 -->\n  - Decided: x\n  my note\n- [ ] C  <!-- s3 -->\n')
  expect(text(run(TAIL, { op: 'move', id: 's1', after: 's3' }))).toBe('# G\n- [ ] B  <!-- s2 -->\n  b note\n- [ ] C  <!-- s3 -->\n- [ ] A  <!-- s1 -->\n  - Decided: x\n  my note\n')
})

test('a step added after another goes below its notes', () => {
  expect(text(run(TAIL, { op: 'add', text: 'N', after: 's1' }))).toBe(TAIL.replace('  my note\n', '  my note\n- [ ] N  <!-- s4 -->\n'))
})

test('when a step is dropped its notes stay where they were, and only its choices go', () => {
  expect(text(run(TAIL, { op: 'drop', id: 's1' }))).toBe('# G\n  my note\n- [ ] B  <!-- s2 -->\n  b note\n- [ ] C  <!-- s3 -->\n')
})

test('when a step is split its choices go to the first new step and its notes stay, right after the new steps', () => {
  expect(text(run(TAIL, { op: 'split', id: 's1', steps: ['A1', 'A2'] }))).toBe('# G\n- [ ] A1  <!-- s4 -->\n  - Decided: x\n- [ ] A2  <!-- s5 -->\n  my note\n- [ ] B  <!-- s2 -->\n  b note\n- [ ] C  <!-- s3 -->\n')
})

// ---- Last lines with no line break, and Windows line breaks ----

const eolize = (t: string, eol: string) => t.replace(/\n/g, eol)

test('move, split and drop on a last step with no final line break, with either kind of line break', () => {
  for (const eol of ['\n', '\r\n']) {
    const file = eolize('# G\n- [ ] A  <!-- s1 -->\n- [ ] B  <!-- s2 -->', eol)
    expect(text(run(file, { op: 'move', id: 's2' }))).toBe(eolize('# G\n- [ ] B  <!-- s2 -->\n- [ ] A  <!-- s1 -->\n', eol))
    expect(text(run(file, { op: 'split', id: 's2', steps: ['B1', 'B2'] }))).toBe(eolize('# G\n- [ ] A  <!-- s1 -->\n- [ ] B1  <!-- s3 -->\n- [ ] B2  <!-- s4 -->\n', eol))
    expect(text(runRaw(file, { op: 'drop', id: 's2' }))).toBe(eolize('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s3 l1 -->\n', eol))
    expect(text(run(file, { op: 'add', text: 'C' }))).toBe(eolize('# G\n- [ ] A  <!-- s1 -->\n- [ ] B  <!-- s2 -->\n- [ ] C  <!-- s3 -->\n', eol))
  }
})

test('a last choice with no line break gets one when something is put after it, moved, or split', () => {
  expect(text(run('# G\n- [ ] A  <!-- s1 -->\n  - Decided: x', { op: 'add', text: 'B', after: 's1' }))).toBe('# G\n- [ ] A  <!-- s1 -->\n  - Decided: x\n- [ ] B  <!-- s2 -->\n')
  const last = '# G\n- [ ] A  <!-- s1 -->\n- [ ] B  <!-- s2 -->\n  - Decided: y'
  expect(text(run(last, { op: 'move', id: 's2' }))).toBe('# G\n- [ ] B  <!-- s2 -->\n  - Decided: y\n- [ ] A  <!-- s1 -->\n')
  expect(text(run(last, { op: 'split', id: 's2', steps: ['B1', 'B2'] }))).toBe('# G\n- [ ] A  <!-- s1 -->\n- [ ] B1  <!-- s3 -->\n  - Decided: y\n- [ ] B2  <!-- s4 -->\n')
  expect(text(run(eolize(last, '\r\n'), { op: 'later', text: 'P' }))).toBe(eolize('# G\n- [ ] A  <!-- s1 -->\n- [ ] B  <!-- s2 -->\n  - Decided: y\n\n## Later\n\n- [ ] P  <!-- l1 -->\n', '\r\n'))
})

// ---- The next line ----

test('dropping the highest step keeps its number: the next line is written in the same go, and the next step does not reuse it', () => {
  const dropped = runRaw(BASE, { op: 'drop', id: 's3' }) as { text: string }
  expect(dropped.text).toBe('# G\n\n- [ ] A  <!-- s1 -->\n  - Decided: use one file\n- [x] B  <!-- s2 -->\n\n## Later\n\n- [ ] L  <!-- l1 -->\n<!-- next: s4 l2 -->\n')
  expect(stepIds(text(runRaw(dropped.text, { op: 'add', text: 'D' })))).toEqual(['s1', 's2', 's4'])
})

test('a changed file has its next line made right: made when missing, lifted when lower, and the first of two is the one that counts', () => {
  expect(text(runRaw('# G\n- [ ] A  <!-- s1 -->\n', { op: 'add', text: 'B' }))).toBe('# G\n- [ ] A  <!-- s1 -->\n- [ ] B  <!-- s2 -->\n<!-- next: s3 l1 -->\n')
  const lowered = '# G\n- [ ] A  <!-- s5 -->\n<!-- next: s1 l1 -->\n'
  expect(text(runRaw(lowered, { op: 'add', text: 'B' }))).toBe('# G\n- [ ] A  <!-- s5 -->\n- [ ] B  <!-- s6 -->\n<!-- next: s7 l1 -->\n')
  const two = '# G\n- [ ] A  <!-- s1 -->\n<!-- next: s5 l1 -->\n<!-- next: s9 l9 -->\n'
  expect(text(runRaw(two, { op: 'add', text: 'B' }))).toBe('# G\n- [ ] A  <!-- s1 -->\n- [ ] B  <!-- s5 -->\n<!-- next: s6 l1 -->\n<!-- next: s9 l9 -->\n')
})

test('the next line keeps the file\'s line breaks and sits after what is added, also a new Later list', () => {
  expect(text(runRaw('# G\r\n- [ ] A  <!-- s1 -->', { op: 'add', text: 'B' }))).toBe('# G\r\n- [ ] A  <!-- s1 -->\r\n- [ ] B  <!-- s2 -->\r\n<!-- next: s3 l1 -->\r\n')
  expect(text(runRaw('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s2 l5 -->\n', { op: 'later', text: 'P' }))).toBe('# G\n- [ ] A  <!-- s1 -->\n\n## Later\n\n- [ ] P  <!-- l5 -->\n<!-- next: s2 l6 -->\n')
})

test('a refusal, or an operation that changes nothing, gives no next line', () => {
  expect(runRaw(BASE, { op: 'drop', id: 's9' })).toEqual({ reason: 'There is no step s9.' })
  expect(text(runRaw(BASE, { op: 'done', id: 's2' }))).toBe(BASE)
  expect(text(runRaw('# G\n- [ ] By hand\n', { op: 'reopen', id: 's1' }))).toBe('# G\n- [ ] By hand\n')
})

test('an add is refused when the next number would pass the largest the file can hold', () => {
  const full = `# G\n- [ ] X  <!-- s${MAX_ID} -->\n`
  const reason = `The plan has used up its step numbers (the last is ${MAX_ID}).`
  expect(run(full, { op: 'add', text: 'one more' })).toEqual({ reason })
  expect(run(full, { op: 'split', id: `s${MAX_ID}`, steps: ['a', 'b'] })).toEqual({ reason })
  const room = `# G\n- [ ] X  <!-- s${MAX_ID - 2} -->\n<!-- next: s${MAX_ID - 1} l1 -->\n`
  expect(stepIds(text(run(room, { op: 'add', text: 'fits' })))).toEqual([`s${MAX_ID - 2}`, `s${MAX_ID - 1}`])
})

// ---- Text that tries to be lines of its own, and operations that do not exist ----

test('text with line breaks and file marks in it becomes exactly one new line', () => {
  const forged = 'a\n## Later\n- [x] x <!-- s99 -->\n<!-- next: s1 l1 -->'
  const out = text(run(BASE, { op: 'add', text: forged }))
  expect(out.split('\n')).toHaveLength(BASE.split('\n').length + 1)
  const file = parsePlanFile(out)!
  expect(sectionsOf(file).steps).toHaveLength(4)
  expect(sectionsOf(file).steps[3]).toMatchObject({ id: 's4', isDone: false })
  expect(sectionsOf(file).later).toHaveLength(1)
  expect(out).not.toContain('s99  <!--')
  for (const op of [{ op: 'later', text: forged }, { op: 'split', id: 's1', steps: [forged, forged] }] as PlanOp[]) {
    const r = text(run(BASE, op))
    expect(r.split('\n').length - BASE.split('\n').length).toBe(1)
    expect(sectionsOf(parsePlanFile(r)!).later.length).toBe(op.op === 'later' ? 2 : 1)
  }
})

test('an operation that does not exist is refused, whatever it is called', () => {
  expect(run(BASE, { op: 'explode' } as never)).toEqual({ reason: 'There is no operation called explode.' })
  expect(run(BASE, {} as never)).toEqual({ reason: 'There is no operation called undefined.' })
  expect(run(BASE, { op: 'x'.repeat(50) } as never)).toMatchObject({ reason: expect.stringContaining('There is no operation') })
})

// ---- A hand-edited file through every operation ----

const stepLine = /^- \[[ xX]\] +\S/
const plainLines = (t: string) => t.split('\n').filter(l => !stepLine.test(l) && !/^[ \t]/.test(l) && !MARK_LINE.test(l))
const indentedNotes = (t: string) => t.split('\n').filter(l => /^[ \t]+\S/.test(l) && !/^ {2}- Decided:/.test(l)).sort()

test('every operation on a hand-edited file keeps every line that is not a step, in order, and every indented note', () => {
  const ops: PlanOp[] = [
    { op: 'add', text: 'New' }, { op: 'add', text: 'New', after: 's1' }, { op: 'drop', id: 's1' }, { op: 'drop', id: 's10' }, { op: 'drop', id: 's9' },
    { op: 'move', id: 's9' }, { op: 'move', id: 's1', after: 's9' }, { op: 'move', id: 's10', after: 's11' }, { op: 'split', id: 's10', steps: ['P', 'Q'] }, { op: 'split', id: 's9', steps: ['P', 'Q'] },
    { op: 'done', id: 's1' }, { op: 'reopen', id: 's9' }, { op: 'later', text: 'Put off' },
  ]
  for (const op of ops) {
    const r = runRaw(HAND_EDITED, op)
    expect('text' in r ? 'ok' : `${JSON.stringify(op)} refused: ${(r as { reason: string }).reason}`).toBe('ok')
    const out = (r as { text: string }).text
    expect(plainLines(out), JSON.stringify(op)).toEqual(plainLines(HAND_EDITED))
    expect(indentedNotes(out), JSON.stringify(op)).toEqual(indentedNotes(HAND_EDITED))
    expect(serialisePlanFile(parsePlanFile(out)!)).toBe(out)
  }
})

// ---- The choices a finished run reported ----

test('decide puts the choices under the step, after the ones it has, and ticks it when asked', () => {
  expect(text(run(BASE, { op: 'decide', id: 's1', choices: ['use two files'] }))).toBe(BASE.replace('  - Decided: use one file\n', '  - Decided: use one file\n  - Decided: use two files\n'))
  expect(text(run(BASE, { op: 'decide', id: 's3', choices: ['keep it flat'], tick: true }))).toBe(BASE.replace('- [ ] C  <!-- s3 -->\n', '- [x] C  <!-- s3 -->\n  - Decided: keep it flat\n'))
  expect(text(run(BASE, { op: 'decide', id: 's3', choices: [], tick: true }))).toBe(BASE.replace('- [ ] C', '- [x] C'))
})

test('decide keeps the step\'s own line as written when it only adds choices, and puts them before the person\'s notes only when there are no choices yet', () => {
  const edited = '# G\n-  [ ]  odd\n- [ ] Odd   spacing  <!-- s1 -->\n  my note\n'
  expect(text(run(edited, { op: 'decide', id: 's1', choices: ['x'] }))).toBe('# G\n-  [ ]  odd\n- [ ] Odd   spacing  <!-- s1 -->\n  - Decided: x\n  my note\n')
})

test('decide adds no choice twice (any case or spacing), keeps at most five, and writes nothing when nothing is new', () => {
  const has = text(run(BASE, { op: 'decide', id: 's1', choices: ['USE  one file', 'use one file', 'a new one', 'A NEW  one'] }))
  expect(has.match(/Decided:/g)).toHaveLength(2)
  const many = text(run(BASE, { op: 'decide', id: 's1', choices: ['b', 'c', 'd', 'e', 'f', 'g'] }))
  expect(many.match(/Decided:/g)).toHaveLength(MAX_CHOICES)
  expect(many).not.toContain('Decided: f')
  expect(text(run(BASE, { op: 'decide', id: 's1', choices: ['use one file'] }))).toBe(BASE)
  const full = text(run(BASE, { op: 'decide', id: 's1', choices: ['b', 'c', 'd', 'e'] }))
  expect(text(run(full, { op: 'decide', id: 's1', choices: ['z'] }))).toBe(full)
})

test('decide is refused for a step that is not there, and cleans each choice like any text', () => {
  expect(run(BASE, { op: 'decide', id: 's9', choices: ['x'] })).toEqual({ reason: 'There is no step s9.' })
  expect(text(run(BASE, { op: 'decide', id: 's3', choices: ['a\n## Later <!-- s9 -->'] }))).toContain('  - Decided: a ## Later s9\n')
})

test('decide closes a last line with no line break before putting a choice after it', () => {
  expect(text(run('# G\n- [ ] A  <!-- s1 -->', { op: 'decide', id: 's1', choices: ['x'], tick: true }))).toBe('# G\n- [x] A  <!-- s1 -->\n  - Decided: x\n')
})

// ---- Ids made real ----

test('withSavedIds gives the same file when every step has an id, and the numbers viewOf showed when some had none', () => {
  const whole = parsePlanFile(BASE)!
  expect(withSavedIds(whole)).toBe(whole)
  const hand = parsePlanFile('# G\n- [ ] By hand\n- [ ] A  <!-- s4 -->\n')!
  expect(viewOf(hand).steps.map(s => s.id)).toEqual(['s5', 's4'])
  expect(serialisePlanFile(withSavedIds(hand))).toBe('# G\n- [ ] By hand  <!-- s5 -->\n- [ ] A  <!-- s4 -->\n<!-- next: s6 l1 -->\n')
})

// ---- A Later item taken out ----

test('forget takes a Later item out of the file, and nothing else; a note indented under it stays', () => {
  expect(text(run(BASE, { op: 'forget', id: 'l1' }))).toBe('# G\n\n- [ ] A  <!-- s1 -->\n  - Decided: use one file\n- [x] B  <!-- s2 -->\n- [ ] C  <!-- s3 -->\n\n## Later\n\n')
  const two = `${BASE}- [ ] M  <!-- l2 -->\n  a note of mine\n`
  expect(text(run(two, { op: 'forget', id: 'l2' }))).toBe(`${BASE}  a note of mine\n`)
})

test('forget is refused for a step, an id that is not there, or a file with no Later list; nothing changes', () => {
  expect(run(BASE, { op: 'forget', id: 's1' })).toEqual({ reason: 'There is no Later item s1.' })
  expect(run(BASE, { op: 'forget', id: 'l9' })).toEqual({ reason: 'There is no Later item l9.' })
  expect(run('# G\n- [ ] A  <!-- s1 -->\n', { op: 'forget', id: 'l1' })).toEqual({ reason: 'There is no Later item l1.' })
})

// ---- Text that carries control characters ----

test('control characters, marks that reorder text and hidden marks never reach a step: not in what is written, and not in the view of a file edited by hand', () => {
  const dirty = 'Ship\u202e it\u0007 \u200bnow\u0085 \u2066ok\u2069 \ufeff'
  expect(cleanText(dirty)).toBe('Ship it now ok')
  expect(text(run(BASE, { op: 'add', text: dirty })).includes('Ship it now ok  <!-- s4 -->')).toBe(true)
  const hand = parsePlanFile(`# Go\u202e Home\n- [ ] Bad\u0007 step\u200f  <!-- s1 -->\n  - Decided: a\u009f choice\u202a\n\n## Later\n- [ ] Put\ufeff off  <!-- l1 -->\n`)!
  expect(viewOf(hand)).toEqual({
    title: 'Go Home',
    steps: [{ id: 's1', text: 'Bad step', isDone: false, choices: ['a choice'] }],
    later: [{ id: 'l1', text: 'Put off' }],
  })
})

// ---- The session that owns the goal ----

test('a plan is started under a session: its file says so, and the view carries it', () => {
  const r = startPlan({ goal: 'Export scores', steps: ['A', 'B'], session: 'sess-1', startedAt: 5, hasCurrent: false, taken: [] })
  expect(r.ok && serialisePlanFile(r.file)).toContain('<!-- session: sess-1 -->\n')
  expect(r.ok && viewOf(r.file).session).toBe('sess-1')
  const bare = startPlan({ goal: 'Export scores', steps: ['A'], hasCurrent: false, taken: [] })
  expect(bare.ok && serialisePlanFile(bare.file)).not.toContain('session:')
  expect(bare.ok && viewOf(bare.file).session).toBeUndefined()
  // An id that is not a plain identifier is left out, never written into the file.
  const odd = startPlan({ goal: 'Export scores', steps: ['A'], session: 'two words --> x', hasCurrent: false, taken: [] })
  expect(odd.ok && serialisePlanFile(odd.file)).not.toContain('session:')
})

test('the office\'s own op "own" gives the goal to a session, and changes nothing when it is already that one\'s', () => {
  const owned = '# G\n\n- [ ] A  <!-- s1 -->\n<!-- session: a -->\n'
  expect(text(run(owned, { op: 'own', session: 'b' }))).toBe('# G\n\n- [ ] A  <!-- s1 -->\n<!-- session: b -->\n')
  expect(text(run('# G\n\n- [ ] A  <!-- s1 -->\n', { op: 'own', session: 'b' }))).toContain('<!-- session: b -->')
  const same = parsePlanFile(owned)!
  const r = applyOp(same, { op: 'own', session: 'a' }, none)
  expect(r.ok && r.file).toBe(same)
  expect(text(run(owned, { op: 'own', session: 'two words' }))).toContain('REFUSED')
})
