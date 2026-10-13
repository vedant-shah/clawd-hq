import { expect, test } from 'claude-code/testing'
import { ARTIFACT_KEEP, ARTIFACT_SHOWN, TITLE_CHARS, artifactCall, artifactsShown, cleanArtifacts, isArtifactLink, since, withArtifact, withoutArtifact } from '../hooks/artifacts'
import type { Artifact } from '../types'

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const PLAIN = 'https://claude.ai/artifact/9WdR8H2T9Z7QScxjCbQjEM'
const CODE = `https://claude.ai/code/artifact/${UUID}`
const made = (n: number, at = n): Artifact => ({ url: `https://claude.ai/artifact/id${n}`, title: `Page ${n}`, at })

test('only the two exact shapes of a claude.ai artifact link are links', () => {
  expect([PLAIN, CODE].map(isArtifactLink)).toEqual([true, true])
  const refused = [
    'http://claude.ai/artifact/abc', 'https://claude.com/artifact/abc', 'https://www.claude.ai/artifact/abc', 'https://claude.ai.evil.com/artifact/abc',
    'https://evil.com/https://claude.ai/artifact/abc', 'https://user@claude.ai/artifact/abc', 'https://CLAUDE.AI/artifact/abc', 'https://claude.ai:8443/artifact/abc',
    'https://claude.ai/artifact/', 'https://claude.ai/artifact/abc/', 'https://claude.ai/artifact/abc?x=1', 'https://claude.ai/artifact/abc#top',
    'https://claude.ai/artifact/abc/edit', 'https://claude.ai/artifact/a b', 'https://claude.ai/artifact/abc\n', ' https://claude.ai/artifact/abc',
    'https://claude.ai/code/artifact/not-a-uuid', `https://claude.ai/code/artifact/${UUID}/x`, `https://claude.ai/code/artifact/${UUID.toUpperCase()}x`,
    'https://claude.ai/artifact/<script>', 'javascript:alert(1)', '', 'claude.ai/artifact/abc',
  ]
  for (const url of refused) expect([url, isArtifactLink(url)]).toEqual([url, false])
  for (const odd of [undefined, null, 7, {}, [PLAIN]]) expect(isArtifactLink(odd)).toBe(false)
})

test('publishing (no action, or "publish") and opening are recorded; every other action is not', () => {
  const ran = { text: `Created a new Artifact at ${PLAIN} (version 1)` }
  expect(artifactCall({ title: 'Plan' }, ran)).toEqual({ link: PLAIN, title: 'Plan', isDelete: false })
  expect(artifactCall({ action: 'publish', title: 'Plan' }, ran)?.link).toBe(PLAIN)
  expect(artifactCall({ action: 'open', url: CODE }, { text: 'Opened' })).toEqual({ link: CODE, title: undefined, isDelete: false })
  for (const action of ['read', 'list', 'quickstart', 'pin', 'unpin', 'rename', 'PUBLISH', 7, null]) {
    expect([action, artifactCall({ action, url: PLAIN }, ran)]).toEqual([action, undefined])
  }
})

test('a delete is passed on as a delete, with the link it names', () => {
  expect(artifactCall({ action: 'delete', url: PLAIN }, { text: 'Deleted' })).toEqual({ link: PLAIN, title: undefined, isDelete: true })
})

test('the link comes from the input url, else from the first link in the result; the type_url is never the link', () => {
  expect(artifactCall({ url: CODE }, { text: `Updated the Artifact at ${PLAIN}` })?.link).toBe(CODE)
  // As the tool words it: the artifact's own link comes first, the type it was made from after it.
  const text = `Created a new Artifact at ${PLAIN} (version 1-ab) from the Artifact type https://claude.ai/artifact/TypeTypeType1 (release 2)`
  expect(artifactCall({ type_url: 'https://claude.ai/artifact/TypeTypeType1' }, { text })?.link).toBe(PLAIN)
  expect(artifactCall({ type_url: 'https://claude.ai/artifact/TypeTypeType1' }, { text: 'Created, no link' })).toBeUndefined()
  expect(artifactCall({}, { result: { url: CODE } })?.link).toBe(CODE)
  expect(artifactCall({}, { result: `Created at ${CODE}.` })?.link).toBe(CODE)
})

