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

const WHERE = 'Change them in /plugin, on the page of Clawd HQ, or in /config. A change takes effect when the plugin reloads.'
const TITLES = ['Clawd runs the chat', 'Quiet chat', 'Recap', 'You should know']

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

// ---- The switches ----

test('Settings lists the four switches with their value and a plain line each, then where to change them', async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await shows(ui, 'SWITCHES')).toBe(true)
    for (const title of TITLES) expect(await shows(ui, title)).toBe(true)
    // All four are on by default; no voice file is set, so that one has no row.
    expect(await count(ui, 'On')).toBe(4)
    expect(await count(ui, 'Off')).toBe(0)
    expect(await shows(ui, 'Your own voice file')).toBe(false)
    expect(await shows(ui, /^The main chat works as Clawd, the chief of staff/)).toBe(true)
    expect(await shows(ui, /^Hides the "finished" notices of specialists/)).toBe(true)
    expect(await shows(ui, /^After a few quiet minutes, one line on where things stand/)).toBe(true)
    expect(await shows(ui, /^A small model checks finished work/)).toBe(true)
    expect(await shows(ui, WHERE)).toBe(true)
    await ui.unmount()
  }
})

test('a switch that is off reads Off', { options: { chiefOfStaff: false, quietChat: false, recap: false, youShouldKnow: false } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  const ui = await mount($)
  expect(await count(ui, 'Off')).toBe(4)
  expect(await count(ui, 'On')).toBe(0)
  await ui.unmount()
})

test('each switch reads on its own', { options: { recap: false } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  const ui = await mount($)
  expect(await count(ui, 'On')).toBe(3)
  expect(await count(ui, 'Off')).toBe(1)
  await ui.unmount()
})

test('a voice file that is set gets a row with its path and a line on what it does', { options: { voiceFile: '  /me/voice.md  ' } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  const ui = await mount($)
  expect(await shows(ui, 'Your own voice file')).toBe(true)
  expect(await shows(ui, '/me/voice.md')).toBe(true)
  expect(await shows(ui, /^Sets how Clawd sounds, in place of his built-in voice/)).toBe(true)
  await ui.unmount()
})

test('the switches are read-only: nothing on their rows can be pressed, and the one line says where to change them', async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect((await buttons(ui)).filter(k => k.startsWith('switch-'))).toEqual([])
    expect(await ui.findAll({ type: 'Input' })).toEqual([])
    await ui.unmount()
  }
})

const LONG_PATH = `/me/${'a-long-folder-name/'.repeat(8)}voice.md`

test('nothing in the switches view is cut short: every text wraps, on both surfaces', { options: { voiceFile: LONG_PATH } }, async ($, on) => {
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
    expect(await shows(ui, 'SWITCHES')).toBe(true)

    await ui.press({ key: 'settings-log' })
    expect(await shows(ui, 'FINISHED THIS SESSION · 1')).toBe(true)
    expect(await shows(ui, /^Writer$/)).toBe(true)
    expect(await shows(ui, /Updated the setup guide/)).toBe(true)
    expect(await shows(ui, 'SWITCHES')).toBe(false)
    expect(await shows(ui, 'INSTRUCTIONS')).toBe(false)
    expect(await ui.find({ key: 'settings-log' })).toBeUndefined()
    expect((await ui.find({ key: 'settings-back' }))?.props.label).toMatch(/Back/)

    await ui.press({ key: 'settings-back' })
    expect(await shows(ui, 'SWITCHES')).toBe(true)
    expect(await shows(ui, 'FINISHED THIS SESSION · 1')).toBe(false)
    expect(await ui.find({ key: 'settings-back' })).toBeUndefined()
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
  expect(await shows(again, 'SWITCHES')).toBe(true)
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
  expect(at('SWITCHES')).toBeGreaterThanOrEqual(0)
  expect(at('SWITCHES')).toBeLessThan(at(WHERE))
  expect(at(WHERE)).toBeLessThan(at('button:settings-log'))
  expect(at('button:settings-log')).toBeLessThan(at('INSTRUCTIONS'))
  // The fixed rules close the instructions, as they did in the old Clawd tab, before the voice notes.
  expect(at('INSTRUCTIONS')).toBeLessThan(at('ALWAYS'))
  expect(at('ALWAYS')).toBeLessThan(at('VOICE NOTES'))
  expect((await buttons(ui)).filter(k => k.startsWith('clawd-'))).toEqual(['clawd-edit-rules', 'clawd-edit-voice'])
  await ui.unmount()
})
