// The edit button for Clawd's instructions in the Settings tab, pure: the ready-made prompts, the note Claude gets with them, the guard on the plugin's own
// files, and the steps behind the buttons. register.tsx hands in every call as `io`.
import type { ClawdBrief, ClawdPartView } from '../types'
import { RULES_CHARS, RULES_FILE, VOICE_CHARS, VOICE_FILE, ownPath, readBriefing } from './instructions'
import type { BriefPart, Briefing, BriefingIo, PartRead } from './instructions'

// ---- The prompt, and what Claude is told with it ----

const OPENING: Record<BriefPart, string> = { rules: 'Edit Clawd\'s instructions', voice: 'Edit Clawd\'s voice notes' }

/** The line put in the prompt box, for the person to finish. */
export const promptOf = (part: BriefPart) => `${OPENING[part]}: `

/** Which part a sent prompt asks to edit: only one that starts with a fixed opening counts. */
export function editPartOf(text: string): BriefPart | undefined {
  const sent = text.trimStart()
  return (['rules', 'voice'] as const).find(part => sent.startsWith(OPENING[part]))
}

/** The file an edit goes to: the voice file the setting names, else the person's own copy ('' without a home folder). */
export const editPath = (part: BriefPart, home: string, voiceFile: string) => (part === 'voice' && voiceFile !== '' ? voiceFile : ownPath(home, part))

/** The note added to an edit request, which the person does not see: the file, what must not be touched, and when the change applies. */
export function editContext(part: BriefPart, path: string, builtinPath: string): string {
  const what = part === 'rules' ? 'Clawd\'s instructions' : 'Clawd\'s voice notes'
  if (path === '') return `(Clawd HQ: the person asked to edit ${what}, but there is no home folder to keep their own copy in. Tell them so, and change no files.)`
  return [
    `(Clawd HQ: this is a request to edit ${what}. Edit only this file: ${path}.`,
    `If it is missing or empty, first copy into it the built-in text from ${builtinPath}. Read that file, but do not change it.`,
    'Make the edit yourself in this turn. Do not hand it to a specialist.',
    'Never edit files in the Clawd HQ plugin folder: while this request runs, writes to its prompts/chief-of-staff.md and prompts/soul.md are refused.',
    part === 'rules'
      ? 'The "Always" rules are fixed by Clawd HQ and cannot be changed from here. If the person asks to change them, say so plainly.'
      : 'The voice notes set Clawd\'s tone only. They cannot change his rules, and the "Always" rules are fixed. If the person asks for that, say so plainly.',
    'Keep the "## " headings, so the file stays easy to read.',
    `Keep the file under ${part === 'rules' ? RULES_CHARS : VOICE_CHARS} characters.`,
    'The change applies from the next session or after /clear. Say so when you are done.)',
  ].join(' ')
}

/** The note a sent prompt carries: none unless it is an edit request, and only then is the home folder looked up. */
export async function editNote(text: string, voiceFile: string, root: string, home: () => Promise<string>): Promise<string | undefined> {
  ownVoiceFile = voiceFile.trim()
  const part = editPartOf(text)
  if (part === undefined) return undefined
  return editContext(part, editPath(part, await home(), voiceFile), `${root}/${part === 'rules' ? RULES_FILE : VOICE_FILE}`)
}