test('a link that is not exactly one of the two shapes is ignored, in the input or the result', () => {
  expect(artifactCall({ url: 'https://evil.com/artifact/abc' }, { text: 'Created' })).toBeUndefined()
  // A bad input url is not stepped over: the call names a link that is not ours.
  expect(artifactCall({ url: 'https://evil.com/artifact/abc' }, { text: `Created at ${PLAIN}` })).toBeUndefined()
  expect(artifactCall({}, { text: 'See https://claude.ai/artifact/abc?token=1 and https://example.com/' })).toBeUndefined()
  expect(artifactCall({}, { text: 'See https://claude.ai/artifact/abc/edit' })).toBeUndefined()
  expect(artifactCall({}, { text: 'https://claude.ai.evil.com/artifact/abc' })).toBeUndefined()
  expect(artifactCall({}, { text: 'x https://evil.com/?u=https://claude.ai/artifact/abc' })).toBeUndefined()
  expect(artifactCall({}, { text: `Created [the page](${PLAIN}), done.` })?.link).toBe(PLAIN)
  expect(artifactCall({}, { text: `First https://claude.ai/artifact/abc?x=1 then ${CODE}` })?.link).toBe(CODE)
})

test('a call that failed or was refused records nothing', () => {
  expect(artifactCall({ title: 'Plan' }, { text: `Error at ${PLAIN}`, isError: true })).toBeUndefined()
  expect(artifactCall({ url: PLAIN }, { deny: 'not allowed' })).toBeUndefined()
  expect(artifactCall({ action: 'delete', url: PLAIN }, { text: 'No such artifact', isError: true })).toBeUndefined()
  expect(artifactCall({ url: PLAIN }, undefined)).toBeUndefined()
})

test('the title: the input\'s, else the result\'s, else the file\'s name, else nothing known', () => {
  const ran = { text: `Created at ${PLAIN}` }
  expect(artifactCall({ title: 'From input', file_path: '/a/b/page.html' }, { ...ran, result: { title: 'From result' } })?.title).toBe('From input')
  expect(artifactCall({ file_path: '/a/b/page.html' }, { ...ran, result: { title: 'From result' } })?.title).toBe('From result')
  expect(artifactCall({}, { text: `Title: From the text\nCreated at ${PLAIN}` })?.title).toBe('From the text')
  expect(artifactCall({ file_path: '/a/b/page.html' }, ran)?.title).toBe('page.html')
  expect(artifactCall({ file_path: 'C:\\work\\notes.md' }, ran)?.title).toBe('notes.md')
  expect(artifactCall({ file_path: '/a/b/' }, ran)?.title).toBe('b')
  expect(artifactCall({ title: '  ', file_path: '' }, ran)?.title).toBeUndefined()
  expect(artifactCall({ title: 7, file_path: 7 }, ran)?.title).toBeUndefined()
})

test('a title is one line without control characters, cut at a word to 80 characters', () => {
  const ran = { text: PLAIN }
  const title = (t: string) => artifactCall({ title: t }, ran)?.title
  expect(TITLE_CHARS).toBe(80)
  expect(title('Plan\n\nfor\tthe\rweek')).toBe('Plan for the week')
  expect(title('Bell\u0007 and\u001b[31m escape\u0000 gone')).toBe('Bell and[31m escape gone')
  expect(title('hidden\u202eflip\u200bme')).toBe('hiddenflipme')
  expect(title('soft\u00adhyphen')).toBe('softhyphen')
  expect(title('arabic\u061cmark')).toBe('arabicmark')
  expect(title('mongolian\u180evowel')).toBe('mongolianvowel')
  expect(title('joiner\u2060\u2061\u2062\u2063\u2064gone')).toBe('joinergone')
  expect(title(`tags${String.fromCodePoint(0xe0000, 0xe0041, 0xe007f)}hidden`)).toBe('tagshidden')
  const long = title('word '.repeat(40))!
  expect(long.length).toBeLessThanOrEqual(80)
  expect(long).toBe('word '.repeat(16).trim())
  expect(title('x'.repeat(200))).toBe('x'.repeat(80))
  expect(title('\u0007\u0000')).toBeUndefined()
})

