// The Artifact Desk: the pages on claude.ai that Claude published or opened with the Artifact tool in this project,
// or published with the claude-artifacts connector (its MCP tools stand in for the Artifact tool in some sessions).
// Pure: which calls count, which link and title they leave, and how the list is kept and shown. register-artifacts.ts keeps the list (register-state.ts holds it).
import type { Artifact } from '../types'
import { fit } from './desk'
import { inLine } from './state'

/** The newest this many artifacts are kept per project. */
export const ARTIFACT_KEEP = 50
/** The Office tab draws the newest this many; the rest are counted. */
export const ARTIFACT_SHOWN = 6
/** A title is cut at a word to this many characters. */
export const TITLE_CHARS = 80
/** The title of a page that came with none, and has none recorded. */
const FALLBACK_TITLE = 'Artifact'

// The only two shapes of a link that is ever kept or drawn: the page's id, or a uuid under /code/.
const LINK = /^https:\/\/claude\.ai\/(?:artifact\/[A-Za-z0-9_-]{1,64}|code\/artifact\/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/
// A claude.ai address inside a text: not glued to a word or to another address; trailing punctuation is peeled off after.
const LINK_IN_TEXT = /(?<![\w/.@:=?&%#+-])https:\/\/claude\.ai\/\S+/g
const TRAILING = /[)\]}>"'`.,;:!?*_]+$/
// Control characters go; the few that separate words become a space first. The soft hyphen, the direction marks, the zero-width characters and the tag characters go too: they can disguise or hide text in a title.
const SPACING = /[\t\n\r\v\f]+/g
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu
/** Only these actions leave a page in the list; a delete takes one out. Every other action is ignored. */
const KEEPS = new Set(['publish', 'open'])

export function isArtifactLink(url: unknown): url is string {
  return typeof url === 'string' && LINK.test(url)
}

/** Untrusted text as a title: one line, no control characters, cut at a word; nothing when nothing is left. */
function tidy(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined
  return fit(text.replace(SPACING, ' ').replace(INVISIBLE, ''), TITLE_CHARS) || undefined
}

/** What the tool's answer says, as text to look through: what the model read, a plain result, and the text fields of a record. */
function textsOf(ran: ArtifactAnswer): string[] {
  const { text, result } = ran
  const fields = result !== null && typeof result === 'object' ? Object.values(result) : [result]
  return [text, ...fields].filter((t): t is string => typeof t === 'string')
}

/** The first link in a text that is exactly one of the two shapes; any other address in it is stepped over. */
function firstLink(texts: string[]): string | undefined {
  for (const text of texts) {
    for (const found of text.matchAll(LINK_IN_TEXT)) {
      const url = found[0].replace(TRAILING, '')
      if (isArtifactLink(url)) return url
    }
  }
  return undefined
}

function titleFromAnswer(ran: ArtifactAnswer): string | undefined {
  const { result, text } = ran
  const named = result !== null && typeof result === 'object' ? tidy((result as { title?: unknown }).title) : undefined
  return named ?? tidy(typeof text === 'string' ? /^\s*title:[ \t]*(.+)$/im.exec(text)?.[1] : undefined)
}

function titleFromFile(path: unknown): string | undefined {
  return typeof path === 'string' ? tidy(path.split(/[\\/]/).filter(Boolean).pop()) : undefined
}

/** The Artifact tool's answer, as `tool.call` hands it back. */
export type ArtifactAnswer = { result?: unknown; text?: unknown; isError?: unknown; deny?: unknown }

/** What one call to the Artifact tool does to the list: keep this page (with the title it came with, if any) or take it out. */
export type ArtifactCall = { link: string; title: string | undefined; isDelete: boolean }

/**
 * The call's effect on the list, or nothing when it has none. Only a publish (no action, or "publish"), an open and a
 * delete count; a call that failed counts for nothing. The link is the input's `url`, else the first one in the answer.
 * The input's `type_url` is the page's template, never the page.
 */
export function artifactCall(input: Record<string, unknown>, ran: ArtifactAnswer | undefined): ArtifactCall | undefined {
  if (!ran || ran.isError || ran.deny) return undefined
  const action = input.action === undefined ? 'publish' : input.action
  const isDelete = action === 'delete'
  if (!isDelete && !(typeof action === 'string' && KEEPS.has(action))) return undefined
  // A url the input names that is not ours is not stepped over for one in the answer: the call is about that other page.
  const named = typeof input.url === 'string' && input.url !== ''
  const link = named ? (isArtifactLink(input.url) ? input.url : undefined) : firstLink(textsOf(ran))
  if (link === undefined) return undefined
  return { link, title: tidy(input.title) ?? titleFromAnswer(ran) ?? titleFromFile(input.file_path), isDelete }
}

/**
 * The page at the top with the time it was last published or opened. A title that is not known keeps the recorded one.
 * The row is found by its slug when the call has one (a connector page), else by its link; a row keeps the slug it has.
 */
export function withArtifact(list: Artifact[], url: string, title: string | undefined, at: number, slug?: string): Artifact[] {
  const old = (slug === undefined ? undefined : list.find(a => a.slug === slug)) ?? list.find(a => a.url === url)
  const kept = slug ?? old?.slug
  const entry: Artifact = { url, title: title ?? old?.title ?? FALLBACK_TITLE, at, ...(kept === undefined ? {} : { slug: kept }) }
  return [entry, ...list.filter(a => a !== old && a.url !== url)].slice(0, ARTIFACT_KEEP)
}

export function withoutArtifact(list: Artifact[], url: string): Artifact[] {
  return list.some(a => a.url === url) ? list.filter(a => a.url !== url) : list
}

/** The read-only call that lists every page the person can see, as many as the tool will give at once. */
export const LIST_LIMIT = 200
export const LIST_INPUT = { action: 'list', scope: 'all', limit: LIST_LIMIT } as const

/** Every real link in a list answer, once each. Nothing when the answer failed, was refused, names no page, or has as many as the limit (it may be cut short). */
export function listedLinks(ran: ArtifactAnswer | undefined, limit: number): string[] | undefined {
  if (!ran || ran.isError || ran.deny) return undefined
  const found = new Set<string>()
  for (const text of textsOf(ran)) {
    for (const one of text.matchAll(LINK_IN_TEXT)) {
      const url = one[0].replace(TRAILING, '')
      if (isArtifactLink(url)) found.add(url)
    }
  }
  return found.size === 0 || found.size >= limit ? undefined : [...found]
}

// ---- The claude-artifacts connector: an MCP server whose tools stand in for the Artifact tool in some sessions ----

/** The connector's server name. On another machine the tool names may carry a prefix of their own before it (`mcp__<prefix>_claude-artifacts__…`). */
export const CONNECTOR_SERVER = 'claude-artifacts'
/** The tool-name prefix this machine's connector is assumed to have until a publish shows the real one. */
export const CONNECTOR_PREFIX = `mcp__${CONNECTOR_SERVER}__`
/** The tools whose answers name a page that was just published or edited. */
const CONNECTOR_PUBLISHES = new Set(['publish_files', 'publish_version', 'edit_version'])
/** The same rule as a matcher for the `tool.call` hook (checked again by `connectorToolOf`, which is the rule). */
export const CONNECTOR_PUBLISH_TOOLS = /^mcp__(?:.*_)?claude-artifacts__(?:publish_files|publish_version|edit_version)$/
/** The read-only call that lists the connector's pages; the connector's own limit rules apply (an answer cut short tells nothing). */
export const CONNECTOR_LIST_INPUT = { limit: LIST_LIMIT } as const

// A page's id on the connector is a uuid.
const SLUG = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/

export function isArtifactSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SLUG.test(slug)
}

