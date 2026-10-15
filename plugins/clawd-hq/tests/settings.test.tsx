import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { RULES_FILE, VOICE_FILE } from '../hooks/instructions'
import { SETTINGS, START, SURFACES, host, mountLog } from './host'

type On = Parameters<typeof host>[0]

/** The plugin's own folder: the one above this file's. */
const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')

const mount = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => $.ui.mount({ plugin: 'clawd-hq', surface, ...SETTINGS })
type Ui = Awaited<ReturnType<typeof mount>>
const shows = async (ui: Ui, text: string | RegExp) => (await ui.find({ type: 'Text', text })) !== undefined
/** How many texts read exactly this. */
const count = async (ui: Ui, text: string) => (await ui.findAll({ type: 'Text', text: new RegExp(`^${text}$`) })).length
const buttons = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const textIn = (node: unknown): string => (typeof node === 'string' ? node : typeof node === 'object' && node !== null ? ((node as Tree).children ?? []).map(textIn).join('') : '')
/** Every text and button of the drawing as it reads from top to bottom: the text itself, `button:` and the key for a button. */
function inOrder(node: Tree): string[] {
  if (node.type === 'Text') return [textIn(node)]
  if (node.type === 'Button') return [`button:${String(node.props.key)}`]
  return (node.children ?? []).flatMap(c => (typeof c === 'object' && c !== null ? inOrder(c as Tree) : []))
}

const WHERE = 'A change is saved to your settings, and the plugin reloads with it at once.'
const TITLES = ['Clawd runs the chat', 'Quiet chat', 'Recap', 'You should know']
const FIELDS = ['chiefOfStaff', 'quietChat', 'recap', 'youShouldKnow']
const LINES = [
  'Clawd hands work to specialists and reports in plain words.',
  'Hides finished notices and no-update lines; ctrl+o shows everything.',
  'One line on where things stand, after a few quiet minutes.',
  'A small model checks finished work and may leave a note.',
]
const labelOf = async (ui: Ui, field: string) => (await ui.find({ key: `config-${field}` }))?.props.label

/** The engine's settings rows and every change asked of them; `answer` is what a change gets back. */
function configs(on: On, answer: (e: { key: string; value: unknown }) => unknown = e => ({ value: e.value }), keys = FIELDS.map(f => `clawd-hq.${f}`)) {
  const asked: Array<{ key: string; value: unknown }> = []
  on('config.list', () => ({ value: keys.map(key => ({ key, label: key, kind: 'boolean', value: true, provider: { plugin: 'clawd-hq', tier: 'user' }, isLocked: false })) }) as never)
  on('config.set', (_$, e) => {
    const ev = e as { key: string; value: unknown }
    asked.push({ key: ev.key, value: ev.value })
    return answer(ev) as never
  })
  return asked
}

/** A specialist that started and finished after the session began, so the finished list has one row. */
async function oneFinisher($: Engine, on: On) {
  const { clock, session } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  session.startedAt = clock.now()
  await $.session.start(START)
  await clock.advance(5_000)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Updated the setup guide', subagentType: 'ecc:doc-updater' } as never)
  await clock.advance(70_000)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)
}

// ---- The configs ----

test('Settings lists the four configs, each with a toggle and one short line, then when a change applies', async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await shows(ui, 'CONFIGS')).toBe(true)
    expect(await shows(ui, /^SWITCHES$/)).toBe(false)
    for (const title of TITLES) expect(await shows(ui, title)).toBe(true)
    // All four are on by default; no voice file is set, so that one has no row.
    for (const field of FIELDS) expect(await labelOf(ui, field)).toBe('● On')
    expect(await shows(ui, 'Your own voice file')).toBe(false)
    for (const line of LINES) {
      expect(await shows(ui, line)).toBe(true)
      expect(line.split(' ').length).toBeLessThanOrEqual(12)
    }
    expect(await shows(ui, WHERE)).toBe(true)
    expect(await shows(ui, /\/plugin|on the page of Clawd HQ/)).toBe(false)
    await ui.unmount()
  }
})

test('a config that is off reads Off on its toggle', { options: { chiefOfStaff: false, quietChat: false, recap: false, youShouldKnow: false } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    for (const field of FIELDS) expect(await labelOf(ui, field)).toBe('○ Off')
    await ui.unmount()
  }
})

test('each config reads on its own', { options: { recap: false } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  const ui = await mount($)
  expect(await Promise.all(FIELDS.map(f => labelOf(ui, f)))).toEqual(['● On', '● On', '○ Off', '● On'])
  await ui.unmount()
})

