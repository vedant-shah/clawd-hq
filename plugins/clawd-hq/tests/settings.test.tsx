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

/** The Box whose own children hold the element with this key: the row it sits in. */
function rowOf(node: Tree, key: string): Tree | undefined {
  const kids = (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null)
  if (kids.some(c => c.props.key === key)) return node
  for (const c of kids) {
    const found = rowOf(c, key)
    if (found !== undefined) return found
  }
  return undefined
}
/** The smallest part of the drawing that holds both texts: the tab's body without the usage footer. */
function holding(node: Tree, first: string, last: string): Tree {
  const kids = (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null)
  const inner = kids.find(c => textIn(c).includes(first) && textIn(c).includes(last))
  return inner === undefined ? node : holding(inner, first, last)
}
/** Every Text of the drawing, as props. */
const allTexts = (node: Tree): Tree[] =>
  node.type === 'Text' ? [node] : (node.children ?? []).flatMap(c => (typeof c === 'object' && c !== null ? allTexts(c as Tree) : []))

const WHERE = 'Changes apply right away.'
const TITLES = ['Clawd runs the chat', 'Quiet chat', 'Recap', 'You should know', 'Left undone check']
const FIELDS = ['chiefOfStaff', 'quietChat', 'recap', 'youShouldKnow', 'leftUndone']
/** The old one-line descriptions: the README has them now, the tab does not. */
const LINES = [
  'Clawd hands work to specialists and reports in plain words.',
  'Hides finished notices and no-update lines; ctrl+o shows everything.',
  'One line on where things stand, after a few quiet minutes.',
  'A small model checks finished work and may leave a note.',
]
const labelOf = async (ui: Ui, field: string) => (await ui.find({ key: `config-${field}` }))?.props.label

/** A settings row as the engine lists it: its key and the plugin that owns it. */
type Row = { key: string; owner: string }
const OURS: Row[] = FIELDS.map(f => ({ key: `clawd-hq.${f}`, owner: 'clawd-hq' }))

/** The engine's settings rows and every change asked of them; `answer` is what a change gets back. */
function configs(on: On, answer: (e: { key: string; value: unknown }) => unknown = e => ({ value: e.value }), rows: Row[] = OURS) {
  const asked: Array<{ key: string; value: unknown }> = []
  on('config.list', () => ({ value: rows.map(r => ({ key: r.key, label: r.key, kind: 'boolean', value: true, provider: { plugin: r.owner, tier: 'user' }, isLocked: false })) }) as never)
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

test('Settings lists the four configs, each a name with its toggle on the right and no description, then one short line on when a change applies', async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await shows(ui, 'CONFIGS')).toBe(true)
    expect(await shows(ui, /^SWITCHES$/)).toBe(false)
    const tree = (await ui.drawn()) as unknown as Tree
    for (const [i, field] of FIELDS.entries()) {
      // All four are on by default.
      expect(await labelOf(ui, field)).toBe('● On')
      // The name and the toggle share one row, pushed to its two ends.
      const row = rowOf(tree, `config-${field}`)
      expect(row?.props.flexDirection).toBe('row')
      expect(row?.props.justifyContent).toBe('space-between')
      expect(textIn(row)).toContain(TITLES[i])
    }
    // No voice file is set, so that one has no row.
    expect(await shows(ui, 'Your own voice file')).toBe(false)
    for (const line of LINES) expect(await shows(ui, line)).toBe(false)
    expect(await count(ui, WHERE.replace('.', '\\.'))).toBe(1)
    expect(await shows(ui, /reloads with it|\/plugin|on the page of Clawd HQ/)).toBe(false)
    await ui.unmount()
  }
})

// The desktop app's own engine (2.1.295) refuses a whole drawing over a `weight` prop, so the headings use the older `bold`.
test('the configs view draws no weight prop, and its headings are bold and dim, like the Office tab\'s', async ($, on) => {
  const { files } = host(on)
  files.set(`${ROOT}/${RULES_FILE}`, '# Clawd, chief of staff\n\n- Talk with the person.\n')
  files.set(`${ROOT}/${VOICE_FILE}`, 'Tone notes.\n')
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const texts = allTexts(holding((await ui.drawn()) as unknown as Tree, 'CONFIGS', 'ALWAYS'))
    expect(texts.some(t => textIn(t) === 'Recap')).toBe(true)
    expect(texts.some(t => /Sonnet/.test(textIn(t)))).toBe(false)
    // On the desktop the test engine pairs every bold with a weight of its own; one of ours would come without a bold.
    expect(texts.filter(t => t.props.weight !== undefined && t.props.bold !== true)).toEqual([])
    for (const heading of ['CONFIGS', 'INSTRUCTIONS', 'VOICE NOTES', 'ALWAYS']) {
      const t = texts.find(x => textIn(x) === heading)
      expect(t?.props.bold).toBe(true)
      expect(t?.props.dimColor).toBe(true)
    }
    await ui.unmount()
  }
})

