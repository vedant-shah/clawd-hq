import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { RULES_FILE, VOICE_FILE } from '../hooks/instructions'
import { START, host, paneProps } from './host'

type On = Parameters<typeof host>[0]

/** The plugin's own folder: the one above this file's. */
const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
/** Clawd's instructions and voice notes live in the Settings tab, below the switches. */
const CLAWD = paneProps('clawd-hq-settings', 'Settings')
const OWN_RULES = '/home/me/.clawd-hq/chief-of-staff.md'
const OWN_VOICE = '/home/me/.clawd-hq/soul.md'
const RULES = '# Clawd, chief of staff\n\nYou are Clawd.\n\n## What you do yourself\n\n- Talk with the person.\n- One-step **jobs**: a `single` command.\n\n## When to hand work over\n\nHand over every job.\n'
const VOICE = '# Clawd\'s voice\n\nTone notes.\n\n## Who you are\n\n- A colleague.\n'

/** The host, a home folder, the shipped files, and a prompt box that records what it was given. */
function office(on: On, store: Record<string, unknown> = {}) {
  const h = host(on, [], store)
  on('env.get', (_$, e) => ({ value: ({ HOME: '/home/me' } as Record<string, string>)[(e as { name: string }).name] }) as never)
  const box = { text: '', filled: [] as Array<{ text: string; mode: string }>, answer: { isFilled: true } as { isFilled: boolean; refusal?: string } }
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }) as never)
  on('prompt.fill', (_$, e) => {
    const f = e as { text: string; mode: string }
    if (box.answer.isFilled) box.filled.push({ text: f.text, mode: f.mode })
    return box.answer as never
  })
  on('prompt.compose', () => ({ sections: [] }))
  h.files.set(`${ROOT}/${RULES_FILE}`, RULES)
  h.files.set(`${ROOT}/${VOICE_FILE}`, VOICE)
  return { ...h, box }
}

const mount = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => $.ui.mount({ plugin: 'clawd-hq', surface, ...CLAWD })
const shows = async (ui: Awaited<ReturnType<typeof mount>>, text: string | RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
const compose = ($: Engine) => $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)

/** The Markdown blocks the tab draws, as their text. */
const blocks = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.findAll({ type: 'Markdown' })).map(m => m.props.text as string)

test('the tab shows each file whole as one markdown block, then the fixed rules, dim, with one Edit with Claude button per file and no file line for the built-in text', async ($, on) => {
  office(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    for (const text of ['INSTRUCTIONS', 'VOICE NOTES', 'ALWAYS', 'Fixed']) expect(await shows(ui, text)).toBe(true)
    expect(await shows(ui, /Edits go to|\.clawd-hq/)).toBe(false)
    expect(await shows(ui, /after \/clear|Changes apply from/)).toBe(false)
    expect(await ui.findAll({ type: 'Text', text: 'Edits apply from your next session.' })).toHaveLength(1)
    expect((await ui.findAll({ type: 'Text', text: 'Built-in' }))).toHaveLength(2)
    const shown = await ui.findAll({ type: 'Markdown' })
    expect(shown.map(m => m.props.text)).toHaveLength(3)
    expect(shown[0]?.props.text).toBe(RULES.trim())
    expect(shown[1]?.props.text).toBe(VOICE.trim())
    expect(shown[2]?.props.text).toMatch(/^- The person's recorded decisions are settled/)
    expect(shown[2]?.props.text).toMatch(/Never hide a failure, a skipped step/)
    expect(shown[2]?.props.text).not.toMatch(/## Always/)
    expect(shown[2]?.props.dimColor).toBe(true)
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
    expect(keys.filter(k => k.startsWith('clawd-'))).toEqual(['clawd-edit-rules', 'clawd-edit-voice'])
    for (const key of ['clawd-edit-rules', 'clawd-edit-voice']) expect((await ui.find({ key }))?.props.label).toBe('Edit with Claude')
    await ui.unmount()
  }
})

test('edit with an empty prompt box makes the own copy and puts a ready-made line in the box, never sending it', async ($, on) => {
  const { files, box, saved } = office(on)
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'clawd-edit-rules' })
  expect(box.filled).toEqual([{ text: 'Edit Clawd\'s instructions: ', mode: 'append' }])
  expect(files.get(OWN_RULES)).toBe(RULES)
  expect(saved.get('brief:seed:rules')).toBe(RULES.trim())
  expect(await shows(ui, 'Ready in your prompt box. Press Esc, finish the sentence, then Enter.')).toBe(true)
  await ui.unmount()
})

test('with text in the prompt box nothing is filled, and the tab says what to do', async ($, on) => {
  const { files, box } = office(on)
  box.text = 'a half-typed thought'
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'clawd-edit-voice' })
  expect(box.filled).toEqual([])
  expect(files.has(OWN_VOICE)).toBe(false)
  expect(await shows(ui, 'Your prompt box already has text. Send or clear it, then press again.')).toBe(true)
  await ui.unmount()
})

