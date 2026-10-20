import { expect, test } from 'claude-code/testing'
import { ANSWER_MAX, FILE_MAX, deferredIn, linesWritten, unfinishedLines } from '../hooks/left-scan'

// ---- Source 1: deferring sentences in an answer ----

test('the deferring phrases are found, one sentence each', () => {
  const found: Array<[string, string]> = [
    ["I'll wire up the retry logic later.", "I'll wire up the retry logic later."],
    ['The migration is left for later.', 'The migration is left for later.'],
    ['Token refresh is not done yet.', 'Token refresh is not done yet.'],
    ['I skipped the end-to-end tests.', 'I skipped the end-to-end tests.'],
    ["I didn't run the linter.", "I didn't run the linter."],
    ['Docs are out of scope for now.', 'Docs are out of scope for now.'],
    ['You may want to add rate limiting.', 'You may want to add rate limiting.'],
    ['The next step would be to add pagination.', 'The next step would be to add pagination.'],
    ['TODO: handle the empty state.', 'TODO: handle the empty state.'],
    ['I left the caching for a follow-up.', 'I left the caching for a follow-up.'],
  ]
  for (const [answer, sentence] of found) expect([answer, deferredIn(answer)]).toEqual([answer, [sentence]])
})

test('only the deferring sentence of a longer answer is returned, from a list too', () => {
  const answer = ['Built the panel and it draws on both surfaces.', '', '- Added the button', '- I skipped the desktop check for now', '', 'All 12 tests pass.'].join('\n')
  expect(deferredIn(answer)).toEqual(['I skipped the desktop check for now'])
})

test('false positives stay out: negations, past cleanup, other subjects, questions, quotes and code', () => {
  const quiet = [
    'All tests pass and nothing was skipped.',
    'I removed the TODO comments from the file.',
    'No TODO is left in the diff.',
    'The loop skipped hidden files by design.',
    'The TODO list now shows three items.',
    'I will report back once it is done.',
    "Let me know if you'd like changes later.",
    'The report will come later today from the Builder.',
    'You may want to see the diff in the Settings tab.',
    'Should I do the docs later?',
    'The next step is done and merged.',
    'It works for now and for later.',
    'Resolved the FIXME in the parser.',
    'The tests were not skipped.',
    'We have no skipped tests.',
    'I fixed the thing that was not working yet again.',
    '',
    '   ',
  ]
  for (const answer of quiet) expect([answer, deferredIn(answer)]).toEqual([answer, []])
  expect(deferredIn('> I skipped the tests for now.\n\nDone.')).toEqual([])
  expect(deferredIn('Here is the snippet:\n```\n// I will do the rest later\nTODO: later\n```\nDone.')).toEqual([])
})

test('at most three are kept from one answer, and a runaway sentence is cut at a word with no mark', () => {
  const many = ['I skipped A.', 'I skipped B.', 'I skipped C.', 'I skipped D.'].join(' ')
  expect(deferredIn(many)).toEqual(['I skipped A.', 'I skipped B.', 'I skipped C.'])
  const long = `I skipped ${'the very long thing '.repeat(40)}entirely.`
  const [one] = deferredIn(long)
  expect(one!.length).toBeLessThanOrEqual(ANSWER_MAX)
  expect(one).not.toMatch(/[….]{2,}$|…$/)
  expect(deferredIn('I skipped A. I skipped A.')).toEqual(['I skipped A.'])
})

test('control characters and hidden marks are taken out of a sentence', () => {
  expect(deferredIn('I skipped the\u0007 checks​ for now.')).toEqual(['I skipped the checks for now.'])
})

// ---- Source 2: unfinished-work lines written into files ----

const hits = (text: string, before = '') => unfinishedLines(before, text).map(h => [h.line, h.text])

test('TODO and FIXME comments are found in the comment styles of the common languages', () => {
  expect(hits('const a = 1 // TODO: handle empty list')).toEqual([[1, 'TODO: handle empty list']])
  expect(hits('x = 1\n# FIXME retry on 500')).toEqual([[2, 'FIXME retry on 500']])
  expect(hits('/* TODO tidy up */')).toEqual([[1, 'TODO tidy up']])
  expect(hits(' * TODO document the options')).toEqual([[1, 'TODO document the options']])
  expect(hits('-- TODO add an index')).toEqual([[1, 'TODO add an index']])
  expect(hits('<!-- TODO replace the logo -->')).toEqual([[1, 'TODO replace the logo']])
  expect(hits('{/* FIXME wrap on narrow panes */}')).toEqual([[1, 'FIXME wrap on narrow panes']])
})

