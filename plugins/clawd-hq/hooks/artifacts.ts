// The Artifact Desk: the pages on claude.ai that Claude published or opened with the Artifact tool in this project.
// Pure: which calls count, which link and title they leave, and how the list is kept and shown. register.tsx keeps the list.
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
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿\u{e0000}-\u{e007f}]/gu
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

/** The page at the top with the time it was last published or opened. A title that is not known keeps the recorded one. */
export function withArtifact(list: Artifact[], url: string, title: string | undefined, at: number): Artifact[] {
  const old = list.find(a => a.url === url)
  const entry: Artifact = { url, title: title ?? old?.title ?? FALLBACK_TITLE, at }
  return [entry, ...list.filter(a => a.url !== url)].slice(0, ARTIFACT_KEEP)
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

/** What the sweep may do: ask whether the call would run unasked, and make the call. */
export type ListIo = {
  check: (input: { tool: 'Artifact'; input: typeof LIST_INPUT }) => Promise<{ decision?: unknown }>
  list: (input: typeof LIST_INPUT) => Promise<ArtifactAnswer>
}

/** The links the Artifact tool lists now, but only if the engine says the call needs no question to the person. Any other verdict, or any failure, is nothing. */
export async function listedPages(io: ListIo, limit: number): Promise<string[] | undefined> {
  try {
    if ((await io.check({ tool: 'Artifact', input: LIST_INPUT })).decision !== 'allow') return undefined
    return listedLinks(await io.list(LIST_INPUT), limit)
  } catch {
    return undefined
  }
}

/** The list without the pages the answer left out. A page published or opened since the call began is newer than the answer and stays. */
export function withoutGone(list: Artifact[], links: string[], startedAt: number): Artifact[] {
  const there = new Set(links)
  const kept = list.filter(a => there.has(a.url) || a.at > startedAt)
  return kept.length === list.length ? list : kept
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

/** The Hide button: the page leaves this project's desk and the saved list. Publishing or opening it again brings it back. The page on claude.ai is not touched. */
export function hideArtifact(io: ArtifactIo, folder: string, url: string) {
  return commit(io, folder, list => withoutArtifact(list, url))
}

/** One change to the desk's list, made on the list as it stands when its turn comes, then saved under the folder. */
function commit(io: ArtifactIo, folder: string, fn: (list: Artifact[]) => Artifact[]) {
  return inLine(async () => {
    // The session moved to another project while the call ran: this page is not that project's, so it is dropped.
    if (io.folder() !== folder) return
    const next = await io.change(fn)
    if (!folder) return
    try {
      await io.save(folder, next)
    } catch {
      // The change stays in this session's list; the person hears of it once.
      io.warnOnce('Could not save the artifact list. It is kept for this session only.')
    }
  })
}

/** Once per session start: pages gone from claude.ai leave the list. Only a list call the engine allows unasked is made; anything else removes nothing. */
export async function sweepArtifacts(io: ArtifactIo, folder: string) {
  const startedAt = await io.now()
  const links = await listedPages(io, LIST_LIMIT)
  if (!links || !folder) return
  await inLine(async () => {
    if (io.folder() !== folder) return
    await io.save(folder, await io.change(list => withoutGone(list, links, startedAt))).catch(() => undefined)
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
    kept.push({ url: one.url, title: tidy(one.title) ?? FALLBACK_TITLE, at: one.at })
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
