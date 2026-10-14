import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, PEOPLE, START, SURFACES, host } from './host'

const MIN = 60_000
const PLAIN = 'https://claude.ai/artifact/9WdR8H2T9Z7QScxjCbQjEM'
const CODE = 'https://claude.ai/code/artifact/0f8fad5b-d9cb-469f-a165-70867728950e'
const link = (n: number) => `https://claude.ai/artifact/page${n}`
type On = Parameters<typeof host>[0]

/** What the Artifact tool answers: the text the model reads, and the record behind it. */
const answer = (url: string, over: Record<string, unknown> = {}) => ({ result: { url }, text: `Created a new Artifact at ${url} (version 1-ab)`, ...over })
// The desk's save is started and not waited for, so a call is followed by a moment on the held clock for it to land.
let held: ReturnType<typeof host>['clock'] | undefined
async function publish($: Engine, input: Record<string, unknown> = {}) {
  const ran = await $.tool.call({ tool: 'Artifact', ...input } as never)
  await held?.advance(1)
  return ran
}

/** A session whose Artifact tool answers `reply(input)`; any other tool answers with `other`. */
function session(on: On, reply: (input: Record<string, unknown>) => unknown, store: Record<string, unknown> = {}, other: unknown = { result: 'ok', text: 'ok' }) {
  const h = host(on, [], store)
  held = h.clock
  on('tool.call', (_$, e) => ((e as { tool: string }).tool === 'Artifact' ? reply(e as never) : other) as never)
  return h
}

/** A pane drawn and put away again: its drawn text, the address of every Link, and the words of every Text. */
async function seen($: Engine, surface: 'terminal' | 'desktop' = 'terminal', pane = PANE) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
  const result = {
    text: JSON.stringify(await ui.drawn()),
    links: (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href)),
    words: (await ui.findAll({ type: 'Text' })).map(t => String(t.text)),
  }
  await ui.unmount()
  return result
}

test('a published artifact shows under the specialists on the Office tab as a one-click link, on both surfaces', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  await publish($, { title: 'Launch plan' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^ARTIFACTS · 1$/ })).toBeDefined()
    const one = await ui.find({ type: 'Link' })
    expect(one?.props.href).toBe(PLAIN)
    expect(JSON.stringify(one)).toContain('Launch plan')
    expect(JSON.stringify(await ui.drawn())).toMatch(/just now/)
    await ui.unmount()
  }
})

test('the section sits below the specialists\' section', async ($, on) => {
  session(on, () => answer(PLAIN))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.session.start(START)
  await $.agent.spawn({ prompt: 'Plan', description: 'Plan it', subagentType: 'ecc:planner' } as never)
  await publish($, { title: 'Launch plan' })
  const { text } = await seen($)
  expect(text.indexOf('AT WORK · 1')).toBeGreaterThan(-1)
  expect(text.indexOf('ARTIFACTS · 1')).toBeGreaterThan(text.indexOf('AT WORK · 1'))
})

test('with no artifacts the section is not drawn at all, and it is only on the Office tab', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  for (const surface of SURFACES) {
    const { text, links } = await seen($, surface)
    expect(text).not.toMatch(/ARTIFACT/i)
    expect(links).toEqual([])
  }
  await publish($, { title: 'Launch plan' })
  expect((await seen($, 'terminal', PEOPLE)).text).not.toMatch(/ARTIFACT/)
})

test('a specialist\'s publish and an open are recorded too, with the link from the input or from the result', async ($, on) => {
  session(on, input => (input.action === 'open' ? { result: 'Opened', text: 'Opened' } : answer(CODE)))
  await $.session.start(START)
  await publish($, { agentId: 'a1', title: 'By a specialist' })
  await publish($, { action: 'open', url: PLAIN })
  const { links, words } = await seen($)
  expect(links).toEqual([PLAIN, CODE])
  expect(words).toContain('ARTIFACTS · 2')
})

test('read, list, quickstart, pin and unpin record nothing, and neither does any other tool\'s output', async ($, on) => {
  session(on, () => answer(PLAIN), {}, { result: PLAIN, text: `Pages: ${PLAIN} and ${CODE}` })
  await $.session.start(START)
  for (const action of ['read', 'list', 'quickstart', 'pin', 'unpin']) await publish($, { action, url: PLAIN })
  await $.tool.call({ tool: 'Bash', command: 'echo listing' } as never)
  await $.tool.call({ tool: 'WebFetch', url: PLAIN } as never)
  await $.tool.call({ tool: 'mcp__other__Artifact', title: 'Not ours' } as never)
  expect((await seen($)).text).not.toMatch(/ARTIFACT/)
})

