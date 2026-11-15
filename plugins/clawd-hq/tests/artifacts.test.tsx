import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HISTORY, PANE, PEOPLE, START, SURFACES, host } from './host'

/** The History tab with its Artifacts fold open: the list moved there from the Office tab. */
async function openArtifacts($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...HISTORY })
  const fold = await ui.find({ key: 'history-artifacts' })
  if (fold !== undefined && String(fold.props.label ?? '').startsWith('▸')) await ui.press({ key: 'history-artifacts' })
  return ui
}
/** Every Text and every button's words, in the order drawn (the fold's label, "▾ Artifacts · N", is a button). */
const wordsOf = async (ui: { findAll(q: object): Promise<Array<{ type?: string; props: Record<string, unknown>; text?: unknown }>> }) =>
  (await ui.findAll({})).filter(n => n.type === 'Text' || n.type === 'Button').map(n => String(n.type === 'Button' ? n.props.label ?? n.text ?? '' : n.text))


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
async function seen($: Engine, surface: 'terminal' | 'desktop' = 'terminal', pane: typeof HISTORY | typeof PEOPLE | typeof PANE = HISTORY) {
  const ui = pane === HISTORY ? await openArtifacts($, surface) : await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
  const result = {
    text: JSON.stringify(await ui.drawn()),
    links: (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href)),
    words: await wordsOf(ui),
  }
  await ui.unmount()
  return result
}

test('a published artifact shows under Artifacts on the History tab as a one-click link, on both surfaces', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  await publish($, { title: 'Launch plan' })
  for (const surface of SURFACES) {
    const ui = await openArtifacts($, surface)
    expect((await ui.find({ key: 'history-artifacts' }))?.props.label).toBe('▾ Artifacts · 1')
    const one = await ui.find({ type: 'Link' })
    expect(one?.props.href).toBe(PLAIN)
    expect(JSON.stringify(one)).toContain('Launch plan')
    expect(JSON.stringify(await ui.drawn())).toMatch(/just now/)
    await ui.unmount()
  }
})

test('the Office tab has no artifact list: it is on the History tab', async ($, on) => {
  session(on, () => answer(PLAIN))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.session.start(START)
  await $.agent.spawn({ prompt: 'Plan', description: 'Plan it', subagentType: 'ecc:planner' } as never)
  await publish($, { title: 'Launch plan' })
  expect((await seen($, 'terminal', PANE)).text).not.toMatch(/ARTIFACTS|Launch plan/)
  expect((await seen($)).words).toContain('▾ Artifacts · 1')
})

test('with no artifacts the section is not drawn at all, and it is only on the History tab', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  for (const surface of SURFACES) {
    const { text, links } = await seen($, surface)
    expect(text).not.toMatch(/Artifacts ·/)
    expect(links).toEqual([])
  }
  await publish($, { title: 'Launch plan' })
  expect((await seen($, 'terminal', PEOPLE)).text).not.toMatch(/Artifacts ·/)
})

test('a specialist\'s publish and an open are recorded too, with the link from the input or from the result', async ($, on) => {
  session(on, input => (input.action === 'open' ? { result: 'Opened', text: 'Opened' } : answer(CODE)))
  await $.session.start(START)
  await publish($, { agentId: 'a1', title: 'By a specialist' })
  await publish($, { action: 'open', url: PLAIN })
  const { links, words } = await seen($)
  expect(links).toEqual([PLAIN, CODE])
  expect(words).toContain('▾ Artifacts · 2')
})

test('read, list, quickstart, pin and unpin record nothing, and neither does any other tool\'s output', async ($, on) => {
  session(on, () => answer(PLAIN), {}, { result: PLAIN, text: `Pages: ${PLAIN} and ${CODE}` })
  await $.session.start(START)
  for (const action of ['read', 'list', 'quickstart', 'pin', 'unpin']) await publish($, { action, url: PLAIN })
  await $.tool.call({ tool: 'Bash', command: 'echo listing' } as never)
  await $.tool.call({ tool: 'WebFetch', url: PLAIN } as never)
  await $.tool.call({ tool: 'mcp__other__Artifact', title: 'Not ours' } as never)
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
})

test('a link that is not exactly one of the two shapes is never kept or drawn', async ($, on) => {
  session(on, input => answer(String(input.page)))
  await $.session.start(START)
  for (const page of ['https://evil.com/artifact/abc', 'http://claude.ai/artifact/abc', 'https://claude.ai/artifact/abc?x=1', 'javascript:alert(1)']) {
    await publish($, { page, url: page, title: 'Sneaky' })
    await publish($, { page, title: 'Sneaky' })
  }
  expect((await seen($)).text).not.toMatch(/Artifacts ·|Sneaky/)
})

test('a call that failed records nothing', async ($, on) => {
  session(on, () => answer(PLAIN, { isError: true }))
  await $.session.start(START)
  await publish($, { title: 'Broken' })
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
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
  expect(words).toContain('▾ Artifacts · 2')
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
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
})

test('the newest 6 are drawn, "N older" with show counts the rest, and the fold counts all', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 8; n += 1) {
    await publish($, { url: link(n), title: `Page ${n}` })
    await clock.advance(MIN)
  }
  for (const surface of SURFACES) {
    const { links, words } = await seen($, surface)
    expect(links).toEqual([8, 7, 6, 5, 4, 3].map(link))
    expect(words).toContain('▾ Artifacts · 8')
    expect(words).toContain('2 older')
  }
  await publish($, { url: link(9), title: 'Page 9' })
  expect((await seen($)).words).toContain('3 older')
})

test('exactly 6 artifacts draw no older-line, and 7 say "1 older"', async ($, on) => {
  session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 6; n += 1) await publish($, { url: link(n), title: `Page ${n}` })
  expect((await seen($)).text).not.toMatch(/older/)
  await publish($, { url: link(7), title: 'Page 7' })
  expect((await seen($)).words).toContain('1 older')
})

