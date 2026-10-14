import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BRIEF_NOTE } from '../hooks/desk'
import { CHECK_PROMPT } from '../hooks/know'
import { CLEAR, PANE, START, SURFACES, host } from './host'

type On = Parameters<typeof host>[0]
type Ask = { model: string; system?: string; prompt: string; maxTokens?: number; timeoutMs?: number }
const NOTE = 'learn: The Tester says all tests pass, but the last test run failed.\ntag: Heads up\nexplain: **The tests did not pass**\nThe last run ended with 3 failures. Ask for a new run.'
const USAGE = { input_tokens: 9_000, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered = (text: string) => ({ isAnswered: true, text, usage: USAGE })

/** One specialist's run as the session would read it back: its brief, then a step that read a file and one that failed. */
const run = (brief: string) => [
  { role: 'user', text: brief, toolUses: [] },
  { role: 'assistant', text: 'Step 1 of 2: reading the code.', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: 'src/login.ts' }, text: 'code' }] },
  { role: 'assistant', text: 'Step 2 of 2: testing.', toolUses: [{ tool_use_id: 'u2', tool: 'Bash', input: { command: 'npm test' }, text: '3 failed', isError: true }] },
  { role: 'assistant', text: 'All tests pass.', toolUses: [] },
]

/**
 * A session with the office open, a model whose replies come from `replies` (a function per call), and each agent's
 * rows in `rows`. `held` holds every reply until released.
 */
