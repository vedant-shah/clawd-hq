// Clawd's standing instructions for the main chat, pure: the shipped rules, then a voice (the shipped one, or the person's own file).
// register.tsx hands in the reads and the warning (`$` never leaves that file).
import { NO_UPDATE } from './quiet'

export const SECTION_ID = 'clawd-hq:chief-of-staff'
export const RULES_FILE = 'prompts/chief-of-staff.md'
export const VOICE_FILE = 'prompts/soul.md'
/** A voice file of the person's own longer than this is not used: the text rides in every request. */
export const VOICE_CHARS = 8000
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

export type BriefingOptions = { isOn: boolean; voiceFile: string; isRecapOn: boolean; isQuiet: boolean; isKnowOn: boolean }
export type BriefingIo = { root: string; read: (path: string) => Promise<string>; warn: (text: string) => void }

/** The plugin's options as the manifest declares them; a value of the wrong kind counts as unset. */
export function optionsOf(options: Readonly<Record<string, unknown>>): BriefingOptions {
  const { chiefOfStaff, voiceFile, recap, quietChat, youShouldKnow } = options
  return {
    isOn: chiefOfStaff !== false, voiceFile: typeof voiceFile === 'string' ? voiceFile.trim() : '', isRecapOn: recap !== false, isQuiet: quietChat !== false,
    isKnowOn: youShouldKnow !== false,
  }
}

/** A bare session keeps its one-line prompt, and a teammate is not the chief of staff. */
export const isBriefed = (traits: readonly string[]) => !traits.some(t => t === 'bare' || t === 'teammate')

const readOr = (io: BriefingIo, path: string) => io.read(path).then(text => text.trim(), () => undefined)

/** A word to the person. A warning that itself fails must not cost the briefing, so it is let go. */
function tell(io: BriefingIo, text: string) {
  try { io.warn(text) } catch { /* nothing more can be said */ }
}

/** The person's own voice when it can be used; otherwise the shipped one, with a word to the person about why. */
async function voiceOf(io: BriefingIo, voiceFile: string): Promise<string> {
  if (voiceFile !== '') {
    const own = await readOr(io, voiceFile)
    if (own !== undefined && own !== '' && own.length <= VOICE_CHARS) return own
    const why = own === undefined ? 'could not be read (check the full path)' : own === '' ? 'is empty' : `is over ${VOICE_CHARS} characters`
    tell(io, `Your voice file ${voiceFile} ${why}. Clawd uses his built-in voice this session.`)
  }
  const shipped = await readOr(io, `${io.root}/${VOICE_FILE}`)
  if (shipped === undefined || shipped === '') tell(io, 'Clawd HQ could not read its built-in voice. Clawd follows his rules without it this session.')
  return shipped ?? ''
}

/** The text added to the main chat's instructions: the rules, then the voice between its two guard lines. Nothing when the rules cannot be read. With the quiet chat off, the rule about the no-update mark is left out. */
export async function loadBriefing(io: BriefingIo, voiceFile: string, isQuiet = true): Promise<string | undefined> {
  const editable = await readOr(io, `${io.root}/${RULES_FILE}`)
  const all = editable === undefined || editable === '' ? undefined : `${editable}\n\n${LOCKED_RULES}`
  // The line that asks for the no-update mark is only of use where the chat hides the mark.
  const rules = isQuiet ? all : all?.split('\n').filter(line => !line.includes(NO_UPDATE)).join('\n')
  if (rules === undefined) {
    tell(io, 'Clawd HQ could not read its chief of staff instructions. Claude runs as usual this session.')
    return undefined
  }
  const voice = await voiceOf(io, voiceFile)
  return voice === '' ? rules : [rules, VOICE_GUARD, voice, VOICE_END].join('\n\n')
}
