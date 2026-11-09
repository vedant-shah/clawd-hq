// The Artifact Desk for pages published through the claude-artifacts connector (MCP) instead of the built-in Artifact tool.
import { expect, test } from 'claude-code/testing'
import { CONNECTOR_PREFIX, cleanArtifacts, connectorCall, connectorLinks, connectorToolOf, keepConnectorArtifact, learnedPrefix, sweepArtifacts, withArtifact, withoutGone } from '../hooks/artifacts'
import type { ArtifactIo } from '../hooks/artifacts'
import type { Artifact } from '../types'

const SLUG = '42d37a55-5bdb-4d3b-9870-42b85285d9e0'
const SLUG2 = '66962085-0314-4aff-a33b-7d1856d72556'
const URL1 = 'https://claude.ai/artifact/9FcdMcCMNuUS9sAKhQ81dq'
const URL2 = 'https://claude.ai/artifact/DfjWnGvoW9yKCTMW1gL2CD'
const BUILT_IN = 'https://claude.ai/artifact/9WdR8H2T9Z7QScxjCbQjEM'

/** The answer text of edit_version / publish_version, as the connector words it. */
const json = (over: Record<string, unknown> = {}) => JSON.stringify({ slug: SLUG, version: '1794203457-cf91', title: 'Robot Vacuum Verdict', url: URL1, read: 'public', ...over })
/** The same answer in the shapes an MCP result may reach a hook in. */
const asText = (over?: Record<string, unknown>) => ({ text: json(over) })
const asBlocks = (over?: Record<string, unknown>) => ({ result: { content: [{ type: 'text', text: json(over) }] }, text: 'ignored' })
const asBlockList = (over?: Record<string, unknown>) => ({ result: [{ type: 'text', text: json(over) }] })
const asString = (over?: Record<string, unknown>) => ({ result: json(over) })
const asRecord = (over?: Record<string, unknown>) => ({ result: { slug: SLUG, version: '1', title: 'Robot Vacuum Verdict', url: URL1, ...over } })
const asStructured = (over?: Record<string, unknown>) => ({ result: { content: [], structuredContent: JSON.parse(json(over)) } })
const withNotice = (over?: Record<string, unknown>) => ({ text: `<artifact-content-authored-by-others/>\nThis result includes content written by others.${json(over)}` })

test('the connector\'s three publishing tools are matched by server and tool name, whatever the server\'s prefix', () => {
  for (const tool of ['publish_files', 'publish_version', 'edit_version']) {
    expect(connectorToolOf(`${CONNECTOR_PREFIX}${tool}`)).toEqual({ prefix: CONNECTOR_PREFIX, tool })
    // Another machine may name the server with a prefix of its own; the server part still ends in claude-artifacts.
    expect(connectorToolOf(`mcp__plugin_acme_claude-artifacts__${tool}`)).toEqual({ prefix: 'mcp__plugin_acme_claude-artifacts__', tool })
  }
  for (const other of [
    'mcp__claude-artifacts__list_artifacts', 'mcp__claude-artifacts__read_artifact', 'mcp__claude-artifacts__delete_artifact', 'mcp__claude-artifacts__get_artifact',
    'mcp__other__publish_version', 'mcp__claude-artifacts-evil__publish_version', 'mcp__evil-claude-artifacts__publish_version', 'claude-artifacts__publish_version',
    'Artifact', 'publish_version', 'mcp__claude-artifacts__publish_version_x', '',
  ]) expect([other, connectorToolOf(other)]).toEqual([other, undefined])
})

test('a publish or an edit answer gives the page\'s slug, link and title, however the result reached the hook', () => {
  const want = { slug: SLUG, url: URL1, title: 'Robot Vacuum Verdict' }
  for (const make of [asText, asBlocks, asBlockList, asString, asRecord, asStructured, withNotice]) {
    expect([make.name, connectorCall({}, make())]).toEqual([make.name, want])
  }
})

test('the answer\'s title wins, then the input\'s; the input\'s slug or url is never taken for the page', () => {
  expect(connectorCall({ title: 'Typed' }, asText({ title: undefined }))).toEqual({ slug: SLUG, url: URL1, title: 'Typed' })
  expect(connectorCall({ title: 'Typed' }, asText())?.title).toBe('Robot Vacuum Verdict')
  expect(connectorCall({ slug: SLUG2, title: 'Typed' }, asText({ slug: undefined, url: undefined }))).toBeUndefined()
})

