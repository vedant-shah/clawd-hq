import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { isHandback, needsAgentList } from '../hooks/quiet'
import { agentListCache } from '../hooks/quiet-agents'
import type { Employee } from '../types'
import { START, host } from './host'

// Two rows a desktop session showed with quiet chat on. Field values are the ones the session's transcript carried; the words are made up.
type On = Parameters<typeof host>[0]

const emp = (over: Partial<Employee>): Employee => ({ id: 'a1', type: 'general-purpose', description: 'Research', mood: 'done', tools: 0, startedAt: 0, joinedTick: 0, ...over })
const staff = [emp({ id: 'a490', name: 'Researcher-Vacuum' })]
const row = (over: Record<string, unknown>) => ({ isExpanded: false, originKind: 'task-notification', text: 'Agent finished', ...over })

/** A subagent's final report handed back to the main chat: the engine stamps it `peer`, sender the name it was hired under. */
const FRAME = '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. The report follows:'
const handback = (over: Record<string, unknown> = {}) =>
  row({ originKind: 'peer', from: { name: 'Researcher-Vacuum' }, text: `${FRAME}\n  DOSSIER: Robot vacuum X.\n  Price checked on two stores.`, ...over })

test('a hired specialist\'s hand-back (its final report, stamped peer) is a hand-back the chat can hide', () => {
  expect(isHandback(handback(), staff)).toBe(true)
  expect(isHandback(handback({ from: { name: 'researcher-vacuum' } }), staff)).toBe(true)
})

test('a hired specialist\'s hand-back is hidden whatever its report says: Clawd reads every report, as with a finished notice', () => {
  expect(isHandback(handback({ text: `${FRAME}\n  Should I also check the warranty?` }), staff)).toBe(true)
  expect(isHandback(handback({ text: `${FRAME}\n  The store page was blocked and the mop fails the brief.` }), staff)).toBe(true)
})

test('a hand-back stays shown in the full view, without the hand-back line, or when its sender is not on the staff', () => {
  expect(isHandback(handback({ isExpanded: true }), staff)).toBe(false)
  expect(isHandback(handback({ text: 'DOSSIER: Robot vacuum X.' }), staff)).toBe(false)
  expect(isHandback(handback({ text: `Note: ${FRAME}` }), staff)).toBe(false)
  expect(isHandback(handback({ from: { name: 'Another session' } }), staff)).toBe(false)
  expect(isHandback(handback({ from: undefined }), staff)).toBe(false)
  expect(isHandback(handback(), [])).toBe(false)
  // The generic word names no agent: it cannot be tied to one the office hired.
  expect(isHandback(handback({ from: { name: 'subagent' } }), staff)).toBe(false)
  // Only a peer row is a hand-back: the same words under a stamp of the person's or a channel's are not (teammate rows keep their own rules).
  for (const originKind of ['channel', 'composer', 'bridge', 'sdk', 'scheduled-trigger']) {
    expect(isHandback(handback({ originKind }), staff)).toBe(false)
  }
})

test('a hand-back from an agent the session lists under that name counts when its id is on the staff, and only then', () => {
  const unnamed = [emp({ id: 'a490' })]
  expect(isHandback(handback(), unnamed)).toBe(false)
  expect(isHandback(handback(), unnamed, [{ id: 'a490', name: 'Researcher-Vacuum' }])).toBe(true)
  expect(isHandback(handback(), unnamed, [{ id: 'a490', name: 'researcher-vacuum' }])).toBe(true)
  expect(isHandback(handback(), unnamed, [{ id: 'z999', name: 'Researcher-Vacuum' }])).toBe(false)
  expect(isHandback(handback(), unnamed, [{ id: 'a490' }])).toBe(false)
  expect(isHandback(handback(), [], [{ id: 'a490', name: 'Researcher-Vacuum' }])).toBe(false)
})

/** A specialist's shell command moved to the background on a timeout: the summary quotes the command, which holds a `?` of its own. */
const COMMAND = 'cd /tmp/fake-scratch && curl -s "https://video.example/watch?v=abc" | sed -E "s/^text: >?-?//"'
const shellDone = (over: Record<string, unknown> = {}) => row({ text: `Background command "${COMMAND}" completed (exit code 0)`, task: { id: 'b1shell', status: 'completed' }, ...over })

test('a finished background command is hidden even when the command it quotes has a question mark in it', () => {
  expect(isHandback(shellDone(), staff)).toBe(true)
  expect(isHandback(shellDone(), [])).toBe(true)
})

test('a finished background command is still shown when it failed, when the notice itself asks, or in the full view', () => {
  expect(isHandback(shellDone({ task: { id: 'b1shell', status: 'failed' } }), staff)).toBe(false)
  expect(isHandback(shellDone({ text: `Background command "${COMMAND}" completed. Ready to go on?` }), staff)).toBe(false)
  expect(isHandback(shellDone({ text: `Background command "${COMMAND}" needs your approval` }), staff)).toBe(false)
  expect(isHandback(shellDone({ isExpanded: true }), staff)).toBe(false)
})

test('only the command\'s own quotes are set aside: quoted words after its status still count', () => {
  // Quotes after the status word are the notice's own words, not the command.
  expect(isHandback(shellDone({ text: 'Background command "x" completed. Should I run "deploy" now?' }), staff)).toBe(false)
  expect(isHandback(shellDone({ text: 'Background command "x" completed. The log says "needs your approval" and you must reply "yes"' }), staff)).toBe(false)
  // A command with inner and escaped quotes, and nothing asked after it, is still a plain finish.
  expect(isHandback(shellDone({ text: 'Background command "grep -E \\"a?b\\" \\"log file\\" | head" completed (exit code 0)' }), staff)).toBe(true)
  expect(isHandback(shellDone({ text: 'Background command "echo \\"done?\\"" completed (exit code 0)' }), staff)).toBe(true)
  // No closing quote before a status word: nothing is set aside, so the `?` counts.
  expect(isHandback(shellDone({ text: 'Background command "watch?v=1 finished' }), staff)).toBe(false)
  expect(isHandback(shellDone({ text: 'Background command "watch?v=1" done' }), staff)).toBe(false)
})

