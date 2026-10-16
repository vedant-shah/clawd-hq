// The desktop app can bundle an older engine than the terminal's. Claude Code 2.1.295 refuses a whole pane drawing when
// any Text carries a prop it does not know ("Text prop "weight" is not allowed; the engine drew its own"), so every tab is
// drawn here, in the states that use the most styles, and each Text is held to the props that engine takes.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { RULES_FILE, VOICE_FILE } from '../hooks/instructions'
import { AMBER } from '../hooks/office'
import { ALL_PANES, START, SURFACES, host } from './host'
import { flowHost, job, measure } from './flow'

// The runner has a real timer, though its types do not list one.
declare const setTimeout: (run: () => void, ms: number) => unknown

type On = Parameters<typeof host>[0]

const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')

/** The Text props of Claude Code 2.1.295 (its TextProps), plus what JSX itself carries. */
const OLDER_TEXT_PROPS = new Set([
  'hover', 'color', 'backgroundColor', 'dimColor', 'bold', 'italic', 'underline', 'strikethrough', 'inverse', 'wrap', 'children', 'key',
])

/** The host with a home folder, the shipped files, and a prompt box that will not take a line (so the tab shows the line to type). */
function office(on: On, home: { value: unknown } = { value: '/home/me' }) {
  const h = host(on)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'HOME' ? home.value : undefined }) as never)
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }) as never)
  on('prompt.fill', () => ({ isFilled: false }) as never)
  on('prompt.compose', () => ({ sections: [] }))
  // Long enough to need the box's ▲ ▼ and its line count.
  h.files.set(`${ROOT}/${RULES_FILE}`, `# Clawd\n\n## Rules\n\n- One.\n${Array.from({ length: 40 }, (_, i) => `\nLine ${i + 1}.`).join('')}\n`)
  h.files.set(`${ROOT}/${VOICE_FILE}`, '# Voice\n\n- Calm.\n')
  return h
}

/** Each Text prop on this drawing the older engine would refuse, as `pane/surface: prop`. */
async function refusedProps($: Engine, pane: (typeof ALL_PANES)[number], surface: (typeof SURFACES)[number], press: string[] = []) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
  for (const key of press) if ((await ui.find({ key })) !== undefined) await ui.press({ key })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.flatMap(t => Object.keys(t.props).filter(p => !OLDER_TEXT_PROPS.has(p) && !isKitWeight(t.props, p)).map(p => `${pane.requestId}/${surface}: ${p}`))
}

/** The test engine (2.1.300) pairs every `bold` with a `weight` of its own on the desktop; the drawing only said `bold`. The terminal pairs nothing, so it still catches a `weight` of ours. */
const isKitWeight = (props: Record<string, unknown>, prop: string) => prop === 'weight' && props.bold === true

test('every tab draws only Text props the 2.1.295 engine takes, on every surface', { options: { voiceFile: '/me/voice.md' } }, async ($, on) => {
  const h = office(on)
  h.files.set('/me/voice.md', '# My voice\n\n- Warm.\n')
  await $.session.start(START)
  const refused: string[] = []
  for (const surface of SURFACES) {
    for (const pane of ALL_PANES) refused.push(...(await refusedProps($, pane, surface)))
    // Settings after an edit press whose line the box would not take, and with the finished list open.
    refused.push(...(await refusedProps($, ALL_PANES[3], surface, ['clawd-edit-rules'])))
    refused.push(...(await refusedProps($, ALL_PANES[3], surface, ['settings-log'])))
  }
  expect([...new Set(refused)]).toEqual([])
})

const amber = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...ALL_PANES[3] })
  const line = await ui.find({ type: 'Text', text: /^Couldn't read Clawd's instructions: \S/ })
  const isEmpty = (await ui.find({ type: 'Text', text: /Nothing to show yet/ })) !== undefined
  await ui.unmount()
  return { line, isEmpty }
}

test('a read of the instructions that fails is one plain amber line in the tab, with the reason, not an empty tab', async ($, on) => {
  // A home folder look-up that answers with something that is not text breaks the read.
  office(on, { value: 42 })
  await $.session.start(START)
  const { line, isEmpty } = await amber($)
  expect(line?.props.color).toBe(AMBER)
  expect(isEmpty).toBe(false)
})

test('a read that works again after a turn takes the amber line away', async ($, on) => {
  const home = { value: 42 as unknown }
  office(on, home)
  await $.session.start(START)
  expect((await amber($)).line).toBeDefined()
  home.value = '/home/me'
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
  expect((await amber($)).line).toBeUndefined()
})

test('a start-up step that fails stops none after it: the tab still fills, and a toast names what failed', async ($, on) => {
  const h = office(on)
  h.fail.tools = true
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...ALL_PANES[3] })
  expect(await ui.find({ type: 'Text', text: /Nothing to show yet/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Markdown' })).length).toBeGreaterThan(0)
  await ui.unmount()
  expect(h.toasts.some(t => /start-up/.test(t) && /already registered/.test(t))).toBe(true)
})

test('the coffee break button, its working word and its amber line draw only Text props the 2.1.295 engine takes, on every pane and surface', async ($, on) => {
  const h = flowHost(on)
  h.compact.skip = 'a hook said no'
  const work = job($, h)
  await work.ask()
  await work.handBack()
  await work.report()
  await measure($, 310_000)
  const refused: string[] = []
  for (const surface of SURFACES) {
    for (const pane of ALL_PANES) {
      refused.push(...(await refusedProps($, pane, surface)))
      // With its amber line up, and with the word that stands in for the button while it works.
      refused.push(...(await refusedProps($, pane, surface, ['coffee-break'])))
    }
  }
  // A press under a held compaction shows the working word in the button's place.
  let release: () => void = () => undefined
  h.compact.hold = new Promise<void>(resolve => { release = resolve })
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...ALL_PANES[0] })
  const pressing = ui.press({ key: 'coffee-break' })
  await new Promise<void>(resolve => setTimeout(resolve, 25))
  expect(await ui.find({ type: 'Text', text: /^Compacting the chat/ })).toBeDefined()
  const working = await ui.findAll({ type: 'Text' })
  release()
  await pressing
  await ui.unmount()
  refused.push(...working.flatMap(t => Object.keys(t.props).filter(p => !OLDER_TEXT_PROPS.has(p) && !isKitWeight(t.props, p))))
  expect([...new Set(refused)]).toEqual([])
})

test('the Settings tab shows the instructions and voice boxes, with the text it read, on every surface', async ($, on) => {
  office(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...ALL_PANES[3] })
    expect(await ui.find({ type: 'Text', text: /Nothing to show yet/ })).toBeUndefined()
    expect((await ui.findAll({ type: 'Markdown' })).some(m => String(m.props.text).startsWith('# Clawd\n\n## Rules\n\n- One.'))).toBe(true)
    await ui.unmount()
  }
})