test('a link that is not exactly one of the two shapes is never kept or drawn', async ($, on) => {
  session(on, input => answer(String(input.page)))
  await $.session.start(START)
  for (const page of ['https://evil.com/artifact/abc', 'http://claude.ai/artifact/abc', 'https://claude.ai/artifact/abc?x=1', 'javascript:alert(1)']) {
    await publish($, { page, url: page, title: 'Sneaky' })
    await publish($, { page, title: 'Sneaky' })
  }
  expect((await seen($)).text).not.toMatch(/ARTIFACT|Sneaky/)
})

test('a call that failed records nothing', async ($, on) => {
  session(on, () => answer(PLAIN, { isError: true }))
  await $.session.start(START)
  await publish($, { title: 'Broken' })
  expect((await seen($)).text).not.toMatch(/ARTIFACT/)
})

test('publishing or opening the same link again updates it and moves it to the top; newest first', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = session(on, input => answer(String(input.url)))
  await $.session.start(START)
  await publish($, { url: link(1), title: 'First' })
  await clock.advance(2 * MIN)
  await publish($, { url: link(2), title: 'Second' })
  await clock.advance(3 * MIN)
  expect((await seen($)).links).toEqual([link(2), link(1)])
  await publish($, { action: 'open', url: link(1), title: 'First, renamed' })
  const { links, words, text } = await seen($)
  expect(links).toEqual([link(1), link(2)])
  expect(words).toContain('ARTIFACTS · 2')
  expect(text).toContain('First, renamed')
  expect(text).not.toContain('"First"')
  // The time moved with it: the reopened one is new, the other is three minutes old.
  expect(text).toMatch(/just now/)
  expect(text).toMatch(/3m ago/)
})

test('an open that names no title keeps the title the link already had', async ($, on) => {
  session(on, input => (input.action === 'open' ? { result: 'Opened', text: 'Opened' } : answer(PLAIN)))
  await $.session.start(START)
  await publish($, { title: 'Launch plan' })
  await publish($, { action: 'open', url: PLAIN })
  expect((await seen($)).text).toContain('Launch plan')
})

test('a delete of a recorded link removes it, and the section goes with the last one', async ($, on) => {
  session(on, input => (input.action === 'delete' ? { result: 'Deleted', text: 'Deleted' } : answer(String(input.url))))
  await $.session.start(START)
  await publish($, { url: link(1), title: 'One' })
  await publish($, { url: link(2), title: 'Two' })
  await publish($, { action: 'delete', url: link(1) })
  expect((await seen($)).links).toEqual([link(2)])
  await publish($, { action: 'delete', url: link(9) })
  expect((await seen($)).links).toEqual([link(2)])
  await publish($, { action: 'delete', url: link(2) })
  expect((await seen($)).text).not.toMatch(/ARTIFACT/)
})

test('the newest 6 are drawn, one dim line counts the older ones, and the heading counts all', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 8; n += 1) {
    await publish($, { url: link(n), title: `Page ${n}` })
    await clock.advance(MIN)
  }
  for (const surface of SURFACES) {
    const { links, words } = await seen($, surface)
    expect(links).toEqual([8, 7, 6, 5, 4, 3].map(link))
    expect(words).toContain('ARTIFACTS · 8')
    expect(words).toContain('2 older artifacts')
  }
  await publish($, { url: link(9), title: 'Page 9' })
  expect((await seen($)).words).toContain('3 older artifacts')
})

test('exactly 6 artifacts draw no older-line, and 7 say "1 older artifact"', async ($, on) => {
  session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 6; n += 1) await publish($, { url: link(n), title: `Page ${n}` })
  expect((await seen($)).text).not.toMatch(/older/)
  await publish($, { url: link(7), title: 'Page 7' })
  expect((await seen($)).words).toContain('1 older artifact')
})

test('only the newest 50 are kept', async ($, on) => {
  session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 53; n += 1) await publish($, { url: link(n), title: `Page ${n}` })
  expect((await seen($)).words).toContain('ARTIFACTS · 50')
  // Away to another folder and back: what comes back is what was kept.
  await $.session.start({ cwd: '/other', surface: 'terminal', isInteractive: true } as never)
  await $.session.start(START)
  const { links, words } = await seen($)
  expect(words).toContain('ARTIFACTS · 50')
  expect(words).toContain('44 older artifacts')
  expect(links[0]).toBe(link(53))
})

