import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LEFT_KEEP } from '../hooks/left-list'
import { PANE, PEOPLE, SETTINGS, START, SURFACES, host } from './host'

// Left undone, end to end: what Claude or a specialist put off is listed on the Office tab from three sources (a deferring
// sentence in an answer, an unfinished-work line written into a file, and a second Haiku check), kept per project.

type On = Parameters<typeof host>[0]
type Ask = { model: string; system?: string; prompt: string; maxTokens?: number }
const USAGE = { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered = (text: string) => ({ isAnswered: true, text, usage: USAGE })
const undone = (...items: string[]) => answered(JSON.stringify({ undone: items }))
const OTHER = { cwd: '/other', surface: 'terminal', isInteractive: true } as never

/** A session whose model answers with `reply()`, whose tools answer with `tool.answer(input)`, and whose prompt box and model calls are recorded. */
function office(on: On, reply: () => unknown = () => undone()) {
  const h = host(on, [], {})
  const asked: Ask[] = []
  const fills: Array<{ text: string; mode: string }> = []
  const tool = { answer: (_input: Record<string, unknown>): unknown => ({ result: 'ok', text: 'ok' }) }
  on('model.complete', (_$, e) => (asked.push(e as Ask), { value: reply() }) as never)
  on('prompt.fill', (_$, e) => (fills.push({ text: (e as { text: string }).text, mode: (e as { mode: string }).mode }), { isFilled: true }) as never)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('tool.call', (_$, e) => tool.answer(e as never) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${(n += 1)}` }))
  return { ...h, asked, fills, tool }
}
type Office = ReturnType<typeof office>

/** Lets the background work a hook started without waiting finish. */
const settle = async (h: Office) => { for (let i = 0; i < 30; i += 1) await h.clock.advance(0) }
let turnNo = 0
/** A turn of Clawd's: the person's request, `tools` Read calls, and the final answer. */
async function clawdTurn($: Engine, h: Office, o: { request?: string; tools?: number; answer?: string; extra?: Array<Record<string, unknown>> } = {}) {
  turnNo += 1
  await $.prompt.submit({ text: o.request ?? 'Add login and tests', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: o.request ?? 'Add login and tests', turnId: `m${turnNo}` } as never)
  for (let i = 0; i < (o.tools ?? 0); i += 1) await $.tool.call({ tool: 'Read', file_path: `/repo/f${i}.ts` } as never)
  for (const call of o.extra ?? []) await $.tool.call(call as never)
  await $.turn.complete({ reason: 'answer', answer: o.answer ?? 'Done.', turnId: `m${turnNo}`, isAborted: false, durationMs: 5 } as never)
  await settle(h)
}
const hire = ($: Engine) => $.agent.spawn({ prompt: 'Fix it', description: 'Fix login', subagentType: 'ecc:tdd-guide' } as never) as unknown as Promise<{ agentId: string }>
const handBack = ($: Engine, id: string, answer: string, reason = 'answer') =>
  $.turn.complete({ reason, answer, turnId: `t-${id}`, agentId: id, isAborted: false, durationMs: 60_000 } as never)

async function seen($: Engine, surface: 'terminal' | 'desktop' = 'terminal', pane = PANE) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
  const words = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String(b.text))
  await ui.unmount()
  return { words, buttons, text: words.join('\n') }
}
async function press($: Engine, text: string, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const one = await ui.find({ type: 'Button', text })
  if (!one?.key) throw new Error(`no ${text} button`)
  await ui.press({ key: one.key })
  await ui.unmount()
}
const stored = (h: Office, folder = '/repo') => (h.saved.get(`leftUndone:${folder}`) ?? []) as Array<{ text: string; source: string; file?: string; line?: number }>

// ---- Source 1: the final answer ----

test('a deferring sentence in Clawd\'s final answer is listed on the Office tab with its source, on both surfaces', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { answer: "Built the login. I'll wire up the retry logic later. All tests pass." })
  for (const surface of SURFACES) {
    const { words } = await seen($, surface)
    expect(words).toContain('LEFT UNDONE · 1')
    expect(words).toContain("I'll wire up the retry logic later.")
    expect(words).toContain('Answer · Clawd')
  }
  expect(stored(h)).toEqual([expect.objectContaining({ text: "I'll wire up the retry logic later.", source: 'answer' })])
})

test('a specialist\'s hand-back is scanned too, and the item names the specialist', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const { agentId } = await hire($)
  await handBack($, agentId, 'Fixed the login. I skipped the desktop check.')
  await settle(h)
  const { words } = await seen($)
  expect(words).toContain('I skipped the desktop check.')
  expect(words.filter(w => /^Answer · /.test(w)).length).toBe(1)
  expect(words).not.toContain('Answer · Clawd')
})

test('an answer that is not a finished answer, or has no deferring sentence, adds nothing, and the section is not drawn', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { answer: 'Everything is done. Nothing was skipped.' })
  const { text } = await seen($)
  expect(text).not.toMatch(/LEFT UNDONE/)
  await $.turn.complete({ reason: 'aborted', answer: 'I skipped the rest for now.', turnId: 'x', isAborted: true, durationMs: 1 } as never)
  await settle(h)
  expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)
  expect(stored(h)).toEqual([])
})

test('the section is on the Office tab only, below the specialists and above the artifacts', async ($, on) => {
  const h = office(on)
  h.tool.answer = input => (input.tool === 'Artifact' ? { result: { url: 'https://claude.ai/artifact/abc' }, text: 'Created https://claude.ai/artifact/abc' } : { result: 'ok' })
  await $.session.start(START)
  await hire($)
  await $.tool.call({ tool: 'Artifact', title: 'Plan' } as never)
  await clawdTurn($, h, { answer: 'I skipped the docs.' })
  await settle(h)
  const { text } = await seen($)
  expect(text.indexOf('AT WORK')).toBeGreaterThan(-1)
  expect(text.indexOf('LEFT UNDONE')).toBeGreaterThan(text.indexOf('AT WORK'))
  expect(text.indexOf('ARTIFACTS')).toBeGreaterThan(text.indexOf('LEFT UNDONE'))
  expect((await seen($, 'terminal', PEOPLE)).text).not.toMatch(/LEFT UNDONE/)
})

// ---- Source 2: unfinished-work lines written into files ----

test('an Edit that adds a TODO is listed with the file and the line it landed on, the path shown from the project folder', async ($, on) => {
  const h = office(on)
  h.tool.answer = input => {
    if (input.tool === 'Edit') h.files.set('/repo/src/a.ts', 'a()\n// TODO: handle empty list\nb()\n')
    return { result: 'ok', text: 'Edited' }
  }
  await $.session.start(START)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a()', new_string: 'a()\n// TODO: handle empty list' } as never)
  await settle(h)
  const { words } = await seen($)
  expect(words).toContain('TODO: handle empty list')
  expect(words).toContain('File · src/a.ts:2 · Clawd')
  expect(stored(h)).toEqual([expect.objectContaining({ source: 'file', file: 'src/a.ts', line: 2 })])
})

test('a Write is read against the old file: only its new lines count, with their line in the new file', async ($, on) => {
  const h = office(on)
  h.files.set('/repo/tests/a.test.ts', "// TODO: already there\nit('a', f)\n")
  await $.session.start(START)
  const content = "// TODO: already there\nit('a', f)\nit.skip('b', f)\n"
  await $.tool.call({ tool: 'Write', file_path: '/repo/tests/a.test.ts', content } as never)
  await settle(h)
  const { words } = await seen($)
  expect(words).toContain("it.skip('b', f)")
  expect(words).toContain('File · tests/a.test.ts:3 · Clawd')
  expect(words).not.toContain('TODO: already there')
})

test('a Write of a new file, a MultiEdit and a notebook cell are read too; a file outside the project keeps its full path', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/elsewhere/x.py', content: 'def f():\n    raise NotImplementedError\n' } as never)
  await $.tool.call({ tool: 'MultiEdit', file_path: '/repo/m.ts', edits: [{ old_string: 'a', new_string: 'a // FIXME: one' }] } as never)
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/n.ipynb', new_source: '# TODO: plot it', edit_mode: 'insert' } as never)
  await settle(h)
  const { words } = await seen($)
  expect(words).toContain('raise NotImplementedError')
  expect(words).toContain('File · /elsewhere/x.py:2 · Clawd')
  expect(words).toContain('FIXME: one')
  expect(words).toContain('TODO: plot it')
  expect(words).toContain('File · n.ipynb · Clawd')
})

test('a write that failed or was refused, or one with nothing unfinished in it, adds nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  h.tool.answer = () => ({ result: 'boom', text: 'boom', isError: true })
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: '// TODO: lost\n' } as never)
  h.tool.answer = () => ({ deny: 'not allowed' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: '// TODO: refused' } as never)
  h.tool.answer = () => ({ result: 'ok', text: 'ok' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/a.ts', content: 'const todo = 1\n' } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo "// TODO: shell"' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await settle(h)
  expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)
})

test('the tool answers at once even when the file cannot be read back, and a specialist\'s write is filed under its name', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const { agentId } = await hire($)
  h.disk.isReadFailing = true
  const ran = await $.tool.call({ tool: 'Edit', agentId, file_path: '/repo/src/b.ts', old_string: 'a', new_string: 'a // TODO: later' } as never)
  expect(JSON.stringify(ran)).toContain('ok')
  await settle(h)
  const { words } = await seen($)
  expect(words).toContain('TODO: later')
  expect(words.some(w => /^File · src\/b\.ts · (?!Clawd)/.test(w))).toBe(true)
})

// ---- Source 3: the second check ----

test('after a turn with five tool calls, Haiku compares the request with the report; what it lists joins the list', async ($, on) => {
  const h = office(on, () => undone('Add the tests', 'Write the docs'))
  await $.session.start(START)
  await clawdTurn($, h, { request: 'Add login, tests and docs', tools: 5, answer: 'Added the login.' })
  expect(h.asked).toHaveLength(1)
  expect(h.asked[0]!.model).toBe('haiku')
  expect(h.asked[0]!.prompt).toContain('Add login, tests and docs')
  expect(h.asked[0]!.prompt).toContain('Added the login.')
  const { words } = await seen($)
  expect(words).toContain('LEFT UNDONE · 2')
  expect(words).toContain('Add the tests')
  expect(words).toContain('Second check · Clawd')
})

test('four tool calls, a specialist\'s tools, a step report and an aborted turn do not start a check; hiring a specialist does not either', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await clawdTurn($, h, { tools: 4 })
  await clawdTurn($, h, { tools: 3, extra: [{ tool: 'Read', agentId: 'a9', file_path: '/x' }, { tool: 'Read', agentId: 'a9', file_path: '/y' }, { tool: 'Read', agentId: 'a9', file_path: '/z' }] })
  await clawdTurn($, h, { tools: 3, extra: [{ tool: 'mcp__clawd-hq__step', done: 1, total: 2 }, { tool: 'mcp__clawd-hq__step', done: 2, total: 2 }] })
  await clawdTurn($, h, { tools: 5, extra: [{ tool: 'Agent', prompt: 'Do it', description: 'Do it', subagentType: 'ecc:tdd-guide' }] })
  expect(h.asked).toEqual([])
  expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)
})

test('an aborted turn with enough tool calls is not checked, and the counter starts over with the next turn', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await $.prompt.submit({ text: 'Do it', origin: { kind: 'composer' } } as never)
  await $.turn.start({ text: 'Do it', turnId: 'z1' } as never)
  for (let i = 0; i < 6; i += 1) await $.tool.call({ tool: 'Read', file_path: `/repo/${i}.ts` } as never)
  await $.turn.complete({ reason: 'aborted', answer: 'Partial.', turnId: 'z1', isAborted: true, durationMs: 1 } as never)
  await settle(h)
  await clawdTurn($, h, { tools: 2 })
  expect(h.asked).toEqual([])
})

test('with the setting off the check is not made, but the other two sources still are', { options: { leftUndone: false } }, async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await clawdTurn($, h, { tools: 6, answer: 'Done, but I skipped the docs.' })
  expect(h.asked).toEqual([])
  const { words } = await seen($)
  expect(words).toContain('LEFT UNDONE · 1')
  expect(words).toContain('Done, but I skipped the docs.')
})

test('a press of the Settings switch turns the check off for the rest of the session and is saved', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...SETTINGS })
  expect(JSON.stringify(await ui.drawn())).toContain('Left undone check')
  await ui.press({ key: 'config-leftUndone' })
  await ui.unmount()
  expect(h.saved.get('toggle:leftUndone')).toBe(false)
  await clawdTurn($, h, { tools: 6 })
  expect(h.asked).toEqual([])
})

test('a reply that is wrong, unsafe or empty, a model that fails and a model that throws all leave the list alone', async ($, on) => {
  const replies = [() => answered('sure! nothing to add'), () => undone('See https://evil.example.com for the rest'), () => ({ isAnswered: false, reason: 'api-error' }), () => { throw new Error('down') }]
  let call = 0
  const h = office(on, () => replies[call++]!())
  await $.session.start(START)
  for (let i = 0; i < replies.length; i += 1) await clawdTurn($, h, { tools: 5 })
  expect(h.asked).toHaveLength(4)
  expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)
})

test('the check is skipped when there is no request of the person\'s to compare with', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await $.turn.start({ text: 'Do it', turnId: 'n1' } as never)
  for (let i = 0; i < 5; i += 1) await $.tool.call({ tool: 'Read', file_path: `/repo/${i}.ts` } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 'n1', isAborted: false, durationMs: 1 } as never)
  await settle(h)
  expect(h.asked).toEqual([])
})

// ---- The list: newest first, no repeats, a cap, the buttons ----

test('newest first, a repeat is one item, and only the newest 30 are kept', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { answer: 'I skipped the docs.' })
  await h.clock.advance(60_000)
  await clawdTurn($, h, { answer: "I'll tidy the tests later." })
  await clawdTurn($, h, { answer: 'I skipped the docs!' })
  expect(stored(h).map(i => i.text)).toEqual(['I skipped the docs!', "I'll tidy the tests later."])
  for (let n = 0; n < LEFT_KEEP + 4; n += 1) await clawdTurn($, h, { answer: `I skipped the job number ${n} about thing${n}x.` })
  expect(stored(h).length).toBe(LEFT_KEEP)
})

test('the panel draws the newest 8 and says how many more there are; the heading counts all', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  for (let n = 0; n < 11; n += 1) await clawdTurn($, h, { answer: `I skipped the job number ${n} about thing${n}x.` })
  const { words, buttons } = await seen($)
  expect(words).toContain('LEFT UNDONE · 11')
  expect(buttons.filter(b => b === 'Do it now').length).toBe(8)
  expect(words).toContain('3 more')
  expect(words.filter(w => /^I skipped the job number/.test(w))[0]).toContain('number 10 ')
})

test('Do it now fills the prompt box with the exact sentence, never sends, and keeps the item', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { answer: 'I skipped the docs for now.' })
  for (const surface of SURFACES) {
    await press($, 'Do it now', surface)
    expect(h.fills.at(-1)).toEqual({ text: 'You left this undone: I skipped the docs for now. Do it now.', mode: 'append' })
  }
  expect(h.fills.length).toBe(2)
  expect(stored(h).length).toBe(1)
  expect(h.toasts).toEqual([])
})

test('Do it now on a file item names the file and line', async ($, on) => {
  const h = office(on)
  h.tool.answer = input => (input.tool === 'Edit' ? (h.files.set('/repo/src/a.ts', 'a()\n// TODO: handle empty list\n'), { result: 'ok', text: 'ok' }) : { result: 'ok' })
  await $.session.start(START)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a()', new_string: 'a()\n// TODO: handle empty list' } as never)
  await settle(h)
  await press($, 'Do it now')
  expect(h.fills.at(-1)?.text).toBe('You left this undone: TODO: handle empty list (src/a.ts:2). Do it now.')
})

test('Clear empties the list, the store and the section, and shows no toast', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { answer: 'I skipped the docs. I skipped the tests.' })
  expect((await seen($)).words).toContain('LEFT UNDONE · 2')
  await press($, 'Clear')
  await settle(h)
  expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)
  expect(stored(h)).toEqual([])
  expect(h.toasts).toEqual([])
})

test('no toast is shown when something is added', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await clawdTurn($, h, { tools: 5, answer: 'I skipped the docs.' })
  expect(h.toasts).toEqual([])
})

// ---- Kept per project, across sessions ----

test('the list belongs to the project folder and comes back with the next session; a stored list with bad entries is cleaned', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { answer: 'I skipped the docs.' })
  await $.session.start(OTHER)
  expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)
  await $.session.start(START)
  expect((await seen($)).words).toContain('LEFT UNDONE · 1')
  h.saved.set('leftUndone:/repo', [{ id: 'a', text: 'Kept', source: 'answer', by: 'Clawd', at: 5 }, 'junk', null, { id: 'b', text: 3 }])
  await $.session.start(START)
  const { words } = await seen($)
  expect(words).toContain('LEFT UNDONE · 1')
  expect(words).toContain('Kept')
})

test('a save that fails keeps the item for the session and says nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  h.kv.isWriteFailing = true
  await clawdTurn($, h, { answer: 'I skipped the docs.' })
  expect((await seen($)).words).toContain('LEFT UNDONE · 1')
  expect(h.toasts).toEqual([])
})
