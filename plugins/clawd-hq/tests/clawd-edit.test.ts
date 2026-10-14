import { expect, test } from 'claude-code/testing'
import {
  BOX_BUSY, DIALOG_OPEN, SHIPPED_DENY, blocksOf, clawdActions, editContext, editPartOf, editPath, isShippedWrite, partView, promptOf,
  readyText, refreshClawd, sectionsOf, toggled,
} from '../hooks/clawd-edit'
import type { ClawdIo } from '../hooks/clawd-edit'
import type { Briefing, PartRead } from '../hooks/instructions'
import { RULES_CHARS, VOICE_CHARS } from '../hooks/instructions'
import type { ClawdBrief } from '../types'

// ---- Sections and how their text is shown ----

test('a text splits at its "## " headings; what comes before the first is kept as the intro', () => {
  const text = '# Clawd\n\nYou are Clawd.\n\n## What you do\n\n- Talk.\n- Plan.\n\n## When to hand over\n\nOften.\n### Not a split\nStill here.'
  expect(sectionsOf(text)).toEqual({
    intro: '# Clawd\n\nYou are Clawd.',
    sections: [
      { heading: 'What you do', body: '- Talk.\n- Plan.' },
      { heading: 'When to hand over', body: 'Often.\n### Not a split\nStill here.' },
    ],
  })
})

test('a text with no headings is all intro, and an empty one is nothing', () => {
  expect(sectionsOf('Just words.\nMore words.')).toEqual({ intro: 'Just words.\nMore words.', sections: [] })
  expect(sectionsOf('')).toEqual({ intro: '', sections: [] })
  expect(sectionsOf('## Only\r\nBody\r\n')).toEqual({ intro: '', sections: [{ heading: 'Only', body: 'Body' }] })
})

test('a section\'s text becomes blocks to draw: bullets, paragraphs and titles, with marks for bold and code taken out', () => {
  const body = '# Title\n\nA **bold** start and `code`,\nwrapped on two lines.\n\n- One `thing`.\n- Two.\n\n### Sub\nAfter.'
  expect(blocksOf(body)).toEqual([
    { kind: 'title', text: 'Title', isSpaced: false },
    { kind: 'para', text: 'A bold start and code, wrapped on two lines.', isSpaced: true },
    { kind: 'bullet', text: 'One thing.', isSpaced: true },
    { kind: 'bullet', text: 'Two.', isSpaced: false },
    { kind: 'title', text: 'Sub', isSpaced: true },
    { kind: 'para', text: 'After.', isSpaced: false },
  ])
  expect(blocksOf('')).toEqual([])
  expect(blocksOf('* Star bullet\n  continued')).toEqual([{ kind: 'bullet', text: 'Star bullet continued', isSpaced: false }])
})

test('a fold opens and closes by its key, without touching the list it was given', () => {
  const open = ['rules:A']
  expect(toggled(open, 'rules:B')).toEqual(['rules:A', 'rules:B'])
  expect(toggled(open, 'rules:A')).toEqual([])
  expect(toggled(undefined, 'voice:X')).toEqual(['voice:X'])
  expect(open).toEqual(['rules:A'])
})

// ---- What goes in the prompt box, and what Claude is told with it ----

test('the ready-made prompts start with one of two fixed openings, per part or per section', () => {
  expect(promptOf({ part: 'rules' })).toBe('Edit Clawd\'s instructions: ')
  expect(promptOf({ part: 'voice' })).toBe('Edit Clawd\'s voice notes: ')
  expect(promptOf({ part: 'rules', heading: 'When to hand work over' })).toBe('Edit Clawd\'s instructions, "When to hand work over" section: ')
  expect(promptOf({ part: 'voice', heading: 'How you speak' })).toBe('Edit Clawd\'s voice notes, "How you speak" section: ')
})

test('a sent prompt is an edit request only when it starts with one of the openings', () => {
  expect(editPartOf('Edit Clawd\'s instructions: hand over less')).toBe('rules')
  expect(editPartOf('  Edit Clawd\'s instructions, "Bigger calls" section: drop it')).toBe('rules')
  expect(editPartOf('Edit Clawd\'s voice notes: be warmer')).toBe('voice')
  expect(editPartOf('Please Edit Clawd\'s instructions')).toBeUndefined()
  expect(editPartOf('edit clawd\'s instructions')).toBeUndefined()
  expect(editPartOf('')).toBeUndefined()
})