/** The connector's publishing tool a call name is, with the prefix its server's tools carry; nothing for any other tool. The server part must be, or end in `_`, claude-artifacts. */
export function connectorToolOf(name: string): { prefix: string; tool: string } | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const cut = name.lastIndexOf('__')
  if (cut <= 'mcp__'.length) return undefined
  const [server, tool] = [name.slice('mcp__'.length, cut), name.slice(cut + 2)]
  if (!CONNECTOR_PUBLISHES.has(tool) || !(server === CONNECTOR_SERVER || server.endsWith(`_${CONNECTOR_SERVER}`))) return undefined
  return { prefix: name.slice(0, cut + 2), tool }
}

type Record_ = Record<string, unknown>
const isRecord = (v: unknown): v is Record_ => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The text blocks of an MCP result: a list of blocks, or a record that holds the list as `content`. */
function blockTexts(value: unknown): string[] {
  const blocks = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.content) ? value.content : []
  return blocks.flatMap((b: unknown) => (isRecord(b) && typeof b.text === 'string' ? [b.text] : []))
}

/** The record a text is as JSON, or nothing when it is not JSON or not an object. */
function parsedRecord(part: string): Record_ | undefined {
  try {
    const value: unknown = JSON.parse(part)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined // Not JSON: the caller tries another reading of the text.
  }
}