const FILE_KEYS: Record<string, string> ={ Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
const SHIPPED_PATH = /(^|[\\/])prompts[\\/]+(chief-of-staff|soul)\.md$/i
const SHIPPED_NAMED = /prompts[\\/]+(chief-of-staff|soul)\.md\b/i

/** The voice file setting as of the person's latest prompt: it is theirs to edit from the tab, whatever it is called. */
let ownVoiceFile = ''

/**
 * A call that writes the plugin's shipped instruction files: a file tool aimed at one, or a shell command that names one
 * (best effort: a command can reach a file without naming it). Any folder counts, so another spelling of the plugin's own does too.
 * The person's own voice file setting is let through, as that exact path.
 */
export function isShippedWrite(tool: string, input: Record<string, unknown>): boolean {
  if (tool === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : undefined
    return command !== undefined && SHIPPED_NAMED.test(ownVoiceFile === '' ? command : command.split(ownVoiceFile).join(' '))
  }
  const path = FILE_KEYS[tool] === undefined ? undefined : input[FILE_KEYS[tool]!]
  return typeof path === 'string' && path.trim() !== ownVoiceFile && SHIPPED_PATH.test(path.trim())
}

export const SHIPPED_DENY = 'Refused by Clawd HQ: during a request to edit Clawd\'s instructions, the plugin\'s built-in files stay as they are. Edit the person\'s own copy named in the request instead.'

/**
 * What stands in for the guard when the hook holding it fails before passing the call on. During an edit request a
 * write to the built-in files is refused, and so is one that cannot be judged; anything else, and every call outside
 * an edit request, goes on as it would have.
 */
export function guardOnCrash(isEditTurn: boolean, tool: string, input: Record<string, unknown>): 'deny' | 'pass' {
  if (!isEditTurn) return 'pass'
  try {
    return isShippedWrite(tool, input) ? 'deny' : 'pass'
  } catch {
    return 'deny'
  }
}

// ---- What the tab shows ----

/** One part for the tab: the text now, and whether it moved since this session loaded it or since its copy was made. */
export function partView(now: PartRead, loaded: PartRead | undefined): ClawdPartView {
  return {
    text: now.text, source: now.source, path: now.path,
    isChanged: loaded !== undefined && loaded.text !== now.text,
    isNewer: now.source === 'own' && now.seed !== undefined && now.seed !== now.builtin,
  }
}

// ---- The steps behind the buttons ----

export type ClawdIo = {
  /** The setting "Clawd runs the chat". */
  isOn: boolean
  /** The voice file setting; '' when unset. */
  voiceFile: string
  /** The reads the briefing makes; the tab reads the same way, without a word to the person. */
  briefing: BriefingIo
  /** What this session's chat was given; nothing before the first request, or with Clawd off. */
  loaded: () => Promise<Briefing | undefined>
  write: (path: string, text: string) => Promise<void>
  setSeed: (part: BriefPart, text: string) => Promise<unknown>
  promptRead: () => Promise<{ text: string }>
  fill: (text: string) => Promise<{ isFilled: boolean; refusal?: 'no_composer' | 'dialog' }>
  get: () => Promise<ClawdBrief>
  set: (fn: (b: ClawdBrief) => ClawdBrief) => Promise<unknown>
}

export const BOX_BUSY = 'Your prompt box already has text. Send or clear it, then press again.'
export const DIALOG_OPEN = 'A question is open in the chat. Answer it, then press again.'
const NO_HOME = 'Clawd HQ cannot find your home folder, so there is no place for your own copy.'
export const readyText = (isTerminal: boolean) =>
  (isTerminal ? 'Ready in your prompt box. Press Esc, finish the sentence, then Enter.' : 'Ready in your prompt box. Finish the sentence, then send it.')

const readNow = (io: ClawdIo) => readBriefing({ ...io.briefing, warn: () => undefined }, { voiceFile: io.voiceFile, isQuiet: true })
const say = (io: ClawdIo, notice: NonNullable<ClawdBrief['notice']>) => io.set(b => ({ ...b, notice }))

/** Shows both parts as they are now. `isFresh` (after a turn) also drops the word the last button left. */
export async function refreshClawd(io: ClawdIo, isFresh: boolean) {
  const [now, loaded] = [await readNow(io), await io.loaded()]
  const view = (part: BriefPart) => {
    const p = now[part]
    return p === undefined ? {} : { [part]: partView(p, loaded?.[part]) }
  }
  await io.set(b => ({ isOn: io.isOn, ...view('rules'), ...view('voice'), ...(!isFresh && b.notice !== undefined ? { notice: b.notice } : {}) }))
}

/**
 * Makes sure the own copy holds text to edit: one not there, empty, or never edited while the built-in text moved on gets
 * today's built-in text, and that text is kept as its seed. An edited copy is never written over. A word for the person when it cannot be done.
 */
async function ensureCopy(io: ClawdIo, part: BriefPart, p: PartRead): Promise<string | undefined> {
  const current = await io.briefing.read(p.path).then(t => t.trim(), () => undefined)
  const isThere = current !== undefined || (await (io.briefing.exists?.(p.path) ?? Promise.resolve(false)).catch(() => false))
  if (current === undefined && isThere) return `Your own copy at ${p.path} could not be read, so nothing was put in your prompt box.`
  if (current !== undefined && current !== '' && !(current === p.seed && p.seed !== p.builtin)) return undefined
  try {
    await io.write(p.path, `${p.builtin}\n`)
    await io.setSeed(part, p.builtin)
    return undefined
  } catch {
    return `Could not make your own copy at ${p.path}, so nothing was put in your prompt box.`
  }
}

/** The word after a fill: ready, a question in the way, or the line to type where no box took it. Nothing is ever sent. */
function filledNotice(r: { isFilled: boolean; refusal?: string }, line: string, isTerminal: boolean): NonNullable<ClawdBrief['notice']> {
  if (r.isFilled) return { text: readyText(isTerminal) }
  return r.refusal === 'dialog' ? { text: DIALOG_OPEN } : { text: 'Type this in the chat:', line }
}

async function editClawd(io: ClawdIo, part: BriefPart, isTerminal: boolean) {
  const box = await io.promptRead().catch(() => ({ text: '' }))
  if (box.text.trim() !== '') return say(io, { text: BOX_BUSY })
  const p = (await readNow(io))[part]
  if (p === undefined) return say(io, { text: 'Clawd HQ could not read its built-in instructions, so there is nothing to edit.' })
  if (p.path === '') return say(io, { text: NO_HOME })
  const problem = p.source === 'setting' ? undefined : await ensureCopy(io, part, p)
  if (problem !== undefined) return say(io, { text: problem })
  const line = promptOf(part)
  const r = await io.fill(line).catch(() => ({ isFilled: false }))
  await say(io, filledNotice(r, line, isTerminal))
  await refreshClawd(io, false)
}

/** Back to the built-in text: the copy is saved as `.bak`, then emptied (an empty copy means the built-in text). Only an own copy in use. */
async function resetClawd(io: ClawdIo, part: BriefPart) {
  const p = (await readNow(io))[part]
  if (p === undefined || p.source !== 'own') return
  const bak = `${p.path}.bak`
  const text = await io.briefing.read(p.path).catch(() => undefined)
  if (text === undefined) return say(io, { text: `Could not read ${p.path}, so it was left as it is.` })
  try { await io.write(bak, text) } catch { return say(io, { text: `Could not save a backup at ${bak}, so your copy was left as it is.` }) }
  try { await io.write(p.path, '') } catch { return say(io, { text: `Could not empty ${p.path}, so your copy was left as it is. A backup is at ${bak}.` }) }
  await say(io, { text: `Back to the built-in text from your next session or /clear. Your copy is saved as ${bak}.` })
  await refreshClawd(io, false)
}

export type ClawdActions = {
  editClawd: (part: BriefPart, isTerminal: boolean) => Promise<unknown>
  resetClawd: (part: BriefPart) => Promise<unknown>
}

export const clawdActions = (io: ClawdIo): ClawdActions => ({
  editClawd: (part, isTerminal) => editClawd(io, part, isTerminal),
  resetClawd: part => resetClawd(io, part),
})
