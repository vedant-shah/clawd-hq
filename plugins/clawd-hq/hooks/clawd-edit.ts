// The Clawd tab's edit button, pure: the ready-made prompts, the note Claude gets with them, the guard on the plugin's own
// files, how a text splits into sections, and the steps behind the buttons. register.tsx hands in every call as `io`.
import type { ClawdBrief, ClawdPartView } from '../types'
import { RULES_CHARS, VOICE_CHARS, ownPath, readBriefing } from './instructions'
import type { BriefPart, Briefing, BriefingIo, PartRead } from './instructions'

// ---- Sections, and their text as blocks to draw ----

export type Section = { heading: string; body: string }

/** A text split at its `## ` headings; what comes before the first is the intro. */
export function sectionsOf(text: string): { intro: string; sections: Section[] } {
  const intro: string[] = []
  const found: Array<{ heading: string; lines: string[] }> = []
  for (const line of text.split(/\r?\n/)) {
    const heading = /^## (.*)$/.exec(line)?.[1]
    if (heading !== undefined) found.push({ heading: heading.trim(), lines: [] })
    else (found.length === 0 ? intro : found[found.length - 1]!.lines).push(line)
  }
  return { intro: intro.join('\n').trim(), sections: found.map(s => ({ heading: s.heading, body: s.lines.join('\n').trim() })) }
}

/** One thing to draw. `isSpaced`: a blank line stood before it in the text. */
export type Block = { kind: 'title' | 'para' | 'bullet'; text: string; isSpaced: boolean }

/** Bold and code marks are for Claude; the tab shows the words. */
const plain = (text: string) => text.replace(/\*\*/g, '').replace(/`/g, '')

/** A section's text as titles, paragraphs and bullets. A line that starts nothing new carries on the one before. */
export function blocksOf(body: string): Block[] {
  const blocks: Block[] = []
  let isGap = false
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '') { isGap = true; continue }
    const title = /^#{1,6} (.*)$/.exec(line)?.[1]
    const bullet = /^[-*] (.*)$/.exec(line)?.[1]
    const last = blocks[blocks.length - 1]
    const isSpaced = isGap && blocks.length > 0
    isGap = false
    if (title !== undefined) blocks.push({ kind: 'title', text: plain(title), isSpaced })
    else if (bullet !== undefined) blocks.push({ kind: 'bullet', text: plain(bullet), isSpaced })
    else if (last !== undefined && last.kind !== 'title' && !isSpaced) blocks[blocks.length - 1] = { ...last, text: `${last.text} ${plain(line)}` }
    else blocks.push({ kind: 'para', text: plain(line), isSpaced })
  }
  return blocks
}

/** The open sections after one fold is pressed: a new list, the one given left as it was. */
export const toggled = (open: readonly string[] | undefined, key: string): string[] =>
  (open ?? []).includes(key) ? (open ?? []).filter(k => k !== key) : [...(open ?? []), key]

// ---- The prompt, and what Claude is told with it ----

export type EditTarget = { part: BriefPart; heading?: string }

const OPENING: Record<BriefPart, string> = { rules: 'Edit Clawd\'s instructions', voice: 'Edit Clawd\'s voice notes' }

/** The line put in the prompt box, for the person to finish. */
export const promptOf = (t: EditTarget) => (t.heading === undefined ? `${OPENING[t.part]}: ` : `${OPENING[t.part]}, "${t.heading}" section: `)

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
    'Keep the "## " headings, so the Clawd tab can show each section.',
    `Keep the file under ${part === 'rules' ? RULES_CHARS : VOICE_CHARS} characters.`,
    'The change applies from the next session or after /clear. Say so when you are done.)',
  ].join(' ')
}

const FILE_KEYS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
const SHIPPED_PATH = /(^|[\\/])prompts[\\/]+(chief-of-staff|soul)\.md$/i
const SHIPPED_NAMED = /prompts[\\/]+(chief-of-staff|soul)\.md\b/i

/**
 * A call that writes the plugin's shipped instruction files: a file tool aimed at one, or a shell command that names one
 * (best effort: a command can reach a file without naming it). Any folder counts, so another spelling of the plugin's own does too.
 */
export function isShippedWrite(tool: string, input: Record<string, unknown>): boolean {
  if (tool === 'Bash') return typeof input.command === 'string' && SHIPPED_NAMED.test(input.command)
  const path = FILE_KEYS[tool] === undefined ? undefined : input[FILE_KEYS[tool]!]
  return typeof path === 'string' && SHIPPED_PATH.test(path.trim())
}

export const SHIPPED_DENY = 'Refused by Clawd HQ: during a request to edit Clawd\'s instructions, the plugin\'s built-in files stay as they are. Edit the person\'s own copy named in the request instead.'

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
    await io.setSeed(part, p.builtin)
    await io.write(p.path, `${p.builtin}\n`)
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

async function editClawd(io: ClawdIo, target: EditTarget, isTerminal: boolean) {
  const box = await io.promptRead().catch(() => ({ text: '' }))
  if (box.text.trim() !== '') return say(io, { text: BOX_BUSY })
  const p = (await readNow(io))[target.part]
  if (p === undefined) return say(io, { text: 'Clawd HQ could not read its built-in instructions, so there is nothing to edit.' })
  if (p.path === '') return say(io, { text: NO_HOME })
  const problem = p.source === 'setting' ? undefined : await ensureCopy(io, target.part, p)
  if (problem !== undefined) return say(io, { text: problem })
  const line = promptOf(target)
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
  editClawd: (target: EditTarget, isTerminal: boolean) => Promise<unknown>
  resetClawd: (part: BriefPart) => Promise<unknown>
}

export const clawdActions = (io: ClawdIo): ClawdActions => ({
  editClawd: (target, isTerminal) => editClawd(io, target, isTerminal),
  resetClawd: part => resetClawd(io, part),
})
