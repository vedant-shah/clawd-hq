// The Artifact Desk through the plugin's own wiring, for sessions where pages are published with the claude-artifacts connector
// (MCP tools) and the built-in Artifact tool is not there.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, START, host } from './host'

const SLUG = '42d37a55-5bdb-4d3b-9870-42b85285d9e0'
const SLUG2 = '66962085-0314-4aff-a33b-7d1856d72556'
const URL1 = 'https://claude.ai/artifact/9FcdMcCMNuUS9sAKhQ81dq'
const URL2 = 'https://claude.ai/artifact/DfjWnGvoW9yKCTMW1gL2CD'
type On = Parameters<typeof host>[0]

const PUBLISH = 'mcp__claude-artifacts__publish_version'
const EDIT = 'mcp__claude-artifacts__edit_version'
const FILES = 'mcp__claude-artifacts__publish_files'
const LIST = 'mcp__claude-artifacts__list_artifacts'

/** What the connector answers, as the text block of an MCP result. */
const reply = (body: Record<string, unknown>) => {
  const text = JSON.stringify(body)
  return { result: { content: [{ type: 'text', text }] }, text }
}
const page = (slug: string, url: string, title: string) => reply({ slug, version: '1-aa', title, url, read: 'owner' })

let held: ReturnType<typeof host>['clock'] | undefined
/** A session with no built-in Artifact tool: the engine refuses every check on it, and the connector answers as `answer(tool, input)`. */
function connectorSession(on: On, answer: (tool: string, input: Record<string, unknown>) => unknown, store: Record<string, unknown> = {}, over: { listVerdict?: string } = {}) {
  const h = host(on, [], store)
  held = h.clock
  on('tool.call', (_$, e) => answer((e as { tool: string }).tool, e as never) as never)
  // Whatever the server's prefix, its read-only list is answered by `listVerdict`.
  on('tool.check', (_$, e) => ({ decision: (e as { tool: string }).tool === 'Artifact' ? 'deny' : (e as { tool: string }).tool.endsWith('__list_artifacts') ? over.listVerdict ?? 'allow' : 'allow' }) as never)
  return h
}
async function call($: Engine, tool: string, input: Record<string, unknown> = {}) {
  const ran = await $.tool.call({ tool, ...input } as never)
  await held?.advance(1)
  return ran
}
async function seen($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const result = {
    text: JSON.stringify(await ui.drawn()),
    links: (await ui.findAll({ type: 'Link' })).map(l => String(l.props.href)),
    words: (await ui.findAll({ type: 'Text' })).map(t => String(t.text)),
  }
  await ui.unmount()
  return result
}

