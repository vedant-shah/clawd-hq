import { expect, test } from 'claude-code/testing'
import { MAX_ID, decidedOf, nextIds, parsePlanFile, sectionsOf, serialisePlanFile, withIds, withMark } from '../hooks/plan-file'
import { HAND_EDITED } from './plan-fixtures'

// The plan file (pure): what is read from it, and the promise that reading then writing gives the same bytes back.

const WELL_FORMED = `# Export scores as CSV

- [x] Find how exports work now  <!-- s1 -->
- [x] Plan the change  <!-- s2 -->
  - Decided: one CSV file, not one for each class
- [x] Add the export button  <!-- s3 -->
- [ ] Tests for the export  <!-- s4 -->
- [ ] Review  <!-- s5 -->
- [ ] Update the README  <!-- s6 -->

## Later

- [ ] Add an XLSX option  <!-- l1 -->
`

const roundTrip = (text: string) => {
  const file = parsePlanFile(text)
  expect(file).toBeDefined()
  return serialisePlanFile(file!)
}

// ---- Reading ----

test('a well-formed file is read into its title, steps with their choices, and its later items', () => {
  const { title, steps, later } = sectionsOf(parsePlanFile(WELL_FORMED)!)
  expect(title).toBe('Export scores as CSV')
  expect(steps.map(s => [s.id, s.text, s.isDone])).toEqual([
    ['s1', 'Find how exports work now', true], ['s2', 'Plan the change', true], ['s3', 'Add the export button', true],
    ['s4', 'Tests for the export', false], ['s5', 'Review', false], ['s6', 'Update the README', false],
  ])
  expect(decidedOf(steps[1]!).map(d => d.text)).toEqual(['one CSV file, not one for each class'])
  expect(later.map(l => [l.id, l.text, l.isDone])).toEqual([['l1', 'Add an XLSX option', false]])
})

test('a capital X ticks a step too, and the text is trimmed of the spaces around the id', () => {
  const { steps } = sectionsOf(parsePlanFile('# G\n- [X] Ship it   <!--   s7   -->  \n')!)
  expect(steps).toMatchObject([{ id: 's7', text: 'Ship it', isDone: true }])
})

test('a step with no id is read with no id; an id that belongs to the other list, or is not one, stays in the text', () => {
  const { steps, later } = sectionsOf(parsePlanFile('# G\n- [ ] By hand\n- [ ] Wrong list  <!-- l4 -->\n- [ ] Odd mark  <!-- note -->\n\n## Later\n- [ ] Other wrong  <!-- s2 -->\n')!)
  expect(steps.map(s => [s.id, s.text])).toEqual([[undefined, 'By hand'], [undefined, 'Wrong list  <!-- l4 -->'], [undefined, 'Odd mark  <!-- note -->']])
  expect(later.map(l => [l.id, l.text])).toEqual([[undefined, 'Other wrong  <!-- s2 -->']])
})

test('an id that appears twice belongs to the first line only', () => {
  const { steps } = sectionsOf(parsePlanFile('# G\n- [ ] One  <!-- s1 -->\n- [ ] Copy  <!-- s1 -->\n')!)
  expect(steps.map(s => s.id)).toEqual(['s1', undefined])
})

test('a Decided line counts only straight under a step; elsewhere it is just a line', () => {
  const text = '# G\n  - Decided: orphan\n- [ ] One  <!-- s1 -->\n  - Decided: a\n  - Decided: b\nnote\n  - Decided: after a note\n\n## Later\n- [ ] Put off  <!-- l1 -->\n  - Decided: not for later\n'
  const { steps, later } = sectionsOf(parsePlanFile(text)!)
  expect(decidedOf(steps[0]!).map(d => d.text)).toEqual(['a', 'b'])
  expect(decidedOf(later[0]!)).toEqual([])
  expect(later[0]!.sub).toHaveLength(1)
  expect(roundTrip(text)).toBe(text)
})

test('only a first line of "# title" makes a plan: anything else is not a plan', () => {
  for (const text of ['', '\n', '\n# Late title\n- [ ] A  <!-- s1 -->\n', '- [ ] A  <!-- s1 -->\n', '#nospace\n', '# \n- [ ] A\n', '## Later\n', 'Notes about the goal\n# Title\n'])
    expect(parsePlanFile(text)).toBeUndefined()
})

// ---- Byte for byte ----

test('a well-formed file comes back byte for byte', () => {
  expect(roundTrip(WELL_FORMED)).toBe(WELL_FORMED)
})

