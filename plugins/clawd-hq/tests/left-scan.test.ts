import { expect, test } from 'claude-code/testing'
import { CODE_EXTENSIONS, FILE_MAX, FILE_TOOLS, isProjectCode, languageOf, linesWritten, unfinishedLines } from '../hooks/left-scan'
import type { Language } from '../hooks/left-scan'

// The only source left in the scanner: real code markers in the text a file tool newly wrote, in a code file. Never prose.

const hits = (text: string, before = '', lang: Language = 'slash') => unfinishedLines(before, text, lang).map(h => [h.line, h.text])

test('only files of a programming language count; prose, data and files with no extension do not', () => {
  const code: Array<[string, Language]> = [
    ['/p/a.ts', 'slash'], ['/p/a.tsx', 'slash'], ['/p/a.js', 'slash'], ['/p/a.mjs', 'slash'], ['/p/A.java', 'slash'], ['/p/a.go', 'slash'], ['/p/a.rs', 'slash'], ['/p/a.swift', 'slash'],
    ['/p/a.py', 'hash'], ['/p/a.rb', 'hash'], ['/p/a.sh', 'hash'], ['/p/a.sql', 'dash'], ['/p/a.lua', 'dash'], ['/p/a.html', 'html'], ['/p/a.vue', 'slash'],
  ]
  for (const [path, lang] of code) expect([path, languageOf(path)]).toEqual([path, lang])
  for (const path of ['/p/README.md', '/p/a.mdx', '/p/notes.txt', '/p/guide.rst', '/p/data.json', '/p/c.yml', '/p/n.ipynb', '/p/Makefile', '/p/.gitignore', '/p/a', '/p/ts', '/p/a.ts.md', '']) {
    expect([path, languageOf(path)]).toEqual([path, undefined])
  }
  expect(languageOf('/p/A.TS')).toBe('slash')
  expect(CODE_EXTENSIONS.has('md')).toBe(false)
  expect([...CODE_EXTENSIONS].every(e => e === e.toLowerCase())).toBe(true)
})

test('a path from the project folder is read only when it is a code file inside the project, not under docs/ or node_modules/', () => {
  for (const ok of ['src/a.ts', 'a.py', 'tests/a.test.ts', 'packages/x/src/b.go']) expect([ok, isProjectCode(ok)]).toEqual([ok, true])
  for (const no of ['README.md', 'docs/plan.ts', 'src/docs/x.ts', 'node_modules/x/index.js', 'doc/a.py', '/abs/src/a.ts', '../other/a.ts', 'src/../../a.ts', 'C:\\x\\a.ts', 'src/notes.txt', 'Makefile']) {
    expect([no, isProjectCode(no)]).toEqual([no, false])
  }
  expect(isProjectCode('src/docs.ts')).toBe(true)
})

test('TODO, FIXME and XXX are found inside a comment token of the file\'s language', () => {
  expect(hits('const a = 1 // TODO: handle empty list')).toEqual([[1, 'TODO: handle empty list']])
  expect(hits('/* TODO tidy up */')).toEqual([[1, 'TODO tidy up']])
  expect(hits(' * FIXME document the options')).toEqual([[1, 'FIXME document the options']])
  expect(hits('{/* FIXME wrap on narrow panes */}')).toEqual([[1, 'FIXME wrap on narrow panes']])
  expect(hits('// XXX this is a hack')).toEqual([[1, 'XXX this is a hack']])
  expect(hits('x = 1\n# FIXME retry on 500', '', 'hash')).toEqual([[2, 'FIXME retry on 500']])
  expect(hits('x = 1  # TODO later', '', 'hash')).toEqual([[1, 'TODO later']])
  expect(hits('-- TODO add an index', '', 'dash')).toEqual([[1, 'TODO add an index']])
  expect(hits('<!-- TODO replace the logo -->', '', 'html')).toEqual([[1, 'TODO replace the logo']])
})