test('an answer with only a slug, or only a link, still names the page; one with neither names nothing', () => {
  expect(connectorCall({}, asText({ url: undefined }))).toEqual({ slug: SLUG, url: undefined, title: 'Robot Vacuum Verdict' })
  expect(connectorCall({}, asText({ slug: undefined }))).toEqual({ slug: undefined, url: URL1, title: 'Robot Vacuum Verdict' })
  expect(connectorCall({}, { text: JSON.stringify({ version: '1', title: 'x' }) })).toBeUndefined()
  expect(connectorCall({}, { text: 'Published.' })).toBeUndefined()
})

test('a failed, refused or error answer records nothing, nor does a link or slug that is not exactly ours', () => {
  expect(connectorCall({}, { ...asText(), isError: true })).toBeUndefined()
  expect(connectorCall({}, { ...asText(), deny: 'no' })).toBeUndefined()
  expect(connectorCall({}, undefined)).toBeUndefined()
  expect(connectorCall({}, asText({ error: 'conflict: base_version is not live' }))).toBeUndefined()
  expect(connectorCall({}, { text: JSON.stringify({ error: 'conflict', live_version: '2-bb' }) })).toBeUndefined()
  // A link that is not a claude.ai artifact link is dropped; the slug alone may still match a page already on the desk.
  expect(connectorCall({}, asText({ url: 'https://evil.com/artifact/abc' }))).toEqual({ slug: SLUG, url: undefined, title: 'Robot Vacuum Verdict' })
  expect(connectorCall({}, asText({ url: 'https://evil.com/artifact/abc', slug: 'not-a-uuid' }))).toBeUndefined()
  expect(connectorCall({}, asText({ slug: 'not-a-uuid', url: undefined }))).toBeUndefined()
})

test('a title from the connector is one short line', () => {
  const got = connectorCall({}, asText({ title: `Line one\nline two\u0007 ${'word '.repeat(60)}` }))
  expect(got?.title).toMatch(/^Line one line two/)
  expect(got?.title?.length).toBeLessThanOrEqual(80)
})

// ---- The desk's row for a page: found by slug, else by link; one row per page ----

test('a row is found by its slug first, then by its link, and a slug is added to a row that had none', () => {
  const a: Artifact = { url: URL1, title: 'Old', at: 1, slug: SLUG }
  const b: Artifact = { url: URL2, title: 'Other', at: 2, slug: SLUG2 }
  const bySlug = withArtifact([b, a], URL1, 'New', 9, SLUG)
  expect(bySlug).toEqual([{ url: URL1, title: 'New', at: 9, slug: SLUG }, b])
  // The same page under a new link: the slug finds the row, which takes the new link, with no second row.
  const moved = withArtifact([b, a], URL2.replace('Dfj', 'Xyz'), 'Moved', 9, SLUG)
  expect(moved.filter(r => r.slug === SLUG)).toEqual([{ url: URL2.replace('Dfj', 'Xyz'), title: 'Moved', at: 9, slug: SLUG }])
  expect(moved).toHaveLength(2)
  // A row from the built-in tool (no slug) found by its link gains the slug.
  expect(withArtifact([{ url: BUILT_IN, title: 'Built', at: 1 }], BUILT_IN, undefined, 5, SLUG)).toEqual([{ url: BUILT_IN, title: 'Built', at: 5, slug: SLUG }])
  // A call with no slug keeps the slug the row has, and writes no slug key on a row that never had one.
  expect(withArtifact([a], URL1, 'Again', 7)).toEqual([{ url: URL1, title: 'Again', at: 7, slug: SLUG }])
  expect(Object.keys(withArtifact([], BUILT_IN, 'T', 1)[0]!)).toEqual(['url', 'title', 'at'])
})

test('what was stored keeps a real slug and drops anything else in its place', () => {
  const row = { url: URL1, title: 'T', at: 1 }
  expect(cleanArtifacts([{ ...row, slug: SLUG }, { ...row, url: URL2, slug: 'junk' }, { ...row, url: BUILT_IN, slug: 7 }])).toEqual([
    { ...row, slug: SLUG }, { ...row, url: URL2 }, { ...row, url: BUILT_IN },
  ])
})