test('the file to edit: the own copy in the home folder, or for the voice the file the setting names', () => {
  expect(editPath('rules', '/home/me', '/me/voice.md')).toBe('/home/me/.clawd-hq/chief-of-staff.md')
  expect(editPath('voice', '/home/me', '/me/voice.md')).toBe('/me/voice.md')
  expect(editPath('voice', '/home/me', '')).toBe('/home/me/.clawd-hq/soul.md')
  expect(editPath('rules', '', '')).toBe('')
})

test('the note Claude gets with an edit request names the file, the guard rules, the size limit and when it applies', () => {
  const rules = editContext('rules', '/home/me/.clawd-hq/chief-of-staff.md', '/plugin/prompts/chief-of-staff.md')
  expect(rules).toContain('/home/me/.clawd-hq/chief-of-staff.md')
  expect(rules).toMatch(/Never edit files in the Clawd HQ plugin folder/)
  expect(rules).toMatch(/"Always" rules are fixed/)
  expect(rules).toMatch(/Keep the "## " headings/)
  expect(rules).toContain(`${RULES_CHARS} characters`)
  expect(rules).toMatch(/next session or after \/clear/)
  expect(rules).toMatch(/yourself/)
  expect(rules).toContain('/plugin/prompts/chief-of-staff.md')
  const voice = editContext('voice', '/me/voice.md', '/plugin/prompts/soul.md')
  expect(voice).toContain('/me/voice.md')
  expect(voice).toContain(`${VOICE_CHARS} characters`)
  expect(voice).toMatch(/tone only/)
  const nowhere = editContext('rules', '', '/plugin/prompts/chief-of-staff.md')
  expect(nowhere).toMatch(/no home folder/)
})

test('writes to the plugin\'s shipped instruction files are spotted, by any file tool or a shell command naming them', () => {
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    expect(isShippedWrite(tool, { file_path: '/plugins/clawd-hq/prompts/chief-of-staff.md' })).toBe(true)
    expect(isShippedWrite(tool, { file_path: 'prompts/soul.md' })).toBe(true)
    expect(isShippedWrite(tool, { file_path: 'C:\\clawd-hq\\prompts\\Soul.md' })).toBe(true)
    expect(isShippedWrite(tool, { file_path: '/home/me/.clawd-hq/chief-of-staff.md' })).toBe(false)
    expect(isShippedWrite(tool, { file_path: '/repo/prompts/soul.md.bak' })).toBe(false)
  }
  expect(isShippedWrite('NotebookEdit', { notebook_path: '/p/prompts/soul.md' })).toBe(true)
  expect(isShippedWrite('Bash', { command: 'sed -i "" s/a/b/ "$ROOT/prompts/chief-of-staff.md"' })).toBe(true)
  expect(isShippedWrite('Bash', { command: 'cp ~/.clawd-hq/soul.md /tmp/x' })).toBe(false)
  expect(isShippedWrite('Read', { file_path: '/p/prompts/soul.md' })).toBe(false)
  expect(isShippedWrite('Write', { file_path: 7 })).toBe(false)
  expect(SHIPPED_DENY).toMatch(/own copy/)
})

// ---- The view the tab draws ----

const part = (over: Partial<PartRead> = {}): PartRead => ({ text: 'Rules', source: 'builtin', path: '/h/.clawd-hq/chief-of-staff.md', builtin: 'Rules', ...over })

test('a part is "changed" when the text now differs from what this session loaded, and "newer" when the built-in moved past its seed', () => {
  expect(partView(part(), part())).toEqual({ text: 'Rules', source: 'builtin', path: '/h/.clawd-hq/chief-of-staff.md', isChanged: false, isNewer: false })
  expect(partView(part({ text: 'Mine', source: 'own' }), part()).isChanged).toBe(true)
  expect(partView(part({ text: 'Mine', source: 'own' }), undefined).isChanged).toBe(false)
  expect(partView(part({ text: 'Mine', source: 'own', seed: 'Old rules' }), undefined).isNewer).toBe(true)
  expect(partView(part({ text: 'Mine', source: 'own', seed: 'Rules' }), undefined).isNewer).toBe(false)
  expect(partView(part({ seed: 'Old rules' }), undefined).isNewer).toBe(false)
})

// ---- The steps behind the buttons, on a home folder and a prompt box in memory ----

type Box = { text: string; filled: string[]; answer: { isFilled: boolean; refusal?: 'no_composer' | 'dialog' } }

