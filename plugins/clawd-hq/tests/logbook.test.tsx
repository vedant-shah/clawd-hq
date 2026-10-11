import { expect, test } from 'claude-code/testing'
import { DECISIONS, SURFACES, START, host } from './host'

const FILE = '/repo/.clawd-hq/decisions.md'
const remember = ($: Parameters<Parameters<typeof test>[1]>[0], decision: string) =>
  $.tool.call({ tool: 'mcp__clawd-hq__remember', decision } as never)
const drawn = async ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...DECISIONS })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}

test('a decision is written to a plain file in the project\'s .clawd-hq folder, one line each', async ($, on) => {
  const { files } = host(on)
  await $.session.start(START)
  await remember($, 'Scores live in Postgres')
  await remember($, 'Use Drizzle for migrations')
  const text = files.get(FILE)!
  expect(text).toMatch(/^# Clawd HQ decisions/)
  expect(text).toMatch(/- M1 · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · decision · CEO · clawd · Scores live in Postgres\n/)
  expect(text).toMatch(/- M2 · .* · Use Drizzle for migrations\n/)
})

test('the decisions in the file are what the Decisions tab shows when a session starts, hand edits included', async ($, on) => {
  const { files } = host(on)
  files.set(FILE, '# Clawd HQ decisions\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep it simple\n- Never use tabs\n')
  await $.session.start(START)
  for (const surface of SURFACES) {
    const text = await drawn($, surface)
    expect(text).toContain('Keep it simple')
    expect(text).toContain('Never use tabs')
  }
})

test('a project with no file starts with no decisions, and decisions kept the old way in the config folder are not copied', async ($, on) => {
  const { files } = host(on, [], { 'memory:/repo': [{ id: 'M1', kind: 'decision', text: 'Old store entry', by: 'CEO', at: 0, source: 'desk' }] })
  await $.session.start(START)
  for (const surface of SURFACES) expect(await drawn($, surface)).not.toContain('Old store entry')
  expect(files.has(FILE)).toBe(false)
  await remember($, 'Fresh start')
  expect(files.get(FILE)).not.toContain('Old store entry')
})

test('a hand edit made while the session runs survives the next decision, and the new line is numbered after the highest', async ($, on) => {
  const { files } = host(on)
  await $.session.start(START)
  await remember($, 'First')
  files.set(FILE, `${files.get(FILE)!}- Added by hand\n`)
  await remember($, 'Second')
  const text = files.get(FILE)!
  expect(text).toContain('Added by hand')
  expect(text).toMatch(/- M2 · .* · decision · CEO · desk · Added by hand\n/)
  expect(text).toMatch(/- M3 · .* · Second\n/)
})

test('forgetting a decision removes its line from the file', async ($, on) => {
  const { files } = host(on)
  await $.session.start(START)
  await remember($, 'Keep me')
  await remember($, 'Forget me')
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DECISIONS })
  await ui.press({ key: 'forget-M2' })
  await ui.unmount()
  expect(files.get(FILE)).toContain('Keep me')
  expect(files.get(FILE)).not.toContain('Forget me')
})

test('a folder it cannot write to costs one toast and no decision: it stays for this session', async ($, on) => {
  const { files, disk, toasts } = host(on)
  disk.isWriteFailing = true
  await $.session.start(START)
  await remember($, 'Kept in memory')
  await remember($, 'Still kept')
  expect(files.has(FILE)).toBe(false)
  expect(toasts.filter(t => /decisions\.md/.test(t))).toHaveLength(1)
  expect(await drawn($, 'terminal')).toContain('Kept in memory')
  expect(await drawn($, 'terminal')).toContain('Still kept')
})

test('a file that exists but cannot be read is never overwritten: the decision stays for this session and you are told once', async ($, on) => {
  const { files, disk, toasts } = host(on)
  const original = '- M1 · 2026-10-10 14:03 · decision · CEO · desk · Hidden\n'
  files.set(FILE, original)
  disk.isReadFailing = true
  await $.session.start(START)
  await remember($, 'Carry on')
  await remember($, 'And on')
  expect(files.get(FILE)).toBe(original)
  expect(toasts.filter(t => /decisions\.md/.test(t))).toHaveLength(1)
  const text = await drawn($, 'terminal')
  expect(text).toContain('Carry on')
  expect(text).toContain('And on')
})

test('notes you wrote in the file survive a new decision', async ($, on) => {
  const { files } = host(on)
  files.set(FILE, '# Our decisions\n\nTeam rules below.\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep it simple\n\n## Later\nTo discuss.\n')
  await $.session.start(START)
  await remember($, 'Ship small')
  const text = files.get(FILE)!
  expect(text).toContain('# Our decisions\n\nTeam rules below.\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep it simple\n\n## Later\nTo discuss.\n')
  expect(text).toMatch(/- M2 · .* · Ship small\n$/)
})

test('if the plugin cannot tell whether the file is there, it does not write', async ($, on) => {
  const { files, disk, toasts } = host(on)
  files.set(FILE, '- M1 · 2026-10-10 14:03 · decision · CEO · desk · Precious\n')
  disk.isExistsFailing = true
  await $.session.start(START)
  await remember($, 'Carry on')
  expect(files.get(FILE)).toBe('- M1 · 2026-10-10 14:03 · decision · CEO · desk · Precious\n')
  expect(toasts.filter(t => /decisions\.md/.test(t))).toHaveLength(1)
})