// ---- The desk's work for a connector call ----

type Desk = { io: ArtifactIo; list: Artifact[]; saved: Array<[string, Artifact[]]>; folder: string; now: number }

function desk(start: Artifact[], over: { folder?: string } = {}): Desk {
  const d: Desk = { io: undefined as never, list: start, saved: [], folder: over.folder ?? '/proj', now: 100 }
  d.io = {
    folder: () => d.folder, now: async () => d.now,
    change: async fn => (d.list = fn(d.list)),
    save: async (folder, list) => { d.saved.push([folder, list]) },
    warnOnce: () => undefined,
    check: async () => ({ decision: 'deny' }),
    list: async () => ({}),
  }
  return d
}

test('a connector publish adds a row with the page\'s slug, and the list is saved under its folder', async () => {
  const d = desk([])
  await keepConnectorArtifact(d.io, '/proj', { title: 'Robot Vacuum Verdict', files: [] }, asBlocks())
  expect(d.list).toEqual([{ url: URL1, title: 'Robot Vacuum Verdict', at: 100, slug: SLUG }])
  expect(d.saved).toEqual([['/proj', d.list]])
})

test('an edit of the same page updates its row (new title, moved to the top) and never adds a second one', async () => {
  const d = desk([])
  await keepConnectorArtifact(d.io, '/proj', { title: 'Robot Vacuum Verdict' }, asBlocks())
  d.now = 200
  await keepConnectorArtifact(d.io, '/proj', { slug: SLUG2 }, asText({ slug: SLUG2, url: URL2, title: 'Font Looks' }))
  d.now = 300
  await keepConnectorArtifact(d.io, '/proj', { slug: SLUG, base_version: '1794203457-cf91', edits: [] }, asText({ title: 'Robot Vacuum Verdict, revised', version: '1794209999-aa11' }))
  expect(d.list).toEqual([
    { url: URL1, title: 'Robot Vacuum Verdict, revised', at: 300, slug: SLUG },
    { url: URL2, title: 'Font Looks', at: 200, slug: SLUG2 },
  ])
})

test('an edit answer that names the slug but no link still finds the row; one that names an unknown slug and no link records nothing', async () => {
  const d = desk([{ url: URL1, title: 'Before', at: 1, slug: SLUG }])
  await keepConnectorArtifact(d.io, '/proj', {}, asText({ url: undefined, title: 'After' }))
  expect(d.list).toEqual([{ url: URL1, title: 'After', at: 100, slug: SLUG }])
  const saved = d.saved.length
  await keepConnectorArtifact(d.io, '/proj', {}, asText({ slug: SLUG2, url: undefined }))
  expect([d.list.length, d.saved.length]).toEqual([1, saved])
})

test('a page the built-in tool put on the desk is the same row when the connector edits it, found by its link', async () => {
  const d = desk([{ url: BUILT_IN, title: 'Built', at: 1 }])
  await keepConnectorArtifact(d.io, '/proj', {}, asText({ url: BUILT_IN, title: 'Built, edited' }))
  expect(d.list).toEqual([{ url: BUILT_IN, title: 'Built, edited', at: 100, slug: SLUG }])
})

test('failed, refused and unrelated connector calls record nothing, and a page from another folder is dropped', async () => {
  const d = desk([])
  await keepConnectorArtifact(d.io, '/proj', {}, { ...asText(), isError: true })
  await keepConnectorArtifact(d.io, '/proj', {}, { ...asText(), deny: 'no' })
  await keepConnectorArtifact(d.io, '/proj', {}, asText({ error: 'conflict' }))
  await keepConnectorArtifact(d.io, '/proj', {}, { text: 'Published.' })
  expect([d.list, d.saved]).toEqual([[], []])
  const moved = desk([], { folder: '/other' })
  await keepConnectorArtifact(moved.io, '/proj', {}, asText())
  expect([moved.list, moved.saved]).toEqual([[], []])
})

// ---- The session-start refresh, through the built-in tool or else the connector ----

