import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LEFT_KEEP } from '../hooks/left-list'
import { RULES_FILE, VOICE_FILE } from '../hooks/instructions'
import { MUST_NOT_FLAG } from './left-false'
import { PANE, PEOPLE, SETTINGS, START, SURFACES, host } from './host'

// Left undone, end to end: it is rare, like "You should know", and an empty list is the normal state. Two sources only: a real
// code marker in the text a file tool newly wrote in a code file, and a strict second Haiku check of a long turn. Kept per project.

type On = Parameters<typeof host>[0]
type Ask = { model: string; system?: string; prompt: string; maxTokens?: number }
const USAGE = { input_tokens: 900, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answered = (text: string) => ({ isAnswered: true, text, usage: USAGE })
const undone = (...items: string[]) => answered(JSON.stringify({ undone: items }))
const OTHER = { cwd: '/other', surface: 'terminal', isInteractive: true } as never
const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')

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
/** A TODO comment added to a code file by Clawd, the file as it is afterwards put where the later read finds it. */
async function todo($: Engine, h: Office, text: string, file = '/repo/src/a.ts', agentId?: string) {
  h.tool.answer = input => (input.tool === 'Edit' ? (h.files.set(file, `a()\n// TODO: ${text}\n`), { result: 'ok', text: 'ok' }) : { result: 'ok', text: 'ok' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a()', new_string: `a()\n// TODO: ${text}`, ...(agentId === undefined ? {} : { agentId }) } as never)
  await settle(h)
}

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
const none = async ($: Engine) => expect((await seen($)).text).not.toMatch(/LEFT UNDONE/)

// ---- An empty list is the normal state ----

test('with nothing left undone the section is not drawn at all, not even its header', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { tools: 6, answer: 'All done. Nothing was skipped.' })
  for (const surface of SURFACES) expect((await seen($, surface)).text).not.toMatch(/LEFT UNDONE|Do it now|Clear/)
})

// ---- No phrase matching in answers ----

test('no answer is read for phrases: not the main chat\'s, not a specialist\'s, whatever it says', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const { agentId } = await hire($)
  const said = ["I'll wire up the retry logic later.", 'I skipped the desktop check.', 'TODO: handle the empty state.', 'The next step would be to add pagination.', 'You may want to add rate limiting.', ...MUST_NOT_FLAG]
  for (const answer of said) {
    await clawdTurn($, h, { answer })
    await handBack($, agentId, answer)
  }
  await settle(h)
  await none($)
  expect(stored(h)).toEqual([])
  expect(h.asked).toEqual([])
})

test('the six items that were all false are never listed: as answers, as notes in files, in any pane', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  for (const [n, text] of MUST_NOT_FLAG.entries()) {
    await clawdTurn($, h, { answer: text })
    await $.tool.call({ tool: 'Write', file_path: `/repo/README${n}.md`, content: `${text}\n// TODO: ${text}\n` } as never)
    await $.tool.call({ tool: 'Write', file_path: `/repo/docs/notes${n}.txt`, content: `# TODO: ${text}\n` } as never)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'x', new_string: `- ${text}` } as never)
  }
  await settle(h)
  for (const pane of [PANE, PEOPLE]) expect((await seen($, 'terminal', pane)).text).not.toMatch(/LEFT UNDONE/)
  expect(stored(h)).toEqual([])
})

// ---- Files: real code markers only ----

test('a TODO comment added to a code file is listed with the file and line, the path from the project folder, on both surfaces', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'handle empty list')
  for (const surface of SURFACES) {
    const { words } = await seen($, surface)
    expect(words).toContain('LEFT UNDONE · 1')
    expect(words).toContain('TODO: handle empty list')
    expect(words).toContain('File · src/a.ts:2 · Clawd')
  }
  expect(stored(h)).toEqual([expect.objectContaining({ source: 'file', file: 'src/a.ts', line: 2 })])
  expect(JSON.stringify(stored(h))).not.toContain('/repo')
})

