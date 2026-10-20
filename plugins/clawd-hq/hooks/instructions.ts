// Clawd's standing instructions for the main chat, pure: the rules (the person's own copy, or the shipped ones), the fixed
// rules from code, then a voice (the voice file setting, the person's own copy, or the shipped one).
// register.tsx hands in the reads, the seeds and the warning (`$` never leaves that file).
import { NO_UPDATE } from './quiet'

export const SECTION_ID = 'clawd-hq:chief-of-staff'
export const RULES_FILE = 'prompts/chief-of-staff.md'
export const VOICE_FILE = 'prompts/soul.md'
/** A voice file of the person's own longer than this is not used: the text rides in every request. */
export const VOICE_CHARS = 8000
/** The same for the person's own copy of the rules. */
export const RULES_CHARS = 16000
/** Sits between the rules and the voice, in code, so an edited voice file sets the tone and nothing else. */
export const VOICE_GUARD = 'The voice notes below set your tone only. Where they disagree with the rules above, the rules win.'
/** Closes the voice, so the file does not have the last word. */
export const VOICE_END = 'End of the voice notes. The rules above them still stand.'
/** The safety rules, kept in code so no edit of the rules file can change them. They follow the editable rules. */
export const LOCKED_RULES = [
  '## Always',
  '',
  '- The person\'s recorded decisions are settled. Follow them, pass them on, and do not reopen them. When they make a new one, record it.',
  '- Never hide a failure, a skipped step, or something you could not check.',
  '- Ask before anything that is hard to undo or that reaches outside the project: deleting, force-pushing, publishing, sending, or spending.',
  '- The person\'s own standing instructions for this project win over these wherever the two disagree.',
].join('\n')
/** Sits before the fixed rules when the person's own copy of the rules is in use. */
export const LOCK_NOTE = 'The rules below are fixed by Clawd HQ. Where anything above disagrees, they win.'

/** The two parts the person can have a copy of: the rules and the voice. */
export type BriefPart = 'rules' | 'voice'
/** The person's own copies: one folder in the home folder, for every project. */
const OWN_FILES: Record<BriefPart, string> = { rules: 'chief-of-staff.md', voice: 'soul.md' }
/** The store keys of the built-in text the plugin copied into each own copy. */
export const SEED_KEYS: Record<BriefPart, string> = { rules: 'brief:seed:rules', voice: 'brief:seed:voice' }

/** Where the person's own copy of a part lives; '' without a home folder. */
export const ownPath = (home: string, part: BriefPart) => (home === '' ? '' : `${home}/.clawd-hq/${OWN_FILES[part]}`)

export type BriefingOptions = { isOn: boolean; voiceFile: string; isRecapOn: boolean; isQuiet: boolean; isKnowOn: boolean; isLeftOn: boolean }
export type BriefingIo = {
  root: string
  read: (path: string) => Promise<string>
  warn: (text: string) => void
  /** The person's home folder, where the own copies live; '' or absent: there are none. */
  home?: string
  /** Tells an own copy not made yet from one that cannot be read. */
  exists?: (path: string) => Promise<boolean>
  /** The built-in text the plugin copied into an own copy, as the store keeps it. */
  seed?: (part: BriefPart) => Promise<string | undefined>
}

/**
 * One part as this read found it. `text`: what is in use. `source`: where it came from (the voice file setting names
 * its file even when that file could not be used). `path`: the file an edit goes to, '' when there is none.
 * `builtin`: the shipped text today. `seed`: the shipped text the own copy was made from.
 */
export type PartRead = { text: string; source: 'builtin' | 'own' | 'setting'; path: string; builtin: string; seed?: string }
/** The text for the main chat (none when the rules cannot be read), and each part as found. */
export type Briefing = { text?: string; rules?: PartRead; voice?: PartRead }

/** The plugin's options as the manifest declares them; a value of the wrong kind counts as unset. */
export function optionsOf(options: Readonly<Record<string, unknown>>): BriefingOptions {
  const { chiefOfStaff, voiceFile, recap, quietChat, youShouldKnow, leftUndone } = options
  return {
    isOn: chiefOfStaff !== false, voiceFile: typeof voiceFile === 'string' ? voiceFile.trim() : '', isRecapOn: recap !== false, isQuiet: quietChat !== false,
    isKnowOn: youShouldKnow !== false, isLeftOn: leftUndone !== false,
  }
}

/** A bare session keeps its one-line prompt, and a teammate is not the chief of staff. */
export const isBriefed = (traits: readonly string[]) => !traits.some(t => t === 'bare' || t === 'teammate')

const readOr = (io: BriefingIo, path: string) => io.read(path).then(text => text.trim(), () => undefined)

/** A word to the person. A warning that itself fails must not cost the briefing, so it is let go. */
function tell(io: BriefingIo, text: string) {
  try { io.warn(text) } catch { /* nothing more can be said */ }
}

