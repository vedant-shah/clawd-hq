import { expect, test } from 'claude-code/testing'
import { appendRule } from '../hooks/rule-io'

// Writing one rule line into the project's CLAUDE.md, on a file system held in memory: what is there is never lost.

const PATH = '/repo/CLAUDE.md'

function disk(files: Record<string, string> = {}) {
  const held = new Map(Object.entries(files))
  const writes: Array<{ path: string; text: string }> = []
  const fail = { exists: false, read: false, write: false }
  const io = {
    exists: async (path: string) => { if (fail.exists) throw new Error('the check failed'); return held.has(path) },
    read: async (path: string) => { if (fail.read) throw new Error('too big to read'); const t = held.get(path); if (t === undefined) throw new Error('ENOENT'); return t },
    write: async (path: string, text: string) => { if (fail.write) throw new Error('EACCES'); writes.push({ path, text }); held.set(path, text) },
  }
  return { io, held, writes, fail }
}

test('a missing file is created with the rule as its one bullet', async () => {
  const d = disk()
  expect(await appendRule(d.io, PATH, 'Always run the tests')).toEqual({ ok: true, added: true })
  expect(d.held.get(PATH)).toBe('- Always run the tests\n')
})

test('the rule is added after what is there, which stays exactly as it was', async () => {
  const before = '# Project\n\nSome notes.\n- Keep it small\n'
  const d = disk({ [PATH]: before })
  expect(await appendRule(d.io, PATH, 'Never push without asking')).toEqual({ ok: true, added: true })
  expect(d.held.get(PATH)).toBe(`${before}- Never push without asking\n`)
  expect(d.held.get(PATH)!.startsWith(before)).toBe(true)
})

test('a file that does not end in a line break gets one first; a file with Windows line breaks keeps them', async () => {
  const a = disk({ [PATH]: '# Project' })
  await appendRule(a.io, PATH, 'Rule A')
  expect(a.held.get(PATH)).toBe('# Project\n- Rule A\n')
  const b = disk({ [PATH]: '# Project\r\n- Old\r\n' })
  await appendRule(b.io, PATH, 'Rule B')
  expect(b.held.get(PATH)).toBe('# Project\r\n- Old\r\n- Rule B\r\n')
})

test('a rule already in the file, as a bullet in any case or spacing, is not added again and nothing is written', async () => {
  const d = disk({ [PATH]: '# Project\n- Always  run the TESTS\n' })
  expect(await appendRule(d.io, PATH, 'Always run the tests')).toEqual({ ok: true, added: false })
  expect(d.writes).toHaveLength(0)
  const star = disk({ [PATH]: '* Always run the tests\n' })
  expect(await appendRule(star.io, PATH, 'Always run the tests')).toEqual({ ok: true, added: false })
  // A line that only contains the words is not the rule.
  const longer = disk({ [PATH]: '- Always run the tests and the linter\n' })
  expect(await appendRule(longer.io, PATH, 'Always run the tests')).toEqual({ ok: true, added: true })
})

test('a file that cannot be read is never overwritten: the reason comes back and nothing is written', async () => {
  const d = disk({ [PATH]: 'Precious notes\n' })
  d.fail.read = true
  const r = await appendRule(d.io, PATH, 'Rule')
  expect(r).toMatchObject({ ok: false })
  expect((r as { reason: string }).reason).toContain('too big to read')
  expect(d.writes).toHaveLength(0)
  expect(d.held.get(PATH)).toBe('Precious notes\n')
})

test('a failing existence check or write comes back as a reason, never a throw', async () => {
  const a = disk({ [PATH]: 'Notes\n' })
  a.fail.exists = true
  expect(await appendRule(a.io, PATH, 'Rule')).toMatchObject({ ok: false, reason: expect.stringContaining('the check failed') })
  expect(a.writes).toHaveLength(0)
  const b = disk({ [PATH]: 'Notes\n' })
  b.fail.write = true
  expect(await appendRule(b.io, PATH, 'Rule')).toMatchObject({ ok: false, reason: expect.stringContaining('EACCES') })
  expect(b.held.get(PATH)).toBe('Notes\n')
})

test('with no project folder there is nowhere to write', async () => {
  const d = disk()
  expect(await appendRule(d.io, '', 'Rule')).toMatchObject({ ok: false })
  expect(d.writes).toHaveLength(0)
})