test('FIXME, XXX, a skipped test and a not-implemented throw in code files are listed; a Write is read against the old file', async ($, on) => {
  const h = office(on)
  h.files.set('/repo/tests/a.test.ts', "// TODO: already there\nit('a', f)\n")
  await $.session.start(START)
  await $.tool.call({ tool: 'Write', file_path: '/repo/tests/a.test.ts', content: "// TODO: already there\nit('a', f)\nit.skip('b', f)\n" } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/lib/x.py', content: 'def f():\n    raise NotImplementedError\n' } as never)
  await $.tool.call({ tool: 'MultiEdit', file_path: '/repo/m.go', edits: [{ old_string: 'a', new_string: 'a // FIXME: one' }, { old_string: 'b', new_string: 'b // XXX: two' }] } as never)
  await settle(h)
  // Four items are kept; the panel draws the newest three.
  const kept = stored(h)
  expect(kept.map(i => i.text).sort()).toEqual(["FIXME: one", "XXX: two", "it.skip('b', f)", 'raise NotImplementedError'].sort())
  expect(kept.find(i => i.text === "it.skip('b', f)")).toEqual(expect.objectContaining({ file: 'tests/a.test.ts', line: 3 }))
  expect(kept.find(i => i.text === 'raise NotImplementedError')).toEqual(expect.objectContaining({ file: 'lib/x.py', line: 2 }))
  const { words } = await seen($)
  expect(words).toContain('LEFT UNDONE · 4')
  expect(words).toContain('1 more')
  expect(words).not.toContain('TODO: already there')
})

test('not code, not in the project, or in docs/: a README, a text file, a notebook, a file outside the project, docs/, node_modules/ give nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const line = '// TODO: later\n# FIXME: later\nit.skip(\'x\')\nthrow new Error(\'Not implemented\')\n'
  for (const file of ['/repo/README.md', '/repo/notes.txt', '/repo/guide.rst', '/repo/data.json', '/repo/Makefile', '/elsewhere/x.ts', '/repo/docs/example.ts', '/repo/node_modules/p/index.js', '/repo/../up.ts']) {
    await $.tool.call({ tool: 'Write', file_path: file, content: line } as never)
  }
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/repo/n.ipynb', new_source: '# TODO: plot it', edit_mode: 'insert' } as never)
  await settle(h)
  await none($)
  expect(stored(h)).toEqual([])
})