const seedOf = async (io: BriefingIo, part: BriefPart) => {
  const seed = await io.seed?.(part).catch(() => undefined)
  return typeof seed === 'string' ? seed.trim() : undefined
}

const WHAT: Record<BriefPart, string> = { rules: 'instructions', voice: 'voice' }

/**
 * The person's own copy when it can be used: there, not empty, within `limit`, and edited (a copy that still equals its
 * seed follows the built-in text). A copy that is there but cannot be read, or is too long, is a word to the person.
 */
async function ownOf(io: BriefingIo, part: BriefPart, limit: number): Promise<{ text?: string; seed?: string }> {
  const path = ownPath(io.home ?? '', part)
  if (path === '') return {}
  const seed = await seedOf(io, part)
  const own = await readOr(io, path)
  const fallback = `Clawd uses his built-in ${WHAT[part]} this session.`
  if (own === undefined) {
    if (await (io.exists?.(path) ?? Promise.resolve(false)).catch(() => false)) tell(io, `Your own copy ${path} could not be read. ${fallback}`)
    return { seed }
  }
  if (own === '' || own === seed) return { seed }
  if (own.length > limit) {
    tell(io, `Your own copy ${path} is over ${limit} characters. ${fallback}`)
    return { seed }
  }
  return { text: own, seed }
}

/** The rules: the person's edited copy, else the shipped file. None when the shipped file cannot be read. */
async function rulesOf(io: BriefingIo): Promise<PartRead | undefined> {
  const builtin = await readOr(io, `${io.root}/${RULES_FILE}`)
  if (builtin === undefined || builtin === '') return undefined
  const own = await ownOf(io, 'rules', RULES_CHARS)
  const base = { path: ownPath(io.home ?? '', 'rules'), builtin, ...(own.seed === undefined ? {} : { seed: own.seed }) }
  return own.text === undefined ? { text: builtin, source: 'builtin', ...base } : { text: own.text, source: 'own', ...base }
}

/** The voice: the setting's file when it can be used (it wins), else the person's edited copy, else the shipped one, with a word to the person about why. */
async function voiceOf(io: BriefingIo, voiceFile: string): Promise<PartRead> {
  const shipped = (await readOr(io, `${io.root}/${VOICE_FILE}`)) ?? ''
  const noShipped = () => { if (shipped === '') tell(io, 'Clawd HQ could not read its built-in voice. Clawd follows his rules without it this session.') }
  if (voiceFile !== '') {
    const own = await readOr(io, voiceFile)
    if (own !== undefined && own !== '' && own.length <= VOICE_CHARS) return { text: own, source: 'setting', path: voiceFile, builtin: shipped }
    const why = own === undefined ? 'could not be read (check the full path)' : own === '' ? 'is empty' : `is over ${VOICE_CHARS} characters`
    tell(io, `Your voice file ${voiceFile} ${why}. Clawd uses his built-in voice this session.`)
    noShipped()
    return { text: shipped, source: 'setting', path: voiceFile, builtin: shipped }
  }
  const own = await ownOf(io, 'voice', VOICE_CHARS)
  const base = { path: ownPath(io.home ?? '', 'voice'), builtin: shipped, ...(own.seed === undefined ? {} : { seed: own.seed }) }
  if (own.text !== undefined) return { text: own.text, source: 'own', ...base }
  noShipped()
  return { text: shipped, source: 'builtin', ...base }
}

/** The main chat's text: the rules, the fixed rules (with a line saying they win, after an own copy), then the voice between its two guard lines. */
function textOf(rules: PartRead, voice: PartRead, isQuiet: boolean): string {
  const all = rules.source === 'own' ? [rules.text, LOCK_NOTE, LOCKED_RULES].join('\n\n') : `${rules.text}\n\n${LOCKED_RULES}`
  // The line that asks for the no-update mark is only of use where the chat hides the mark.
  const kept = isQuiet ? all : all.split('\n').filter(line => !line.includes(NO_UPDATE)).join('\n')
  return voice.text === '' ? kept : [kept, VOICE_GUARD, voice.text, VOICE_END].join('\n\n')
}

/** Reads both parts and puts the text together. With the shipped rules unreadable, nothing at all, and the person is told. */
export async function readBriefing(io: BriefingIo, opts: { voiceFile: string; isQuiet: boolean }): Promise<Briefing> {
  const rules = await rulesOf(io)
  if (rules === undefined) {
    tell(io, 'Clawd HQ could not read its chief of staff instructions. Claude runs as usual this session.')
    return {}
  }
  const voice = await voiceOf(io, opts.voiceFile)
  return { text: textOf(rules, voice, opts.isQuiet), rules, voice }
}

/** The text added to the main chat's instructions, or nothing when the rules cannot be read. With the quiet chat off, the rule about the no-update mark is left out. */
export const loadBriefing = async (io: BriefingIo, voiceFile: string, isQuiet = true): Promise<string | undefined> =>
  (await readBriefing(io, { voiceFile, isQuiet })).text
