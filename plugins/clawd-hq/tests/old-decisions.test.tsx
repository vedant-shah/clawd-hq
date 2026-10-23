import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, START, SURFACES, host } from './host'

// The one-time card for a project that still has an old decisions file: Clawd HQ no longer reads that file, and the card offers to
// turn the decisions in it into CLAUDE.md rules. The file itself is never read, changed or removed by the plugin.

const FILE = '/repo/.clawd-hq/decisions.md'
const KEY = 'oldDecisions:/repo'
const OLD = '# Clawd HQ decisions\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep it simple\n'
const HEADLINE = 'Clawd HQ no longer reads your old decisions file.'
const PROMPT = 'Read .clawd-hq/decisions.md. List my decisions (not the agents\' notes) that should still guide later work, each as one short rule, and offer each with offer_rule.'

type Surface = (typeof SURFACES)[number]

function office(on: Parameters<typeof host>[0], store: Record<string, unknown> = {}) {
  const h = host(on, [], store)
  const fills: Array<{ text: string; mode: string }> = []
  const fill = { isFilled: true, error: undefined as string | undefined }
  on('prompt.fill', (_$, e) => {
    if (fill.error !== undefined) throw new Error(fill.error)
    if (fill.isFilled) fills.push({ text: (e as { text: string }).text, mode: (e as { mode: string }).mode })
    return { isFilled: fill.isFilled } as never
  })
  return { ...h, fills, fill }
}

async function seen($: Engine, surface: Surface) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const words = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String(b.text))
  await ui.unmount()
  return { words, buttons, text: words.join('\n') }
}

async function press($: Engine, text: string, surface: Surface = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const one = await ui.find({ type: 'Button', text })
  if (!one?.key) throw new Error(`no ${text} button`)
  await ui.press({ key: one.key })
  await ui.unmount()
}

test('a project with an old decisions file and no answer yet gets the card, on both surfaces, with its two buttons', async ($, on) => {
  const h = office(on)
  h.files.set(FILE, OLD)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const { text, buttons } = await seen($, surface)
    expect(text).toContain(HEADLINE)
    expect(buttons).toEqual(expect.arrayContaining(['Offer them as rules', 'Dismiss']))
  }
})

test('no old file, or an answer already given for this project, means no card', async ($, on) => {
  const none = office(on)
  await $.session.start(START)
  expect((await seen($, 'terminal')).text).not.toContain(HEADLINE)
  expect(none.files.size).toBe(0)
})

test('an answer already given for this project means no card, however many sessions later', async ($, on) => {
  const h = office(on, { [KEY]: true })
  h.files.set(FILE, OLD)
  await $.session.start(START)
  await $.session.start(START)
  expect((await seen($, 'terminal')).text).not.toContain(HEADLINE)
})

test('an answer given for another project does not count', async ($, on) => {
  const h = office(on, { 'oldDecisions:/elsewhere': true })
  h.files.set(FILE, OLD)
  await $.session.start(START)
  expect((await seen($, 'desktop')).text).toContain(HEADLINE)
})

test('the offer button puts the prompt in the prompt box after what is there, never sends it, and settles the card for good', async ($, on) => {
  const h = office(on)
  h.files.set(FILE, OLD)
  await $.session.start(START)
  await press($, 'Offer them as rules')
  expect(h.fills).toEqual([{ text: PROMPT, mode: 'append' }])
  expect(h.saved.get(KEY)).toBeTruthy()
  expect((await seen($, 'terminal')).text).not.toContain(HEADLINE)
  // The next session does not bring it back.
  await $.session.start(START)
  expect((await seen($, 'desktop')).text).not.toContain(HEADLINE)
})

test('Dismiss settles the card for good and puts nothing in the prompt box', async ($, on) => {
  const h = office(on)
  h.files.set(FILE, OLD)
  await $.session.start(START)
  await press($, 'Dismiss', 'desktop')
  expect(h.fills).toEqual([])
  expect(h.saved.get(KEY)).toBeTruthy()
  expect((await seen($, 'terminal')).text).not.toContain(HEADLINE)
  await $.session.start(START)
  expect((await seen($, 'terminal')).text).not.toContain(HEADLINE)
})

test('the old file is never changed or removed: not by the card, a press, or a dismissal', async ($, on) => {
  const h = office(on)
  h.files.set(FILE, OLD)
  await $.session.start(START)
  await press($, 'Offer them as rules')
  expect(h.files.get(FILE)).toBe(OLD)
  expect([...h.files.keys()]).toEqual([FILE]) // nothing else was written, and nothing was removed
})

test('a prompt box that cannot take the text, or a fill that fails, keeps the card and says so', async ($, on) => {
  const h = office(on)
  h.files.set(FILE, OLD)
  await $.session.start(START)
  h.fill.isFilled = false
  await press($, 'Offer them as rules')
  expect(h.saved.has(KEY)).toBe(false)
  expect((await seen($, 'terminal')).text).toContain(HEADLINE)
  expect(h.toasts.some(t => /prompt box/i.test(t))).toBe(true)
  h.fill.error = 'no prompt box'
  await press($, 'Offer them as rules')
  expect(h.saved.has(KEY)).toBe(false)
  expect((await seen($, 'terminal')).text).toContain(HEADLINE)
  // And pressed again once the box can take it, it goes through.
  h.fill.error = undefined
  h.fill.isFilled = true
  await press($, 'Offer them as rules')
  expect(h.fills).toHaveLength(1)
  expect(h.saved.get(KEY)).toBeTruthy()
})

test('a check for the file that itself fails shows no card and stops nothing', async ($, on) => {
  const h = office(on)
  h.files.set(FILE, OLD)
  h.disk.isExistsFailing = true
  await $.session.start(START)
  expect((await seen($, 'terminal')).text).not.toContain(HEADLINE)
  expect(h.toasts.filter(t => /start-up failed/.test(t))).toEqual([])
})
