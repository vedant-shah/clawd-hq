import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { RULES_FILE, SECTION_ID, VOICE_FILE } from '../hooks/instructions'
import { SAVED_KEY, SAVED_MS, savedStateOf, withSaved } from '../hooks/office-saved'
import { CLOSED, START, host as baseHost } from './host'

// The office's open or closed state is saved per session id in the plugin's own store. A plugin reload (a fresh module, the store kept) or
// `claude --resume` (the same id) finds it as the person left it; a new id starts from the switch. Only the person closes it.

type On = Parameters<typeof baseHost>[0]
const IDS = ['clawd-hq', 'clawd-hq-people', 'clawd-hq-history', 'clawd-hq-settings']
const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
const DAY = 24 * 60 * 60 * 1000

/** A host with the real default (closed), the session's id, and what the store already holds: a reload is a new test with the store seeded. */
function reloaded(on: On, id: string, saved: Record<string, unknown> = {}) {
  const h = baseHost(on, [], { ...CLOSED, ...(Object.keys(saved).length > 0 ? { [SAVED_KEY]: saved } : {}) })
  on('session.id', () => ({ value: id }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  h.files.set(`${ROOT}/${RULES_FILE}`, '# Clawd, chief of staff\n\nHand real work over.')
  h.files.set(`${ROOT}/${VOICE_FILE}`, 'Plain words.')
  return h
}
const hasClawd = async ($: Engine) =>
  (await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] } as never)).sections.some(s => s.id === SECTION_ID)
const office = ($: Engine) => $.command.run({ command: 'office', args: '' } as never) as Promise<{ text: string }>
async function settle($: Engine) {
  for (let i = 0; i < 20; i++) await $.session.measure({ context: { window: 1, tokens: 0, percent: 0 }, rateLimits: [], changed: ['context'] } as never)
}
const heldFor = (h: ReturnType<typeof reloaded>, id: string) => (h.saved.get(SAVED_KEY) as Record<string, { open: boolean; seen: number }> | undefined)?.[id]

// ---- Reading what is saved ----

test('a saved state is read only when it is whole: a flag and a time, under this session\'s id', () => {
  expect(savedStateOf({ s1: { open: true, seen: 5 } }, 's1')).toBe(true)
  expect(savedStateOf({ s1: { open: false, seen: 5 } }, 's1')).toBe(false)
  expect(savedStateOf({ s1: { open: true, seen: 5 } }, 's2')).toBeUndefined()
  expect(savedStateOf({ s1: { open: 'yes', seen: 5 } }, 's1')).toBeUndefined()
  expect(savedStateOf({ s1: { open: true } }, 's1')).toBeUndefined()
  expect(savedStateOf('junk', 's1')).toBeUndefined()
  expect(savedStateOf(undefined, 's1')).toBeUndefined()
})

test('a save replaces the list rather than changing it, and drops every session not seen for 30 days', () => {
  const before = { old: { open: true, seen: 0 }, recent: { open: false, seen: 40 * DAY }, bad: 7 }
  const after = withSaved(before, 'now', true, 40 * DAY + 1)
  expect(after).toEqual({ recent: { open: false, seen: 40 * DAY }, now: { open: true, seen: 40 * DAY + 1 } })
  expect(Object.keys(before)).toEqual(['old', 'recent', 'bad']) // the old list is untouched
  expect(SAVED_MS).toBe(30 * DAY)
  expect(withSaved({ s1: { open: true, seen: 1 } }, 's1', false, 2)).toEqual({ s1: { open: false, seen: 2 } })
})

// ---- A reload, and a resume with the same id ----

test('a reload finds the office open for this session: Clawd stays on, the panels are put back, and /office then closes it', { options: { openAtStart: false } }, async ($, on) => {
  const h = reloaded(on, 's1', { s1: { open: true, seen: 1 } })
  await $.session.start(START)
  await settle($)
  expect(await hasClawd($)).toBe(true)
  expect(h.panes.map(p => p.id)).toEqual(IDS)
  h.closed.length = 0
  const r = await office($)
  expect(r.text).toMatch(/closed/i)
  expect(IDS.every(id => h.closed.includes(id))).toBe(true)
  expect(await hasClawd($)).toBe(false)
})

