import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BRIEF_NOTE } from '../hooks/desk'
import { RULES_FILE, SECTION_ID, VOICE_FILE } from '../hooks/instructions'
import { RECAP_PROMPT } from '../hooks/recap'
import { CLEAR, SETTINGS, START, SURFACES, host } from './host'

// Each switch of the Settings tab, end to end: a press saves the other value in the settings under the row the engine
// names, the plugin loaded with that value (the reload after a press, or a restart) behaves by it, and it holds through
// a /clear and the next session start. The test kit has no reload, so "after the reload" is a test loaded with the value.

type On = Parameters<typeof host>[0]
type Field = 'chiefOfStaff' | 'quietChat' | 'recap' | 'youShouldKnow'
const FIELDS: readonly Field[] = ['chiefOfStaff', 'quietChat', 'recap', 'youShouldKnow']
const TITLES: Record<Field, string> = { chiefOfStaff: 'Clawd runs the chat', quietChat: 'Quiet chat', recap: 'Recap', youShouldKnow: 'You should know' }
/** Any note the tab gives when a press did not fully go through. */
const NO_ROW = /^Could not change|this session only/
const MIN = 60_000

/** The plugin's own folder: the one above this file's. */
const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')

/**
 * The settings as the engine keeps them: every row of this plugin, owned as the real `$.config.list()` names the owner
 * (the loader's key, `clawd-hq@inline` for a plugin run from a folder), holding `values`; a change is written there.
 */
function settings(on: On, owner = 'clawd-hq@inline', values: Record<string, boolean> = {}) {
  const saved = new Map<string, boolean>(FIELDS.map(f => [`clawd-hq.${f}`, values[f] ?? true]))
  const asked: Array<{ key: string; value: unknown }> = []
  const row = (key: string, value: unknown, plugin: string) => ({ key, label: key, kind: 'boolean', value, provider: { plugin, tier: 'user' }, isLocked: false })
  on('config.list', () => ({ value: [
    row('theme', 'dark', 'engine'), row('clawd-hq-extra.recap', true, 'clawd-hq-extra@other'),
    ...[...saved].map(([key, value]) => row(key, value, owner)),
  ] }) as never)
  on('config.set', (_$, e) => {
    const { key, value } = e as { key: string; value: boolean }
    asked.push({ key, value })
    saved.set(key, value)
    return { value } as never
  })
  return { saved, asked }
}

