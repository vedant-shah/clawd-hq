import { expect, test } from 'claude-code/testing'
import { BRIEF_NOTE, fit, whoOf, oneLine, parseChoices, parseEffort, projectFiles, proposeLayoffs } from '../hooks/desk'
import * as desk from '../hooks/desk'

test('a TypeScript project lays off other stacks and niche domains, never built-ins', () => {
  const types = ['Explore', 'general-purpose', 'ecc:go-reviewer', 'ecc:typescript-reviewer', 'ecc:react-reviewer', 'ecc:rust-build-resolver', 'ecc:healthcare-reviewer', 'ecc:architect', 'acme-ops:Robin']
  const plan = proposeLayoffs(types, ['package.json', 'tsconfig.json', 'src'])
  expect(plan.laidOff).toEqual(['ecc:go-reviewer', 'ecc:healthcare-reviewer', 'ecc:rust-build-resolver'])
  expect(plan.stacks).toEqual(['TypeScript/React'])
})

test("Clawd's effort line comes off the brief", () => {
  expect(parseEffort('[effort: high]\nDesign the cache')).toEqual({ effort: 'high', prompt: 'Design the cache' })
  expect(parseEffort('[effort: turbo]\nDesign the cache')).toEqual({ prompt: '[effort: turbo]\nDesign the cache' })
  expect(parseEffort('Design the cache')).toEqual({ prompt: 'Design the cache' })
})

test('DECIDED lines are read from a report', () => {
  expect(parseChoices('ok\n- DECIDED: Use Drizzle — typed\nDECIDED:   \nQUESTION: x?')).toEqual(['Use Drizzle — typed'])
})

test('oneLine collapses whitespace and cuts long text with an ellipsis', () => {
  expect(oneLine('  a\n\n  b\t c  ', 50)).toBe('a b c')
  expect(oneLine('abcdefghij', 5)).toBe('abcd…')
  expect(oneLine('abcde', 5)).toBe('abcde')
  expect(oneLine('   ', 5)).toBe('')
})

test('decisions are no longer put in Clawd\'s context or in a brief, and the question box\'s answers are no longer read for saving: the helpers are gone', () => {
  for (const name of ['memoryBlock', 'memoryLines', 'recallNote', 'boxAnswers']) expect(desk).not.toHaveProperty(name)
})

test('the note on every brief tells a specialist to do the work itself and not hire other agents', () => {
  expect(BRIEF_NOTE).toContain('do not hire or start other agents')
  expect(BRIEF_NOTE).toContain('If the job needs more hands, say so in your report and Clawd will staff it.')
})

test('oneLine cuts on whole characters: an emoji is never split in half', () => {
  const cut = oneLine('😀😀😀😀😀😀', 4)
  expect(cut).toBe('😀😀😀…')
  expect(Array.from(cut)).toHaveLength(4)
  expect(oneLine('😀😀😀😀', 4)).toBe('😀😀😀😀')
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(oneLine('ab😀😀😀😀😀😀😀', 5))).toBe(false)
})

test('fit collapses whitespace and cuts long text at a word, with no mark', () => {
  expect(fit('  a\n\n  b\t c  ', 50)).toBe('a b c')
  expect(fit('one two three four', 12)).toBe('one two')
  expect(fit('abcdefghij', 5)).toBe('abcde')
  expect(fit('abcde', 5)).toBe('abcde')
  expect(fit('   ', 5)).toBe('')
  // Whole characters: an emoji is never split in half.
  expect(fit('😀😀😀😀😀😀', 4)).toBe('😀😀😀😀')
})

test('whoOf reads who something is from: a role, or the role of an older "Name the Role"; CEO and Clawd stay as they are', () => {
  expect(whoOf('Guard')).toBe('Guard')
  expect(whoOf('Sage the Guard')).toBe('Guard')
  expect(whoOf('Bean 71 the Writer')).toBe('Writer')
  expect(whoOf('CEO')).toBe('CEO')
  expect(whoOf('Clawd')).toBe('Clawd')
})

test('the note on every brief asks a specialist to say, in plain words, what step it is on', () => {
  expect(BRIEF_NOTE).toMatch(/start each step with one short sentence/i)
  expect(BRIEF_NOTE).toMatch(/everyday words/)
  expect(BRIEF_NOTE).toMatch(/Step 2 of 4/)
  expect(BRIEF_NOTE).toContain('DECIDED:')
})

test('the note on every brief asks a specialist to report its plan and each step with the step tool, in a line of its own', () => {
  expect(BRIEF_NOTE).toContain('mcp__clawd-hq__step')
  expect(BRIEF_NOTE).toMatch(/before (any )?other work/i)
  expect(BRIEF_NOTE).toMatch(/`total`.*3 to 8/)
  expect(BRIEF_NOTE).toContain('`done: 0`')
  expect(BRIEF_NOTE).toMatch(/after each step/i)
  expect(BRIEF_NOTE.split('\n').filter(l => l.includes('mcp__clawd-hq__step'))).toHaveLength(1)
})

test('the note on every brief sends a specialist\'s questions to Clawd in its report, and names no CEO desk', () => {
  expect(BRIEF_NOTE).toContain('`QUESTION: <question> | <option> / <option> | recommend: <option>`')
  expect(BRIEF_NOTE).toMatch(/Clawd, the chief of staff, reads these and asks the user only what needs the user/)
  expect(BRIEF_NOTE).toMatch(/do not stall/)
  expect(BRIEF_NOTE).not.toMatch(/CEO/)
})

test('a choice is kept whole up to its limit, and cut at a word past it', () => {
  // A choice is saved, so it is kept whole: only a runaway one is cut, at a word, with no mark.
  const whole = `Use Drizzle ${'because it is typed '.repeat(20)}`.trim()
  expect(parseChoices(`DECIDED: ${whole}`)[0]).toBe(whole)
  const long = 'Use the shared scoring table '.repeat(40)
  const [choice] = parseChoices(`DECIDED: ${long}`)
  expect(choice!.length).toBeLessThanOrEqual(600)
  expect(choice!.endsWith('…')).toBe(false)
})

test('the project\'s files are its top names and one level below, skipping hidden folders and node_modules', async () => {
  const tree: Record<string, Array<{ name: string; kind: string }>> = {
    '/repo': [{ name: 'package.json', kind: 'file' }, { name: 'src', kind: 'dir' }, { name: '.git', kind: 'dir' }, { name: 'node_modules', kind: 'dir' }],
    '/repo/src': [{ name: 'index.ts', kind: 'file' }],
    '/repo/.git': [{ name: 'HEAD', kind: 'file' }],
    '/repo/node_modules': [{ name: 'react', kind: 'dir' }],
  }
  const list = async (path: string) => { const found = tree[path]; if (!found) throw new Error('ENOENT'); return found }
  expect(await projectFiles('/repo', list)).toEqual(['package.json', 'src', 'index.ts', '.git', 'node_modules'])
})

test('no project folder, or one that cannot be listed, gives no names; an unreadable folder inside is skipped', async () => {
  expect(await projectFiles('', async () => [{ name: 'x', kind: 'file' }])).toEqual([])
  expect(await projectFiles('/repo', async () => { throw new Error('ENOENT') })).toEqual([])
  const list = async (path: string) => {
    if (path === '/repo') return [{ name: 'src', kind: 'dir' }, { name: 'README.md', kind: 'file' }]
    throw new Error('EACCES')
  }
  expect(await projectFiles('/repo', list)).toEqual(['src', 'README.md'])
})