test('a marker outside a comment, in another language\'s comment, in a string, or in a word is not a hit', () => {
  const quiet: Array<[string, Language]> = [
    ['const todo = []', 'slash'], ['const TODOS = 3', 'slash'], ['const XXXL = 3', 'slash'], ["const x = 'TODO'", 'slash'], ['document.title = "FIXME"', 'slash'],
    ['const s = "// TODO: not a comment"', 'slash'], ["const s = '/* FIXME */'", 'slash'], ['const s = `see # TODO`', 'slash'], ['print("# TODO: not a comment")', 'hash'],
    ['# TODO in the wrong language', 'slash'], ['// TODO in the wrong language', 'hash'], ['// TODO in the wrong language', 'dash'], ['# TODO in the wrong language', 'html'],
    ['Left undone checks TODO and FIXME comments', 'slash'], ['The TODO list is long', 'hash'], ['we need to TODO this', 'slash'],
  ]
  for (const [line, lang] of quiet) expect([line, hits(line, '', lang)]).toEqual([line, []])
})

test('a marker inside any string, including a template that runs over several lines, is not a hit', () => {
  const quiet = [
    '  h.files.set(file, `a()\\n// TODO: ${text}\\n`), { result: \'ok\' })',
    'x({ content: `TODO: ${text}`, ...(id === undefined ? {} : { id }) })',
    'x({ content: `// TODO: ${text}\\n` } as never)',
    'const s = `first\n// TODO: inside the template\n# FIXME: and this\nit.skip(\'x\')\nlast`',
    'const s = `a ${b} c\n// TODO: still inside\n`',
    'const s = `a ${`nested\n// TODO: deep`} b\n// FIXME: still inside`',
    'const s = `a ${ {x: 1}.x } // TODO: after the braces`',
    'const s = "say \\" // TODO: escaped quote"',
  ]
  for (const text of quiet) expect([text, hits(text)]).toEqual([text, []])
  expect(hits('const s = `open\nline two`\n// TODO: after the template')).toEqual([[3, 'TODO: after the template']])
  expect(hits('const s = `a ${b // TODO: a real comment in code\n}`')).toEqual([[1, 'TODO: a real comment in code']])
  expect(hits('/* start\n TODO: inside a block\n*/ x()\n// TODO: after')).toEqual([[2, 'TODO: inside a block'], [4, 'TODO: after']])
})

test('skipped tests are found in each test tool\'s spelling', () => {
  const lines = ["it.skip('does x', () => {})", "test.skip('does y', async () => {})", "describe.skip('suite', () => {})", "xit('old', () => {})", "xdescribe('old suite', () => {})",
    '@pytest.mark.skip(reason="later")', '\tt.Skip("flaky")']
  for (const line of lines) expect([line, hits(line).length]).toEqual([line, 1])
  expect(hits("it.skip('does x', () => {})")[0]![1]).toBe("it.skip('does x', () => {})")
})

test('not-implemented throws are found; the words "not implemented" in prose, comments and strings are not', () => {
  expect(hits("  throw new Error('Not implemented')")).toEqual([[1, "throw new Error('Not implemented')"]])
  expect(hits('  throw new NotImplementedError()')).toEqual([[1, 'throw new NotImplementedError()']])
  expect(hits('    raise NotImplementedError', '', 'hash')).toEqual([[1, 'raise NotImplementedError']])
  expect(hits('    raise NotImplementedError("later")', '', 'hash').length).toBe(1)
  const quiet = ['// export is not implemented for csv', "const msg = 'not implemented'", 'let notImplemented = true', 'Not implemented yet is shown in grey', "const s = \"throw new Error('Not implemented')\"", '// raise NotImplementedError']
  for (const line of quiet) expect([line, hits(line)]).toEqual([line, []])
})

test('ordinary code and words near the markers are not hits', () => {
  const quiet = ["it('works', () => {})", "test('skips blank lines', () => {})", 'function skipped() {}', 'xit_code = 1', 'let implemented = true', "const s = \"it.skip('x')\"", '@pytest.mark.skipif(cond)']
  for (const line of quiet) expect([line, hits(line)]).toEqual([line, []])
})