test('only the newest 50 are kept', async ($, on) => {
  session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 53; n += 1) await publish($, { url: link(n), title: `Page ${n}` })
  expect((await seen($)).words).toContain('▾ Artifacts · 50')
  // Away to another folder and back: what comes back is what was kept.
  await $.session.start({ cwd: '/other', surface: 'terminal', isInteractive: true } as never)
  await $.session.start(START)
  const { links, words } = await seen($)
  expect(words).toContain('▾ Artifacts · 50')
  expect(words).toContain('44 older')
  expect(links[0]).toBe(link(53))
})

test('the list belongs to the project folder and survives sessions', async ($, on) => {
  session(on, () => answer(PLAIN))
  await $.session.start(START)
  await publish($, { title: 'Launch plan' })
  await $.session.start({ cwd: '/other', surface: 'terminal', isInteractive: true } as never)
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
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

// ---- A page deleted on claude.ai leaves the list at session start, but only on a call the engine allows unasked ----
// What happens after an allow (a gone page leaves the list and the store; a failed call removes nothing) is unit-tested
// with a fake in tests/artifacts.test.ts, so no hook here answers a permission check with allow.
const GONE = [{ url: PLAIN, title: 'Kept', at: 500 }, { url: CODE, title: 'Deleted elsewhere', at: 400 }]

test('when the engine would ask the person, or the call fails, nothing is listed and nothing leaves', async ($, on) => {
  let listed = 0
  session(on, input => (input.action === 'list' ? (listed++, { result: 'boom', isError: true, text: 'boom' }) : answer(PLAIN)), { 'artifacts:/repo': GONE })
  on('tool.check', () => ({ decision: 'ask' }) as never)
  await $.session.start(START)
  expect(listed).toBe(0)
  expect((await seen($)).links).toEqual([PLAIN, CODE])
})

test('a stored value that is not a list is ignored',async ($, on) => {
  session(on, () => answer(PLAIN), { 'artifacts:/repo': { oops: true } })
  await $.session.start(START)
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
})

test('two publishes at the same moment are both kept', async ($, on) => {
  session(on, input => answer(String(input.url)))
  await $.session.start(START)
  await Promise.all([publish($, { url: link(1), title: 'One' }), publish($, { url: link(2), title: 'Two' }), publish($, { url: link(3), title: 'Three' })])
  expect((await seen($)).words).toContain('▾ Artifacts · 3')
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

// ---- Hide: a dim button on each row takes the page off this project's desk, kept across sessions; the page on claude.ai stays ----
const hideKey = (url: string) => `artifact-hide-${url}`

test('each row has a dim Hide button; pressing it takes that page off the desk on both surfaces, and the store', async ($, on) => {
  const { saved, clock } = session(on, input => answer(String(input.url)))
  await $.session.start(START)
  await publish($, { url: link(1), title: 'One' })
  await publish($, { url: link(2), title: 'Two' })
  for (const surface of SURFACES) {
    const ui = await openArtifacts($, surface)
    expect((await ui.findAll({ type: 'Button', text: 'Hide' })).length).toBe(2)
    await ui.unmount()
  }
  const ui = await openArtifacts($, 'terminal')
  await ui.press({ key: hideKey(link(2)) })
  await settle(clock)
  await ui.unmount()
  const { links, words } = await seen($)
  expect(links).toEqual([link(1)])
  expect(words).toContain('▾ Artifacts · 1')
  expect(saved.get('artifacts:/repo')).toEqual([expect.objectContaining({ url: link(1) })])
})

test('hiding does not call the Artifact tool, and hiding the last page takes the section away', async ($, on) => {
  const calls: unknown[] = []
  session(on, input => (calls.push(input), answer(String(input.url))))
  await $.session.start(START)
  await publish($, { url: link(1), title: 'One' })
  const before = calls.length
  const ui = await openArtifacts($, 'desktop')
  await ui.press({ key: hideKey(link(1)) })
  await ui.unmount()
  expect(calls.length).toBe(before)
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
})

test('a hidden page stays hidden in the next session, and the next page of the older ones takes its place', async ($, on) => {
  const { clock } = session(on, input => answer(String(input.url)))
  await $.session.start(START)
  for (let n = 1; n <= 7; n += 1) await publish($, { url: link(n), title: `Page ${n}` })
  const ui = await openArtifacts($, 'terminal')
  await ui.press({ key: hideKey(link(7)) })
  await settle(clock)
  await ui.unmount()
  const now = await seen($)
  expect(now.links).toEqual([6, 5, 4, 3, 2, 1].map(link))
  expect(now.words).toContain('▾ Artifacts · 6')
  await $.session.start(OTHER)
  await $.session.start(START)
  expect((await seen($)).links).toEqual([6, 5, 4, 3, 2, 1].map(link))
})

test('a hidden page that is published or opened again comes back', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock } = session(on, input => (input.action === 'open' ? { result: 'Opened', text: 'Opened' } : answer(String(input.url))))
  await $.session.start(START)
  await publish($, { url: link(1), title: 'One' })
  await publish($, { url: link(2), title: 'Two' })
  const ui = await openArtifacts($, 'terminal')
  await ui.press({ key: hideKey(link(1)) })
  await ui.press({ key: hideKey(link(2)) })
  await settle(clock)
  await ui.unmount()
  expect((await seen($)).text).not.toMatch(/Artifacts ·/)
  await publish($, { url: link(1), title: 'One again' })
  await publish($, { action: 'open', url: link(2), title: 'Two' })
  expect((await seen($)).links).toEqual([link(2), link(1)])
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
