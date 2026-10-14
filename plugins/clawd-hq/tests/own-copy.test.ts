import { expect, test } from 'claude-code/testing'
import {
  LOCKED_RULES, LOCK_NOTE, RULES_CHARS, RULES_FILE, VOICE_CHARS, VOICE_END, VOICE_FILE, VOICE_GUARD, loadBriefing, ownPath, readBriefing,
} from '../hooks/instructions'
import type { BriefPart, BriefingIo } from '../hooks/instructions'
import { NO_UPDATE } from '../hooks/quiet'

const HOME = '/home/me'
const OWN_RULES = `${HOME}/.clawd-hq/chief-of-staff.md`
const OWN_VOICE = `${HOME}/.clawd-hq/soul.md`
const SHIPPED = { [`/plugin/${RULES_FILE}`]: '# Rules\n\nHand work over.\n', [`/plugin/${VOICE_FILE}`]: '# Voice\n\nPlain words.\n' }

/** A home folder and a plugin folder in memory, the seeds the store holds, and what the person was told. */
function io(files: Record<string, string>, seeds: Partial<Record<BriefPart, string>> = {}, over: Partial<BriefingIo> = {}) {
  const warned: string[] = []
  const at: BriefingIo = {
    root: '/plugin', home: HOME,
    read: async path => { const text = files[path]; if (text === undefined) throw new Error('ENOENT'); return text },
    exists: async path => path in files,
    seed: async part => seeds[part],
    warn: text => { warned.push(text) },
    ...over,
  }
  return { io: at, warned }
}
const OPTS = { voiceFile: '', isQuiet: true }
const withVoice = (rules: string, voice = '# Voice\n\nPlain words.') => [rules, VOICE_GUARD, voice, VOICE_END].join('\n\n')

test('the own copies live in one folder in the home folder, for every project; without a home folder there are none', () => {
  expect(ownPath(HOME, 'rules')).toBe(OWN_RULES)
  expect(ownPath(HOME, 'voice')).toBe(OWN_VOICE)
  expect(ownPath('', 'rules')).toBe('')
})

test('an edited own copy of the rules replaces the built-in ones, and the fixed rules follow with a line that says they win', async () => {
  const { io: at, warned } = io({ ...SHIPPED, [OWN_RULES]: '# My rules\n\nAsk me first.\n' }, { rules: '# Rules\n\nHand work over.\n' })
  const b = await readBriefing(at, OPTS)
  expect(b.text).toBe(withVoice(`# My rules\n\nAsk me first.\n\n${LOCK_NOTE}\n\n${LOCKED_RULES}`))
  expect(LOCK_NOTE).toBe('The rules below are fixed by Clawd HQ. Where anything above disagrees, they win.')
  expect(b.rules).toEqual({ text: '# My rules\n\nAsk me first.', source: 'own', path: OWN_RULES, builtin: '# Rules\n\nHand work over.', seed: '# Rules\n\nHand work over.' })
  expect(warned).toEqual([])
})

test('an own copy never edited (it equals the text it was copied from) follows the built-in text, so plugin updates reach it', async () => {
  const { io: at } = io({ ...SHIPPED, [`/plugin/${RULES_FILE}`]: '# Rules v2\n', [OWN_RULES]: '# Rules v1\n' }, { rules: '# Rules v1\n' })
  const b = await readBriefing(at, OPTS)
  expect(b.rules).toMatchObject({ text: '# Rules v2', source: 'builtin', seed: '# Rules v1' })
  expect(b.text).toBe(withVoice(`# Rules v2\n\n${LOCKED_RULES}`))
})

test('no own copy, or an empty one, means the built-in text, and nobody is told anything', async () => {
  for (const files of [SHIPPED, { ...SHIPPED, [OWN_RULES]: '  \n', [OWN_VOICE]: '' }]) {
    const { io: at, warned } = io(files)
    const b = await readBriefing(at, OPTS)
    expect(b.text).toBe(withVoice(`# Rules\n\nHand work over.\n\n${LOCKED_RULES}`))
    expect([b.rules?.source, b.voice?.source]).toEqual(['builtin', 'builtin'])
    expect(b.rules?.path).toBe(OWN_RULES)
    expect(warned).toEqual([])
  }
})