const entry = (slug: string, url: string, over: Record<string, unknown> = {}) => ({ slug, title: 'T', version: '1', rel: 'mine', url, ...over })
const listAnswer = (artifacts: unknown[], over: Record<string, unknown> = {}) => ({ text: `<artifact-content-authored-by-others/>\nData.${JSON.stringify({ artifacts, ...over })}` })

type Calls = { builtIn: number; checked: Array<[string, unknown]>; listed: Array<[string, unknown]> }

/** A desk whose built-in tool and connector answer as given; `builtIn` is the verdict for the Artifact tool, `connector` for the connector's list. */
function sweepDesk(start: Artifact[], over: { builtIn?: unknown; connector?: unknown; answer?: unknown; prefix?: string; links?: string[] } = {}) {
  const d = desk(start)
  const calls: Calls = { builtIn: 0, checked: [], listed: [] }
  d.io = {
    ...d.io,
    check: async () => ({ decision: over.builtIn ?? 'deny' }),
    list: async () => (calls.builtIn++, { text: (over.links ?? []).join(' ') }),
    connector: {
      prefix: () => over.prefix ?? CONNECTOR_PREFIX,
      check: async (tool, input) => (calls.checked.push([tool, input]), { decision: over.connector ?? 'allow' }),
      list: async (tool, input) => (calls.listed.push([tool, input]), (over.answer ?? listAnswer([])) as never),
    },
  }
  return { d, calls }
}

test('with the built-in tool not offered, the sweep lists through the connector and drops the connector pages it no longer lists', async () => {
  const keep: Artifact = { url: URL1, title: 'Kept', at: 1, slug: SLUG }
  const gone: Artifact = { url: URL2, title: 'Gone', at: 1, slug: SLUG2 }
  const { d, calls } = sweepDesk([keep, gone], { answer: listAnswer([entry(SLUG, URL1)]) })
  await sweepArtifacts(d.io, '/proj')
  expect(d.list).toEqual([keep])
  expect(d.saved).toEqual([['/proj', [keep]]])
  expect(calls.builtIn).toBe(0)
  // The read-only list call, by tool name from the connector's prefix, asked about first with the very same input.
  expect(calls.checked).toEqual([[`${CONNECTOR_PREFIX}list_artifacts`, { limit: 200 }]])
  expect(calls.listed).toEqual(calls.checked)
})

test('the sweep asks the server the hook saw publishing, not a fixed name', async () => {
  const { d, calls } = sweepDesk([{ url: URL1, title: 'Kept', at: 1, slug: SLUG }], { answer: listAnswer([entry(SLUG, URL1)]), prefix: 'mcp__plugin_acme_claude-artifacts__' })
  await sweepArtifacts(d.io, '/proj')
  expect(calls.checked.map(c => c[0])).toEqual(['mcp__plugin_acme_claude-artifacts__list_artifacts'])
})

test('the connector\'s list never removes a page the built-in tool put on the desk, and does not count a deleted page as there', async () => {
  const builtIn: Artifact = { url: BUILT_IN, title: 'Built-in page', at: 1 }
  const trashed: Artifact = { url: URL2, title: 'Trashed', at: 1, slug: SLUG2 }
  const live: Artifact = { url: URL1, title: 'Live', at: 1, slug: SLUG }
  const { d } = sweepDesk([builtIn, trashed, live], { answer: listAnswer([entry(SLUG, URL1), entry(SLUG2, URL2, { soft_deleted: true })]) })
  await sweepArtifacts(d.io, '/proj')
  expect(d.list).toEqual([builtIn, live])
})

test('when both tools exist the built-in tool is used, and it leaves the connector\'s pages alone', async () => {
  const builtIn: Artifact = { url: BUILT_IN, title: 'Built-in page', at: 1 }
  const gone: Artifact = { url: URL2, title: 'Built-in, gone', at: 1 }
  const viaConnector: Artifact = { url: URL1, title: 'Connector page', at: 1, slug: SLUG }
  const { d, calls } = sweepDesk([builtIn, gone, viaConnector], { builtIn: 'allow', links: [BUILT_IN, 'https://claude.ai/artifact/other'] })
  await sweepArtifacts(d.io, '/proj')
  expect(d.list).toEqual([builtIn, viaConnector])
  expect(calls.builtIn).toBe(1)
  expect(calls.checked).toEqual([])
})