test('the list belongs to the project folder and survives sessions', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  await publish($, { title: 'Launch plan' })
  await $.session.start({ cwd: '/other', surface: 'terminal', isInteractive: true } as never)
  expect((await seen($)).text).not.toMatch(/ARTIFACT/)
  await publish($, { url: CODE, title: 'Elsewhere' })
  expect((await seen($)).links).toEqual([CODE])
  await $.session.start(START)
  const { links, text } = await seen($)
  expect(links).toEqual([PLAIN])
  expect(text).not.toContain('Elsewhere')
})

test('a stored list from an earlier run is drawn, and one with bad entries is cleaned on the way in', async ($, on) => {
  const stored = [
    { url: PLAIN, title: 'Kept', at: 500 },
    { url: 'https://evil.com/artifact/x', title: 'Evil', at: 400 },
    { url: CODE, title: 'Two\nlines', at: 300 },
    'junk',
  ]
  session(on, () => answer(PLAIN), { 'artifacts:/repo': stored })
  await $.session.start(START)
  const { links, text } = await seen($)
  expect(links).toEqual([PLAIN, CODE])
  expect(text).not.toContain('Evil')
  expect(text).toContain('Two lines')
})

test('a stored value that is not a list is ignored', async ($, on) => {
  session(on, () => answer(PLAIN), { 'artifacts:/repo': { oops: true } })
  await $.session.start(START)
  expect((await seen($)).text).not.toMatch(/ARTIFACT/)
})

test('two publishes at the same moment are both kept', async ($, on) => {
  session(on, input => answer(String(input.url)))
  await $.session.start(START)
  await Promise.all([publish($, { url: link(1), title: 'One' }), publish($, { url: link(2), title: 'Two' }), publish($, { url: link(3), title: 'Three' })])
  expect((await seen($)).words).toContain('ARTIFACTS · 3')
})

test('a title with control characters or a runaway length is drawn as one short line', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  await publish($, { title: `Line one\nline two\u0007 ${'word '.repeat(60)}` })
  const { text } = await seen($)
  expect(text).not.toMatch(/\\n|\\u0007/)
  const title = text.match(/Line one line two[^"]*/)?.[0] ?? ''
  expect(title.length).toBeGreaterThan(20)
  expect(title.length).toBeLessThanOrEqual(80)
})

/** Lets the save that a call started without waiting land. */
const settle = (clock: { advance: (ms: number) => Promise<unknown> }) => clock.advance(1)
const OTHER = { cwd: '/other', surface: 'terminal', isInteractive: true } as never

test('the tool answers at once even when the desk\'s save is stuck, and the save lands when it is freed', async ($, on) => {
  const { kv, saved, clock } = session(on, () => answer(PLAIN))
  await $.session.start(START)
  let free!: () => void
  kv.held = new Promise<void>(done => { free = done })
  const ran = await publish($, { title: 'Launch plan' })
  expect(JSON.stringify(ran)).toContain(PLAIN)
  expect(saved.has('artifacts:/repo')).toBe(false)
  free()
  await settle(clock)
  expect(saved.get('artifacts:/repo')).toEqual([expect.objectContaining({ url: PLAIN, title: 'Launch plan' })])
})

test('a save that fails keeps the page for the session, tells the person once, and never changes the tool\'s answer', async ($, on) => {
  const { kv, toasts, clock } = session(on, input => answer(String(input.url)))
  await $.session.start(START)
  kv.isWriteFailing = true
  const ran = await publish($, { url: link(1), title: 'One' })
  expect(JSON.stringify(ran)).toContain(link(1))
  await settle(clock)
  await publish($, { url: link(2), title: 'Two' })
  await settle(clock)
  expect(toasts.filter(t => /artifact list/i.test(t))).toEqual(['Could not save the artifact list. It is kept for this session only.'])
  expect((await seen($)).links).toEqual([link(2), link(1)])
  // A new session is told again.
  await $.session.start(START)
  await publish($, { url: link(3), title: 'Three' })
  await settle(clock)
  expect(toasts.filter(t => /artifact list/i.test(t))).toHaveLength(2)
})

test('a call still running when the session moves to another folder is written to neither folder', async ($, on) => {
  let free!: () => void
  const gate = new Promise<void>(done => { free = done })
  const { saved, clock } = session(on, async () => (await gate, answer(PLAIN)))
  await $.session.start(START)
  const pending = publish($, { title: 'Late' })
  await $.session.start(OTHER)
  free()
  await pending
  await settle(clock)
  expect([...saved.keys()].filter(k => k.startsWith('artifacts:'))).toEqual([])
  expect((await seen($)).text).not.toMatch(/ARTIFACT|Late/)
})