test('a config that is off reads Off on its toggle', { options: { chiefOfStaff: false, quietChat: false, recap: false, youShouldKnow: false, leftUndone: false } }, async ($, on) => {
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
  expect(await Promise.all(FIELDS.map(f => labelOf(ui, f)))).toEqual(['● On', '● On', '○ Off', '● On', '● On'])
  await ui.unmount()
})

test('a voice file that is set gets a read-only row with its path and no description', { options: { voiceFile: '  /me/voice.md  ' } }, async ($, on) => {
  host(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await shows(ui, 'Your own voice file')).toBe(true)
    expect(await shows(ui, '/me/voice.md')).toBe(true)
    expect(await shows(ui, 'Sets how Clawd sounds; his rules stay the same.')).toBe(false)
    expect((await buttons(ui)).filter(k => k.startsWith('config-'))).toEqual(FIELDS.map(f => `config-${f}`))
    await ui.unmount()
  }
})

test('pressing a toggle changes that config in the settings to the other value, under the plugin\'s own key', { options: { recap: false } }, async ($, on) => {
  host(on)
  const asked = configs(on)
  await $.session.start(START)
  const first = [
    { key: 'clawd-hq.chiefOfStaff', value: false }, { key: 'clawd-hq.quietChat', value: false },
    { key: 'clawd-hq.recap', value: true }, { key: 'clawd-hq.youShouldKnow', value: false }, { key: 'clawd-hq.leftUndone', value: false },
  ]
  for (const [i, surface] of SURFACES.entries()) {
    asked.length = 0
    const ui = await mount($, surface)
    for (const field of FIELDS) await ui.press({ key: `config-${field}` })
    // A press applies at once, so the second surface's presses turn each switch back.
    expect(asked).toEqual(i === 0 ? first : first.map(a => ({ ...a, value: !a.value })))
    expect(await shows(ui, /^Could not change/)).toBe(false)
    await ui.unmount()
  }
})