/** Everything the four behaviours need answered: the shipped prompt files, a model, one specialist's run, and the chat's own drawing. */
function stage(on: On) {
  const h = host(on, [])
  const forks: string[] = []
  const checks: unknown[] = []
  h.files.set(`${ROOT}/${RULES_FILE}`, '# Clawd, chief of staff\n\nHand real work over.\n')
  h.files.set(`${ROOT}/${VOICE_FILE}`, '# Clawd\'s voice\n\nPlain words.\n')
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }) as never)
  on('model.fork', (_$, e) => (forks.push((e as { prompt: string }).prompt), { value: { isAnswered: true, text: 'Where things stand.', usage: {} } }) as never)
  on('model.complete', (_$, e) => (checks.push(e), { value: { isAnswered: true, text: 'nothing', usage: {} } }) as never)
  on('session.messages', () => ({ value: [
    { role: 'user', text: `Fix it.${BRIEF_NOTE}`, toolUses: [] },
    { role: 'assistant', text: 'Reading the code.', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: 'src/login.ts' }, text: 'code' }] },
    { role: 'assistant', text: 'Done.', toolUses: [] },
  ] }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${(n += 1)}` }))
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  return { ...h, forks, checks }
}
type Stage = ReturnType<typeof stage>

const settle = async (h: Stage) => { for (let i = 0; i < 40; i += 1) await h.clock.advance(0) }
const wait = async (h: Stage, ms: number) => { for (let left = ms; left > 0; left -= 10_000) await h.clock.advance(Math.min(left, 10_000)) }
let turnNo = 0
async function clawdTurn($: Engine) {
  turnNo += 1
  await $.turn.start({ text: `Request ${turnNo}`, turnId: `m${turnNo}` } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `m${turnNo}`, isAborted: false } as never)
}
/** One specialist hired and handed back; its id. */
async function handBack($: Engine) {
  const { agentId } = (await $.agent.spawn({ prompt: 'Fix it.', description: 'Fix login', subagentType: 'ecc:tdd-guide' } as never)) as unknown as { agentId: string }
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: `t-${agentId}`, agentId, isAborted: false, durationMs: 60_000 } as never)
  return agentId
}
async function drawn($: Engine, props: Record<string, unknown>) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', component: 'UserMessage', props } as never)
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}

/** Whether the behaviour each switch controls is at work now, seen from outside: what the chat, the model and the drawing get. */
const IS_AT_WORK: Record<Field, ($: Engine, h: Stage) => Promise<boolean>> = {
  chiefOfStaff: async $ => {
    const r = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)
    return r.sections.some(s => s.id === SECTION_ID)
  },
  quietChat: async $ => {
    const id = await handBack($)
    return !(await drawn($, { text: 'Agent finished', origin: { kind: 'task-notification' }, isExpanded: false, task: { id, status: 'completed' } })).includes('ENGINE')
  },
  recap: async ($, h) => {
    const before = h.forks.length
    for (let i = 0; i < 3; i += 1) await clawdTurn($)
    await wait(h, 3 * MIN + 20_000)
    return h.forks.slice(before).includes(RECAP_PROMPT)
  },
  youShouldKnow: async ($, h) => {
    const before = h.checks.length
    await handBack($)
    await settle(h)
    return h.checks.length > before
  },
}

async function labelOf($: Engine, field: Field, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...SETTINGS })
  const label = (await ui.find({ key: `config-${field}` }))?.props.label
  await ui.unmount()
  return label
}
async function press($: Engine, field: Field, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...SETTINGS })
  await ui.press({ key: `config-${field}` })
  const isNoRow = (await ui.find({ type: 'Text', text: NO_ROW })) !== undefined
  await ui.unmount()
  return isNoRow
}

// ---- The bug: the engine names a row's owner as the loader keys the plugin, never by its bare name ----

test('a press changes the row the engine lists as ours, owned "clawd-hq@inline" or "clawd-hq@<marketplace>", with no "not listed" line', { timeoutMs: 15_000 }, async ($, on) => {
  host(on)
  let owner = 'clawd-hq@inline'
  const asked: Array<{ key: string; value: unknown }> = []
  on('config.list', () => ({ value: [
    { key: 'clawd-hq-extra.recap', label: 'x', kind: 'boolean', value: true, provider: { plugin: 'clawd-hq-extra@other', tier: 'user' }, isLocked: false },
    ...FIELDS.map(f => ({ key: `clawd-hq.${f}`, label: f, kind: 'boolean', value: true, provider: { plugin: owner, tier: 'user' }, isLocked: false })),
  ] }) as never)
  on('config.set', (_$, e) => (asked.push({ key: (e as { key: string }).key, value: (e as { value: unknown }).value }), { value: (e as { value: unknown }).value }) as never)
  await $.session.start(START)
  let round = 0
  for (const name of ['clawd-hq@inline', 'clawd-hq@vedant-shah']) {
    owner = name
    for (const surface of SURFACES) {
      asked.length = 0
      for (const field of FIELDS) expect(await press($, field, surface)).toBe(false)
      // A press applies at once, so each round turns every switch back the other way.
      expect(asked).toEqual(FIELDS.map(f => ({ key: `clawd-hq.${f}`, value: round % 2 === 1 })))
      round += 1
    }
  }
})

// ---- The desktop app: its SDK session lists no settings rows at all, so a press is kept in the plugin's own store ----

/** No settings rows, as the desktop app (2.1.295) lists them; `isFailing` is a list call that fails outright. */
function noRows(on: On, isFailing = false) {
  const asked: unknown[] = []
  on('config.list', () => { if (isFailing) throw new Error('not in this session'); return { value: [] } as never })
  on('config.set', (_$, e) => (asked.push(e), { value: (e as { value: unknown }).value }) as never)
  return asked
}

for (const field of FIELDS) {
  test(`${TITLES[field]}, with no settings rows: a press flips it at once, the feature follows with no reload, and it holds through a /clear and the next session start`, { timeoutMs: 25_000 }, async ($, on) => {
    const h = stage(on)
    const asked = noRows(on, field === 'recap')
    await $.session.start(START)
    expect(await IS_AT_WORK[field]($, h)).toBe(true)
    expect(await press($, field)).toBe(false)
    expect(asked).toEqual([])
    expect(h.saved.get(`toggle:${field}`)).toBe(false)
    for (const surface of SURFACES) expect(await labelOf($, field, surface)).toBe('○ Off')
    expect(await IS_AT_WORK[field]($, h)).toBe(false)
    await $.session.end(CLEAR)
    await $.session.start(START)
    expect(await labelOf($, field)).toBe('○ Off')
    expect(await IS_AT_WORK[field]($, h)).toBe(false)
    expect(await press($, field)).toBe(false)
    expect(h.saved.get(`toggle:${field}`)).toBe(true)
    expect(await labelOf($, field)).toBe('● On')
  })
}

test('a switch saved in the store wins over the settings, which win over the default; the other switches keep theirs', { options: { quietChat: false, recap: false } }, async ($, on) => {
  host(on, [], { 'toggle:quietChat': true, 'toggle:youShouldKnow': false, 'toggle:chiefOfStaff': 'yes' })
  noRows(on)
  await $.session.start(START)
  // Saved On over the settings' Off; settings' Off with nothing saved; saved Off over the default; a value that is not true or false is ignored.
  expect(await labelOf($, 'quietChat')).toBe('● On')
  expect(await labelOf($, 'recap')).toBe('○ Off')
  expect(await labelOf($, 'youShouldKnow')).toBe('○ Off')
  expect(await labelOf($, 'chiefOfStaff')).toBe('● On')
})

test('a row the organization locks is not changed, here or in the store: the tab says so and the switch keeps its value', async ($, on) => {
  const h = host(on)
  on('config.list', () => ({ value: [{ key: 'clawd-hq.recap', label: 'Recap', kind: 'boolean', value: true, provider: { plugin: 'clawd-hq@inline', tier: 'user' }, isLocked: true }] }) as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...SETTINGS })
  await ui.press({ key: 'config-recap' })
  expect(await ui.find({ type: 'Text', text: 'Could not change Recap: your organization manages this setting.' })).toBeDefined()
  expect(h.saved.has('toggle:recap')).toBe(false)
  expect((await ui.find({ key: 'config-recap' }))?.props.label).toBe('● On')
  await ui.unmount()
})

test('a store that cannot save keeps the change for this session, and the tab says it is not kept', async ($, on) => {
  const h = host(on)
  noRows(on)
  await $.session.start(START)
  h.kv.isWriteFailing = true
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...SETTINGS })
  await ui.press({ key: 'config-recap' })
  expect(await ui.find({ type: 'Text', text: /^Recap is changed for this session only: it could not be saved\.$/ })).toBeDefined()
  expect((await ui.find({ key: 'config-recap' }))?.props.label).toBe('○ Off')
  await ui.unmount()
})

// ---- Each switch: saved, applied, and kept ----

for (const field of FIELDS) {
  test(`${TITLES[field]}: on by default and at work; a press saves Off under clawd-hq.${field}`, { timeoutMs: 15_000 }, async ($, on) => {
    const h = stage(on)
    const { saved } = settings(on)
    await $.session.start(START)
    expect(await labelOf($, field)).toBe('● On')
    expect(await IS_AT_WORK[field]($, h)).toBe(true)
    expect(await press($, field)).toBe(false)
    expect(saved.get(`clawd-hq.${field}`)).toBe(false)
    expect([...saved].filter(([k, v]) => k !== `clawd-hq.${field}` && v === false)).toEqual([])
  })

  test(`${TITLES[field]}: loaded Off, as the settings hold it after a press and a restart, it reads Off and is not at work through a /clear and the next session start; a press saves On`, { timeoutMs: 20_000, options: { [field]: false } }, async ($, on) => {
    const h = stage(on)
    const { saved } = settings(on, 'clawd-hq@inline', { [field]: false })
    await $.session.start(START)
    for (const surface of SURFACES) expect(await labelOf($, field, surface)).toBe('○ Off')
    expect(await IS_AT_WORK[field]($, h)).toBe(false)
    await $.session.end(CLEAR)
    await $.session.start(START)
    expect(await labelOf($, field)).toBe('○ Off')
    expect(await IS_AT_WORK[field]($, h)).toBe(false)
    expect(await press($, field)).toBe(false)
    expect(saved.get(`clawd-hq.${field}`)).toBe(true)
  })
}
