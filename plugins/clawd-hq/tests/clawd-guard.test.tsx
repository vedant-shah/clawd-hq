import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { SHIPPED_DENY } from '../hooks/clawd-edit'
import { host } from './host'

type On = Parameters<typeof host>[0]

const ROOT = new URL('..', (import.meta as unknown as { url: string }).url).pathname.replace(/\/$/, '')
const OWN_RULES = '/home/me/.clawd-hq/chief-of-staff.md'

/** The host with a home folder, a session that takes prompts with their hidden context, and tools that just run. */
function office(on: On) {
  const h = host(on)
  on('env.get', (_$, e) => ({ value: ({ HOME: '/home/me' } as Record<string, string>)[(e as { name: string }).name] }) as never)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text, context: (e as { context?: string[] }).context }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }))
  const ran: string[] = []
  on('tool.call', (_$, e) => (ran.push(String((e as { tool: string }).tool)), { result: 'ran' }) as never)
  return { ...h, ran }
}
const submit = async ($: Engine, text: string) => (await $.prompt.submit({ text } as never)) as { text: string; context?: string[] }
const turn = ($: Engine, text: string) => $.turn.start({ text, turnId: 't1' } as never)
const endTurn = ($: Engine) => $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', isAborted: false } as never)
const write = ($: Engine, path: string) => $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never) as Promise<{ deny?: string; result?: unknown }>

// ---- The hidden note ----

test('an edit request carries a note the person does not see: the file to edit and the guard rules; the visible text is untouched', async ($, on) => {
  office(on)
  const sent = 'Edit Clawd\'s instructions, "Bigger calls" section: drop the council'
  const r = await submit($, sent)
  expect(r.text).toBe(sent)
  expect(r.context).toHaveLength(1)
  expect(r.context![0]).toContain(OWN_RULES)
  expect(r.context![0]).toContain(`${ROOT}/prompts/chief-of-staff.md`)
  expect(r.context![0]).toMatch(/"Always" rules are fixed/)
})

test('a voice edit names the own voice copy, or the file the voice setting names', { options: { voiceFile: '/me/voice.md' } }, async ($, on) => {
  office(on)
  const r = await submit($, 'Edit Clawd\'s voice notes: warmer')
  expect(r.context![0]).toContain('/me/voice.md')
  expect(r.context![0]).not.toContain('/home/me/.clawd-hq/soul.md')
})

test('any other prompt goes in as it was, with no note', async ($, on) => {
  office(on)
  for (const text of ['Fix the login bug', 'Please Edit Clawd\'s instructions', '']) {
    expect((await submit($, text)).context).toBeUndefined()
  }
})

test('the note is added with the "You should know" check off too', { options: { youShouldKnow: false } }, async ($, on) => {
  office(on)
  expect((await submit($, 'Edit Clawd\'s instructions: shorter')).context).toHaveLength(1)
})

// ---- The block on the plugin's own files ----

test('during an edit request, writes to the plugin\'s built-in instruction files are refused; the own copy can be written', async ($, on) => {
  const { ran } = office(on)
  await turn($, 'Edit Clawd\'s instructions: hand over less')
  expect(await write($, `${ROOT}/prompts/chief-of-staff.md`)).toEqual({ deny: SHIPPED_DENY })
  expect(await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/prompts/soul.md`, old_string: 'a', new_string: 'b' } as never)).toEqual({ deny: SHIPPED_DENY })
  expect(await $.tool.call({ tool: 'Bash', command: `sed -i '' s/a/b/ ${ROOT}/prompts/soul.md` } as never)).toEqual({ deny: SHIPPED_DENY })
  expect(ran).toEqual([])
  expect(await write($, OWN_RULES)).toEqual({ result: 'ran' })
  expect(await $.tool.call({ tool: 'Read', file_path: `${ROOT}/prompts/chief-of-staff.md` } as never)).toEqual({ result: 'ran' })
  expect(ran).toEqual(['Write', 'Read'])
})

test('a specialist\'s write during the edit request is refused the same way', async ($, on) => {
  office(on)
  await turn($, 'Edit Clawd\'s voice notes: warmer')
  const r = await $.tool.call({ tool: 'Write', file_path: `${ROOT}/prompts/soul.md`, content: 'x', agentId: 'a1' } as never)
  expect(r).toEqual({ deny: SHIPPED_DENY })
})

test('once the edit request\'s turn ends, and in any other turn, the plugin\'s files can be worked on as usual', async ($, on) => {
  const { ran } = office(on)
  await turn($, 'Edit Clawd\'s instructions: hand over less')
  await endTurn($)
  expect(await write($, `${ROOT}/prompts/chief-of-staff.md`)).toEqual({ result: 'ran' })
  await turn($, 'Tidy the plugin\'s prompts/soul.md')
  expect(await write($, `${ROOT}/prompts/soul.md`)).toEqual({ result: 'ran' })
  expect(ran).toEqual(['Write', 'Write'])
})

test('a specialist\'s turn ending does not lift the block; a new turn of the main chat that is not an edit does', async ($, on) => {
  office(on)
  await turn($, 'Edit Clawd\'s instructions: hand over less')
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't2', agentId: 'a1', isAborted: false } as never)
  expect(await write($, `${ROOT}/prompts/chief-of-staff.md`)).toEqual({ deny: SHIPPED_DENY })
  await turn($, 'Something else')
  expect(await write($, `${ROOT}/prompts/chief-of-staff.md`)).toEqual({ result: 'ran' })
})