test('Windows line breaks, a mix of both, and a missing final line break all come back as they were', () => {
  const crlf = WELL_FORMED.replace(/\n/g, '\r\n')
  expect(roundTrip(crlf)).toBe(crlf)
  const mixed = '# Goal\r\n\n- [ ] One  <!-- s1 -->\r\n- [ ] Two  <!-- s2 -->\n'
  expect(roundTrip(mixed)).toBe(mixed)
  expect(roundTrip('# Goal\n- [ ] One  <!-- s1 -->')).toBe('# Goal\n- [ ] One  <!-- s1 -->')
  expect(roundTrip('# Goal')).toBe('# Goal')
})

test('a hand-edited file comes back byte for byte: notes, odd spacing, unknown lines, missing ids, a second Later heading', () => {
  expect(roundTrip(HAND_EDITED)).toBe(HAND_EDITED)
})

test('a byte-order mark before the title is kept, and the file is still a plan', () => {
  const text = '\uFEFF# Goal\n- [ ] One  <!-- s1 -->\n'
  expect(sectionsOf(parsePlanFile(text)!).title).toBe('Goal')
  expect(roundTrip(text)).toBe(text)
})

test('a lone carriage return inside a line is kept, and that line is not a step', () => {
  const text = '# Goal\n- [ ] One\rtwo  <!-- s1 -->\n'
  expect(sectionsOf(parsePlanFile(text)!).steps).toEqual([])
  expect(roundTrip(text)).toBe(text)
})

// ---- Ids ----

test('a step with no id gets the next number after the highest one in the file, in the order of the file', () => {
  const file = withIds(parsePlanFile('# G\n- [ ] A\n- [ ] B  <!-- s7 -->\n- [ ] C\n\n## Later\n- [ ] D\n- [ ] E  <!-- l2 -->\n')!)
  const { steps, later } = sectionsOf(file)
  expect(steps.map(s => s.id)).toEqual(['s8', 's7', 's9'])
  expect(later.map(l => l.id)).toEqual(['l3', 'l2'])
  expect(serialisePlanFile(file)).toBe('# G\n- [ ] A  <!-- s8 -->\n- [ ] B  <!-- s7 -->\n- [ ] C  <!-- s9 -->\n\n## Later\n- [ ] D  <!-- l3 -->\n- [ ] E  <!-- l2 -->\n')
})

test('a duplicate id is given a new one; the first keeps its own', () => {
  const file = withIds(parsePlanFile('# G\n- [ ] One  <!-- s1 -->\n- [ ] Copy  <!-- s1 -->\n')!)
  expect(sectionsOf(file).steps.map(s => s.id)).toEqual(['s1', 's2'])
})

test('a file whose steps all have ids is not changed by giving ids, and nothing is written into other lines', () => {
  const file = parsePlanFile(WELL_FORMED)!
  expect(withIds(file)).toBe(file)
  const edited = '# G\nnote\n- [ ] A\n  - Decided: x\n  trailing note\n'
  expect(serialisePlanFile(withIds(parsePlanFile(edited)!))).toBe('# G\nnote\n- [ ] A  <!-- s1 -->\n  - Decided: x\n  trailing note\n')
})

test('giving ids does not change the file it was given', () => {
  const file = parsePlanFile('# G\n- [ ] A\n')!
  const before = serialisePlanFile(file)
  withIds(file)
  expect(serialisePlanFile(file)).toBe(before)
})

// ---- Lines under a step ----

test('every indented line straight under a step is its own: Decided lines are choices, the rest are notes that keep their words', () => {
  const text = '# G\n- [ ] One  <!-- s1 -->\n  - Decided: a\n    a deeper note\n\t- tabbed\n  - Decided: b\n- [ ] Two  <!-- s2 -->\n'
  const one = sectionsOf(parsePlanFile(text)!).steps[0]!
  expect(one.sub.map(s => [s.isDecision, s.text])).toEqual([[true, 'a'], [false, '    a deeper note'], [false, '\t- tabbed'], [true, 'b']])
  expect(decidedOf(one).map(d => d.text)).toEqual(['a', 'b'])
  expect(roundTrip(text)).toBe(text)
})

test('a blank line, or a line that is not indented, ends what is under a step', () => {
  const { steps } = sectionsOf(parsePlanFile('# G\n- [ ] One  <!-- s1 -->\n  under\n\n  after a blank\n- [ ] Two  <!-- s2 -->\nplain\n  after plain\n')!)
  expect(steps.map(s => s.sub.map(x => x.text))).toEqual([['  under'], []])
})

