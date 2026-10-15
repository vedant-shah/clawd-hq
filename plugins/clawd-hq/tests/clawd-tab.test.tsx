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

test('the tab shows each file whole as one markdown block, the fixed rules as markdown after the instructions, with one edit button per file', async ($, on) => {
  office(on)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    for (const text of ['INSTRUCTIONS', 'VOICE NOTES', 'ALWAYS', 'Fixed, not editable']) expect(await shows(ui, text)).toBe(true)
    expect(await shows(ui, `Edits go to ${OWN_RULES}`)).toBe(true)
    expect(await shows(ui, 'Changes apply from your next session or after /clear.')).toBe(true)
    expect((await ui.findAll({ type: 'Text', text: 'Built-in text' }))).toHaveLength(2)
    const shown = await blocks(ui)
    expect(shown).toHaveLength(3)
    expect(shown[0]).toBe(RULES.trim())
    expect(shown[1]).toMatch(/^- The person's recorded decisions are settled/)
    expect(shown[1]).toMatch(/Never hide a failure, a skipped step/)
    expect(shown[1]).not.toMatch(/## Always/)
    expect(shown[2]).toBe(VOICE.trim())
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
    expect(keys.filter(k => k.startsWith('clawd-'))).toEqual(['clawd-edit-rules', 'clawd-edit-voice'])
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
  expect(await shows(ui, 'Your own copy')).toBe(true)
  expect(await shows(ui, OWN_RULES)).toBe(true)
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
  expect(await shows(ui, 'Edited. Clawd uses this from your next session.')).toBe(true)
  expect(await blocks(ui)).toContain('Dry and short.')
  await ui.unmount()
})

test('an own copy made from an older built-in text says a newer one exists', async ($, on) => {
  const { files } = office(on, { 'brief:seed:rules': '# An older built-in' })
  files.set(OWN_RULES, '# Mine')
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'A newer built-in version exists.')).toBe(true)
  await ui.unmount()
})

test('with the voice file setting, the voice part is that file, and Reset is replaced by how to clear the setting', { options: { voiceFile: '/me/voice.md' } }, async ($, on) => {
  const { files } = office(on)
  files.set('/me/voice.md', 'Setting voice.')
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'Your voice file setting')).toBe(true)
  expect(await shows(ui, '/me/voice.md')).toBe(true)
  expect(await blocks(ui)).toContain('Setting voice.')
  expect(await shows(ui, 'To go back to the built-in voice, clear the setting \'Your own voice file\'.')).toBe(true)
  expect(await ui.find({ key: 'clawd-reset-voice' })).toBeUndefined()
  await ui.unmount()
})

test('with Clawd not running the chat, the tab says edits apply once he is', { options: { chiefOfStaff: false } }, async ($, on) => {
  office(on)
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'Clawd isn\'t running the chat (setting \'Clawd runs the chat\' is off). Edits apply once it\'s on.')).toBe(true)
  await ui.unmount()
})

test('nothing on the tab is cut short: a long file is handed over whole, and every text wraps, on both surfaces', async ($, on) => {
  const { files } = office(on)
  const text = `# Mine\n\n## A heading that goes on for much longer than the pane is wide\n\n${Array.from({ length: 300 }, (_, i) => `- Rule ${i} with *marks*, \`code\` and **bold**.`).join('\n')}`
  files.set(OWN_RULES, text)
  await $.session.start(START)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mount($, surface)
    expect((await blocks(ui))[0]).toBe(text)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some(t => t.props.wrap === 'truncate' || /…/.test(t.text))).toBe(false)
    await ui.unmount()
  }
})