test('the connector\'s list removes nothing when the engine would ask, the answer is cut short or failed, or there is no folder', async () => {
  const start: Artifact[] = [{ url: URL2, title: 'Stays', at: 1, slug: SLUG2 }]
  const answer = listAnswer([entry(SLUG, URL1)])
  for (const [folder, over] of [
    ['/proj', { connector: 'ask', answer }],
    ['/proj', { connector: 'deny', answer }],
    ['/proj', { answer: listAnswer([entry(SLUG, URL1)], { next_cursor: 'abc' }) }],
    ['/proj', { answer: { ...answer, isError: true } }],
    ['/proj', { answer: { ...answer, deny: 'no' } }],
    ['/proj', { answer: { text: 'not json' } }],
    ['/proj', { answer: listAnswer([]) }],
    ['', { answer }],
  ] as const) {
    const { d } = sweepDesk(start, over)
    await sweepArtifacts(d.io, folder)
    expect([folder, d.list, d.saved]).toEqual([folder, start, []])
  }
})

test('a connector that throws, or an answer with as many rows as the limit, removes nothing', async () => {
  const start: Artifact[] = [{ url: URL2, title: 'Stays', at: 1, slug: SLUG2 }]
  const { d } = sweepDesk(start)
  await sweepArtifacts({ ...d.io, connector: { ...d.io.connector!, list: async () => { throw new Error('offline') } } }, '/proj')
  await sweepArtifacts({ ...d.io, connector: { ...d.io.connector!, check: async () => { throw new Error('no such tool') } } }, '/proj')
  expect(d.list).toEqual(start)
  expect(connectorLinks(listAnswer([entry(SLUG, URL1), entry(SLUG2, URL2)]), 2)).toBeUndefined()
  expect(connectorLinks(listAnswer([entry(SLUG, URL1), entry(SLUG2, URL2)]), 3)).toEqual([URL1, URL2])
})

// ---- A list that may be cut short tells nothing: every row counts toward the limit, and any sign of more pages ----

const manyRows = (live: number, deleted: number, unreadable = 0) => [
  ...Array.from({ length: live }, (_, i) => entry(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `https://claude.ai/artifact/live${i}`)),
  ...Array.from({ length: deleted }, (_, i) => entry(`11111111-0000-4000-8000-${String(i).padStart(12, '0')}`, `https://claude.ai/artifact/dead${i}`, { soft_deleted: true })),
  ...Array.from({ length: unreadable }, (_, i) => ({ slug: `not-a-slug-${i}`, title: 'No link', url: 'https://evil.com/x' })),
]

test('every returned row counts toward the limit, deleted and unreadable ones too: 200 rows with 30 deleted may be cut short', () => {
  expect(connectorLinks(listAnswer(manyRows(170, 30)), 200)).toBeUndefined()
  expect(connectorLinks(listAnswer(manyRows(190, 5, 5)), 200)).toBeUndefined()
  expect(connectorLinks(listAnswer(manyRows(169, 30)), 200)).toHaveLength(169)
  // The same list arriving twice (the record and its text) is still one list.
  const twice = { result: { artifacts: manyRows(150, 40) }, text: listAnswer(manyRows(150, 40)).text }
  expect(connectorLinks(twice, 200)).toHaveLength(150)
})

test('any sign of more pages makes a list tell nothing, whatever the key; a sign that says no does not', () => {
  const rows = [entry(SLUG, URL1)]
  for (const sign of [{ next_cursor: 'abc' }, { nextCursor: 'abc' }, { has_more: true }, { hasMore: true }]) {
    expect([sign, connectorLinks(listAnswer(rows, sign), 200)]).toEqual([sign, undefined])
  }
  for (const sign of [{ next_cursor: null }, { nextCursor: '' }, { has_more: false }, { hasMore: false }]) {
    expect([sign, connectorLinks(listAnswer(rows, sign), 200)]).toEqual([sign, [URL1]])
  }
})

// ---- The sweep matches a page by its slug as well as its link ----