// ---- The next line ----

const MARK = '<!-- next: s7 l3 -->'

test('a next line is read strictly, as a row of its own, and only the first one counts', () => {
  const file = parsePlanFile(`# G\n- [ ] A  <!-- s1 -->\n${MARK}\n<!-- next: s9 l9 -->\n`)!
  expect(file.rows.map(r => r.kind)).toEqual(['title', 'item', 'next', 'other'])
  expect(nextIds(file)).toEqual({ s: 7, l: 3 })
  for (const odd of ['<!-- next: s7 l3 --> ', ' <!-- next: s7 l3 -->', '<!--next: s7 l3-->', '<!-- next: s7 -->', '<!-- next: s1234567 l1 -->', '<!-- next: s7 l3 --> x'])
    expect(parsePlanFile(`# G\n${odd}\n`)!.rows.map(r => r.kind)).toEqual(['title', 'other'])
})

test('the next number is the larger of the line and one more than the highest id: a lowered or deleted line mends itself', () => {
  expect(nextIds(parsePlanFile('# G\n- [ ] A  <!-- s5 -->\n<!-- next: s1 l1 -->\n')!)).toEqual({ s: 6, l: 1 })
  expect(nextIds(parsePlanFile('# G\n- [ ] A  <!-- s5 -->\n\n## Later\n- [ ] B  <!-- l2 -->\n')!)).toEqual({ s: 6, l: 3 })
  expect(nextIds(parsePlanFile('# G\n<!-- next: s9 l4 -->\n- [ ] A  <!-- s5 -->\n')!)).toEqual({ s: 9, l: 4 })
  const given = withIds(parsePlanFile('# G\n<!-- next: s9 l4 -->\n- [ ] A\n\n## Later\n- [ ] B\n')!)
  expect(sectionsOf(given).steps.map(s => s.id)).toEqual(['s9'])
  expect(sectionsOf(given).later.map(s => s.id)).toEqual(['l4'])
})

test('the next line is made at the end of the file, mended in place when lower, and left alone when right', () => {
  const made = withMark(parsePlanFile('# G\n- [ ] A  <!-- s1 -->\n')!, { s: 4, l: 2 })
  expect(serialisePlanFile(made)).toBe('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s4 l2 -->\n')
  const mended = withMark(parsePlanFile('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s1 l1 -->\nnote\n')!, { s: 1, l: 1 })
  expect(serialisePlanFile(mended)).toBe('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s2 l1 -->\nnote\n')
  const right = parsePlanFile('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s2 l1 -->\n')!
  expect(withMark(right, { s: 2, l: 1 })).toBe(right)
  // Never lower than what the line already says.
  expect(serialisePlanFile(withMark(parsePlanFile('# G\n<!-- next: s8 l1 -->\n')!, { s: 2, l: 1 }))).toBe('# G\n<!-- next: s8 l1 -->\n')
})

test('the next line follows the file\'s line breaks, and closes a last line that had none', () => {
  expect(serialisePlanFile(withMark(parsePlanFile('# G\r\n- [ ] A  <!-- s1 -->\r\n')!, { s: 2, l: 1 }))).toBe('# G\r\n- [ ] A  <!-- s1 -->\r\n<!-- next: s2 l1 -->\r\n')
  expect(serialisePlanFile(withMark(parsePlanFile('# G\n- [ ] A  <!-- s1 -->')!, { s: 2, l: 1 }))).toBe('# G\n- [ ] A  <!-- s1 -->\n<!-- next: s2 l1 -->\n')
  expect(serialisePlanFile(withMark(parsePlanFile('# G\r\n- [ ] A  <!-- s1 -->\r\n  - Decided: x')!, { s: 2, l: 1 }))).toBe('# G\r\n- [ ] A  <!-- s1 -->\r\n  - Decided: x\r\n<!-- next: s2 l1 -->\r\n')
  expect(serialisePlanFile(withMark(parsePlanFile('# G')!, { s: 1, l: 1 }))).toBe('# G\n<!-- next: s1 l1 -->\n')
})

test('the next line never says more than the id pattern can read', () => {
  expect(serialisePlanFile(withMark(parsePlanFile(`# G\n- [ ] A  <!-- s${MAX_ID} -->\n`)!, { s: 1, l: 1 }))).toContain(`<!-- next: s${MAX_ID} l1 -->`)
})