test('only lines that are new count: what the old text already had is not read again', () => {
  const before = 'a()\n// TODO: old one\nb()'
  expect(hits('a()\n// TODO: old one\nb()\n// TODO: new one', before)).toEqual([[4, 'TODO: new one']])
  expect(hits('  // TODO: old one', before)).toEqual([])
  expect(hits('// TODO: old one\n// TODO: old one', '// TODO: old one')).toEqual([[2, 'TODO: old one']])
})

test('a line with a key or token is left out, and a long line is cut at a word with no mark', () => {
  expect(hits('// TODO: rotate sk-abcdefghijklmnopqrstuvwxyz123456')).toEqual([])
  const [hit] = unfinishedLines('', `// TODO: ${'word '.repeat(80)}`, 'slash')
  expect(hit!.text.length).toBeLessThanOrEqual(FILE_MAX)
  expect(hit!.text).not.toMatch(/…|\.\.\.$/)
})

test('at most five are kept from one change, and a repeated line once', () => {
  const many = Array.from({ length: 8 }, (_, n) => `// TODO: item ${n}`).join('\n')
  expect(unfinishedLines('', many, 'slash').map(h => h.line)).toEqual([1, 2, 3, 4, 5])
  expect(hits('// TODO: same\nx()\n// TODO: same')).toEqual([[1, 'TODO: same']])
})

test('the file tools are Edit, Write and MultiEdit; a notebook is no code file', () => {
  expect([...FILE_TOOLS]).toEqual(['Edit', 'Write', 'MultiEdit'])
})

test('what each file tool writes: Write is its content against the old file, Edit its new text against its old, MultiEdit each edit', () => {
  const edit = { file_path: '/p/a.ts', old_string: '// TODO: keep\nx()', new_string: '// TODO: keep\nx()\n// TODO: add' }
  expect(linesWritten('Edit', edit, '').map(h => h.text)).toEqual(['TODO: add'])
  const multi = { file_path: '/p/a.ts', edits: [{ old_string: 'a', new_string: 'a // TODO: one' }, { old_string: 'b', new_string: "it.skip('x', f)" }] }
  expect(linesWritten('MultiEdit', multi, '').map(h => h.text)).toEqual(['TODO: one', "it.skip('x', f)"])
  expect(linesWritten('Write', { file_path: '/p/a.ts', content: '// TODO: keep\n// TODO: add' }, '// TODO: keep').map(h => [h.line, h.text])).toEqual([[2, 'TODO: add']])
  expect(linesWritten('Write', { file_path: '/p/a.py', content: 'def f():\n    # FIXME: slow\n    pass' }, '').map(h => h.text)).toEqual(['FIXME: slow'])
})

test('a file that is not code gives nothing, whatever it says; neither does a notebook, a bad input or another tool', () => {
  const prose = '- It keeps a "Left undone" list: `TODO` and `FIXME` comments, skipped tests (`it.skip`, `@pytest.mark.skip`) and "not implemented" lines.\n// TODO: even a comment-looking line\n# TODO: and this'
  for (const path of ['/p/README.md', '/p/docs/plan.mdx', '/p/notes.txt', '/p/guide.rst', '/p/data.json']) expect([path, linesWritten('Write', { file_path: path, content: prose }, '')]).toEqual([path, []])
  expect(linesWritten('NotebookEdit', { notebook_path: '/p/n.ipynb', new_source: '# TODO: plot it', edit_mode: 'insert' }, '')).toEqual([])
  for (const odd of [{}, { file_path: '/p/a.ts', content: 5 }, { file_path: '/p/a.ts', edits: 'x' }, { file_path: '/p/a.ts', edits: [null, 3, {}] }]) expect(linesWritten('Write', odd as never, '')).toEqual([])
  expect(linesWritten('Edit', { file_path: '/p/a.ts' } as never, '')).toEqual([])
  expect(linesWritten('Bash', { command: '// TODO: no' } as never, '')).toEqual([])
})