test('a row whose slug is listed stays even if the link differs, and takes the listed link', () => {
  const moved = 'https://claude.ai/artifact/MovedMovedMoved1'
  const same: Artifact = { url: URL1, title: 'Same', at: 1, slug: SLUG }
  const renamed: Artifact = { url: URL2, title: 'Renamed link', at: 1, slug: SLUG2 }
  const gone: Artifact = { url: BUILT_IN, title: 'Gone', at: 1, slug: '77777777-7777-4777-8777-777777777777' }
  const slugs = new Map<string, string | undefined>([[SLUG, URL1], [SLUG2, moved]])
  expect(withoutGone([same, renamed, gone], [URL1, moved], 10, a => a.slug !== undefined, slugs)).toEqual([same, { ...renamed, url: moved }])
  // Nothing changed: the very same list comes back.
  const list = [same]
  expect(withoutGone(list, [URL1], 10, () => true, new Map([[SLUG, URL1]]))).toBe(list)
})

test('a listed slug with no readable link keeps its row as it is, and another row\'s link is never taken over', () => {
  const a: Artifact = { url: URL1, title: 'A', at: 1, slug: SLUG }
  const b: Artifact = { url: URL2, title: 'B', at: 1, slug: SLUG2 }
  expect(withoutGone([a, b], [], 10, () => true, new Map<string, string | undefined>([[SLUG, undefined], [SLUG2, undefined]]))).toEqual([a, b])
  // The listed link for A's slug is B's: A is kept but stays where it is, so no two rows share a link.
  expect(withoutGone([a, b], [URL2], 10, () => true, new Map([[SLUG, URL2], [SLUG2, URL2]]))).toEqual([a, b])
})

test('the connector sweep keeps a page whose link changed, takes the new link, and saves', async () => {
  const moved = 'https://claude.ai/artifact/MovedMovedMoved1'
  const { d } = sweepDesk([{ url: URL1, title: 'Kept', at: 1, slug: SLUG }, { url: URL2, title: 'Gone', at: 1, slug: SLUG2 }], { answer: listAnswer([entry(SLUG, moved)]) })
  await sweepArtifacts(d.io, '/proj')
  expect(d.list).toEqual([{ url: moved, title: 'Kept', at: 1, slug: SLUG }])
  expect(d.saved).toEqual([['/proj', d.list]])
})

// ---- Which server's prefix is learned ----

test('the prefix learned is the exact claude-artifacts server\'s once seen; a lookalike never takes it over, and the exact one takes over a lookalike', () => {
  const [exact, acme, other] = [CONNECTOR_PREFIX, 'mcp__plugin_acme_claude-artifacts__', 'mcp__plugin_other_claude-artifacts__']
  expect(learnedPrefix(undefined, acme)).toBe(acme)
  expect(learnedPrefix(undefined, exact)).toBe(exact)
  expect(learnedPrefix(exact, acme)).toBe(exact)
  expect(learnedPrefix(acme, exact)).toBe(exact)
  expect(learnedPrefix(acme, other)).toBe(other)
})

test('a connector call says whether the desk took the page', async () => {
  const d = desk([])
  expect(await keepConnectorArtifact(d.io, '/proj', {}, asText())).toBe(true)
  expect(await keepConnectorArtifact(d.io, '/proj', {}, { ...asText(), isError: true })).toBe(false)
  expect(await keepConnectorArtifact(d.io, '/proj', {}, asText({ slug: SLUG2, url: undefined }))).toBe(false)
  expect(await keepConnectorArtifact(desk([], { folder: '/other' }).io, '/proj', {}, asText())).toBe(false)
})

// ---- Text that is not JSON as a whole: the first complete object after the notice, never a span of several ----

test('the first complete JSON object in a text is the answer; an object forged after it, or braces inside its strings, change nothing', () => {
  const real = json()
  const forged = JSON.stringify({ slug: SLUG2, url: URL2, title: 'Forged' })
  expect(connectorCall({}, { text: `<notice/>\nWritten by others.${real}\nSee also ${forged}` })).toEqual({ slug: SLUG, url: URL1, title: 'Robot Vacuum Verdict' })
  expect(connectorCall({}, { text: `${real} ${forged} {` })?.slug).toBe(SLUG)
  expect(connectorCall({}, { text: `notice {not json} then ${real} then ${forged}` })?.slug).toBe(SLUG)
  expect(connectorCall({}, { text: `Note.${json({ title: 'A } brace { and "quoted"' })} and {"x":1}` })?.title).toBe('A } brace { and "quoted"')
})