test('prose-looking and string-looking text in a code file is not a marker', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const content = ["const text = 'Left undone checks TODO and FIXME comments'", 'const s = "// TODO: shown to the user"', '// Items are merged when their words match', '// export is not implemented for csv', "const msg = 'not implemented'"].join('\n')
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/prose.ts', content } as never)
  await settle(h)
  await none($)
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
  await none($)
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

// ---- The second check: strict ----

test('after a turn with five tool calls, Haiku sets the request against the report; the one item it lists joins the list', async ($, on) => {
  const h = office(on, () => undone('Add the tests', 'Write the docs'))
  await $.session.start(START)
  await clawdTurn($, h, { request: 'Add login, tests and docs', tools: 5, answer: 'Added the login.' })
  expect(h.asked).toHaveLength(1)
  expect(h.asked[0]!.model).toBe('haiku')
  expect(h.asked[0]!.system).toMatch(/explicitly asked/i)
  expect(h.asked[0]!.prompt).toContain('Add login, tests and docs')
  expect(h.asked[0]!.prompt).toContain('Added the login.')
  const { words } = await seen($)
  expect(words).toContain('LEFT UNDONE · 1')
  expect(words).toContain('Add the tests')
  expect(words).not.toContain('Write the docs')
  expect(words).toContain('Second check · Clawd')
})

test('four tool calls, a specialist\'s tools, a step report and hiring a specialist do not start a check', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await clawdTurn($, h, { tools: 4 })
  await clawdTurn($, h, { tools: 3, extra: [{ tool: 'Read', agentId: 'a9', file_path: '/x' }, { tool: 'Read', agentId: 'a9', file_path: '/y' }, { tool: 'Read', agentId: 'a9', file_path: '/z' }] })
  await clawdTurn($, h, { tools: 3, extra: [{ tool: 'mcp__clawd-hq__step', done: 1, total: 2 }, { tool: 'mcp__clawd-hq__step', done: 2, total: 2 }] })
  await clawdTurn($, h, { tools: 5, extra: [{ tool: 'Agent', prompt: 'Do it', description: 'Do it', subagentType: 'ecc:tdd-guide' }] })
  expect(h.asked).toEqual([])
  await none($)
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

test('with the setting off the check is not made, and nothing is listed', { options: { leftUndone: false } }, async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await clawdTurn($, h, { tools: 6, answer: 'Done, but I skipped the docs.' })
  expect(h.asked).toEqual([])
  await none($)
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
  const replies = [() => answered('sure! nothing to add'), () => undone('See https://evil.example.com for the rest'), () => undone(), () => ({ isAnswered: false, reason: 'api-error' }), () => { throw new Error('down') }]
  let call = 0
  const h = office(on, () => replies[call++]!())
  await $.session.start(START)
  for (let i = 0; i < replies.length; i += 1) await clawdTurn($, h, { tools: 5 })
  expect(h.asked).toHaveLength(5)
  await none($)
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

// ---- The list: newest first, no repeats, small, the buttons ----

test('newest first, a repeat is one item, and only the newest 10 are kept', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'add rate limiting')
  await h.clock.advance(60_000)
  await todo($, h, 'write the docs', '/repo/src/b.ts')
  await todo($, h, 'add rate limiting!')
  expect(stored(h).map(i => i.text)).toEqual(['TODO: add rate limiting!', 'TODO: write the docs'])
  for (let n = 0; n < LEFT_KEEP + 4; n += 1) await todo($, h, `job number ${n} about thing${n}x`, `/repo/src/c${n}.ts`)
  expect(stored(h).length).toBe(LEFT_KEEP)
  expect(LEFT_KEEP).toBe(10)
})

test('the panel draws the newest 3 and says how many more there are; the heading counts all', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  for (let n = 0; n < 5; n += 1) await todo($, h, `job number ${n} about thing${n}x`, `/repo/src/c${n}.ts`)
  const { words, buttons } = await seen($)
  expect(words).toContain('LEFT UNDONE · 5')
  expect(buttons.filter(b => b === 'Do it now').length).toBe(3)
  expect(words).toContain('2 more')
  expect(words.filter(w => /^TODO: job number/.test(w))[0]).toContain('number 4 ')
})

test('the section is on the Office tab only, below the specialists and above the artifacts', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($)
  h.tool.answer = input => (input.tool === 'Artifact' ? { result: { url: 'https://claude.ai/artifact/abc' }, text: 'Created https://claude.ai/artifact/abc' } : { result: 'ok' })
  await $.tool.call({ tool: 'Artifact', title: 'Plan' } as never)
  await todo($, h, 'add docs')
  const { text } = await seen($)
  expect(text.indexOf('AT WORK')).toBeGreaterThan(-1)
  expect(text.indexOf('LEFT UNDONE')).toBeGreaterThan(text.indexOf('AT WORK'))
  expect(text.indexOf('ARTIFACTS')).toBeGreaterThan(text.indexOf('LEFT UNDONE'))
  expect((await seen($, 'terminal', PEOPLE)).text).not.toMatch(/LEFT UNDONE/)
})

test('Do it now fills the prompt box with the exact sentence, naming the file and line, never sends, and keeps the item', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'handle empty list')
  for (const surface of SURFACES) {
    await press($, 'Do it now', surface)
    expect(h.fills.at(-1)).toEqual({ text: 'You left this undone: TODO: handle empty list (src/a.ts:2). Do it now.', mode: 'append' })
  }
  expect(h.fills.length).toBe(2)
  expect(stored(h).length).toBe(1)
  expect(h.toasts).toEqual([])
})