test('a page published through the connector joins the desk as a link, on both surfaces', async ($, on) => {
  connectorSession(on, () => page(SLUG, URL1, 'Robot Vacuum Verdict'))
  await $.session.start(START)
  await call($, PUBLISH, { title: 'Robot Vacuum Verdict', content: '<!DOCTYPE html>' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const { links, words, text } = await seen($, surface)
    expect(links).toEqual([URL1])
    expect(words).toContain('ARTIFACTS · 1')
    expect(text).toContain('Robot Vacuum Verdict')
  }
})

test('publish_files records a page too, and so does a specialist\'s publish', async ($, on) => {
  connectorSession(on, tool => (tool === FILES ? page(SLUG2, URL2, 'From files') : page(SLUG, URL1, 'By a specialist')))
  await $.session.start(START)
  await call($, FILES, { files: [{ as: 'index.html', path: '/tmp/x/index.html' }], title: 'From files' })
  await call($, PUBLISH, { agentId: 'a1', title: 'By a specialist', content: 'x' })
  expect((await seen($)).links).toEqual([URL1, URL2])
})

test('an edit of the same page updates its row and moves it to the top; there is never a second row', async ($, on) => {
  let title = 'Robot Vacuum Verdict'
  const { clock } = connectorSession(on, tool => (tool === FILES ? page(SLUG2, URL2, 'Font Looks') : page(SLUG, URL1, title)))
  await $.session.start(START)
  await call($, PUBLISH, { title, content: 'x' })
  await clock.advance(2 * 60_000)
  await call($, FILES, { files: [], title: 'Font Looks' })
  expect((await seen($)).links).toEqual([URL2, URL1])
  await clock.advance(3 * 60_000)
  title = 'Robot Vacuum Verdict, revised'
  await call($, EDIT, { slug: SLUG, base_version: '1-aa', edits: [] })
  const { links, words, text } = await seen($)
  expect(links).toEqual([URL1, URL2])
  expect(words).toContain('ARTIFACTS · 2')
  expect(text).toContain('Robot Vacuum Verdict, revised')
  expect(text).not.toContain('"Robot Vacuum Verdict"')
  expect(text).toMatch(/just now/)
  expect(text).toMatch(/3m ago/)
})

test('a failed or refused connector call, and the connector\'s other tools, record nothing', async ($, on) => {
  connectorSession(on, tool => (tool === EDIT ? { ...page(SLUG, URL1, 'Broken'), isError: true } : tool === FILES ? reply({ error: 'conflict: base_version is not live' }) : page(SLUG, URL1, 'Not a publish')))
  await $.session.start(START)
  await call($, EDIT, { slug: SLUG, base_version: 'x', edits: [] })
  await call($, FILES, { files: [] })
  await call($, 'mcp__claude-artifacts__get_artifact', { slug: SLUG })
  await call($, 'mcp__claude-artifacts__read_artifact', { slug: SLUG })
  await call($, 'mcp__other__publish_version', { content: 'x' })
  expect((await seen($)).text).not.toMatch(/ARTIFACT/)
})

test('the desk is kept per project folder and survives sessions, with the slug', async ($, on) => {
  const { saved } = connectorSession(on, () => page(SLUG, URL1, 'Robot Vacuum Verdict'))
  await $.session.start(START)
  await call($, PUBLISH, { title: 'Robot Vacuum Verdict', content: 'x' })
  expect(saved.get('artifacts:/repo')).toEqual([{ url: URL1, title: 'Robot Vacuum Verdict', at: expect.any(Number), slug: SLUG }])
  await $.session.start(START)
  expect((await seen($)).links).toEqual([URL1])
})

// ---- The refresh at session start, with the built-in tool missing ----

const ROWS = [{ url: URL1, title: 'Kept', at: 500, slug: SLUG }, { url: URL2, title: 'Deleted on claude.ai', at: 400, slug: SLUG2 }]
const listing = (...rows: Array<Record<string, unknown>>) => reply({ artifacts: rows })

test('with the built-in Artifact tool missing, session start lists through the connector and drops a page it no longer lists', async ($, on) => {
  const asked: Array<[string, unknown]> = []
  const { saved, clock } = connectorSession(on, (tool, input) => (tool === LIST ? (asked.push([tool, input.limit]), listing({ slug: SLUG, title: 'Kept', url: URL1, rel: 'mine', version: '1-aa' })) : page(SLUG, URL1, 'x')), { 'artifacts:/repo': ROWS })
  await $.session.start(START)
  await clock.advance(1)
  expect(asked).toEqual([[LIST, 200]])
  expect((await seen($)).links).toEqual([URL1])
  expect(saved.get('artifacts:/repo')).toEqual([ROWS[0]])
})

test('when the engine would ask the person before the connector\'s list, or the list fails, nothing is dropped', async ($, on) => {
  let listed = 0
  const { clock } = connectorSession(on, tool => (tool === LIST ? (listed++, listing()) : page(SLUG, URL1, 'x')), { 'artifacts:/repo': ROWS }, { listVerdict: 'ask' })
  await $.session.start(START)
  await clock.advance(1)
  expect(listed).toBe(0)
  expect((await seen($)).links).toEqual([URL1, URL2])
})

test('a connector list that fails drops nothing', async ($, on) => {
  const { clock } = connectorSession(on, tool => (tool === LIST ? { result: 'boom', isError: true, text: JSON.stringify({ artifacts: [{ slug: SLUG, url: URL1 }] }) } : page(SLUG, URL1, 'x')), { 'artifacts:/repo': ROWS })
  await $.session.start(START)
  await clock.advance(1)
  expect((await seen($)).links).toEqual([URL1, URL2])
})

// ---- The list that is cut short, and the page whose link changed ----

const rowsOf = (live: number, deleted: number) => [
  ...Array.from({ length: live }, (_, i) => ({ slug: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: 'Other', url: `https://claude.ai/artifact/live${i}`, rel: 'mine' })),
  ...Array.from({ length: deleted }, (_, i) => ({ slug: `11111111-0000-4000-8000-${String(i).padStart(12, '0')}`, title: 'Deleted', url: `https://claude.ai/artifact/dead${i}`, rel: 'mine', soft_deleted: true })),
]

test('200 rows with 30 of them deleted may be cut short, so nothing is dropped; the same list under the limit drops what it leaves out', async ($, on) => {
  let rows = rowsOf(170, 30)
  const { clock } = connectorSession(on, tool => (tool === LIST ? listing(...rows) : page(SLUG, URL1, 'x')), { 'artifacts:/repo': ROWS })
  await $.session.start(START)
  await clock.advance(1)
  expect((await seen($)).links).toEqual([URL1, URL2])
  rows = [...rowsOf(169, 30), { slug: SLUG, title: 'Kept', url: URL1, rel: 'mine' }]
  await $.session.start(START)
  await clock.advance(1)
  expect(rows).toHaveLength(200)
  rows = [...rowsOf(100, 30), { slug: SLUG, title: 'Kept', url: URL1, rel: 'mine' }]
  await $.session.start(START)
  await clock.advance(1)
  expect((await seen($)).links).toEqual([URL1])
})

test('a page whose link changed on the connector keeps its row with the new link, while the page it no longer lists leaves', async ($, on) => {
  const moved = 'https://claude.ai/artifact/MovedMovedMoved1'
  const { saved, clock } = connectorSession(on, tool => (tool === LIST ? listing({ slug: SLUG, title: 'Kept', url: moved, rel: 'mine', version: '2-bb' }) : page(SLUG, moved, 'x')), { 'artifacts:/repo': ROWS })
  await $.session.start(START)
  await clock.advance(1)
  expect((await seen($)).links).toEqual([moved])
  expect(saved.get('artifacts:/repo')).toEqual([{ ...ROWS[0], url: moved }])
})

// ---- Which server's list is asked: the prefix a recorded publish showed ----

const ACME = 'mcp__plugin_acme_claude-artifacts__'
const OTHER = 'mcp__plugin_other_claude-artifacts__'
const EXACT = 'mcp__claude-artifacts__'
const MOVE_TO = '/other'
const ELSEWHERE = { [`artifacts:${MOVE_TO}`]: [{ url: URL2, title: 'Deleted elsewhere', at: 400, slug: SLUG2 }] }

/** A session whose root can be moved, whose connector answers publishes and lists under any prefix, and which writes down every list tool asked. */
function movableSession(on: On, failing: string[] = []) {
  const where = { folder: '/repo' }
  const asked: string[] = []
  const h = connectorSession(on, tool => {
    if (failing.includes(tool)) return { ...page(SLUG, URL1, 'Broken'), isError: true }
    if (tool.endsWith('__list_artifacts')) return (asked.push(tool), listing({ slug: SLUG, title: 'Kept', url: URL1, rel: 'mine' }))
    return page(SLUG, URL1, 'Robot Vacuum Verdict')
  }, ELSEWHERE)
  on('session.cwd', () => ({ value: where.folder }) as never)
  on('session.root', () => ({ value: where.folder }) as never)
  on('classic.CwdChanged', () => ({}) as never)
  const move = async ($: Engine) => {
    where.folder = MOVE_TO
    await $.classic.CwdChanged({ old_cwd: '/repo', new_cwd: MOVE_TO })
    await h.clock.advance(1)
  }
  return { ...h, asked, move }
}

test('the next sweep asks the server a recorded publish came from, not the usual name', async ($, on) => {
  const { asked, move, clock } = movableSession(on)
  await $.session.start(START)
  await clock.advance(1)
  expect(asked).toEqual([`${EXACT}list_artifacts`])
  await call($, `${ACME}publish_version`, { title: 'Robot Vacuum Verdict', content: 'x' })
  await move($)
  expect(asked).toEqual([`${EXACT}list_artifacts`, `${ACME}list_artifacts`])
  // The page of the other folder that the list no longer names is gone from that folder's desk.
  expect((await seen($)).links).toEqual([])
})

test('a publish that failed teaches nothing: the next sweep still asks the usual server', async ($, on) => {
  const { asked, move, clock } = movableSession(on, [`${OTHER}publish_files`])
  await $.session.start(START)
  await clock.advance(1)
  asked.length = 0
  await call($, `${OTHER}publish_files`, { files: [] })
  await move($)
  expect(asked).toEqual([`${EXACT}list_artifacts`])
})

test('the exact claude-artifacts server is the one asked once it has published, whichever lookalikes publish before or after it', async ($, on) => {
  const { asked, move, clock } = movableSession(on)
  await $.session.start(START)
  await clock.advance(1)
  asked.length = 0
  await call($, `${ACME}publish_version`, { title: 'a', content: 'x' })
  await call($, `${EXACT}publish_version`, { title: 'b', content: 'x' })
  await call($, `${OTHER}publish_version`, { title: 'c', content: 'x' })
  await move($)
  expect(asked).toEqual([`${EXACT}list_artifacts`])
})

test('session start forgets the server learned, and asks the usual one again', async ($, on) => {
  const { asked, clock } = movableSession(on)
  await $.session.start(START)
  await call($, `${ACME}publish_version`, { title: 'x', content: 'x' })
  await $.session.start(START)
  await clock.advance(1)
  expect(asked).toEqual([`${EXACT}list_artifacts`, `${EXACT}list_artifacts`])
})
