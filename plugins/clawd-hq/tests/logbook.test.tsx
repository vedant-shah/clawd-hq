import { expect, test } from 'claude-code/testing'
import { DECISIONS, SURFACES, START, host } from './host'

// The old decisions file, until the Decisions tab is retired. Nothing but a question-box answer writes to it any more, and what the
// file holds is the only way to fill the tab. The mechanics of writing it (notes kept, an unreadable file never overwritten, a folder
// that cannot be written to) are held by hooks/logbook.ts's and hooks/memory-io.ts's own tests, with a file system in memory.

const FILE = '/repo/.clawd-hq/decisions.md'
const drawn = async ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop') => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...DECISIONS })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}

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
})

test('forgetting a decision removes its line from the file', async ($, on) => {
  const { files } = host(on)
  files.set(FILE, '# Clawd HQ decisions\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep me\n- M2 · 2026-10-10 14:04 · decision · CEO · desk · Forget me\n')
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DECISIONS })
  await ui.press({ key: 'forget-M2' })
  await ui.unmount()
  expect(files.get(FILE)).toContain('Keep me')
  expect(files.get(FILE)).not.toContain('Forget me')
})

// ---- What is saved is saved whole ----

// The engine hands a question box's answers back as a map from each question's text to its answer, beside a `text` the model reads.
const boxResult = (answers: Record<string, string>, response?: string) => ({
  result: { questions: [], answers, ...(response === undefined ? {} : { response }) },
  text: `The user answered: ${Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(', ')}`,
})
const ask = ($: Parameters<Parameters<typeof test>[1]>[0], questions: string[]) =>
  $.tool.call({ tool: 'AskUserQuestion', questions: questions.map(question => ({ question, options: [{ label: 'A' }, { label: 'B' }] })) } as never)

test('your answer in a question box is saved whole, however long', async ($, on) => {
  const { files } = host(on)
  const answer = `Start fresh, and ${'keep the old ones where they are for now, '.repeat(6)}then decide later`
  expect(answer.length).toBeGreaterThan(200)
  on('tool.call', () => boxResult({ 'What happens to the old decisions?': answer }) as never)
  await $.session.start(START)
  await ask($, ['What happens to the old decisions?'])
  expect(files.get(FILE)).toContain(`What happens to the old decisions? → ${answer}`)
  expect(files.get(FILE)).not.toMatch(/…|The user answered/)
})

test('each question in a box is saved with its own answer, not with the whole reply', async ($, on) => {
  const { files } = host(on)
  on('tool.call', () => boxResult({ 'Which format?': 'Markdown', 'Copy the old ones?': 'Start fresh' }) as never)
  await $.session.start(START)
  await ask($, ['Which format?', 'Copy the old ones?'])
  const text = files.get(FILE)!
  expect(text).toMatch(/· Which format\? → Markdown\n/)
  expect(text).toMatch(/· Copy the old ones\? → Start fresh\n/)
  expect(text).not.toContain('The user answered')
})

test('a question you left unanswered in a box saves no decision; a typed reply with no picks is saved for it', async ($, on) => {
  const { files } = host(on)
  let reply: ReturnType<typeof boxResult> = boxResult({ 'Which format?': 'Markdown' })
  on('tool.call', () => reply as never)
  await $.session.start(START)
  await ask($, ['Which format?', 'Skipped one?'])
  expect(files.get(FILE)).toContain('Which format? → Markdown')
  expect(files.get(FILE)).not.toContain('Skipped one?')

  reply = boxResult({}, 'Do it the simple way')
  await ask($, ['How should it work?'])
  expect(files.get(FILE)).toContain('How should it work? → Do it the simple way')
})

test('a very long question never pushes its answer out of the saved decision', async ($, on) => {
  const { files } = host(on)
  const question = `Should we ${'keep going with this plan and '.repeat(90)}ship?`
  expect(question.length).toBeGreaterThan(2300)
  on('tool.call', () => boxResult({ [question]: 'Yes' }) as never)
  await $.session.start(START)
  await ask($, [question])
  expect(files.get(FILE)).toMatch(/ → Yes\n$/)
  // And it reads back the same on the next session.
  await $.session.start(START)
  expect(await drawn($, 'terminal')).toContain(' → Yes')
})