function office(on: On, replies: Array<() => unknown> = [() => answered(NOTE)]) {
  const h = host(on, [])
  pause = () => h.clock.advance(0)
  const asked: Ask[] = []
  const reads: string[] = []
  const rows = new Map<string, unknown>()
  const gate = { held: undefined as Promise<void> | undefined, release: () => undefined as void }
  const hold = () => { gate.held = new Promise<void>(resolve => { gate.release = resolve }) }
  on('model.complete', async (_$, e) => {
    asked.push(e as Ask)
    await gate.held
    const reply = replies[Math.min(asked.length - 1, replies.length - 1)]!
    return { value: reply() } as never
  })
  on('session.messages', (_$, e) => {
    const id = (e as { agentId?: string } | undefined)?.agentId ?? 'main'
    reads.push(id)
    return { value: rows.get(id) ?? { deny: `no agent ${id}` } } as never
  })
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${(n += 1)}` }))
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  return { ...h, asked, reads, rows, hold, gate }
}

const hire = ($: Engine, prompt = 'Fix the login bug.') => $.agent.spawn({ prompt, description: 'Fix login', subagentType: 'ecc:tdd-guide' } as never)
const handBack = ($: Engine, id: string, reason = 'answer', answer = 'All tests pass.') =>
  $.turn.complete({ reason, answer, turnId: `t-${id}`, agentId: id, isAborted: reason === 'aborted', durationMs: 60_000, usage: { ...USAGE, model: 'claude-opus-5-5' } } as never)
/** Lets the work running in the background go on, a round trip at a time, without moving the clock. */
let pause: () => Promise<unknown> = async () => undefined
async function until(_$: Engine, isThere: () => boolean) {
  for (let i = 0; i < 300 && !isThere(); i += 1) await pause()
}
const idle = async () => { for (let i = 0; i < 30; i += 1) await pause() }
type Log = Array<{ outcome: string; who: string; reason?: string; inTokens?: number; outTokens?: number; recordChars?: number; ms?: number }>
const logOf = (saved: Map<string, unknown>) => (saved.get('know:log') ?? []) as Log

test('a hand-back asks Haiku once, with our own question and the whole record, and the note is kept as shown', async ($, on) => {
  const { asked, rows, saved, toasts } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', run(`Fix the login bug.${BRIEF_NOTE}`))
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(asked).toHaveLength(1)
  const ask = asked[0]!
  expect({ model: ask.model, maxTokens: ask.maxTokens, timeoutMs: ask.timeoutMs, system: ask.system }).toEqual({ model: 'haiku', maxTokens: 700, timeoutMs: 60_000, system: CHECK_PROMPT })
  expect(ask.prompt).toMatch(/WHO DID THE WORK: Tester, a specialist Clawd hired/)
  expect(ask.prompt).toMatch(/BRIEF:\nFix the login bug\./)
  expect(ask.prompt).toMatch(/STEP 2 · Bash · npm test · ERROR/)
  expect(ask.prompt).toMatch(/REPORT HANDED BACK:\nAll tests pass\./)
  expect(ask.prompt).toMatch(/TIME AND TOKENS: 1m; 9,000 input tokens, 60 output tokens/)
  expect(saved.get('know:shown')).toEqual(['The Tester says all tests pass, but the last test run failed.'])
  expect(logOf(saved)).toEqual([{ at: 1_000, who: 'Tester', outcome: 'shown', inTokens: 9_000, outTokens: 60, ms: 0, recordChars: expect.any(Number) }])
  expect(toasts.some(t => /last test run failed/.test(t))).toBe(false)
})

test('learn: none shows nothing and is logged', async ($, on) => {
  const { asked, rows, saved } = office(on, [() => answered('learn: none')])
  await $.session.start(START)
  await hire($)
  rows.set('a1', run('Fix it.'))
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(asked).toHaveLength(1)
  expect(saved.get('know:shown')).toBeUndefined()
  expect(logOf(saved).map(l => l.outcome)).toEqual(['none'])
})

for (const failure of [
  { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { ...USAGE, input_tokens: 0, output_tokens: 0 } },
  { isAnswered: false, reason: 'empty-reply', usage: USAGE },
  { isAnswered: false, reason: 'aborted', usage: { ...USAGE, input_tokens: 0, output_tokens: 0 } },
]) {
  test(`a check that ends in ${failure.reason} shows nothing, no pop-up, and is logged`, async ($, on) => {
    const { rows, saved, toasts } = office(on, [() => failure])
    await $.session.start(START)
    await hire($)
    rows.set('a1', run('Fix it.'))
    await handBack($, 'a1')
    await until($, () => logOf(saved).length > 0)
    expect(logOf(saved).map(l => l.outcome)).toEqual([failure.reason])
    expect(saved.get('know:shown')).toBeUndefined()
    expect(toasts.filter(t => !/finished/.test(t))).toEqual([])
  })
}

test('a session that will not hand over the record skips the check quietly, and the log says why', async ($, on) => {
  const { asked, saved } = office(on)
  await $.session.start(START)
  await hire($)
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(asked).toEqual([])
  expect(logOf(saved)).toEqual([{ at: 1_000, who: 'Tester', outcome: 'refused', reason: 'no agent a1' }])
})

test('a run that failed is checked too, and the checker is told how it ended', async ($, on) => {
  const { asked, rows, saved } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', run('Fix it.'))
  await handBack($, 'a1', 'error', '')
  await until($, () => logOf(saved).length > 0)
  expect(asked[0]!.prompt).toMatch(/HOW IT ENDED: It stopped on an error before it finished\./)
})

test('a resumed specialist is checked on what it did since its last check, with its first brief beside it', async ($, on) => {
  const { asked, rows, saved } = office(on, [() => answered('learn: none')])
  await $.session.start(START)
  await hire($, 'Fix the login bug.')
  const first = run(`Fix the login bug.${BRIEF_NOTE}`)
  rows.set('a1', first)
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  rows.set('a1', [...first, { role: 'user', text: 'Now fix signup too.', toolUses: [] },
    { role: 'assistant', text: 'Done.', toolUses: [{ tool_use_id: 'u9', tool: 'Edit', input: { file_path: 'src/signup.ts' }, text: 'ok' }] }])
  await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  await handBack($, 'a1', 'answer', 'Done.')
  await until($, () => logOf(saved).length > 1)
  expect(asked).toHaveLength(2)
  expect(asked[1]!.prompt).toMatch(/BRIEF:\nFix the login bug\./)
  expect(asked[1]!.prompt).toMatch(/MESSAGE THAT STARTED THIS RUN:\nNow fix signup too\./)
  expect(asked[1]!.prompt).toMatch(/STEP 1 · Edit · src\/signup\.ts · done/)
  expect(asked[1]!.prompt).not.toMatch(/npm test/)
})

test('several hand-backs close together are all checked, one question at a time', async ($, on) => {
  const { asked, rows, saved, hold, gate } = office(on, [() => answered('learn: none')])
  await $.session.start(START)
  for (const id of ['a1', 'a2', 'a3']) {
    await hire($)
    rows.set(id, run(`Job ${id}`))
  }
  hold()
  for (const id of ['a1', 'a2', 'a3']) await handBack($, id)
  await until($, () => asked.length > 0)
  await idle()
  expect(asked).toHaveLength(1)
  gate.release()
  await until($, () => logOf(saved).length === 3)
  expect(asked.map(a => /BRIEF:\n(Job a\d)/.exec(a.prompt)![1])).toEqual(['Job a1', 'Job a2', 'Job a3'])
})

test('the tour\'s stand-in specialists are never checked', async ($, on) => {
  const { asked, clock } = office(on)
  await $.session.start(START)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await clock.advance(70_000)
  expect(asked).toEqual([])
})

test('nothing is checked where nobody can see the panel', async ($, on) => {
  const { asked, rows } = office(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await hire($)
  rows.set('a1', run('Fix it.'))
  await handBack($, 'a1')
  await idle()
  expect(asked).toEqual([])
})

test('nothing is checked while the Office tab cannot be seen', async ($, on) => {
  const { asked, rows, fail } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', run('Fix it.'))
  fail.list = true
  await handBack($, 'a1')
  await idle()
  expect(asked).toEqual([])
})

test('with the setting off nothing is checked', { options: { youShouldKnow: false } }, async ($, on) => {
  const { asked, rows } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', run('Fix it.'))
  await handBack($, 'a1')
  await idle()
  expect(asked).toEqual([])
})

test('a reply that arrives after a /clear is dropped', async ($, on) => {
  const { asked, rows, saved, hold, gate } = office(on)
  await $.session.start(START)
  await hire($)
  rows.set('a1', run('Fix it.'))
  hold()
  await handBack($, 'a1')
  await until($, () => asked.length > 0)
  await $.session.end(CLEAR)
  gate.release()
  await until($, () => logOf(saved).length > 0)
  expect(logOf(saved).map(l => l.outcome)).toEqual(['stale'])
  expect(saved.get('know:shown')).toBeUndefined()
})

test('the person\'s last two prompts ride along; commands do not count', async ($, on) => {
  const { asked, rows, saved } = office(on)
  await $.session.start(START)
  for (const text of ['first ask', 'second ask', 'third ask']) await $.prompt.submit({ text } as never)
  await $.prompt.submit({ text: '/office', command: { name: 'office', kind: 'local' } } as never)
  await hire($)
  rows.set('a1', run('Fix it.'))
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(asked[0]!.prompt).toMatch(/THE PERSON'S LATEST PROMPTS TO CLAWD:\n1\. second ask\n2\. third ask\n/)
})

test('a note already shown, or one the person already knew, is not shown again; both lists ride in the question', async ($, on) => {
  const line = 'The Tester says all tests pass, but the last test run failed.'
  const { asked, rows, saved } = office(on)
  saved.set('know:knew', [line.toLowerCase()])
  saved.set('know:shown', ['Something older.'])
  await $.session.start(START)
  await hire($)
  rows.set('a1', run('Fix it.'))
  await handBack($, 'a1')
  await until($, () => logOf(saved).length > 0)
  expect(logOf(saved).map(l => l.outcome)).toEqual(['repeat'])
  expect(asked[0]!.prompt).toMatch(/Already shown to the person, do not repeat:\n- Something older\.\n\nThe person already knew, do not repeat:\n- the tester says/)
})

test('the recap waits while a check is under way, and is made on a later frame', { timeoutMs: 15_000 }, async ($, on) => {
  const { asked, rows, saved, hold, gate, clock } = office(on)
  const forks: string[] = []
  on('model.fork', (_$, e) => (forks.push((e as { prompt: string }).prompt), { value: answered('Fixing login. Next: review.') }) as never)
  await $.session.start(START)
  for (let i = 1; i <= 3; i += 1) {
    await $.turn.start({ text: `Ask ${i}`, turnId: `m${i}` } as never)
    await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `m${i}`, isAborted: false } as never)
  }
  await hire($)
  rows.set('a1', run('Fix it.'))
  hold()
  await handBack($, 'a1')
  await until($, () => asked.length > 0)
  for (let left = 4 * 60_000; left > 0; left -= 10_000) await clock.advance(10_000)
  expect(forks).toEqual([])
  gate.release()
  await until($, () => logOf(saved).length > 0)
  for (let left = 30_000; left > 0; left -= 10_000) await clock.advance(10_000)
  expect(forks).toHaveLength(1)
})

test('a note passed over by two prompts leaves; after two such notes the next check is skipped and logged', async ($, on) => {
  const notes = [1, 2, 3].map(n => () => answered(`learn: Note number ${n} matters.\ntag: Heads up`))
  const { asked, rows, saved } = office(on, notes)
  await $.session.start(START)
  for (const n of [1, 2]) {
    await hire($)
    rows.set(`a${n}`, run(`Job ${n}`))
    await handBack($, `a${n}`)
    await until($, () => logOf(saved).length === n)
    await $.prompt.submit({ text: 'carry on' } as never)
    expect(saved.get('know:backoff')).toEqual(n === 1 ? undefined : { ignored: 1, skipLeft: 0 })
    await $.prompt.submit({ text: 'and on' } as never)
  }
  expect(saved.get('know:backoff')).toEqual({ ignored: 2, skipLeft: 1 })
  await hire($)
  rows.set('a3', run('Job 3'))
  await handBack($, 'a3')
  await until($, () => logOf(saved).length === 3)
  expect(asked).toHaveLength(2)
  expect(logOf(saved)[2]).toMatchObject({ outcome: 'skipped', reason: 'notes were passed over' })
  expect(saved.get('know:backoff')).toEqual({ ignored: 2, skipLeft: 0 })
})

// ---- The note on Clawd's card ----

type Surface = (typeof SURFACES)[number]
/** A session with notes from `replies` on Clawd's card, one per finished specialist. */
async function withNotes($: Engine, on: On, replies: Array<() => unknown>) {
  const h = office(on, replies)
  await $.session.start(START)
  for (let n = 1; n <= replies.length; n += 1) {
    await hire($)
    h.rows.set(`a${n}`, run(`Job ${n}`))
    await handBack($, `a${n}`)
    await until($, () => logOf(h.saved).length === n)
  }
  return h
}
const office$ = ($: Engine, surface: Surface) => $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
const texts = async (ui: Awaited<ReturnType<typeof office$>>) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
const reply = (n: number, extra = '\nexplain: **Tests did not pass**\nThe last run had 3 failures.') => () => answered(`learn: Note ${n} matters.\ntag: Heads up${extra}`)

test('a note shows on Clawd\'s card, below his status and above the floor, headed by its tag and who did the work', async ($, on) => {
  await withNotes($, on, [() => answered(NOTE)])
  for (const surface of SURFACES) {
    const ui = await office$($, surface)
    const all = await texts(ui)
    const [head, line] = [all.indexOf('HEADS UP · Tester'), all.indexOf('The Tester says all tests pass, but the last test run failed.')]
    expect(head).toBeGreaterThan(all.findIndex(t => /Chief of Staff/.test(t)))
    expect(line).toBe(head + 1)
    expect(all.findIndex(t => /THE FLOOR|AT WORK/.test(t))).toBeGreaterThan(line)
    for (const key of ['know-more', 'know-knew', 'know-dismiss']) expect(await ui.find({ key })).toBeDefined()
    expect(await ui.find({ key: 'know-got-it' })).toBeUndefined()
    expect(all.some(t => /more notes? waiting/.test(t))).toBe(false)
    // The title and the explanation wait behind Learn more.
    expect(all.some(t => /The tests did not pass|3 failures/.test(t))).toBe(false)
    await ui.unmount()
  }
})

test('Learn more opens the title and explanation with Got it; Got it takes the note off and starts the back-off over', async ($, on) => {
  const { saved } = await withNotes($, on, [() => answered(NOTE)])
  saved.set('know:backoff', { ignored: 1, skipLeft: 0 })
  const ui = await office$($, 'terminal')
  await ui.press({ key: 'know-more' })
  expect(await ui.find({ type: 'Text', text: /^The tests did not pass$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^The last run ended with 3 failures\. Ask for a new run\.$/ })).toBeDefined()
  expect(await ui.find({ key: 'know-more' })).toBeUndefined()
  await ui.press({ key: 'know-got-it' })
  expect(await ui.find({ type: 'Text', text: /HEADS UP/ })).toBeUndefined()
  expect(saved.get('know:backoff')).toEqual({ ignored: 0, skipLeft: 0 })
  await ui.unmount()
})

test('Knew this already saves the note as known and takes it off; Dismiss only takes it off', async ($, on) => {
  const { saved } = await withNotes($, on, [reply(1), reply(2)])
  const ui = await office$($, 'desktop')
  await ui.press({ key: 'know-knew' })
  expect(saved.get('know:knew')).toEqual(['Note 1 matters.'])
  expect(await ui.find({ type: 'Text', text: /^Note 2 matters\.$/ })).toBeDefined()
  await ui.press({ key: 'know-dismiss' })
  expect(await ui.find({ type: 'Text', text: /HEADS UP/ })).toBeUndefined()
  expect(saved.get('know:knew')).toEqual(['Note 1 matters.'])
  await ui.unmount()
})

test('a note with no explanation has no Learn more', async ($, on) => {
  await withNotes($, on, [reply(1, '')])
  for (const surface of SURFACES) {
    const ui = await office$($, surface)
    expect(await ui.find({ type: 'Text', text: /^Note 1 matters\.$/ })).toBeDefined()
    expect(await ui.find({ key: 'know-more' })).toBeUndefined()
    expect(await ui.find({ key: 'know-dismiss' })).toBeDefined()
    await ui.unmount()
  }
})

test('notes queue up to three, oldest first, with a dim count of those waiting; a fourth is not kept', async ($, on) => {
  const { saved } = await withNotes($, on, [reply(1), reply(2), reply(3), reply(4)])
  expect(logOf(saved).map(l => l.outcome)).toEqual(['shown', 'shown', 'shown', 'dropped'])
  const ui = await office$($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^Note 1 matters\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 more notes waiting$/ })).toBeDefined()
  await ui.press({ key: 'know-dismiss' })
  expect(await ui.find({ type: 'Text', text: /^Note 2 matters\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 more note waiting$/ })).toBeDefined()
  await ui.unmount()
})

test('the person\'s second prompt after a note takes it off; a /clear empties the card', async ($, on) => {
  await withNotes($, on, [reply(1), reply(2)])
  await $.prompt.submit({ text: 'next thing' } as never)
  let ui = await office$($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^Note 1 matters\.$/ })).toBeDefined()
  await ui.unmount()
  await $.prompt.submit({ text: 'and another' } as never)
  ui = await office$($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /^Note 2 matters\.$/ })).toBeDefined()
  await ui.unmount()
  await $.session.end(CLEAR)
  ui = await office$($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /HEADS UP/ })).toBeUndefined()
  await ui.unmount()
})

// ---- Claude Code's own "You should know" stays quiet while ours is on ----

/** A stand-in for the built-in: at the end of a turn it forks a side question and keeps what came back. */
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

/** The main thread's fork as the engine would answer it, and every fork that got that far. */
function forks(on: On) {
  const h = host(on, [])
  const asked: string[] = []
  on('model.fork', (_$, e) => (asked.push((e as { prompt: string }).prompt), { value: answered('learn: none') }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  return { ...h, asked }
}
const turnEnds = ($: Engine) => $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'm1', isAborted: false } as never)

test('the built-in\'s side question is answered with nothing to fork, and never reaches the model', { plugins: [ysk('builtin')] }, async ($, on) => {
  const { asked, saved } = forks(on)
  await $.session.start(START)
  await turnEnds($)
  expect(asked).toEqual([])
  expect(saved.get('ysk-reply')).toEqual({ isAnswered: false, reason: 'nothing-to-fork' })
})

test('a plugin a person installed under the same name is left alone', { plugins: [ysk('user')] }, async ($, on) => {
  const { asked, saved } = forks(on)
  await $.session.start(START)
  await turnEnds($)
  expect(asked).toEqual(['anything to know?'])
  expect(saved.get('ysk-reply')).toMatchObject({ isAnswered: true })
})

test('with our setting off, the built-in asks as usual', { plugins: [ysk('builtin')], options: { youShouldKnow: false } }, async ($, on) => {
  const { asked } = forks(on)
  await $.session.start(START)
  await turnEnds($)
  expect(asked).toEqual(['anything to know?'])
})

// ---- Clawd's own long turns ----

const step = (n: number) => ({ tool_use_id: `m${n}`, tool: 'Edit', input: { file_path: `docs/page${n}.md` }, text: 'ok' })
/** The main chat as the session reads it back: an older exchange, then this turn's request and its steps. */
const mainRows = (tools: number) => [
  { role: 'user', text: 'An older request', toolUses: [] },
  { role: 'assistant', text: 'Old answer.', toolUses: [] },
  { role: 'user', text: 'Tidy the docs', toolUses: [] },
  { role: 'assistant', text: 'Step 1: tidying.', toolUses: Array.from({ length: tools }, (_, i) => step(i + 1)) },
  { role: 'assistant', text: 'Done, all pages tidy.', toolUses: [] },
]
async function ownTurn($: Engine, tools: number, id = 'm1', agentTools = 0) {
  await $.turn.start({ text: 'Tidy the docs', turnId: id } as never)
  for (let i = 0; i < tools; i += 1) await $.tool.call({ tool: 'Edit', file_path: `docs/page${i}.md` } as never)
  for (let i = 0; i < agentTools; i += 1) await $.tool.call({ tool: 'Read', file_path: 'x', agentId: 'a1' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done, all pages tidy.', turnId: id, isAborted: false, durationMs: 30_000 } as never)
}

test('a turn of Clawd\'s own with six or more tool uses is checked the same way, as his', async ($, on) => {
  const { asked, rows, saved } = office(on, [() => answered('learn: Clawd edited six pages but the request named only one.\ntag: Heads up')])
  rows.set('main', mainRows(6))
  await $.session.start(START)
  await ownTurn($, 6)
  await until($, () => logOf(saved).length > 0)
  expect(asked).toHaveLength(1)
  const prompt = asked[0]!.prompt
  expect(prompt).toMatch(/WHO DID THE WORK: Clawd, the chief of staff, in the main chat/)
  expect(prompt).toMatch(/THE PERSON'S REQUEST:\nTidy the docs/)
  expect(prompt).not.toMatch(/An older request|Old answer/)
  expect(prompt).toMatch(/STEP 6 · Edit · docs\/page6\.md · done/)
  expect(prompt).toMatch(/FINAL ANSWER:\nDone, all pages tidy\./)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^HEADS UP · Clawd$/ })).toBeDefined()
  await ui.unmount()
})

test('five tool uses, or six spread over two turns, or a specialist\'s tools, are not a long turn of Clawd\'s', async ($, on) => {
  const { asked, rows } = office(on)
  rows.set('main', mainRows(5))
  await $.session.start(START)
  await hire($)
  await ownTurn($, 5, 'm1')
  await ownTurn($, 3, 'm2')
  await ownTurn($, 3, 'm3', 6)
  await idle()
  expect(asked).toEqual([])
})

test('with the setting off, Clawd\'s long turns are not checked either', { options: { youShouldKnow: false } }, async ($, on) => {
  const { asked, rows } = office(on)
  rows.set('main', mainRows(8))
  await $.session.start(START)
  await ownTurn($, 8)
  await idle()
  expect(asked).toEqual([])
})