test('a voice file that is set gets a read-only row with its path and one short line', { options: { voiceFile: '  /me/voice.md  ' } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await shows(ui, 'Your own voice file')).toBe(true)
    expect(await shows(ui, '/me/voice.md')).toBe(true)
    expect(await shows(ui, 'Sets how Clawd sounds; his rules stay the same.')).toBe(true)
    expect((await buttons(ui)).filter(k => k.startsWith('config-'))).toEqual(FIELDS.map(f => `config-${f}`))
    await ui.unmount()
  }
})

test('pressing a toggle changes that config in the settings to the other value, under the plugin\'s own key', { options: { recap: false } }, async ($, on) => {
  host(on)
  const asked = configs(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    asked.length = 0
    const ui = await mount($, surface)
    for (const field of FIELDS) await ui.press({ key: `config-${field}` })
    expect(asked).toEqual([
      { key: 'clawd-hq.chiefOfStaff', value: false }, { key: 'clawd-hq.quietChat', value: false },
      { key: 'clawd-hq.recap', value: true }, { key: 'clawd-hq.youShouldKnow', value: false },
    ])
    expect(await shows(ui, /^Could not change/)).toBe(false)
    await ui.unmount()
  }
})

test('the key is the one the settings list for this plugin\'s field, whatever its plugin part', async ($, on) => {
  host(on)
  const asked = configs(on, e => ({ value: e.value }), ['other.recap', 'clawd-hq@inline.recap'])
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'config-recap' })
  expect(asked).toEqual([{ key: 'clawd-hq@inline.recap', value: false }])
  await ui.unmount()
})

test('a change the settings refuse shows its reason plainly, and the toggle keeps its value', async ($, on) => {
  host(on)
  configs(on, () => ({ deny: 'Your organization manages this setting.' }))
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    await ui.press({ key: 'config-recap' })
    expect(await shows(ui, 'Could not change Recap: Your organization manages this setting.')).toBe(true)
    expect(await labelOf(ui, 'recap')).toBe('● On')
    await ui.unmount()
  }
})

test('while Clawd is busy with a turn the configs cannot be changed: dimmed values, no toggles, and one plain line; free again after it', async ($, on) => {
  host(on)
  const asked = configs(on)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the login bug', turnId: 'm1' } as never)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await buttons(ui)).filter(k => k.startsWith('config-'))).toEqual([])
    const values = await ui.findAll({ type: 'Text', text: /^● On$/ })
    expect(values).toHaveLength(4)
    expect(values.every(t => t.props.dimColor === true)).toBe(true)
    expect(await shows(ui, 'You can change these when Clawd is free.')).toBe(true)
    await ui.unmount()
  }
  // A specialist's turn is not Clawd's: it does not hold the configs.
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'm1', isAborted: false } as never)
  await $.turn.start({ text: 'Brief', turnId: 'r1', agentId: 'a1' } as never)
  const ui = await mount($)
  expect(await shows(ui, 'You can change these when Clawd is free.')).toBe(false)
  await ui.press({ key: 'config-recap' })
  expect(asked).toEqual([{ key: 'clawd-hq.recap', value: false }])
  await ui.unmount()
})

test('the next change that goes through clears the note of a refused one', async ($, on) => {
  host(on)
  let isRefusing = true
  configs(on, e => (isRefusing ? { deny: 'The value does not fit.' } : { value: e.value }))
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'config-quietChat' })
  expect(await shows(ui, 'Could not change Quiet chat: The value does not fit.')).toBe(true)
  isRefusing = false
  await ui.press({ key: 'config-quietChat' })
  expect(await shows(ui, /^Could not change/)).toBe(false)
  await ui.unmount()
})

const LONG_PATH = `/me/${'a-long-folder-name/'.repeat(8)}voice.md`

test('nothing in the configs view is cut short: every text wraps, on both surfaces', { options: { voiceFile: LONG_PATH } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some(t => t.props.wrap === 'truncate' || /…/.test(t.text))).toBe(false)
    for (const line of [WHERE, LONG_PATH]) expect(texts.find(t => t.text === line)?.props.wrap).toBe('wrap')
    await ui.unmount()
  }
})

// ---- The finished-work list, inside the same tab ----