// The kit, like the engine, strips a refusal reason a hook writes itself, so only a refusal without one is reached from
// here; the "question open" and "no prompt box" reasons are covered in clawd-edit.test.ts.
test('where the box does not take the line, the tab shows it to type, and nothing is sent', async ($, on) => {
  const { box } = office(on)
  box.answer = { isFilled: false }
  await $.session.start(START)
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'clawd-edit-voice' })
  expect(await shows(ui, 'Type this in the chat:')).toBe(true)
  expect(await shows(ui, 'Edit Clawd\'s voice notes:')).toBe(true)
  expect(box.filled).toEqual([])
  await ui.unmount()
})

test('a filled box on the desktop says to finish and send, without the terminal\'s Esc', async ($, on) => {
  office(on)
  await $.session.start(START)
  const ui = await mount($, 'desktop')
  await ui.press({ key: 'clawd-edit-rules' })
  expect(await shows(ui, 'Ready in your prompt box. Finish the sentence, then send it.')).toBe(true)
  await ui.unmount()
})

test('an edited own copy is shown as yours, with Reset; Reset keeps a backup and brings the built-in text back', async ($, on) => {
  const { files } = office(on)
  files.set(OWN_RULES, '# Mine\n\n## Only this\n\n- Ask me first.\n')
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'Your copy')).toBe(true)
  // The file it lives in, from the home folder on, short.
  expect(await shows(ui, '~/.clawd-hq/chief-of-staff.md')).toBe(true)
  expect(await shows(ui, OWN_RULES)).toBe(false)
  expect((await blocks(ui))[0]).toBe('# Mine\n\n## Only this\n\n- Ask me first.')
  await ui.press({ key: 'clawd-reset-rules' })
  expect(files.get(`${OWN_RULES}.bak`)).toBe('# Mine\n\n## Only this\n\n- Ask me first.\n')
  expect(files.get(OWN_RULES)).toBe('')
  expect(await shows(ui, /Your copy is saved as .*chief-of-staff\.md\.bak/)).toBe(true)
  expect((await blocks(ui))[0]).toBe(RULES.trim())
  expect(await ui.find({ key: 'clawd-reset-rules' })).toBeUndefined()
  await ui.unmount()
})

test('an edit made during the session is marked as waiting for the next session, once a turn ends', async ($, on) => {
  const { files } = office(on)
  await $.session.start(START)
  await compose($)
  files.set(OWN_VOICE, 'Dry and short.')
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
  const ui = await mount($)
  const status = await ui.find({ type: 'Text', text: 'Edited, not in use yet' })
  expect(status?.props.dimColor).toBe(true)
  expect(await blocks(ui)).toContain('Dry and short.')
  await ui.unmount()
})

test('an own copy made from an older built-in text says a newer one exists', async ($, on) => {
  const { files } = office(on, { 'brief:seed:rules': '# An older built-in' })
  files.set(OWN_RULES, '# Mine')
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'A newer built-in exists')).toBe(true)
  await ui.unmount()
})

test('an own copy both edited this session and made from an older built-in text says both on one short dim line', async ($, on) => {
  const { files } = office(on, { 'brief:seed:rules': '# An older built-in' })
  files.set(OWN_RULES, '# Mine')
  await $.session.start(START)
  await compose($)
  files.set(OWN_RULES, '# Mine, changed')
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
  const ui = await mount($)
  const status = await ui.find({ type: 'Text', text: 'Edited, not in use yet · A newer built-in exists' })
  expect(status?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('with the voice file setting, the voice part is that file, and Reset is replaced by how to clear the setting', { options: { voiceFile: '/me/voice.md' } }, async ($, on) => {
  const { files } = office(on)
  files.set('/me/voice.md', 'Setting voice.')
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'Voice file setting')).toBe(true)
  expect(await shows(ui, '/me/voice.md')).toBe(true)
  expect(await blocks(ui)).toContain('Setting voice.')
  expect(await shows(ui, 'Clear \'Your own voice file\' to go back to the built-in voice')).toBe(true)
  expect(await ui.find({ key: 'clawd-reset-voice' })).toBeUndefined()
  await ui.unmount()
})

test('with Clawd not running the chat, the tab says edits apply once he is', { options: { chiefOfStaff: false } }, async ($, on) => {
  office(on)
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'Clawd isn\'t running the chat, so these are not in use until \'Clawd runs the chat\' is on.')).toBe(true)
  await ui.unmount()
})