/** Where the object that opens at `from` closes (braces inside strings do not count), or -1 when it never does. */
function objectEnd(text: string, from: number): number {
  let [depth, isInString, isEscaped] = [0, false, false]
  for (let at = from; at < text.length; at += 1) {
    const char = text[at]
    if (isInString) {
      if (isEscaped) isEscaped = false
      else if (char === '\\') isEscaped = true
      else if (char === '"') isInString = false
    } else if (char === '"') isInString = true
    else if (char === '{') depth += 1
    else if (char === '}' && (depth -= 1) === 0) return at + 1
  }
  return -1
}

/**
 * The record a text holds as JSON: the whole text, else the first complete JSON object in it (the connector can put a notice before
 * it). Never a span from the first brace to the last, so an object that text elsewhere in the answer carries is not read as the answer.
 */
function jsonIn(text: string): Record_ | undefined {
  const whole = parsedRecord(text)
  if (whole) return whole
  for (let from = text.indexOf('{'); from >= 0; from = text.indexOf('{', from + 1)) {
    const end = objectEnd(text, from)
    const one = end < 0 ? undefined : parsedRecord(text.slice(from, end))
    if (one) return one
  }
  return undefined
}

/** Every record an MCP answer may hold, most structured first: the result and its structured content, then the JSON in any text it carries. */
function recordsOf(ran: ArtifactAnswer): Record_[] {
  const { result, text } = ran
  const found: Record_[] = isRecord(result) ? [result, ...(isRecord(result.structuredContent) ? [result.structuredContent] : [])] : []
  for (const t of [text, result, ...blockTexts(result)]) {
    const one = typeof t === 'string' ? jsonIn(t) : undefined
    if (one) found.push(one)
  }
  return found
}

/** What a connector publish or edit left: the page's slug and link (each only when it is real) and its title. */
export type ConnectorCall = { slug: string | undefined; url: string | undefined; title: string | undefined }

/**
 * The page a connector publish or edit answer names, or nothing when the call failed, was refused, reports an error, or names no
 * real page. Only the answer names the page: the input's slug is never taken for it, so a rejected edit changes nothing.
 */
export function connectorCall(input: Record<string, unknown>, ran: ArtifactAnswer | undefined): ConnectorCall | undefined {
  if (!ran || ran.isError || ran.deny) return undefined
  for (const one of recordsOf(ran)) {
    if (one.error !== undefined) continue
    const [slug, url] = [isArtifactSlug(one.slug) ? one.slug : undefined, isArtifactLink(one.url) ? one.url : undefined]
    if (slug !== undefined || url !== undefined) return { slug, url, title: tidy(one.title) ?? tidy(input.title) }
  }
  return undefined
}

/** Any of these set on a list answer says there is more than it holds. */
const MORE_PAGES = ['next_cursor', 'nextCursor', 'has_more', 'hasMore'] as const

/** The live pages a connector list holds: their links, and their slugs with the link each was listed under (none when it was unreadable). */
export type ConnectorListing = { links: string[]; slugs: ReadonlyMap<string, string | undefined> }

/**
 * What a connector list answer says is there. Nothing when it failed, names no page, signals more pages, or returned as many rows
 * as the limit: every row counts, deleted and unreadable ones too, since the answer may have been cut at the limit. Deleted pages are not there.
 */
export function connectorListing(ran: ArtifactAnswer | undefined, limit: number): ConnectorListing | undefined {
  if (!ran || ran.isError || ran.deny) return undefined
  const [links, slugs] = [new Set<string>(), new Map<string, string | undefined>()]
  let [hasMore, rows] = [false, 0]
  for (const one of recordsOf(ran)) {
    if (MORE_PAGES.some(key => one[key])) hasMore = true
    if (!Array.isArray(one.artifacts)) continue
    // The same list can arrive twice (the record and its text): the longest is the count.
    rows = Math.max(rows, one.artifacts.length)
    for (const page of one.artifacts as unknown[]) {
      if (!isRecord(page) || page.soft_deleted) continue
      const url = isArtifactLink(page.url) ? page.url : undefined
      if (url !== undefined) links.add(url)
      if (isArtifactSlug(page.slug)) slugs.set(page.slug, url)
    }
  }
  return hasMore || rows >= limit || (links.size === 0 && slugs.size === 0) ? undefined : { links: [...links], slugs }
}

/** The live links of a connector list answer, once each, on the same terms. */
export function connectorLinks(ran: ArtifactAnswer | undefined, limit: number): string[] | undefined {
  return connectorListing(ran, limit)?.links
}