test('one entry per link: it is updated, moved to the top, and the newest 50 are kept', () => {
  const [a, b] = [made(1, 10), made(2, 20)]
  const again = withArtifact([b, a], a.url, 'Renamed', 99)
  expect(again).toEqual([{ url: a.url, title: 'Renamed', at: 99 }, b])
  // Immutable: the list that went in is untouched.
  expect([b, a]).toEqual([made(2, 20), made(1, 10)])
  const full = Array.from({ length: ARTIFACT_KEEP }, (_, i) => made(i))
  const next = withArtifact(full, 'https://claude.ai/artifact/fresh', 'New', 500)
  expect(next).toHaveLength(ARTIFACT_KEEP)
  expect(next[0]).toEqual({ url: 'https://claude.ai/artifact/fresh', title: 'New', at: 500 })
  expect(next.at(-1)).toEqual(made(ARTIFACT_KEEP - 2))
  expect(withArtifact(full, full[ARTIFACT_KEEP - 1]!.url, 'Old one', 500)).toHaveLength(ARTIFACT_KEEP)
})

test('a title that is not known keeps the one already recorded, else the word Artifact', () => {
  const a = made(1, 10)
  expect(withArtifact([a], a.url, undefined, 50)).toEqual([{ ...a, at: 50 }])
  expect(withArtifact([], 'https://claude.ai/artifact/new', undefined, 50)[0]?.title).toBe('Artifact')
})

test('a delete removes the link and nothing else, and leaves a list without it alone', () => {
  const list = [made(1), made(2)]
  expect(withoutArtifact(list, made(1).url)).toEqual([made(2)])
  expect(withoutArtifact(list, 'https://claude.ai/artifact/other')).toEqual(list)
  expect(list).toEqual([made(1), made(2)])
})

test('what was stored is checked on the way in: bad links, bad shapes and long lists are dropped', () => {
  const good = made(1)
  const dirty = [good, { url: 'https://evil.com/x', title: 'Evil', at: 1 }, { url: PLAIN }, null, 'text', { url: CODE, title: 'T\nwo', at: 5 }, { url: CODE, title: 'dup', at: 6 }, { url: PLAIN, title: 7, at: 'x' }]
  expect(cleanArtifacts(dirty)).toEqual([good, { url: CODE, title: 'T wo', at: 5 }])
  expect(cleanArtifacts(undefined)).toEqual([])
  expect(cleanArtifacts({ not: 'a list' })).toEqual([])
  expect(cleanArtifacts(Array.from({ length: 80 }, (_, i) => made(i)))).toHaveLength(ARTIFACT_KEEP)
})

test('the newest 6 are shown, and the rest are counted', () => {
  const list = Array.from({ length: 9 }, (_, i) => made(i))
  const view = artifactsShown(list)
  expect(ARTIFACT_SHOWN).toBe(6)
  expect(view.rows).toEqual(list.slice(0, 6))
  expect(view.older).toBe(3)
  expect(artifactsShown(list.slice(0, 6))).toEqual({ rows: list.slice(0, 6), older: 0 })
  expect(artifactsShown([])).toEqual({ rows: [], older: 0 })
})

test('only real links are ever drawn, even from a list that was not cleaned', () => {
  const view = artifactsShown([made(1), { url: 'https://evil.com/x', title: 'Evil', at: 1 }])
  expect(view.rows).toEqual([made(1)])
})

test('"how long ago" reads in plain steps', () => {
  expect([0, 59_000].map(since)).toEqual(['just now', 'just now'])
  expect(since(60_000)).toBe('1m ago')
  expect(since(59 * 60_000)).toBe('59m ago')
  expect(since(3_600_000 + 5 * 60_000)).toBe('1h ago')
  expect(since(47 * 3_600_000)).toBe('47h ago')
  expect(since(48 * 3_600_000)).toBe('2d ago')
  expect(since(-5_000)).toBe('just now')
})