test('the key is the one of the row this plugin owns for that field, whatever the key looks like', async ($, on) => {
  host(on)
  // Another plugin's row carries the guessed key; ours has a key no guess would make.
  const rows = [{ key: 'clawd-hq.recap', owner: 'other' }, { key: 'inline:7f.quietChat', owner: 'clawd-hq' }, { key: 'inline:7f.recap', owner: 'clawd-hq' }]
  const asked = configs(on, e => ({ value: e.value }), rows)
  await $.session.start(START)
  for (const [i, surface] of SURFACES.entries()) {
    asked.length = 0
    const ui = await mount($, surface)
    await ui.press({ key: 'config-recap' })
    expect(asked).toEqual([{ key: 'inline:7f.recap', value: i === 1 }])
    expect(await shows(ui, /^Could not change|isn't listed here/)).toBe(false)
    await ui.unmount()
  }
})

test('with no row of this plugin for the field no settings row is set, yet the switch flips, kept in the plugin\'s store, with no note', async ($, on) => {
  const { saved } = host(on)
  const asked = configs(on, e => ({ value: e.value }), [{ key: 'clawd-hq.recap', owner: 'other' }, { key: 'theme', owner: 'engine' }])
  await $.session.start(START)
  for (const [i, surface] of SURFACES.entries()) {
    const ui = await mount($, surface)
    await ui.press({ key: 'config-recap' })
    expect(asked).toEqual([])
    expect(saved.get('toggle:recap')).toBe(i === 1)
    expect(await shows(ui, /^Could not change|isn't listed here|not saved|could not be saved/)).toBe(false)
    expect(await labelOf(ui, 'recap')).toBe(i === 0 ? '○ Off' : '● On')
    await ui.unmount()
  }
})

test('each press keeps the keys of the settings rows (never their values) in the store, for a look at their real shape', async ($, on) => {
  const { saved } = host(on)
  configs(on, e => ({ value: e.value }), [{ key: 'inline:7f.recap', owner: 'clawd-hq' }, { key: 'other.recap', owner: 'other' }, { key: 'theme', owner: 'engine' }])
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'config-recap' })
  expect(saved.get('debug:config-rows')).toEqual({ plugin: 'clawd-hq', keys: ['inline:7f.recap'], others: ['other: other.recap'] })
  await ui.unmount()
})

test('a change the settings refuse is still made, kept in the plugin\'s store: the switch flips with no note', async ($, on) => {
  const { saved } = host(on)
  configs(on, () => ({ deny: 'Only its dialog changes this setting.' }))
  await $.session.start(START)
  const ui = await mount($)
  await ui.press({ key: 'config-recap' })
  expect(await shows(ui, /^Could not change|this session only/)).toBe(false)
  expect(saved.get('toggle:recap')).toBe(false)
  expect(await labelOf(ui, 'recap')).toBe('○ Off')
  await ui.unmount()
})

test('a change neither the settings nor the store take holds for this session only, and the tab says so', async ($, on) => {
  const { kv } = host(on)
  configs(on, () => ({ deny: 'Only its dialog changes this setting.' }))
  await $.session.start(START)
  kv.isWriteFailing = true
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    expect(await labelOf(ui, 'recap')).toBe('● On')
    await ui.press({ key: 'config-recap' })
    expect(await shows(ui, 'Recap is changed for this session only: it could not be saved.')).toBe(true)
    expect(await labelOf(ui, 'recap')).toBe('○ Off')
    await ui.press({ key: 'config-recap' })
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
    expect(values).toHaveLength(5)
    expect(values.every(t => t.props.dimColor === true)).toBe(true)
    expect(await shows(ui, 'You can change these when Clawd is free.')).toBe(true)
    // The busy line stands in for the one on when a change applies.
    expect(await shows(ui, WHERE)).toBe(false)
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

test('the next change that goes through clears the note of one that was not kept', async ($, on) => {
  const { kv } = host(on)
  let isRefusing = true
  configs(on, e => (isRefusing ? { deny: 'The value does not fit.' } : { value: e.value }))
  await $.session.start(START)
  kv.isWriteFailing = true
  const ui = await mount($)
  await ui.press({ key: 'config-quietChat' })
  expect(await shows(ui, 'Quiet chat is changed for this session only: it could not be saved.')).toBe(true)
  isRefusing = false
  await ui.press({ key: 'config-quietChat' })
  expect(await shows(ui, /this session only/)).toBe(false)
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
    expect(link?.props.label).toBe('Finished this session · 1 ›')
    expect(link?.props.plain).toBe(true)
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
  expect((await ui.find({ key: 'settings-log' }))?.props.label).toBe('Finished this session · 0 ›')
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

test('below the switches and the link come Clawd\'s instructions, his voice notes, then the fixed rules, on both surfaces', async ($, on) => {
  const { files } = host(on)
  files.set(`${ROOT}/${RULES_FILE}`, '# Clawd, chief of staff\n\n## What you do yourself\n\n- Talk with the person.\n')
  files.set(`${ROOT}/${VOICE_FILE}`, '# Clawd\'s voice\n\nTone notes.\n')
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await mount($, surface)
    const order = inOrder((await ui.drawn()) as unknown as Tree)
    const at = (text: string) => order.indexOf(text)
    expect(at('CONFIGS')).toBeGreaterThanOrEqual(0)
    expect(at('CONFIGS')).toBeLessThan(at('Recap'))
    expect(at('Recap')).toBeLessThan(at(WHERE))
    expect(at(WHERE)).toBeLessThan(at('button:settings-log'))
    expect(at('button:settings-log')).toBeLessThan(at('INSTRUCTIONS'))
    expect(at('INSTRUCTIONS')).toBeLessThan(at('VOICE NOTES'))
    // The fixed rules close the tab, short and dim, with no button.
    expect(at('VOICE NOTES')).toBeLessThan(at('ALWAYS'))
    expect((await buttons(ui)).filter(k => k.startsWith('clawd-'))).toEqual(['clawd-edit-rules', 'clawd-edit-voice'])
    await ui.unmount()
  }
})