function fake(over: Partial<{ voiceFile: string; home: string; isOn: boolean; loaded: Briefing }> = {}) {
  const files = new Map<string, string>([['/plugin/prompts/chief-of-staff.md', '# Rules\n\n## A\n\nDo A.\n'], ['/plugin/prompts/soul.md', '# Voice\n\nPlain.\n']])
  const seeds = new Map<string, string>()
  const box: Box = { text: '', filled: [], answer: { isFilled: true } }
  const disk = { isWriteFailing: (_path: string) => false }
  let state: ClawdBrief = { isOn: true }
  const home = over.home ?? '/home/me'
  const io: ClawdIo = {
    isOn: over.isOn ?? true,
    voiceFile: over.voiceFile ?? '',
    briefing: { root: '/plugin', home, warn: () => undefined, read: async p => { const t = files.get(p); if (t === undefined) throw new Error('ENOENT'); return t }, exists: async p => files.has(p), seed: async k => seeds.get(k) },
    loaded: async () => over.loaded,
    write: async (path, text) => { if (disk.isWriteFailing(path)) throw new Error('EACCES'); files.set(path, text) },
    setSeed: async (p, text) => { seeds.set(p, text) },
    promptRead: async () => ({ text: box.text }),
    fill: async text => { if (box.answer.isFilled) box.filled.push(text); return box.answer },
    get: async () => state,
    set: async fn => { state = fn(state) },
  }
  return { io, files, seeds, box, disk, state: () => state }
}
const OWN_RULES = '/home/me/.clawd-hq/chief-of-staff.md'
const OWN_VOICE = '/home/me/.clawd-hq/soul.md'

test('pressing edit with an empty box makes the own copy from the built-in text, keeps its seed, and fills the line without sending', async () => {
  const { io, files, seeds, box, state } = fake()
  await clawdActions(io).editClawd({ part: 'rules' }, true)
  expect(files.get(OWN_RULES)).toBe('# Rules\n\n## A\n\nDo A.\n')
  expect(seeds.get('rules')).toBe('# Rules\n\n## A\n\nDo A.')
  expect(box.filled).toEqual(['Edit Clawd\'s instructions: '])
  expect(state().notice).toEqual({ text: readyText(true) })
  expect(readyText(true)).toBe('Ready in your prompt box. Press Esc, finish the sentence, then Enter.')
  expect(readyText(false)).not.toMatch(/Esc/)
  // The fresh copy still equals its seed, so the tab keeps calling it the built-in text.
  expect(state().rules).toMatchObject({ source: 'builtin', path: OWN_RULES })
})

test('an edited own copy is never written over; an unedited one from an older built-in is brought up to date first', async () => {
  const edited = fake()
  edited.files.set(OWN_RULES, '# Mine\n')
  await clawdActions(edited.io).editClawd({ part: 'rules', heading: 'A' }, false)
  expect(edited.files.get(OWN_RULES)).toBe('# Mine\n')
  expect(edited.box.filled).toEqual(['Edit Clawd\'s instructions, "A" section: '])

  const stale = fake()
  stale.files.set(OWN_RULES, '# Old rules\n')
  stale.seeds.set('rules', '# Old rules')
  await clawdActions(stale.io).editClawd({ part: 'rules' }, false)
  expect(stale.files.get(OWN_RULES)).toBe('# Rules\n\n## A\n\nDo A.\n')
  expect(stale.seeds.get('rules')).toBe('# Rules\n\n## A\n\nDo A.')
})

test('with text already in the prompt box nothing is filled or written, and the panel says why', async () => {
  const { io, files, box, state } = fake()
  box.text = 'half a thought'
  await clawdActions(io).editClawd({ part: 'voice' }, true)
  expect(box.filled).toEqual([])
  expect(files.has(OWN_VOICE)).toBe(false)
  expect(state().notice).toEqual({ text: BOX_BUSY })
  expect(BOX_BUSY).toBe('Your prompt box already has text. Send or clear it, then press again.')
})

test('a box the host refuses: under an open question the person is told to answer it; with no box, the line to type is shown', async () => {
  const dialog = fake()
  dialog.box.answer = { isFilled: false, refusal: 'dialog' }
  await clawdActions(dialog.io).editClawd({ part: 'rules' }, true)
  expect(dialog.state().notice).toEqual({ text: DIALOG_OPEN })
  expect(DIALOG_OPEN).toBe('A question is open in the chat. Answer it, then press again.')

  for (const answer of [{ isFilled: false, refusal: 'no_composer' as const }, { isFilled: false }]) {
    const none = fake()
    none.box.answer = answer
    await clawdActions(none.io).editClawd({ part: 'voice' }, false)
    expect(none.state().notice).toEqual({ text: 'Type this in the chat:', line: 'Edit Clawd\'s voice notes: ' })
  }
})