test('nothing on the tab is cut short: a long file is shown in whole lines, every one reached with ▼, and every text wraps, on both surfaces', async ($, on) => {
  const { files } = office(on)
  const text = `# Mine\n\n## A heading that goes on for much longer than the pane is wide\n\n${Array.from({ length: 300 }, (_, i) => `- Rule ${i} with *marks*, \`code\` and **bold**.`).join('\n')}`
  files.set(OWN_RULES, text)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const shown = (await blocks(ui))[0] ?? ''
      expect(text.includes(shown)).toBe(true)
      shown.split('\n').forEach(line => seen.add(line))
      await ui.press({ key: 'clawd-down-rules' })
    }
    for (const line of text.split('\n')) if (line !== '') expect(seen.has(line)).toBe(true)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some(t => t.props.wrap === 'truncate' || /…/.test(t.text))).toBe(false)
    for (let i = 0; i < 40; i++) await ui.press({ key: 'clawd-up-rules' })
    await ui.unmount()
  }
})

// ---- The box each file sits in ----

/** An own copy of the rules 62 lines long: a heading, a blank line, then 60 rules. */
const LONG = `# Mine\n\n${Array.from({ length: 60 }, (_, i) => `- Rule ${i + 1}.`).join('\n')}`
/** The count texts under the boxes, in order (a Text keeps no key, so they are found by what they say). */
const counts = async (ui: Awaited<ReturnType<typeof mount>>) => ui.findAll({ type: 'Text', text: /^lines \d+–\d+ of \d+$/ })
/** The count under one file's box: the rules' box comes first, and only a box with ▲ ▼ has one. */
async function countOf(ui: Awaited<ReturnType<typeof mount>>, part: 'rules' | 'voice') {
  const rulesHasOne = (await ui.find({ key: 'clawd-up-rules' })) !== undefined
  return (await counts(ui))[part === 'rules' || !rulesHasOne ? 0 : 1]?.text
}
const press = async (ui: Awaited<ReturnType<typeof mount>>, key: string, times = 1) => { for (let i = 0; i < times; i++) await ui.press({ key }) }

test('a long file sits in a darker box of about 12 lines, with ▲ ▼ and a dim count; they move it by about 10 and stop at the ends, on both surfaces', async ($, on) => {
  const { files } = office(on)
  files.set(OWN_RULES, LONG)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    const box = await ui.find({ key: 'clawd-box-rules' })
    expect(box?.props.backgroundColor).toBe(surface === 'terminal' ? 'userMessageBackground' : '#8080801a')
    expect((await blocks(ui))[0]).toBe(LONG.split('\n').slice(0, 12).join('\n'))
    expect(await countOf(ui, 'rules')).toBe('lines 1–12 of 62')
    expect((await counts(ui))[0]?.props.dimColor).toBe(true)
    // At the top, ▲ is dim and does nothing.
    expect((await ui.find({ key: 'clawd-up-rules' }))?.props.dimColor).toBe(true)
    await press(ui, 'clawd-up-rules')
    expect(await countOf(ui, 'rules')).toBe('lines 1–12 of 62')
    await press(ui, 'clawd-down-rules')
    expect(await countOf(ui, 'rules')).toBe('lines 11–22 of 62')
    expect((await blocks(ui))[0]).toBe(LONG.split('\n').slice(10, 22).join('\n'))
    await press(ui, 'clawd-up-rules')
    expect(await countOf(ui, 'rules')).toBe('lines 1–12 of 62')
    // At the end, ▼ is dim and does nothing; the last window still fills the box.
    await press(ui, 'clawd-down-rules', 10)
    expect(await countOf(ui, 'rules')).toBe('lines 51–62 of 62')
    expect((await ui.find({ key: 'clawd-down-rules' }))?.props.dimColor).toBe(true)
    await press(ui, 'clawd-up-rules', 10)
    await ui.unmount()
  }
})

test('a file that fits sits in the same box, with no ▲ ▼ and no count', async ($, on) => {
  office(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    for (const part of ['rules', 'voice']) {
      expect((await ui.find({ key: `clawd-box-${part}` }))?.props.backgroundColor).toBeDefined()
      expect(await ui.find({ key: `clawd-up-${part}` })).toBeUndefined()
      expect(await ui.find({ key: `clawd-down-${part}` })).toBeUndefined()
    }
    expect(await counts(ui)).toHaveLength(0)
    expect((await blocks(ui))[0]).toBe(RULES.trim())
    await ui.unmount()
  }
})

test('the place is kept with the panel\'s display flags, for each file on its own: another drawing or surface shows the same lines', async ($, on) => {
  const { files } = office(on)
  files.set(OWN_RULES, LONG)
  files.set(OWN_VOICE, LONG.replace('# Mine', '# My voice'))
  await $.session.start(START)
  const first = await mount($)
  await press(first, 'clawd-down-rules', 2)
  await press(first, 'clawd-down-voice')
  await first.unmount()
  const other = await mount($, 'desktop')
  expect(await countOf(other, 'rules')).toBe('lines 21–32 of 62')
  expect(await countOf(other, 'voice')).toBe('lines 11–22 of 62')
  await other.unmount()
})

test('when the file changes, its box goes back to the top', async ($, on) => {
  const { files } = office(on)
  files.set(OWN_RULES, LONG)
  await $.session.start(START)
  const ui = await mount($)
  await press(ui, 'clawd-down-rules', 3)
  expect(await countOf(ui, 'rules')).toBe('lines 31–42 of 62')
  await ui.unmount()
  await compose($)
  files.set(OWN_RULES, `${LONG}\n- Rule 61.`)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
  const again = await mount($)
  expect(await countOf(again, 'rules')).toBe('lines 1–12 of 63')
  await press(again, 'clawd-down-rules')
  expect(await countOf(again, 'rules')).toBe('lines 11–22 of 63')
  await again.unmount()
})