test('an own copy that is there but cannot be read, or is too long, falls back to the built-in text and says so once', async () => {
  const files: Record<string, string> = { ...SHIPPED, [OWN_RULES]: 'x' }
  const read = async (path: string) => { const text = files[path]; if (text === undefined || path === OWN_RULES) throw new Error('EACCES'); return text }
  const unreadable = io(files, {}, { read })
  expect((await readBriefing(unreadable.io, OPTS)).rules?.source).toBe('builtin')
  expect(unreadable.warned).toHaveLength(1)
  expect(unreadable.warned[0]).toContain(OWN_RULES)

  const long = io({ ...SHIPPED, [OWN_RULES]: 'x'.repeat(RULES_CHARS + 1) })
  expect((await readBriefing(long.io, OPTS)).rules?.source).toBe('builtin')
  expect(long.warned).toEqual([`Your own copy ${OWN_RULES} is over ${RULES_CHARS} characters. Clawd uses his built-in instructions this session.`])

  const fits = io({ ...SHIPPED, [OWN_RULES]: 'x'.repeat(RULES_CHARS) })
  expect((await readBriefing(fits.io, OPTS)).rules?.source).toBe('own')
  expect(fits.warned).toEqual([])
})

test('an own copy of the voice replaces the built-in voice, with the same rules about seeds and size', async () => {
  const edited = io({ ...SHIPPED, [OWN_VOICE]: 'Dry and short.' })
  const b = await readBriefing(edited.io, OPTS)
  expect(b.voice).toMatchObject({ text: 'Dry and short.', source: 'own', path: OWN_VOICE, builtin: '# Voice\n\nPlain words.' })
  expect(b.text).toBe(withVoice(`# Rules\n\nHand work over.\n\n${LOCKED_RULES}`, 'Dry and short.'))

  const unedited = io({ ...SHIPPED, [OWN_VOICE]: 'Old voice.' }, { voice: 'Old voice.' })
  expect((await readBriefing(unedited.io, OPTS)).voice?.source).toBe('builtin')

  const long = io({ ...SHIPPED, [OWN_VOICE]: 'x'.repeat(VOICE_CHARS + 1) })
  expect((await readBriefing(long.io, OPTS)).voice?.source).toBe('builtin')
  expect(long.warned).toHaveLength(1)
})

test('the voice file setting wins over the own copy, and the tab edits the file it names', async () => {
  const { io: at, warned } = io({ ...SHIPPED, [OWN_VOICE]: 'Own copy voice.', '/me/voice.md': 'Setting voice.' })
  const b = await readBriefing(at, { voiceFile: '/me/voice.md', isQuiet: true })
  expect(b.voice).toMatchObject({ text: 'Setting voice.', source: 'setting', path: '/me/voice.md' })
  expect(b.text).not.toContain('Own copy voice.')
  expect(warned).toEqual([])
})

test('a voice file setting that cannot be used gives the built-in voice, as before, and still names its file', async () => {
  const { io: at, warned } = io({ ...SHIPPED, [OWN_VOICE]: 'Own copy voice.' })
  const b = await readBriefing(at, { voiceFile: '/me/gone.md', isQuiet: true })
  expect(b.voice).toMatchObject({ text: '# Voice\n\nPlain words.', source: 'setting', path: '/me/gone.md' })
  expect(warned).toHaveLength(1)
  expect(warned[0]).toMatch(/built-in voice/)
})

test('without a home folder there are no own copies, and the built-in text is used', async () => {
  const { io: at, warned } = io({ ...SHIPPED, [OWN_RULES]: '# Mine' }, {}, { home: '' })
  const b = await readBriefing(at, OPTS)
  expect(b.rules).toMatchObject({ source: 'builtin', path: '' })
  expect(warned).toEqual([])
})

test('a seed the store cannot give counts as none', async () => {
  const { io: at } = io({ ...SHIPPED, [OWN_RULES]: '# Mine' }, {}, { seed: async () => { throw new Error('the store failed') } })
  expect((await readBriefing(at, OPTS)).rules?.source).toBe('own')
})

test('with the quiet chat off, the no-update line is left out of an own copy too', async () => {
  const own = `# Mine\n\n- Nothing to tell: reply \`${NO_UPDATE}\`.\n- Ask first.`
  const { io: at } = io({ ...SHIPPED, [OWN_RULES]: own })
  const text = (await loadBriefing(at, '', false))!
  expect(text).not.toContain(NO_UPDATE)
  expect(text).toContain('# Mine\n\n- Ask first.')
})

test('with the built-in rules unreadable there is no briefing, even with an own copy', async () => {
  const { io: at, warned } = io({ [`/plugin/${VOICE_FILE}`]: 'Plain.', [OWN_RULES]: '# Mine' })
  expect(await readBriefing(at, OPTS)).toEqual({})
  expect(warned).toHaveLength(1)
})