test('skipped tests are found in each test tool\'s spelling', () => {
  const lines = ["it.skip('does x', () => {})", "test.skip('does y', async () => {})", "describe.skip('suite', () => {})", "xit('old', () => {})", "xdescribe('old suite', () => {})",
    '@pytest.mark.skip(reason="later")', '\tt.Skip("flaky")']
  for (const line of lines) expect([line, hits(line).length]).toEqual([line, 1])
  expect(hits("it.skip('does x', () => {})")[0]![1]).toBe("it.skip('does x', () => {})")
})

test('not-implemented lines are found', () => {
  expect(hits("  throw new Error('Not implemented')")).toEqual([[1, "throw new Error('Not implemented')"]])
  expect(hits('    raise NotImplementedError')).toEqual([[1, 'raise NotImplementedError']])
  expect(hits('// export is not implemented for csv')[0]![0]).toBe(1)
})

test('ordinary code and words near the markers are not hits', () => {
  const quiet = ['const todo = []', 'const TODOS = 3', "it('works', () => {})", "test('skips blank lines', () => {})", 'function skipped() {}', 'xit_code = 1', 'let implemented = true',
    'the list is implemented', "const x = 'TODO'", 'document.title = "FIXME"']
  for (const line of quiet) expect([line, hits(line)]).toEqual([line, []])
})

test('only lines that are new count: what the old text already had is not read again', () => {
  const before = 'a()\n// TODO: old one\nb()'
  expect(hits('a()\n// TODO: old one\nb()\n// TODO: new one', before)).toEqual([[4, 'TODO: new one']])
  expect(hits('  // TODO: old one', before)).toEqual([])
  // The same line twice where the old text had it once: one is new.
  expect(hits('// TODO: old one\n// TODO: old one', '// TODO: old one')).toEqual([[2, 'TODO: old one']])
})

test('a line with a key or token is left out, and a long line is cut at a word with no mark', () => {
  expect(hits('// TODO: rotate sk-abcdefghijklmnopqrstuvwxyz123456')).toEqual([])
  const [hit] = unfinishedLines('', `// TODO: ${'word '.repeat(80)}`)
  expect(hit!.text.length).toBeLessThanOrEqual(FILE_MAX)
  expect(hit!.text).not.toMatch(/…|\.\.\.$/)
})

test('at most five are kept from one change, and a repeated line once', () => {
  const many = Array.from({ length: 8 }, (_, n) => `// TODO: item ${n}`).join('\n')
  expect(unfinishedLines('', many).map(h => h.line)).toEqual([1, 2, 3, 4, 5])
  expect(hits('// TODO: same\nx()\n// TODO: same')).toEqual([[1, 'TODO: same']])
})

test('what each file tool writes: Write is its content against the old file, Edit its new text against its old, MultiEdit each edit, a notebook its cell', () => {
  const edit = { file_path: '/p/a.ts', old_string: '// TODO: keep\nx()', new_string: '// TODO: keep\nx()\n// TODO: add' }
  expect(linesWritten('Edit', edit, '').map(h => h.text)).toEqual(['TODO: add'])
  const multi = { file_path: '/p/a.ts', edits: [{ old_string: 'a', new_string: 'a // TODO: one' }, { old_string: 'b', new_string: "it.skip('x', f)" }] }
  expect(linesWritten('MultiEdit', multi, '').map(h => h.text)).toEqual(['TODO: one', "it.skip('x', f)"])
  expect(linesWritten('Write', { file_path: '/p/a.ts', content: '// TODO: keep\n// TODO: add' }, '// TODO: keep').map(h => [h.line, h.text])).toEqual([[2, 'TODO: add']])
  expect(linesWritten('NotebookEdit', { notebook_path: '/p/n.ipynb', new_source: '# TODO: plot it', edit_mode: 'insert' }, '').map(h => h.text)).toEqual(['TODO: plot it'])
  expect(linesWritten('NotebookEdit', { notebook_path: '/p/n.ipynb', new_source: '# TODO: plot it', edit_mode: 'delete' }, '')).toEqual([])
  for (const odd of [{}, { content: 5 }, { edits: 'x' }, { edits: [null, 3, {}] }]) expect(linesWritten('Write', odd as never, '')).toEqual([])
  expect(linesWritten('Edit', { file_path: '/p/a.ts' } as never, '')).toEqual([])
  expect(linesWritten('Bash', { command: '// TODO: no' } as never, '')).toEqual([])
})
