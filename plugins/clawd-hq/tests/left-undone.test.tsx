import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { LEFT_KEEP } from '../hooks/left-list'
import { RULES_FILE, VOICE_FILE } from '../hooks/instructions'
import { MUST_NOT_FLAG } from './left-false'
import { PANE, PEOPLE, SETTINGS, START, SURFACES, host } from './host'

// Left undone, end to end: it is rare, like "You should know", and an empty list is the normal state. One live source: a real
// code marker in the text a file tool newly wrote in a code file (the model check is retired). TODO, FIXME and XXX show as one dim line. Kept per project.

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

/** A skipped test added to a test file by Clawd: a row of its own in the fold, unlike a TODO. */
async function skipped($: Engine, h: Office, name: string, file: string) {
  const line = `it.skip('${name}', f)`
  h.tool.answer = input => (input.tool === 'Edit' ? (h.files.set(file, `a()\n${line}\n`), { result: 'ok', text: 'ok' }) : { result: 'ok', text: 'ok' })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a()', new_string: `a()\n${line}` } as never)
  await settle(h)
}

/** Opens the Later fold if it is closed: its items are drawn only while it is open. The state is kept for the session, so a second call leaves it open. */
async function openLater($: Engine, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const toggle = await ui.find({ key: 'later-toggle' })
  if (toggle?.props.label === 'show') await ui.press({ key: 'later-toggle' })
  await ui.unmount()
}

async function seen($: Engine, surface: 'terminal' | 'desktop' = 'terminal', pane = PANE) {
  if (pane === PANE) await openLater($, surface)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
  const words = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String(b.text))
  await ui.unmount()
  return { words, buttons, text: words.join('\n') }
}
async function press($: Engine, text: string, surface: 'terminal' | 'desktop' = 'terminal') {
  await openLater($, surface)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const one = await ui.find({ type: 'Button', text })
  if (!one?.key) throw new Error(`no ${text} button`)
  await ui.press({ key: one.key })
  await ui.unmount()
}
const stored = (h: Office, folder = '/repo') => (h.saved.get(`leftUndone:${folder}`) ?? []) as Array<{ text: string; source: string; file?: string; line?: number }>
const none = async ($: Engine) => expect((await seen($)).text).not.toMatch(/LATER/)

// ---- An empty list is the normal state ----

test('with nothing left undone the section is not drawn at all, not even its header', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await clawdTurn($, h, { tools: 6, answer: 'All done. Nothing was skipped.' })
  for (const surface of SURFACES) expect((await seen($, surface)).text).not.toMatch(/LATER|Do it now|Clear/)
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
  for (const pane of [PANE, PEOPLE]) expect((await seen($, 'terminal', pane)).text).not.toMatch(/LATER/)
  expect(stored(h)).toEqual([])
})

// ---- Files: real code markers only ----

test('a TODO comment added to a code file is listed with the file and line, the path from the project folder, on both surfaces', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'handle empty list')
  for (const surface of SURFACES) {
    const { words } = await seen($, surface)
    expect(words).toContain('LATER · 1')
    expect(words).toContain('1 code marker (TODO)')
    expect(words).not.toContain('TODO: handle empty list')
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
  // Four items are kept; the open fold draws all four.
  const kept = stored(h)
  expect(kept.map(i => i.text).sort()).toEqual(["FIXME: one", "XXX: two", "it.skip('b', f)", 'raise NotImplementedError'].sort())
  expect(kept.find(i => i.text === "it.skip('b', f)")).toEqual(expect.objectContaining({ file: 'tests/a.test.ts', line: 3 }))
  expect(kept.find(i => i.text === 'raise NotImplementedError')).toEqual(expect.objectContaining({ file: 'lib/x.py', line: 2 }))
  const { words } = await seen($)
  // Skipped tests and not-implemented stay rows; the two markers are one dim line.
  expect(words).toContain('LATER · 3')
  expect(words.filter(w => /^File · /.test(w))).toHaveLength(2)
  expect(words).toContain('2 code markers (FIXME, XXX)')
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
  expect(stored(h)).toEqual([expect.objectContaining({ text: 'TODO: later', file: 'src/b.ts' })])
  expect(stored(h)[0]).not.toMatchObject({ by: 'Clawd' })
  expect((await seen($)).words).toContain('1 code marker (TODO)')
})

// ---- The second check: strict ----

test('the model check is retired: long turns, with the setting on or off, never call a model, list nothing and write no log', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  await $.session.start(START)
  await clawdTurn($, h, { request: 'Add login, tests and docs', tools: 6, answer: 'Added the login.' })
  await clawdTurn($, h, { tools: 5, extra: [{ tool: 'Agent', prompt: 'Do it', description: 'Do it', subagentType: 'ecc:tdd-guide' }] })
  expect(h.asked).toEqual([])
  expect(h.saved.has('leftUndone:log:/repo')).toBe(false)
  await none($)
})