test('Do it now on an item from the second check', async ($, on) => {
  const h = office(on, () => undone('Add the tests.'))
  await $.session.start(START)
  await clawdTurn($, h, { tools: 5 })
  await press($, 'Do it now')
  expect(h.fills.at(-1)?.text).toBe('You left this undone: Add the tests. Do it now.')
})

test('Clear empties the list, the store and the section, and shows no toast', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'one thing here')
  await todo($, h, 'another matter entirely', '/repo/src/b.ts')
  expect((await seen($)).words).toContain('LEFT UNDONE · 2')
  await press($, 'Clear')
  await settle(h)
  await none($)
  expect(stored(h)).toEqual([])
  expect(h.toasts).toEqual([])
})

test('no toast is shown when something is added', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  // Clawd's own instructions are there, as in a real install: a first message may read them (hooks/rules-reach.ts).
  h.files.set(`${ROOT}/${RULES_FILE}`, '# Clawd')
  h.files.set(`${ROOT}/${VOICE_FILE}`, 'Plain words.')
  await $.session.start(START)
  await clawdTurn($, h, { tools: 5 })
  await todo($, h, 'handle empty list')
  expect(h.toasts).toEqual([])
})

// ---- Kept per project, across sessions ----

test('the list belongs to the project folder and comes back with the next session', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'handle empty list')
  await $.session.start(OTHER)
  await none($)
  await $.session.start(START)
  expect((await seen($)).words).toContain('LEFT UNDONE · 1')
})

test('on the first load after this change the user\'s old list is cleaned: answer items, README and docs items, full local paths go; real code items stay', async ($, on) => {
  const h = office(on)
  h.saved.set('leftUndone:/repo', [
    { id: 'a1', text: "lines in an answer that put something off, like I'll do that later", source: 'answer', by: 'Clawd', at: 9 },
    { id: 'a2', text: 'whether a TODO you write shows up with the right line', source: 'answer', by: 'Clawd', at: 9 },
    { id: 'a3', text: 'Items are merged when about 70% of their words match', source: 'answer', by: 'Generalist', at: 9 },
    { id: 'f1', text: '- It keeps a "Left undone" list on the Office tab', source: 'file', by: 'Generalist', at: 8, file: '/Users/someone/work/clawd/README.md', line: 69 },
    { id: 'f2', text: 'TODO: full path', source: 'file', by: 'Generalist', at: 8, file: '/Users/someone/work/clawd/src/a.ts', line: 3 },
    { id: 'f3', text: 'TODO: kept', source: 'file', by: 'Builder', at: 7, file: 'src/a.ts', line: 4 },
    'junk', null,
  ])
  await $.session.start(START)
  const { words, text } = await seen($)
  expect(words).toContain('LEFT UNDONE · 1')
  expect(words).toContain('TODO: kept')
  expect(text).not.toMatch(/do that later|README|70%|\/Users|Items are merged/)
  // Only the cleaned list is ever written back.
  await todo($, h, 'one more matter')
  expect(stored(h).map(i => i.text)).toEqual(['TODO: one more matter', 'TODO: kept'])
})

test('when every saved item is old the section is gone, header and all', async ($, on) => {
  const h = office(on)
  h.saved.set('leftUndone:/repo', [{ id: 'a1', text: "I'll do that later", source: 'answer', by: 'Clawd', at: 9 }])
  await $.session.start(START)
  await none($)
})

test('a save that fails keeps the item for the session and says nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  h.kv.isWriteFailing = true
  await todo($, h, 'handle empty list')
  expect((await seen($)).words).toContain('LEFT UNDONE · 1')
  expect(h.toasts).toEqual([])
})
