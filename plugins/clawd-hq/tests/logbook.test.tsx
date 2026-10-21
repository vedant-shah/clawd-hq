import { expect, test } from 'claude-code/testing'
import { DECISIONS, PANE, SURFACES, START, host } from './host'

// The old decisions file, until the Decisions tab is retired. Nothing writes to it any more except a key choice a specialist
// reports, and what the file holds is the only other way to fill the tab. The mechanics of writing it (notes kept, an unreadable
// file never overwritten, a folder that cannot be written to) are held by hooks/logbook.ts's and hooks/memory-io.ts's own tests.

const FILE = '/repo/.clawd-hq/decisions.md'
const drawn = async ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop', pane = DECISIONS) => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
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

// ---- Answers in the question box are not saved ----

// The engine hands a question box's answers back as a map from each question's text to its answer, beside a `text` the model reads.
const boxResult = (answers: Record<string, string>, response?: string) => ({
  result: { questions: [], answers, ...(response === undefined ? {} : { response }) },
  text: `The user answered: ${Object.entries(answers).map(([q, a]) => `"${q}"="${a}"`).join(', ')}`,
})
const ask = ($: Parameters<Parameters<typeof test>[1]>[0], questions: string[]) =>
  $.tool.call({ tool: 'AskUserQuestion', questions: questions.map(question => ({ question, options: [{ label: 'A' }, { label: 'B' }] })) } as never)

test('an answer in a question box settles the job at hand only: nothing is saved, nothing is said about it, and the answer still reaches Clawd', async ($, on) => {
  const { files } = host(on)
  let reply: ReturnType<typeof boxResult> = boxResult({ 'Which format?': 'Markdown', 'Copy the old ones?': 'Start fresh' })
  on('tool.call', () => reply as never)
  await $.session.start(START)
  const answered = await ask($, ['Which format?', 'Copy the old ones?'])
  expect(answered).toEqual(reply)
  // A typed reply with no picks is no different.
  reply = boxResult({}, 'Do it the simple way')
  expect(await ask($, ['How should it work?'])).toEqual(reply)

  expect(files.has(FILE)).toBe(false)
  for (const surface of SURFACES) {
    expect(await drawn($, surface)).not.toMatch(/Markdown|Start fresh|simple way/)
    expect(await drawn($, surface, PANE)).not.toMatch(/On it, boss/)
  }
})

test('an old decisions file is left exactly as it is by an answer in the question box', async ($, on) => {
  const { files } = host(on)
  const old = '# Clawd HQ decisions\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep it simple\n'
  files.set(FILE, old)
  on('tool.call', () => boxResult({ 'Which format?': 'Markdown' }) as never)
  await $.session.start(START)
  await ask($, ['Which format?'])
  expect(files.get(FILE)).toBe(old)
})
