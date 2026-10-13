import { expect, test } from 'claude-code/testing'
import { RULES_FILE, SECTION_ID, VOICE_END, VOICE_FILE, VOICE_GUARD } from '../hooks/instructions'
import { host } from './host'

type Engine = Parameters<Parameters<typeof test>[1]>[0]
type Files = Map<string, string>
const BASE = { id: 'intro', text: 'You are Claude Code.', scope: 'shared' } as const

/** The plugin's own folder: the one above this file's. */
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

/** The plugin's two shipped files, in the host's memory. */
function ship(files: Files) {
  files.set(`${ROOT}/${RULES_FILE}`, '# Clawd, chief of staff\n\nHand real work over.\n')
  files.set(`${ROOT}/${VOICE_FILE}`, '# Clawd\'s voice\n\nPlain words.\n')
}
/** A request for the system prompt, as the engine makes one. */
const compose = ($: Engine, traits: string[] = []) =>
  $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits } as never)
const ours = async ($: Engine, traits: string[] = []) => (await compose($, traits)).sections.find(s => s.id === SECTION_ID)

test('the main chat\'s instructions end with Clawd\'s rules and voice, as a session section', async ($, on) => {
  const { files, toasts } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  ship(files)
  const { sections } = await compose($)
  expect(sections.map(s => s.id)).toEqual(['intro', SECTION_ID])
  expect(sections[1]!.scope).toBe('session')
  expect(sections[1]!.text).toBe(`# Clawd, chief of staff\n\nHand real work over.\n\n${VOICE_GUARD}\n\n# Clawd's voice\n\nPlain words.\n\n${VOICE_END}`)
  expect(toasts).toEqual([])
})

test('the text is read once and is the same on every request, so the prompt cache holds', async ($, on) => {
  const { files } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  ship(files)
  const first = (await ours($))!.text
  files.set(`${ROOT}/${VOICE_FILE}`, 'Changed mid-session.')
  expect((await ours($))!.text).toBe(first)
})

test('with the chief of staff option off, the instructions are left as they were', { options: { chiefOfStaff: false } }, async ($, on) => {
  const { files } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  ship(files)
  expect((await compose($)).sections).toEqual([BASE])
})

test('a voice file of the person\'s own replaces the shipped voice', { options: { voiceFile: '/me/voice.md' } }, async ($, on) => {
  const { files, toasts } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  ship(files)
  files.set('/me/voice.md', 'Short and dry.')
  const text = (await ours($))!.text
  expect(text).toContain('Hand real work over.')
  expect(text.endsWith(`${VOICE_GUARD}\n\nShort and dry.\n\n${VOICE_END}`)).toBe(true)
  expect(text).not.toContain('Plain words.')
  expect(toasts).toEqual([])
})

test('a voice file that cannot be read falls back to the shipped voice and tells the person once', { options: { voiceFile: '/me/gone.md' } }, async ($, on) => {
  const { files, toasts } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  ship(files)
  expect((await ours($))!.text).toContain('Plain words.')
  await ours($)
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain('/me/gone.md')
})

test('a bare session and a teammate keep their instructions untouched', async ($, on) => {
  const { files } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  ship(files)
  expect(await ours($, ['bare'])).toBeUndefined()
  expect(await ours($, ['teammate'])).toBeUndefined()
  expect(await ours($, ['skills'])).toBeDefined()
})

test('with its own files unreadable the plugin leaves the instructions alone, tells the person once, and does not throw', async ($, on) => {
  const { toasts } = host(on)
  on('prompt.compose', () => ({ sections: [BASE] }))
  expect((await compose($)).sections).toEqual([BASE])
  expect((await compose($)).sections).toEqual([BASE])
  expect(toasts).toHaveLength(1)
})