/** What the sweep may do with the connector: the tool names start with `prefix()`, and the same two calls as the built-in tool's. */
export type ConnectorIo = {
  prefix: () => string
  check: (tool: string, input: typeof CONNECTOR_LIST_INPUT) => Promise<{ decision?: unknown }>
  list: (tool: string, input: typeof CONNECTOR_LIST_INPUT) => Promise<ArtifactAnswer>
}

/** What the sweep may do: ask whether the call would run unasked, and make the call. */
export type ListIo = {
  check: (input: { tool: 'Artifact'; input: typeof LIST_INPUT }) => Promise<{ decision?: unknown }>
  list: (input: typeof LIST_INPUT) => Promise<ArtifactAnswer>
  /** The claude-artifacts connector, for a session where the Artifact tool is not offered. */
  connector?: ConnectorIo
}

/** The built-in tool's listing: whether the engine lets the call run unasked (so the tool is there to use), and the links it gave. */
async function listBuiltIn(io: ListIo, limit: number): Promise<{ isOffered: boolean; links: string[] | undefined }> {
  try {
    if ((await io.check({ tool: 'Artifact', input: LIST_INPUT })).decision !== 'allow') return { isOffered: false, links: undefined }
    return { isOffered: true, links: listedLinks(await io.list(LIST_INPUT), limit) }
  } catch {
    return { isOffered: false, links: undefined }
  }
}

/** The links the Artifact tool lists now, but only if the engine says the call needs no question to the person. Any other verdict, or any failure, is nothing. */
export async function listedPages(io: ListIo, limit: number): Promise<string[] | undefined> {
  return (await listBuiltIn(io, limit)).links
}

/** What the connector lists now, on the same terms: only a call the engine allows unasked, and any failure is nothing. */
async function listedConnectorPages(io: ListIo, limit: number): Promise<ConnectorListing | undefined> {
  const connector = io.connector
  if (!connector) return undefined
  const tool = `${connector.prefix()}list_artifacts`
  try {
    if ((await connector.check(tool, CONNECTOR_LIST_INPUT)).decision !== 'allow') return undefined
    return connectorListing(await connector.list(tool, CONNECTOR_LIST_INPUT), limit)
  } catch {
    return undefined
  }
}

/**
 * The list without the pages the answer left out. A page published or opened since the call began is newer than the answer and stays.
 * Only the rows `isOwn` names are judged by the answer: the rows of the other tool are left as they are.
 * A row whose slug is among `slugs` (a connector page) is there even if its link is not listed, and takes the link it was listed
 * under, unless another row already has that link.
 */
export function withoutGone(list: Artifact[], links: string[], startedAt: number, isOwn: (a: Artifact) => boolean = () => true, slugs: ReadonlyMap<string, string | undefined> = new Map()): Artifact[] {
  const there = new Set(links)
  const next = list.flatMap(a => {
    if (!isOwn(a)) return [a]
    const isListed = a.slug !== undefined && slugs.has(a.slug)
    if (!isListed && !there.has(a.url) && !(a.at > startedAt)) return []
    const listedUrl = a.slug === undefined ? undefined : slugs.get(a.slug)
    return [listedUrl !== undefined && listedUrl !== a.url && !list.some(o => o.url === listedUrl) ? { ...a, url: listedUrl } : a]
  })
  return next.length === list.length && next.every((a, i) => a === list[i]) ? list : next
}

/** What the desk may do. The folder is read when the work lands, since the session can move to another project meanwhile. */
export type ArtifactIo = ListIo & {
  folder: () => string
  now: () => Promise<number>
  /** The list as it stands when the write lands: the change is made on that, so calls made at the same moment all land. Queued. */
  change: (fn: (list: Artifact[]) => Artifact[]) => Promise<Artifact[]>
  save: (folder: string, list: Artifact[]) => Promise<unknown>
  /** Shows the text once a session. */
  warnOnce: (text: string) => void
}

/** Notes what a call to the Artifact tool did. */
export async function keepArtifact(io: ArtifactIo, folder: string, input: Record<string, unknown>, ran: ArtifactAnswer) {
  const call = artifactCall(input, ran)
  if (!call) return
  const at = await io.now()
  await commit(io, folder, list => (call.isDelete ? withoutArtifact(list, call.link) : withArtifact(list, call.link, call.title, at)))
}

/**
 * Notes what a connector publish or edit did. The page's row is found by its slug, else by its link, and updated (new title,
 * newest time, to the top); with neither on the desk the page is added when the answer gives its link. An answer that names
 * a slug the desk does not know and no link changes nothing, and nothing is saved. True when the desk took the page.
 */
