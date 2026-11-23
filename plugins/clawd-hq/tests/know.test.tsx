import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { KNOW_VERSION } from '../hooks/know'
import { EXPLAIN_FAILED } from '../hooks/know-check'
import { EXPLAIN_FILE, OBSERVER_FILE } from '../hooks/know-prompts'
import { AMBER } from '../hooks/office'
import { PANES } from '../hooks/panes'
import { CLEAR, PANE, START, SURFACES, host } from './host'
import { EXPLAIN, OBSERVER } from './know-prompts'

type On = Parameters<typeof host>[0]
type Fork = { prompt: string; effort?: string }
const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
const NOTE = 'learn: The Tester says all tests pass, but the last test run failed.\ntag: Heads up\nexplain: **The tests did not pass**\nThe last run ended with 3 failures. Ask for a new run.'
const USAGE = { input_tokens: 7_000, output_tokens: 60, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 3_000 }
const COST = { engine: 'fork', inTokens: 7_000, cacheReadTokens: 90_000, cacheWriteTokens: 3_000, outTokens: 60, ms: 0, cacheShare: 0.9 }
const answered = (text: string) => ({ isAnswered: true, text, usage: USAGE })
const none = () => answered('learn: none')
const WRITING = 'Writing the explanation…'

/**
 * A session with the office open and the shipped prompts in place, a main thread whose forks are answered from `replies`
 * (one per fork, the last one again after that), and each specialist's rows in `rows`. `hold` holds every fork until released.
 */