test('a link shows how many finished this session; pressing it swaps the tab to the list and Back swaps it back, on both surfaces', async ($, on) => {
  await oneFinisher($, on)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const link = await ui.find({ key: 'settings-log' })
    expect(link?.props.label).toBe('Finished this session · 1')
    expect(await shows(ui, 'CONFIGS')).toBe(true)

    await ui.press({ key: 'settings-log' })
    expect(await shows(ui, 'FINISHED THIS SESSION · 1')).toBe(true)
    expect(await shows(ui, /^Writer$/)).toBe(true)
    expect(await shows(ui, /Updated the setup guide/)).toBe(true)
    expect(await shows(ui, 'CONFIGS')).toBe(false)
    expect(await shows(ui, 'INSTRUCTIONS')).toBe(false)
    expect(await ui.find({ key: 'settings-log' })).toBeUndefined()
    expect((await ui.find({ key: 'settings-back' }))?.props.label).toMatch(/Back/)

    await ui.press({ key: 'settings-back' })
    expect(await shows(ui, 'CONFIGS')).toBe(true)
    expect(await shows(ui, 'FINISHED THIS SESSION · 1')).toBe(false)
    expect(await ui.find({ key: 'settings-back' })).toBeUndefined()
    await ui.unmount()
  }
})

test('nothing in the finished list is cut short: its rows wrap, on both surfaces', async ($, on) => {
  await oneFinisher($, on)
  for (const surface of SURFACES) {
    const ui = await mountLog($, surface)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.some(t => t.props.wrap === 'truncate' || /…/.test(t.text))).toBe(false)
    for (const line of [/^Writer$/, /^Updated the setup guide$/]) expect(texts.find(t => line.test(String(t.text)))?.props.wrap).toBe('wrap')
    await ui.unmount()
  }
})

test('with nothing finished the link reads 0 and the list says so, with the Back link still there', async ($, on) => {
  host(on)
  await $.session.start(START)
  const ui = await mount($)
  expect((await ui.find({ key: 'settings-log' }))?.props.label).toBe('Finished this session · 0')
  await ui.press({ key: 'settings-log' })
  expect(await shows(ui, 'Nothing has finished yet this session.')).toBe(true)
  expect(await ui.find({ key: 'settings-back' })).toBeDefined()
  await ui.unmount()
})

test('the view choice is kept with the panel\'s display flags: another drawing of the pane, or the other surface, opens on the list too', async ($, on) => {
  await oneFinisher($, on)
  const first = await mountLog($, 'terminal')
  expect(await shows(first, 'FINISHED THIS SESSION · 1')).toBe(true)
  await first.unmount()
  const other = await mount($, 'desktop')
  expect(await shows(other, 'FINISHED THIS SESSION · 1')).toBe(true)
  await other.press({ key: 'settings-back' })
  await other.unmount()
  const again = await mount($, 'terminal')
  expect(await shows(again, 'CONFIGS')).toBe(true)
  await again.unmount()
})

test('the list never adds a tab: the host still has the four panes', async ($, on) => {
  const { panes } = host(on)
  await $.command.run({ command: 'office', args: '' } as never)
  const ui = await mountLog($, 'terminal')
  await ui.unmount()
  expect(panes.map(p => p.title)).toEqual(['Office', 'Decisions', 'People', 'Settings'])
})

// ---- Clawd's instructions, below the switches ----

test('below the switches and the link come Clawd\'s instructions and voice notes, as the old Clawd tab showed them', async ($, on) => {
  const { files } = host(on)
  files.set(`${ROOT}/${RULES_FILE}`, '# Clawd, chief of staff\n\n## What you do yourself\n\n- Talk with the person.\n')
  files.set(`${ROOT}/${VOICE_FILE}`, '# Clawd\'s voice\n\nTone notes.\n')
  await $.session.start(START)
  const ui = await mount($)
  const order = inOrder((await ui.drawn()) as unknown as Tree)
  const at = (text: string) => order.indexOf(text)
  expect(at('CONFIGS')).toBeGreaterThanOrEqual(0)
  expect(at('CONFIGS')).toBeLessThan(at(WHERE))
  expect(at(WHERE)).toBeLessThan(at('button:settings-log'))
  expect(at('button:settings-log')).toBeLessThan(at('INSTRUCTIONS'))
  // The fixed rules close the instructions, as they did in the old Clawd tab, before the voice notes.
  expect(at('INSTRUCTIONS')).toBeLessThan(at('ALWAYS'))
  expect(at('ALWAYS')).toBeLessThan(at('VOICE NOTES'))
  expect((await buttons(ui)).filter(k => k.startsWith('clawd-'))).toEqual(['clawd-edit-rules', 'clawd-edit-voice'])
  await ui.unmount()
})
