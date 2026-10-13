// The Artifact Desk: the pages on claude.ai that Claude published or opened with the Artifact tool in this project.
// Pure: which calls count, which link and title they leave, and how the list is kept and shown. register.tsx keeps the list.
import type { Artifact } from '../types'
import { fit } from './desk'

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