export async function keepConnectorArtifact(io: ArtifactIo, folder: string, input: Record<string, unknown>, ran: ArtifactAnswer): Promise<boolean> {
  const call = connectorCall(input, ran)
  if (!call) return false
  const at = await io.now()
  return commit(io, folder, list => {
    const url = call.url ?? list.find(a => a.slug !== undefined && a.slug === call.slug)?.url
    return url === undefined ? list : withArtifact(list, url, call.title, at, call.slug)
  }, true)
}

/** The prefix to hold after a publish showed `seen`: the exact claude-artifacts server's, once seen, is never given up for a lookalike's (`…_claude-artifacts`). */
export function learnedPrefix(current: string | undefined, seen: string): string {
  return current === CONNECTOR_PREFIX ? current : seen
}

/** The Hide button: the page leaves this project's desk and the saved list. Publishing or opening it again brings it back. The page on claude.ai is not touched. */
export function hideArtifact(io: ArtifactIo, folder: string, url: string) {
  return commit(io, folder, list => withoutArtifact(list, url))
}

/**
 * One change to the desk's list, made on the list as it stands when its turn comes, then saved under the folder. A change that
 * returns the list it was given did nothing: with `isSkippingSame` it is not saved. True when the list changed (false when
 * the page was dropped for another project); the built-in tool's callers do not read it.
 */
function commit(io: ArtifactIo, folder: string, fn: (list: Artifact[]) => Artifact[], isSkippingSame = false): Promise<boolean> {
  return inLine(async () => {
    // The session moved to another project while the call ran: this page is not that project's, so it is dropped.
    if (io.folder() !== folder) return false
    let isSame = false
    const next = await io.change(list => { const out = fn(list); isSame = out === list; return out })
    if (!folder || (isSkippingSame && isSame)) return !isSame
    try {
      await io.save(folder, next)
    } catch {
      // The change stays in this session's list; the person hears of it once.
      io.warnOnce('Could not save the artifact list. It is kept for this session only.')
    }
    return !isSame
  })
}

/**
 * Once per session start: pages gone from claude.ai leave the list. Only a list call the engine allows unasked is made; anything else removes nothing.
 * The built-in Artifact tool is used when it is offered, and judges the pages it put on the desk (no slug). When it is not offered
 * (a session where the connector stands in for it) the connector's list is used instead, and judges the connector's pages (those with a slug).
 * Each tool leaves the other's rows alone: neither list can say whether a page of the other kind is still there.
 */
export async function sweepArtifacts(io: ArtifactIo, folder: string) {
  const startedAt = await io.now()
  const builtIn = await listBuiltIn(io, LIST_LIMIT)
  const connector = builtIn.isOffered ? undefined : await listedConnectorPages(io, LIST_LIMIT)
  const links = builtIn.isOffered ? builtIn.links : connector?.links
  const isOwn = builtIn.isOffered ? (a: Artifact) => a.slug === undefined : (a: Artifact) => a.slug !== undefined
  if (!links || !folder) return
  await inLine(async () => {
    if (io.folder() !== folder) return
    await io.save(folder, await io.change(list => withoutGone(list, links, startedAt, isOwn, connector?.slugs))).catch(() => undefined)
  })
}

/** A list read back from the store, which anyone can edit: only well-formed entries with a real link survive, once each. */
export function cleanArtifacts(raw: unknown): Artifact[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const kept: Artifact[] = []
  for (const one of raw as Array<Partial<Artifact> | null>) {
    if (one === null || typeof one !== 'object' || !isArtifactLink(one.url) || seen.has(one.url)) continue
    if (typeof one.title !== 'string' || typeof one.at !== 'number' || !Number.isFinite(one.at)) continue
    seen.add(one.url)
    kept.push({ url: one.url, title: tidy(one.title) ?? FALLBACK_TITLE, at: one.at, ...(isArtifactSlug(one.slug) ? { slug: one.slug } : {}) })
  }
  return kept.slice(0, ARTIFACT_KEEP)
}

/** The newest few to draw (real links only), and how many older ones there are. */
export function artifactsShown(list: Artifact[]): { rows: Artifact[]; older: number } {
  const real = list.filter(a => isArtifactLink(a.url))
  return { rows: real.slice(0, ARTIFACT_SHOWN), older: Math.max(0, real.length - ARTIFACT_SHOWN) }
}

/** How long ago, in plain steps: under a minute, minutes, hours, then days from two days on. */
export function since(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}