function office(on: On, replies: Array<() => unknown> = [() => answered(NOTE)]) {
  const h = host(on, [])
  pause = () => h.clock.advance(0)
  h.files.set(`${ROOT}/${OBSERVER_FILE}`, OBSERVER)
  h.files.set(`${ROOT}/${EXPLAIN_FILE}`, EXPLAIN)
  const forked: Fork[] = []
  const completed: unknown[] = []
  const rows = new Map<string, unknown>()
  const gate = { held: undefined as Promise<void> | undefined, release: () => undefined as void }
  const hold = () => { gate.held = new Promise<void>(resolve => { gate.release = resolve }) }
  on('model.fork', async (_$, e) => {
    forked.push(e as Fork)
    await gate.held
    return { value: replies[Math.min(forked.length - 1, replies.length - 1)]!() } as never
  })
  on('model.complete', (_$, e) => (completed.push(e), { value: answered('learn: none') }) as never)
  on('session.messages', (_$, e) => {
    const id = (e as { agentId?: string } | undefined)?.agentId ?? 'main'
    return { value: rows.get(id) ?? { deny: `no agent ${id}` } } as never
  })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${(n += 1)}` }))
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const fills: Array<{ text: string; mode: string }> = []
  on('prompt.fill', (_$, e) => (fills.push({ text: (e as { text: string }).text, mode: (e as { mode: string }).mode }), { isFilled: true }) as never)
  return { ...h, forked, completed, rows, hold, gate, fills }
}

const hire = ($: Engine, prompt = 'Fix the login bug.') => $.agent.spawn({ prompt, description: 'Fix login', subagentType: 'ecc:tdd-guide' } as never)
const handBack = ($: Engine, id: string, reason = 'answer', answer = 'All tests pass.') =>
  $.turn.complete({ reason, answer, turnId: `t-${id}`, agentId: id, isAborted: reason === 'aborted', durationMs: 60_000 } as never)
/** Clawd's own turn ends, in the main chat. */
const mainEnd = ($: Engine, reason = 'answer', answer = 'The Tester fixed the login bug.', turnId = 'm1') =>
  $.turn.complete({ reason, answer, turnId, isAborted: reason === 'aborted' } as never)
/** One specialist hired and handed back, then Clawd answers: the usual turn that is checked. */
async function backAndAnswer($: Engine, id: string, answer?: string) {
  await hire($)
  await handBack($, id)
  await mainEnd($, 'answer', answer)
}
let pause: () => Promise<unknown> = async () => undefined
async function until(_$: Engine, isThere: () => boolean) {
  for (let i = 0; i < 300 && !isThere(); i += 1) await pause()
}
const idle = async () => { for (let i = 0; i < 30; i += 1) await pause() }
async function tabsOpened(h: Pick<ReturnType<typeof host>, 'opened' | 'clock'>) {
  for (let i = 0; i < 300 && !h.opened.some(o => o.focus === true); i += 1) await h.clock.advance(0)
}
type Row = { outcome: string; who: string; reason?: string; stage?: string; engine?: string; noteId?: string; reactions?: string[] } & Record<string, unknown>
const logOf = (saved: Map<string, unknown>, folder = '/repo') => (saved.get(`know:log:${folder}`) ?? []) as Row[]
const office$ = ($: Engine, surface: (typeof SURFACES)[number] = 'terminal') => $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
const texts = async (ui: Awaited<ReturnType<typeof office$>>) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
const reply = (n: number, extra = '\nexplain: **Tests did not pass**\nThe last run had 3 failures.') => () => answered(`learn: Note ${n} matters.\ntag: Heads up${extra}`)

// ---- When the check runs, and what it sends ----

test('after a hand-back, Clawd\'s answer forks the main chat once with our prompt, names no effort, and the note is shown and logged with its cost', async ($, on) => {
  const { forked, completed, saved, toasts } = office(on)
  saved.set('know:knew:/repo', ['An old topic.'])
  await $.session.start(START)
  await backAndAnswer($, 'a1', 'The Tester fixed the login bug; all tests pass.')
  await until($, () => logOf(saved).length > 0)
  expect(forked).toHaveLength(1)
  expect(forked[0]!.effort).toBeUndefined()
  const prompt = forked[0]!.prompt
  expect(prompt.startsWith('# Check\n\nNotes already shown to the person:\nNone yet.\n\nTopics the person said they already knew:\n- An old topic.\n')).toBe(true)
  expect(prompt).toContain('<reply>\nThe Tester fixed the login bug; all tests pass.\n</reply>')
  // No small-model call at all: the old per-hand-back check is gone.
  expect(completed).toEqual([])
  expect(saved.get('know:shown:/repo')).toEqual(['The Tester says all tests pass, but the last test run failed.'])
  expect(logOf(saved)).toEqual([{ at: 1_000, who: 'Clawd', outcome: 'shown', stage: 'check', ...COST, noteId: 'k1000-1', version: KNOW_VERSION }])
  expect(toasts.some(t => /last test run failed/.test(t))).toBe(false)
  const ui = await office$($)
  expect(await ui.find({ type: 'Text', text: /^· Clawd$/ })).toBeDefined()
  await ui.unmount()
})

test('a turn with no hand-back and fewer than six tools of Clawd\'s own forks nothing and logs nothing', async ($, on) => {
  const { forked, saved } = office(on)
  await $.session.start(START)
  await $.turn.start({ text: 'What is next?', turnId: 'm1' } as never)
  for (let i = 0; i < 5; i += 1) await $.tool.call({ tool: 'Read', file_path: `f${i}` } as never)
  await mainEnd($)
  await idle()
  expect(forked).toEqual([])
  expect(saved.get('know:log:/repo')).toBeUndefined()
})

test('six tools of Clawd\'s own in one turn are checked; the step tool and a specialist\'s tools do not count, nor tools spread over two turns', async ($, on) => {
  const { forked, saved } = office(on, [none])
  await $.session.start(START)
  await hire($)
  const turn = async (id: string, tools: number, stepTools = 0, agentTools = 0) => {
    await $.turn.start({ text: 'Tidy the docs', turnId: id } as never)
    for (let i = 0; i < tools; i += 1) await $.tool.call({ tool: 'Edit', file_path: `docs/p${i}.md` } as never)
    for (let i = 0; i < stepTools; i += 1) await $.tool.call({ tool: 'mcp__clawd-hq__step', done: i, total: 8 } as never)
    for (let i = 0; i < agentTools; i += 1) await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
    await mainEnd($, 'answer', 'Done.', id)
  }
  await turn('m1', 5)
  await turn('m2', 3)
  await turn('m3', 0, 8)
  await turn('m4', 3, 0, 6)
  await idle()
  expect(forked).toEqual([])
  await turn('m5', 6)
  await until($, () => logOf(saved).length > 0)
  expect(forked).toHaveLength(1)
})

test('a turn that did not end with an answer is not checked; its hand-back carries over to the next answer', async ($, on) => {
  const { forked, saved } = office(on, [none])
  await $.session.start(START)
  await hire($)
  await handBack($, 'a1')
  await mainEnd($, 'aborted')
  await until($, () => logOf(saved).length > 0)
  expect(forked).toEqual([])
  expect(logOf(saved)[0]).toMatchObject({ outcome: 'skipped', reason: 'the turn did not end with an answer' })
  await mainEnd($, 'answer', 'Sorry, here it is.', 'm2')
  await until($, () => logOf(saved).length > 1)
  expect(forked).toHaveLength(1)
  // Checked once, the hand-back is used up.
  await mainEnd($, 'answer', 'Anything else?', 'm3')
  await idle()
  expect(forked).toHaveLength(1)
})

test('straight after a compaction no fork is made; once a main reply has run since, the turn is checked', async ($, on) => {
  const { forked, saved } = office(on, [none])
  await $.session.start(START)
  await hire($)
  await handBack($, 'a1')
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'Fix login', toolUses: [] }] } as never)
  await mainEnd($)
  await until($, () => logOf(saved).length > 0)
  expect(forked).toEqual([])
  expect(logOf(saved)[0]).toMatchObject({ outcome: 'skipped', reason: 'no main reply since the compaction' })
  await $.turn.start({ text: 'Go on', turnId: 'm2' } as never)
  await mainEnd($, 'answer', 'Carried on.', 'm2')
  await until($, () => logOf(saved).length > 1)
  expect(forked).toHaveLength(1)
})

test('a specialist\'s own compaction does not hold the check', async ($, on) => {
  const { forked, saved } = office(on, [none])
  await $.session.start(START)
  await hire($)
  await $.session.compact({ trigger: 'auto', agentId: 'a1', messages: [{ role: 'user', text: 'Fix login', toolUses: [] }] } as never)
  await handBack($, 'a1')
  await mainEnd($)
  await until($, () => logOf(saved).length > 0)
  expect(forked).toHaveLength(1)
})

test('one side request at a time: a turn ending while a check is still out is skipped, and its hand-back waits for the next answer', async ($, on) => {
  const { forked, saved, hold, gate } = office(on, [none])
  await $.session.start(START)
  hold()
  await backAndAnswer($, 'a1')
  await until($, () => forked.length === 1)
  await backAndAnswer($, 'a2')
  await until($, () => logOf(saved).length > 0)
  expect(forked).toHaveLength(1)
  expect(logOf(saved)[0]).toMatchObject({ outcome: 'skipped', reason: 'another side request is running' })
  gate.release()
  await until($, () => logOf(saved).length > 1)
  await mainEnd($, 'answer', 'Both done.', 'm3')
  await until($, () => forked.length === 2)
  expect(forked).toHaveLength(2)
})

test('nothing is checked where nobody can see the office, and the log says why', async ($, on) => {
  const h = office(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(h.saved).length > 0)
  expect(h.forked).toEqual([])
  expect(logOf(h.saved)).toEqual([{ at: 1_000, who: 'Clawd', outcome: 'skipped', stage: 'check', reason: 'nothing is drawn', version: KNOW_VERSION }])
})

test('with no office tab open nothing is checked; the Settings tab alone counts as open, and a note waits behind another tab', async ($, on) => {
  const h = office(on, [none, () => answered(NOTE)])
  await $.session.start(START)
  await tabsOpened(h)
  for (const { id } of PANES) h.closePane(id)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(h.saved).length > 0)
  expect(h.forked).toEqual([])
  expect(logOf(h.saved)[0]).toMatchObject({ outcome: 'skipped', reason: 'no office tab is open' })
  h.panes.push({ id: 'clawd-hq-settings', title: 'Settings' })
  h.front.id = 'clawd-hq-settings'
  await backAndAnswer($, 'a2')
  await until($, () => logOf(h.saved).length > 1)
  expect(h.forked).toHaveLength(1)
})

test('in the desktop app, which attaches after the session starts, the turn is checked', async ($, on) => {
  const { forked, saved } = office(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(forked).toHaveLength(1)
})

test('with the setting off nothing is checked or guarded', { options: { youShouldKnow: false } }, async ($, on) => {
  const { forked, rows, saved } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', guardRun('rm -rf src'))
  await handBack($, 'a1')
  await mainEnd($)
  await idle()
  expect(forked).toEqual([])
  expect(saved.get('know:log:/repo')).toBeUndefined()
})

test('with "Clawd runs the chat" off the turn is not checked, and the log says why', { options: { chiefOfStaff: false } }, async ($, on) => {
  const { forked, saved } = office(on)
  await $.session.start(START)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(forked).toEqual([])
  expect(logOf(saved)[0]).toMatchObject({ outcome: 'skipped', reason: 'Clawd does not run the chat' })
})

test('a reply that arrives after a /clear is dropped', async ($, on) => {
  const { forked, saved, hold, gate } = office(on)
  await $.session.start(START)
  hold()
  await backAndAnswer($, 'a1')
  await until($, () => forked.length > 0)
  await $.session.end(CLEAR)
  gate.release()
  await until($, () => logOf(saved).length > 0)
  expect(logOf(saved).map(l => l.outcome)).toEqual(['stale'])
  expect(saved.get('know:shown:/repo')).toBeUndefined()
})

for (const failure of [
  { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { ...USAGE, output_tokens: 0 } },
  { isAnswered: false, reason: 'empty-reply', usage: USAGE },
  { isAnswered: false, reason: 'aborted', usage: { ...USAGE, output_tokens: 0 } },
]) {
  test(`a fork that ends in ${failure.reason} shows nothing and is logged with what it cost`, async ($, on) => {
    const { saved, toasts } = office(on, [() => failure])
    await $.session.start(START)
    await backAndAnswer($, 'a1')
    await until($, () => logOf(saved).length > 0)
    expect(logOf(saved)[0]).toMatchObject({ outcome: failure.reason, engine: 'fork', inTokens: 7_000, cacheReadTokens: 90_000 })
    expect(saved.get('know:shown:/repo')).toBeUndefined()
    expect(toasts.filter(t => !/finished/.test(t))).toEqual([])
  })
}

test('nothing to fork yet is logged as such, with no token counts', async ($, on) => {
  const { saved } = office(on, [() => ({ isAnswered: false, reason: 'nothing-to-fork' })])
  await $.session.start(START)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(logOf(saved)[0]).toEqual({ at: 1_000, who: 'Clawd', outcome: 'nothing-to-fork', stage: 'check', engine: 'fork', ms: 0, version: KNOW_VERSION })
})

test('a fork that throws, or a prompt file that cannot be read, fails quietly and is logged', async ($, on) => {
  const h = office(on, [() => { throw new Error('the fork broke') }])
  await $.session.start(START)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(h.saved).length > 0)
  expect(logOf(h.saved)[0]).toMatchObject({ outcome: 'failed', reason: 'the check stopped on an error' })
  h.files.delete(`${ROOT}/${OBSERVER_FILE}`)
  await $.session.start(START)
  await $.prompt.submit({ text: 'next' } as never)
  await backAndAnswer($, 'a2')
  await until($, () => logOf(h.saved).length > 1)
  expect(logOf(h.saved)[1]).toMatchObject({ outcome: 'failed', reason: 'the prompt file could not be read' })
  expect(h.forked).toHaveLength(1)
})

test('a learn: none reply shows nothing; a reply the parser refuses is logged as failed; a repeat is not shown again', async ($, on) => {
  const { saved } = office(on, [none, () => answered('learn: See https://example.com now.'), () => answered(NOTE)])
  saved.set('know:knew:/repo', ['the tester says all tests pass, but the last test run failed'])
  await $.session.start(START)
  for (const [n, id] of ['a1', 'a2', 'a3'].entries()) {
    await backAndAnswer($, id)
    await until($, () => logOf(saved).length === n + 1)
  }
  expect(logOf(saved).map(l => l.outcome)).toEqual(['none', 'failed', 'repeat'])
  expect(saved.get('know:shown:/repo')).toBeUndefined()
})

test('the back-off still holds: after two notes passed over the next check is skipped without a fork', async ($, on) => {
  const { forked, saved } = office(on, [reply(1), reply(2), reply(3)])
  await $.session.start(START)
  for (const n of [1, 2]) {
    await backAndAnswer($, `a${n}`)
    await until($, () => logOf(saved).length === n)
    await $.prompt.submit({ text: 'carry on' } as never)
    await $.prompt.submit({ text: 'and on' } as never)
  }
  expect(saved.get('know:backoff:/repo')).toEqual({ ignored: 2, skipLeft: 1 })
  await backAndAnswer($, 'a3')
  await until($, () => logOf(saved).length === 3)
  expect(forked).toHaveLength(2)
  expect(logOf(saved)[2]).toMatchObject({ outcome: 'skipped', reason: 'notes were passed over' })
  expect(saved.get('know:backoff:/repo')).toEqual({ ignored: 2, skipLeft: 0 })
})

test('while a note is showing no check is made; once one was shown, none until the person\'s next typed message', async ($, on) => {
  const { forked, saved } = office(on, [reply(1), reply(2)])
  await $.session.start(START)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(saved).length === 1)
  await $.prompt.submit({ text: 'a new message' } as never)
  await backAndAnswer($, 'a2')
  await until($, () => logOf(saved).length === 2)
  expect(logOf(saved)[1]).toMatchObject({ outcome: 'skipped', reason: 'a note is already showing' })
  // The person's next message: a note is shown, dismissed, and no other comes until they type again.
  await $.prompt.submit({ text: 'and another' } as never)
  await $.prompt.submit({ text: 'a third' } as never)
  await backAndAnswer($, 'a3')
  await until($, () => logOf(saved).length === 3)
  const ui = await office$($)
  await ui.press({ key: 'know-dismiss' })
  await ui.unmount()
  await $.prompt.submit({ text: '/office', command: { name: 'office', kind: 'local' } } as never)
  await $.prompt.submit({ text: 'a hook message', isMeta: true } as never)
  await backAndAnswer($, 'a4')
  await until($, () => logOf(saved).length === 4)
  expect(forked).toHaveLength(2)
  expect(logOf(saved).map(l => l.outcome)).toEqual(['shown', 'skipped', 'shown', 'skipped'])
  expect(logOf(saved)[3]).toMatchObject({ reason: 'a note was already shown for this message' })
})

// ---- The note on Clawd's card ----

/** A session with one note on the card, from a checked turn; `store` is what the project's store held before the session started. */
async function withNote($: Engine, on: On, replies: Array<() => unknown> = [() => answered(NOTE)], store: Record<string, unknown> = {}) {
  const h = office(on, replies)
  for (const [key, value] of Object.entries(store)) h.saved.set(key, value)
  await $.session.start(START)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(h.saved).length === 1)
  return h
}

test('a note is its own card under Needs you, its tag in amber as its only label, who it is about dim, and the explanation behind Learn more', async ($, on) => {
  await withNote($, on)
  for (const surface of SURFACES) {
    const ui = await office$($, surface)
    const all = await texts(ui)
    const [heading, tag, who, line] = [all.findIndex(t => /^NEEDS YOU · \d+$/.test(t)), all.indexOf('HEADS UP'), all.indexOf('· Clawd'), all.indexOf('The Tester says all tests pass, but the last test run failed.')]
    expect(heading).toBeGreaterThan(all.findIndex(t => /Chief of Staff/.test(t)))
    expect([tag, who, line]).toEqual([heading + 1, heading + 2, heading + 3])
    expect((await ui.find({ type: 'Text', text: /^HEADS UP$/ }))?.props.color).toBe(AMBER)
    expect((await ui.find({ type: 'Text', text: /^· Clawd$/ }))?.props.dimColor).toBe(true)
    for (const key of ['know-more', 'know-got-it', 'know-discuss', 'know-dismiss']) expect(await ui.find({ key })).toBeDefined()
    expect(all.some(t => /The tests did not pass|3 failures/.test(t))).toBe(false)
    await ui.unmount()
  }
})

test('Learn more shows the first reply\'s explanation at once, with no fork, and offers Simpler, Shorter and More detail', async ($, on) => {
  const { forked } = await withNote($, on)
  const ui = await office$($, 'desktop')
  await ui.press({ key: 'know-more' })
  expect(await ui.find({ type: 'Text', text: /^The tests did not pass$/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^The last run ended/ }))?.props.dimColor).toBe(true)
  expect(await ui.find({ key: 'know-more' })).toBeUndefined()
  const labels = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label)).filter(l => l !== 'Hold a council').slice(0, 6)
  expect(labels).toEqual(['Simpler', 'Shorter', 'More detail', 'Knew this', 'Ask Clawd', 'Dismiss'])
  await ui.unmount()
  expect(forked).toHaveLength(1)
})

const FOLLOW_UPS = [['know-simpler', 'simpler', 'Say it in simpler words'], ['know-shorter', 'shorter', 'Say it in 45 words'], ['know-detail', 'more-detail', 'Say more, with real names']] as const
for (const [key, reaction, words] of FOLLOW_UPS) {
  test(`${key}: a fork with the explain prompt, its follow-up text and the last explanation; the new one takes its place and is logged`, async ($, on) => {
    const { forked, saved } = await withNote($, on, [() => answered(NOTE), () => answered('**Three tests failed**\nThe run in `login.test.ts` had 3 failures.\nAsk for a new run.')])
    const ui = await office$($)
    await ui.press({ key: 'know-more' })
    await ui.press({ key })
    await until($, () => logOf(saved).length === 2)
    await ui.unmount()
    expect(forked).toHaveLength(2)
    expect(forked[1]!.effort).toBeUndefined()
    const prompt = forked[1]!.prompt
    expect(prompt).toContain('The note the person opened:\nThe Tester says all tests pass, but the last test run failed.\n')
    expect(prompt).toContain(words)
    expect(prompt).toContain('Your last explanation:\n**The tests did not pass**\nThe last run ended with 3 failures. Ask for a new run.\n')
    expect(prompt).not.toContain('<!--')
    const after = await office$($)
    expect(await after.find({ type: 'Text', text: /^Three tests failed$/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: 'The run in login.test.ts had 3 failures.\nAsk for a new run.' })).toBeDefined()
    await after.unmount()
    expect(logOf(saved)[1]).toEqual({ at: 1_000, who: 'Clawd', outcome: 'explained', stage: 'explain', reason: reaction.replace('-', ' '), ...COST, version: KNOW_VERSION })
    expect(logOf(saved)[0]!.reactions).toEqual(['opened', reaction])
  })
}

test('Learn more on a note with no explanation forks the explain prompt with no follow-up, and says so while it writes', async ($, on) => {
  const { forked, gate, hold, saved } = await withNote($, on, [() => answered('learn: Note 1 matters.\ntag: Heads up'), () => answered('**One thing matters**\nIt does.')])
  hold()
  const ui = await office$($)
  await ui.press({ key: 'know-more' })
  await until($, () => forked.length === 2)
  await ui.unmount()
  expect(forked[1]!.prompt).toContain('## Follow-up\n\n\n\n## Example')
  let seen = await office$($)
  expect(await seen.find({ type: 'Text', text: WRITING })).toBeDefined()
  expect(await seen.find({ key: 'know-simpler' })).toBeUndefined()
  await seen.unmount()
  gate.release()
  await until($, () => logOf(saved).length === 2)
  seen = await office$($)
  expect(await seen.find({ type: 'Text', text: /^One thing matters$/ })).toBeDefined()
  expect(await seen.find({ type: 'Text', text: WRITING })).toBeUndefined()
  expect(await seen.find({ key: 'know-shorter' })).toBeDefined()
  await seen.unmount()
})

test('an explanation the reader refuses, or none at all, keeps the last one and says no new one came', async ($, on) => {
  const { saved } = await withNote($, on, [() => answered(NOTE), () => answered('**Fix**\nSee https://example.com/fix.'), () => ({ isAnswered: false, reason: 'empty-reply', usage: USAGE })])
  for (const n of [2, 3]) {
    const ui = await office$($)
    if (n === 2) await ui.press({ key: 'know-more' })
    await ui.press({ key: 'know-shorter' })
    await until($, () => logOf(saved).length === n)
    await ui.unmount()
    const after = await office$($)
    expect(await after.find({ type: 'Text', text: /^The tests did not pass$/ })).toBeDefined()
    expect(await after.find({ type: 'Text', text: EXPLAIN_FAILED })).toBeDefined()
    await after.unmount()
  }
  expect(logOf(saved).slice(1).map(l => l.outcome)).toEqual(['failed', 'empty-reply'])
})

test('while a follow-up is being written its buttons are hidden, so a second press cannot start a second fork', async ($, on) => {
  const h = await withNote($, on, [() => answered(NOTE), () => answered('**Shorter**\nThree failed.')])
  const ui = await office$($)
  await ui.press({ key: 'know-more' })
  h.hold()
  await ui.press({ key: 'know-shorter' })
  await until($, () => h.forked.length === 2)
  await ui.unmount()
  const seen = await office$($)
  expect(await seen.find({ type: 'Text', text: WRITING })).toBeDefined()
  for (const key of ['know-simpler', 'know-shorter', 'know-detail']) expect(await seen.find({ key })).toBeUndefined()
  // The note's line and the last explanation stay while the new one is written.
  expect(await seen.find({ type: 'Text', text: /^The tests did not pass$/ })).toBeDefined()
  await seen.unmount()
  h.gate.release()
  await until($, () => logOf(h.saved).length === 2)
})

test('Knew this takes the note off, saves its topic as known (newest ten) and starts the back-off over', async ($, on) => {
  const { saved } = await withNote($, on, undefined, { 'know:knew:/repo': Array.from({ length: 12 }, (_, i) => `Old topic ${i}.`) })
  saved.set('know:backoff:/repo', { ignored: 1, skipLeft: 0 })
  const ui = await office$($)
  await ui.press({ key: 'know-got-it' })
  expect(await ui.find({ type: 'Text', text: /YOU SHOULD KNOW|HEADS UP/ })).toBeUndefined()
  expect(saved.get('know:backoff:/repo')).toEqual({ ignored: 0, skipLeft: 0 })
  await ui.unmount()
  const knew = saved.get('know:knew:/repo') as string[]
  expect(knew).toHaveLength(10)
  expect(knew[9]).toBe('The Tester says all tests pass, but the last test run failed.')
})

test('Ask Clawd fills the prompt box with the line and the longer version, sends nothing, and takes the note off', async ($, on) => {
  const { saved, fills } = await withNote($, on)
  const ui = await office$($)
  await ui.press({ key: 'know-discuss' })
  expect(fills).toEqual([{
    text: 'Clawd raised this: "The Tester says all tests pass, but the last test run failed.". The last run ended with 3 failures. Ask for a new run. Let\'s discuss: is this a real concern here, and what should we do about it?',
    mode: 'append',
  }])
  expect(await ui.find({ type: 'Text', text: /YOU SHOULD KNOW|HEADS UP/ })).toBeUndefined()
  expect(saved.get('know:knew:/repo')).toBeUndefined()
  await ui.unmount()
})

test('the person\'s second prompt after a note takes it off; an opened one stays through three and goes on the fourth; a /clear empties the card', async ($, on) => {
  await withNote($, on)
  await $.prompt.submit({ text: 'one' } as never)
  let ui = await office$($)
  await ui.press({ key: 'know-more' })
  await ui.unmount()
  for (const text of ['two', 'three', 'four']) await $.prompt.submit({ text } as never)
  ui = await office$($)
  expect(await ui.find({ type: 'Text', text: /^The tests did not pass$/ })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'five' } as never)
  ui = await office$($)
  expect(await ui.find({ type: 'Text', text: /HEADS UP/ })).toBeUndefined()
  await ui.unmount()
})

test('a /clear empties the card', async ($, on) => {
  await withNote($, on)
  await $.session.end(CLEAR)
  const ui = await office$($)
  expect(await ui.find({ type: 'Text', text: /HEADS UP/ })).toBeUndefined()
  await ui.unmount()
})

test('the person\'s reactions ride on the row of their note, and the tally counts outcomes, reasons, reactions and cost', async ($, on) => {
  const h = office(on, [reply(1), reply(2), reply(3)])
  await $.session.start(START)
  const press = async (key: string) => { const ui = await office$($); await ui.press({ key }); await ui.unmount() }
  const next = async (n: number) => {
    await $.prompt.submit({ text: `message ${n}` } as never)
    await backAndAnswer($, `a${n}`)
    await until($, () => logOf(h.saved).filter(l => l.outcome === 'shown').length === n)
  }
  await next(1)
  await press('know-more')
  await press('know-got-it')
  await next(2)
  await press('know-discuss')
  await next(3)
  await $.prompt.submit({ text: 'one' } as never)
  await $.prompt.submit({ text: 'two' } as never)
  await idle()
  expect(logOf(h.saved).map(l => l.reactions)).toEqual([['opened', 'knew-this'], ['discussed'], ['passed-over']])
  expect(h.saved.get('know:tally:/repo')).toEqual({
    outcomes: { shown: 3 },
    reasons: {},
    reactions: { opened: 1, 'knew-this': 1, discussed: 1, 'passed-over': 1 },
    costs: { fork: { checks: 3, inTokens: 21_000, cacheReadTokens: 270_000, cacheWriteTokens: 9_000, outTokens: 180, ms: 0 } },
  })
})

test('the lists and the log are kept per project folder', async ($, on) => {
  const { saved } = office(on)
  await $.session.start({ cwd: '/other', surface: 'terminal', isInteractive: true } as never)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(saved, '/other').length > 0)
  expect(saved.get('know:shown:/other')).toEqual(['The Tester says all tests pass, but the last test run failed.'])
  expect(saved.get('know:shown:/repo')).toBeUndefined()
})

// ---- The risky-action guard on specialists' steps ----

const guardRun = (command: string) => [
  { role: 'user', text: 'Clean up the old code.', toolUses: [] },
  { role: 'assistant', text: 'Cleaning.', toolUses: [{ tool_use_id: 'g1', tool: 'Bash', input: { command }, text: 'done' }] },
]

test('a specialist\'s step that deletes for good is flagged by code at its hand-back: a Heads up on the card, logged with no model call', async ($, on) => {
  const { forked, completed, rows, saved } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', guardRun('rm -rf src/legacy'))
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(forked).toEqual([])
  expect(completed).toEqual([])
  expect(logOf(saved)).toEqual([{ at: 1_000, who: 'Tester', outcome: 'shown', stage: 'guard', engine: 'code', ms: 0, reason: 'destructive', noteId: 'k1000-1', version: KNOW_VERSION }])
  const ui = await office$($)
  expect(await ui.find({ type: 'Text', text: 'The Tester ran a command that deletes files and folders for good, in steps the main chat does not show.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^· Tester$/ })).toBeDefined()
  await ui.press({ key: 'know-more' })
  expect(await ui.find({ type: 'Text', text: /Step 1: a command that deletes files and folders for good \(Bash\)/ })).toBeDefined()
  // The command itself never reaches the card.
  expect(JSON.stringify(await texts(ui))).not.toContain('src/legacy')
  await ui.unmount()
  // The guard's note is this message's note: Clawd's answer is not checked on top of it.
  await mainEnd($)
  await until($, () => logOf(saved).length > 1)
  expect(logOf(saved)[1]).toMatchObject({ outcome: 'skipped', stage: 'check', reason: 'a note is already showing' })
})

test('a clean run leaves no row; a resumed specialist is guarded only on its steps since', async ($, on) => {
  const { rows, saved } = office(on, [none])
  await $.session.start(START)
  await hire($)
  const first = guardRun('npm test')
  rows.set('a1', first)
  await handBack($, 'a1')
  await idle()
  expect(saved.get('know:log:/repo')).toBeUndefined()
  rows.set('a1', [...first, { role: 'user', text: 'Now push it.', toolUses: [] }, { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'g2', tool: 'Bash', input: { command: 'git push --force' }, text: 'ok' }] }])
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(logOf(saved)[0]).toMatchObject({ stage: 'guard', reason: 'destructive' })
  const ui = await office$($)
  await ui.press({ key: 'know-more' })
  expect(await ui.find({ type: 'Text', text: /^These come from the Tester's own steps[\s\S]*Step 1: a command that overwrites history/ })).toBeDefined()
  await ui.unmount()
})

test('the guard keeps the card\'s rules: no office tab, or a note already there, and it is skipped and logged', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await tabsOpened(h)
  await hire($)
  h.rows.set('a1', guardRun('git reset --hard'))
  for (const { id } of PANES) h.closePane(id)
  await handBack($, 'a1')
  await until($, () => logOf(h.saved).length > 0)
  expect(logOf(h.saved)[0]).toMatchObject({ stage: 'guard', outcome: 'skipped', reason: 'no office tab is open' })
})

test('the tour\'s stand-in specialists are never guarded or counted as hand-backs', { timeoutMs: 15_000 }, async ($, on) => {
  const { forked, clock, saved } = office(on)
  await $.session.start(START)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await clock.advance(70_000)
  await mainEnd($)
  await idle()
  expect(forked).toEqual([])
  expect(saved.get('know:log:/repo')).toBeUndefined()
})

// ---- Claude Code's own "You should know" stays quiet while ours is on ----

const ysk = (tier: 'builtin' | 'user') => ({
  name: 'cc-plugin-you-should-know',
  tier,
  register(on: (event: string, hook: (...args: never[]) => unknown) => void) {
    on('turn.complete', async ($: { model: { fork: (r: unknown) => Promise<unknown> }; store: { set: (k: string, v: unknown) => Promise<unknown> } }, e: unknown, next: (e: unknown) => unknown) => {
      if ((e as { agentId?: string }).agentId === undefined) await $.store.set('ysk-reply', await $.model.fork({ prompt: 'anything to know?' }))
      return next(e)
    })
  },
}) as never
const builtinAsks = (forked: Fork[]) => forked.filter(f => f.prompt === 'anything to know?')

test('the built-in\'s side question is answered with nothing to fork, and never reaches the model; ours still forks', { plugins: [ysk('builtin')] }, async ($, on) => {
  const { forked, saved } = office(on, [none])
  await $.session.start(START)
  await backAndAnswer($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(builtinAsks(forked)).toEqual([])
  expect(saved.get('ysk-reply')).toEqual({ isAnswered: false, reason: 'nothing-to-fork' })
  expect(forked).toHaveLength(1)
})

test('a plugin a person installed under the same name is left alone', { plugins: [ysk('user')] }, async ($, on) => {
  const { forked } = office(on, [none])
  await $.session.start(START)
  await mainEnd($)
  await idle()
  expect(builtinAsks(forked)).toHaveLength(1)
})

test('with our setting off, the built-in asks as usual', { plugins: [ysk('builtin')], options: { youShouldKnow: false } }, async ($, on) => {
  const { forked } = office(on, [none])
  await $.session.start(START)
  await mainEnd($)
  await idle()
  expect(builtinAsks(forked)).toHaveLength(1)
})

test('with no office tab open, the built-in asks as usual; with one open behind another tab, it stays quiet', { plugins: [ysk('builtin')] }, async ($, on) => {
  const h = office(on, [none])
  await $.session.start(START)
  await tabsOpened(h)
  h.front.id = 'clawd-hq-people'
  await mainEnd($)
  await idle()
  expect(builtinAsks(h.forked)).toEqual([])
  for (const { id } of PANES) h.closePane(id)
  await mainEnd($, 'answer', 'ok', 'm2')
  await idle()
  expect(builtinAsks(h.forked)).toHaveLength(1)
})

test('where nothing is drawn, the built-in asks as usual', { plugins: [ysk('builtin')] }, async ($, on) => {
  const { forked } = office(on, [none])
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await mainEnd($)
  await idle()
  expect(builtinAsks(forked)).toHaveLength(1)
})