test('the session\'s agent list is wanted only for a hand-back whose sender is not on the books by name', () => {
  expect(needsAgentList(handback(), staff)).toBe(false)
  expect(needsAgentList(handback(), [emp({ id: 'a490' })])).toBe(true)
  expect(needsAgentList(handback({ text: 'DOSSIER: Robot vacuum X.' }), [emp({ id: 'a490' })])).toBe(false)
  expect(needsAgentList(handback({ isExpanded: true }), [emp({ id: 'a490' })])).toBe(false)
  expect(needsAgentList(handback({ from: undefined }), [emp({ id: 'a490' })])).toBe(false)
  expect(needsAgentList(shellDone(), [emp({ id: 'a490' })])).toBe(false)
})

test('the agent list is read once a short while, a failing read gives none, and the time passing reads again', async () => {
  const cached = agentListCache(2_000)
  let reads = 0
  const load = async () => { reads += 1; return [{ id: 'a490', name: 'Researcher-Vacuum' }] }
  expect(await cached(10, load)).toEqual([{ id: 'a490', name: 'Researcher-Vacuum' }])
  await Promise.all([cached(500, load), cached(1_999, load)])
  expect(reads).toBe(1)
  await cached(2_010, load)
  expect(reads).toBe(2)
  const failing = agentListCache(2_000)
  expect(await failing(0, async () => { throw new Error('no list') })).toEqual([])
})

// ---- The same two rows drawn on the desktop, after the office hired the specialist (by name, unless `name` is null) ----
async function office($: Engine, on: On, opts: { name?: string | null; agents?: unknown[] } = {}) {
  const h = host(on, opts.agents ?? [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a490' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['ENGINE'] }) as never)
  await $.session.start(START)
  const name = opts.name === undefined ? 'Researcher-Vacuum' : opts.name
  await $.agent.spawn({ prompt: 'Research it', description: 'Research', subagentType: 'general-purpose', ...(name === null ? {} : { name }) } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'r1', agentId: 'a490', isAborted: false } as never)
  return h
}
/** The debug record is written without holding the row: let it land. */
const settle = async (h: { clock: { advance: (ms: number) => Promise<unknown> } }) => { for (let i = 0; i < 30; i += 1) await h.clock.advance(0) }
const listed = (name: string) => [{ id: 'a490', type: 'general-purpose', description: 'Research', status: 'completed', name }]
const drawn = async ($: Engine, props: Record<string, unknown>) => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', component: 'UserMessage', props } as never)
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}
const isHidden = (text: string) => !text.includes('ENGINE') && !/[A-Za-z]{3}/.test(text.replace(/"type":"Text"|"props"|"children"|"part":\{"plugin":"clawd-hq"\}/g, ''))

test('on the desktop, a named specialist\'s hand-back and a finished background command are not drawn', async ($, on) => {
  const h = await office($, on)
  const { originKind, ...back } = handback()
  expect(isHidden(await drawn($, { ...back, origin: { kind: originKind } }))).toBe(true)
  const { originKind: kind, ...shell } = shellDone()
  expect(isHidden(await drawn($, { ...shell, origin: { kind } }))).toBe(true)
  // Each decision leaves a record in the store to read in a live session, without the row's words.
  await settle(h)
  const records = h.saved.get('debug:quiet') as Array<Record<string, unknown>>
  expect(records).toMatchObject([
    { kind: 'peer', from: 'Researcher-Vacuum', isHandbackLine: true, look: 'hide' },
    { kind: 'task-notification', from: null, status: 'completed', type: null, look: 'hide' },
  ])
  expect(JSON.stringify(records)).not.toContain('DOSSIER')
})

test('on the desktop, a peer row without the hand-back line, and a failed command, are drawn as the engine draws them', async ($, on) => {
  await office($, on)
  const { originKind, ...plain } = handback({ text: 'DOSSIER: Robot vacuum X.' })
  expect(await drawn($, { ...plain, origin: { kind: originKind } })).toContain('ENGINE')
  const { originKind: kind, ...failed } = shellDone({ task: { id: 'b1shell', status: 'failed' } })
  expect(await drawn($, { ...failed, origin: { kind } })).toContain('ENGINE')
})

const drawnBack = async ($: Engine, from: string) => {
  const { originKind, ...back } = handback({ from: { name: from } })
  return drawn($, { ...back, origin: { kind: originKind } })
}

test('a hand-back from a specialist hired with no name is hidden when the session lists it under the sender\'s name', async ($, on) => {
  await office($, on, { name: null, agents: listed('Researcher-Vacuum') })
  expect(isHidden(await drawnBack($, 'Researcher-Vacuum'))).toBe(true)
})

test('a hand-back under the suffixed name the session gave a specialist is hidden through the list', async ($, on) => {
  await office($, on, { agents: listed('Researcher-Vacuum-2') })
  expect(isHidden(await drawnBack($, 'Researcher-Vacuum-2'))).toBe(true)
})

test('a hand-back whose sender neither the books nor the session list place is shown', async ($, on) => {
  await office($, on, { name: null, agents: listed('Researcher-Other') })
  expect(await drawnBack($, 'Researcher-Vacuum')).toContain('ENGINE')
})