test('with the voice file setting, edit goes to that file: no own copy is made', async () => {
  const { io, files, box } = fake({ voiceFile: '/me/voice.md' })
  await clawdActions(io).editClawd({ part: 'voice' }, true)
  expect(files.has(OWN_VOICE)).toBe(false)
  expect(box.filled).toEqual(['Edit Clawd\'s voice notes: '])
})

test('an own copy that cannot be written, or no home folder, stops before the box is filled, and says so', async () => {
  const failing = fake()
  failing.disk.isWriteFailing = () => true
  await clawdActions(failing.io).editClawd({ part: 'rules' }, true)
  expect(failing.box.filled).toEqual([])
  expect(failing.state().notice?.text).toContain(OWN_RULES)

  const homeless = fake({ home: '' })
  await clawdActions(homeless.io).editClawd({ part: 'rules' }, true)
  expect(homeless.box.filled).toEqual([])
  expect(homeless.state().notice?.text).toMatch(/home folder/)
})

test('a copy that is there but cannot be read is left alone, and nothing is filled', async () => {
  const { io, files, box, state } = fake()
  files.set(OWN_RULES, 'unreadable')
  const read = io.briefing.read
  const locked: ClawdIo = { ...io, briefing: { ...io.briefing, read: async p => { if (p === OWN_RULES) throw new Error('EACCES'); return read(p) } } }
  await clawdActions(locked).editClawd({ part: 'rules' }, true)
  expect(files.get(OWN_RULES)).toBe('unreadable')
  expect(box.filled).toEqual([])
  expect(state().notice?.text).toContain(OWN_RULES)
})

test('reset saves the copy as .bak, then empties it, so the built-in text is back from the next session', async () => {
  const { io, files, state } = fake()
  files.set(OWN_RULES, '# Mine\n')
  await clawdActions(io).resetClawd('rules')
  expect(files.get(`${OWN_RULES}.bak`)).toBe('# Mine\n')
  expect(files.get(OWN_RULES)).toBe('')
  expect(state().notice?.text).toContain(`${OWN_RULES}.bak`)
  expect(state().rules?.source).toBe('builtin')
})

test('a reset whose backup cannot be written leaves the copy as it was, and says so', async () => {
  const { io, files, disk, state } = fake()
  files.set(OWN_VOICE, 'Mine.')
  disk.isWriteFailing = path => path.endsWith('.bak')
  await clawdActions(io).resetClawd('voice')
  expect(files.get(OWN_VOICE)).toBe('Mine.')
  expect(state().notice?.text).toMatch(/left as it is/)
})

test('a reset that cannot empty the copy says so and names the backup', async () => {
  const { io, files, disk, state } = fake()
  files.set(OWN_VOICE, 'Mine.')
  disk.isWriteFailing = path => path === OWN_VOICE
  await clawdActions(io).resetClawd('voice')
  expect(files.get(OWN_VOICE)).toBe('Mine.')
  expect(state().notice?.text).toContain(`${OWN_VOICE}.bak`)
})

test('reset does nothing to a copy that is not in use, nor to the voice file the setting names', async () => {
  const { io, files } = fake({ voiceFile: '/me/voice.md' })
  files.set('/me/voice.md', 'Setting voice.')
  await clawdActions(io).resetClawd('voice')
  expect(files.get('/me/voice.md')).toBe('Setting voice.')
  expect(files.has('/me/voice.md.bak')).toBe(false)
})

test('a refresh shows the parts as they are now, compared with what the session loaded; a full refresh drops the notice', async () => {
  const loaded: Briefing = { text: 'x', rules: part({ text: '# Rules\n\n## A\n\nDo A.', builtin: '# Rules\n\n## A\n\nDo A.', path: OWN_RULES }) }
  const { io, files, state } = fake({ loaded, isOn: false })
  files.set(OWN_RULES, '# Mine')
  await io.set(b => ({ ...b, notice: { text: 'Hello' } }))
  await refreshClawd(io, false)
  expect(state()).toMatchObject({ isOn: false, notice: { text: 'Hello' }, rules: { text: '# Mine', source: 'own', isChanged: true } })
  expect(state().voice).toMatchObject({ source: 'builtin', isChanged: false })
  await refreshClawd(io, true)
  expect(state().notice).toBeUndefined()
})