test('the setting stays: a press of the Settings switch is still saved', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...SETTINGS })
  expect(JSON.stringify(await ui.drawn())).toContain('Left undone check')
  await ui.press({ key: 'config-leftUndone' })
  await ui.unmount()
  expect(h.saved.get('toggle:leftUndone')).toBe(false)
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

test('the open fold draws every kept item, newest first; the heading counts all', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  for (let n = 0; n < 5; n += 1) await skipped($, h, `job number ${n} about thing${n}x`, `/repo/src/c${n}.test.ts`)
  const { words, buttons } = await seen($)
  expect(words).toContain('LATER · 5')
  expect(buttons.filter(b => b === 'Do it now').length).toBe(5)
  expect(buttons.filter(b => b === 'Dismiss').length).toBe(5)
  expect(words).not.toContain('2 more')
  expect(words.filter(w => /^it\.skip/.test(w))[0]).toContain('number 4 ')
})

test('TODO, FIXME and XXX are one dim line, "N code markers (kinds)", in the open fold: no rows, no Do it now of their own; skipped tests stay rows', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'handle empty list')
  await todo($, h, 'tidy this', '/repo/src/b.ts')
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/c.ts', old_string: 'a', new_string: 'a // FIXME: broken' } as never)
  await skipped($, h, 'later test', '/repo/src/d.test.ts')
  const { words, buttons } = await seen($)
  expect(words).toContain('LATER · 2')
  expect(words).toContain('3 code markers (TODO, FIXME)')
  expect(words.some(w => /TODO: handle|TODO: tidy|FIXME: broken/.test(w))).toBe(false)
  expect(buttons.filter(b => b === 'Do it now')).toHaveLength(1)
  expect(stored(h)).toHaveLength(4)
})

test('with only code markers the fold still shows: "1 later" closed, the one line open', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await todo($, h, 'handle empty list')
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect((await ui.findAll({ type: 'Text' })).map(t => String(t.text))).toContain('LATER · 1')
  await ui.unmount()
  expect((await seen($)).words).toContain('1 code marker (TODO)')
})

test('the section is on the Office tab only, below the specialists (the artifacts are on the History tab now)', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($)
  h.tool.answer = input => (input.tool === 'Artifact' ? { result: { url: 'https://claude.ai/artifact/abc' }, text: 'Created https://claude.ai/artifact/abc' } : { result: 'ok' })
  await $.tool.call({ tool: 'Artifact', title: 'Plan' } as never)
  await todo($, h, 'add docs')
  const { text } = await seen($)
  expect(text.indexOf('AT WORK')).toBeGreaterThan(-1)
  expect(text.indexOf('LATER')).toBeGreaterThan(text.indexOf('AT WORK'))
  expect(text).not.toContain('ARTIFACTS')
  expect((await seen($, 'terminal', PEOPLE)).text).not.toMatch(/LATER/)
})

test('Do it now fills the prompt box with the exact sentence, naming the file and line, never sends, and keeps the item', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await skipped($, h, 'handle empty list', '/repo/src/a.test.ts')
  for (const surface of SURFACES) {
    await press($, 'Do it now', surface)
    expect(h.fills.at(-1)).toEqual({ text: "You left this undone: it.skip('handle empty list', f) (src/a.test.ts:2). Do it now.", mode: 'append' })
  }
  expect(h.fills.length).toBe(2)
  expect(stored(h).length).toBe(1)
  expect(h.toasts).toEqual([])
})

test('Do it now on an item from the second check', async ($, on) => {
  const h = office(on)
  h.saved.set('leftUndone:/repo', [{ id: 'k1', text: 'Add the tests.', source: 'check', by: 'Clawd', at: 7 }])
  await $.session.start(START)
  await press($, 'Do it now')
  expect(h.fills.at(-1)?.text).toBe('You left this undone: Add the tests. Do it now.')
})

test('Clear empties the list, the store and the section, and shows no toast', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await skipped($, h, 'one thing here', '/repo/src/a.test.ts')
  await todo($, h, 'another matter entirely', '/repo/src/b.ts')
  expect((await seen($)).words).toContain('LATER · 2')
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
  expect((await seen($)).words).toContain('LATER · 1')
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
  expect(words).toContain('LATER · 1')
  expect(words).toContain('1 code marker (TODO)')
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
  expect((await seen($)).words).toContain('LATER · 1')
  expect(h.toasts).toEqual([])
})

// ---- Items the retired check stored stay until dismissed ----

test('an item the retired check stored stays in the list, with its note, and can be dismissed; nothing new is added by a long turn', async ($, on) => {
  const h = office(on, () => undone('Add the tests'))
  h.saved.set('leftUndone:/repo', [{ id: 'k1', text: 'Add the tests.', source: 'check', by: 'Clawd', at: 7 }])
  await $.session.start(START)
  await clawdTurn($, h, { tools: 6 })
  const { words } = await seen($)
  expect(words).toContain('Add the tests.')
  expect(words).toContain('Second check · Clawd')
  await press($, 'Dismiss')
  expect(stored(h)).toEqual([])
})