test('a reload that finds the panels still up leaves them as they are', async ($, on) => {
  const h = reloaded(on, 's1', { s1: { open: true, seen: 1 } })
  for (const id of IDS) h.panes.push({ id, title: id })
  await $.session.start(START)
  await settle($)
  expect(h.opened.filter(o => o.focus === true)).toEqual([]) // the panes are opened again as they are, with no request to bring Office forward
  expect(h.panes.map(p => p.id)).toEqual(IDS)
  expect(await hasClawd($)).toBe(true)
})

test('a resume saved as open on the desktop, where the surface attaches later, puts the panels up once it does, so the first /office closes something real', async ($, on) => {
  const h = reloaded(on, 's1', { s1: { open: true, seen: 1 } })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await settle($)
  expect(h.panes).toEqual([])
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await settle($)
  expect(h.panes.map(p => p.id)).toEqual(IDS)
  h.closed.length = 0
  await office($)
  expect(IDS.every(id => h.closed.includes(id))).toBe(true)
})

test('resuming with the same id keeps the office closed when the person had closed it, though the switch is on', { options: { openAtStart: true } }, async ($, on) => {
  const h = reloaded(on, 's1', { s1: { open: false, seen: 1 } })
  await $.session.start(START)
  await settle($)
  expect(h.opened).toEqual([])
  expect(await hasClawd($)).toBe(false)
  await office($) // the person\'s next /office opens it
  expect(await hasClawd($)).toBe(true)
})

test('a new session id starts from the switch, whatever another session left', async ($, on) => {
  const h = reloaded(on, 's2', { s1: { open: true, seen: 1 } })
  await $.session.start(START)
  await settle($)
  expect(h.opened).toEqual([])
  expect(await hasClawd($)).toBe(false)
})

test('a new session id with the switch on starts open', { options: { openAtStart: true } }, async ($, on) => {
  const h = reloaded(on, 's2', { s1: { open: false, seen: 1 } })
  await $.session.start(START)
  await settle($)
  expect(h.panes.map(p => p.id)).toEqual(IDS)
  expect(await hasClawd($)).toBe(true)
})

// ---- What is saved, and when ----

test('opening with /office saves "open" for this session, and /office again saves "closed"', async ($, on) => {
  const h = reloaded(on, 's1')
  await $.session.start(START)
  await office($)
  expect(heldFor(h, 's1')).toMatchObject({ open: true })
  await office($)
  expect(heldFor(h, 's1')).toMatchObject({ open: false })
})

test('the switch at the start saves "open" for the session', { options: { openAtStart: true } }, async ($, on) => {
  const h = reloaded(on, 's1')
  await $.session.start(START)
  await settle($)
  expect(heldFor(h, 's1')).toMatchObject({ open: true })
})

test('a save drops the sessions not seen for 30 days and keeps the others', async ($, on) => {
  const h = reloaded(on, 's1', { stale: { open: true, seen: -31 * DAY }, fresh: { open: true, seen: -DAY } })
  await $.session.start(START)
  await office($)
  expect(Object.keys(h.saved.get(SAVED_KEY) as object).sort()).toEqual(['fresh', 's1'])
})

test('where the engine cannot name the session nothing is saved or read', async ($, on) => {
  const h = baseHost(on, [], { ...CLOSED })
  await $.session.start(START)
  await office($)
  expect(h.saved.has(SAVED_KEY)).toBe(false)
})

test('a store that refuses the save does not stop /office', async ($, on) => {
  const h = reloaded(on, 's1')
  await $.session.start(START)
  h.kv.isWriteFailing = true
  const r = await office($)
  expect(r.text).toMatch(/open/i)
  expect(await hasClawd($)).toBe(true)
})
