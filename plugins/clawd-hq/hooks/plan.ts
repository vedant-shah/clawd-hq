// The plan's operations (pure): start a plan, and add, drop, move, split, done, reopen and later on one that is read (hooks/plan-file.ts).
// Each takes a file and gives back a new file, or the one plain sentence why not. Nothing is changed in place and nothing is written:
// plan-io.ts reads the file fresh, applies one operation and writes. No tool, panel or hook uses this yet.
import { fit } from './desk'
import { plainText } from './know'
import { MAX_ID, closeRow, decidedOf, laterAt, nextIds, parsePlanFile, sectionsOf, serialisePlanFile, withIds, withMark } from './plan-file'
import type { Item, PlanFile, Row } from './plan-file'

export const MAX_STEPS = 40
export const MAX_LATER = 20
/** The most choices a step keeps in its file. */
export const MAX_CHOICES = 5
/** DECIDED: step text, Later text and the title are each cut at a word to 120 characters. */
export const TEXT_CHARS = 120
/** DECIDED: 40 characters are the title's share of a slug; the `-2` of a clash comes after them. */
const SLUG_CHARS = 40

const MARKS = /<!--|-->/g

const strip = (text: string): string => (/<!--|-->/.test(text) ? strip(text.replace(MARKS, '')) : text)

/**
 * Text from a model as one clean line: control characters, marks that reorder text and hidden marks gone (`plainText`), spaces folded, cut to
 * size, and with no comment marks, so it can never pass as an id of its own. Not text: nothing.
 */
export function cleanText(raw: unknown): string {
  return typeof raw === 'string' ? fit(strip(plainText(raw)), TEXT_CHARS) : ''
}

/** Text read from the file, which anyone may have edited: the same clean-up as `cleanText`, but not cut. */
const tidy = (text: string) => plainText(text).replace(/\s+/g, ' ').trim()

/**
 * The file name for a goal: its title in lower case with every run of other characters turned to one dash, at most 40 characters,
 * and `-2`, `-3` ... after it when that name is taken. DECIDED: only a-z and 0-9 count, so a title with none (all Chinese, say) is `goal`.
 */
export function slugOf(title: string, taken: readonly string[]): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SLUG_CHARS).replace(/-+$/, '') || 'goal'
  const free = (n: number): string => (taken.includes(n === 1 ? base : `${base}-${n}`) ? free(n + 1) : n === 1 ? base : `${base}-${n}`)
  return free(1)
}

/** What a plan is to the rest of the plugin: the live state (Phase 2) is built from this. */
export type PlanView = {
  title: string
  steps: Array<{ id: string; text: string; isDone: boolean; choices: string[] }>
  later: Array<{ id: string; text: string }>
}

/**
 * The plan as the rest of the plugin sees it. A step added by hand has no id in the file yet: the id shown here is the one the next
 * write will give it (the numbers are worked out the same way each time), but it is provisional until then. DECIDED for Phase 2: the
 * loader saves the ids (one write through `changeGoal` or a save of its own) before it shows or links any of them.
 */
export function viewOf(file: PlanFile): PlanView {
  const { title, steps, later } = sectionsOf(withIds(file))
  return {
    title: tidy(title),
    steps: steps.map(s => ({ id: s.id!, text: tidy(s.text), isDone: s.isDone, choices: decidedOf(s).map(d => tidy(d.text)) })),
    later: later.map(l => ({ id: l.id!, text: tidy(l.text) })),
  }
}

type Refused = { ok: false; reason: string }
const refuse = (reason: string): Refused => ({ ok: false, reason })

export type StartResult = { ok: true; slug: string; file: PlanFile } | Refused

/**
 * A new plan. One goal only: refused while one is current. `taken` is the slugs of the plan files already there.
 * Steps that are empty after cleaning are left out.
 */
export function startPlan(input: { goal: unknown; steps: readonly unknown[]; hasCurrent: boolean; taken: readonly string[] }): StartResult {
  if (input.hasCurrent) return refuse('Cannot start: finish the current goal first (done or stopped).')
  const title = cleanText(input.goal)
  if (title === '') return refuse('A goal needs a title.')
  const steps = (Array.isArray(input.steps) ? input.steps : []).map(cleanText).filter(text => text !== '')
  if (steps.length === 0) return refuse('A plan needs at least one step.')
  if (steps.length > MAX_STEPS) return refuse(`A plan holds at most ${MAX_STEPS} steps.`)
  const file = parsePlanFile(`# ${title}\n\n${steps.map(text => `- [ ] ${text}`).join('\n')}\n`)
  return file === undefined ? refuse('That title cannot be used.') : { ok: true, slug: slugOf(title, input.taken), file: withMark(withIds(file), { s: 1, l: 1 }) }
}

export type PlanOp =
  | { op: 'add'; text: string; after?: string }
  | { op: 'drop'; id: string }
  | { op: 'move'; id: string; after?: string }
  | { op: 'split'; id: string; steps: string[] }
  | { op: 'done'; id: string }
  | { op: 'reopen'; id: string }
  | { op: 'later'; text: string }
  /** The office's own, never from the tool: a finished run's choices go under its step, and with `tick` the step is ticked. */
  | { op: 'decide'; id: string; choices: string[]; tick?: boolean }
  /** The office's own, from the Dismiss button on a Later item: that item leaves the file (a note indented under it stays). */
  | { op: 'forget'; id: string }

export type OpResult = { ok: true; file: PlanFile } | Refused
const accept = (file: PlanFile): OpResult => ({ ok: true, file })

// ---- Finding things ----

const inSteps = (file: PlanFile, i: number) => laterAt(file) === -1 || i < laterAt(file)
const itemAt = (file: PlanFile, i: number) => file.rows[i] as Item
/** Row positions of the steps, in file order. */
const stepRows = (file: PlanFile) => file.rows.flatMap((row, i) => (row.kind === 'item' && inSteps(file, i) ? [i] : []))
const stepAt = (file: PlanFile, id: string) => stepRows(file).find(i => itemAt(file, i).id === id)
const unknown = (id: string) => refuse(`There is no step ${fit(String(id), 20)}.`)
const busy = (id: string) => refuse(`Step ${id} has a specialist at work on it; wait for it to finish first.`)

// ---- Making rows ----

/** The indented notes under a step as lines of their own, for when the step goes and they stay. */
const notesOf = (item: Item): Row[] => item.sub.filter(sub => !sub.isDecision).map(sub => ({ kind: 'other', text: sub.text, eol: sub.eol }))

const isBlank = (row: Row | undefined) => row?.kind === 'other' && row.text.trim() === ''
const blank = (file: PlanFile): Row => ({ kind: 'other', text: '', eol: file.eol })
const newItem = (file: PlanFile, text: string): Item => ({ kind: 'item', text, isDone: false, sub: [], eol: file.eol })

/** The file with rows put in at a position; a last line with no line break gets one first. */
function insertRows(file: PlanFile, at: number, rows: Row[]): PlanFile {
  const before = file.rows.slice(0, at)
  const after = file.rows.slice(at)
  const kept = after.length === 0 ? [...before.slice(0, -1), closeRow(before[before.length - 1]!, file.eol)] : before
  return { ...file, rows: [...kept, ...rows, ...after] }
}

/** An item as it is now, with the line it was read from forgotten, so it is written in full. */
function changed(item: Item, patch: Partial<Item>): Item {
  const { src: _read, ...rest } = item
  return { ...rest, ...patch }
}

// ---- The operations ----

/** Where a first step goes in a plan with none: below the title and a blank line, and set off from what follows. */
function firstStep(file: PlanFile, item: Item): PlanFile {
  const second = file.rows[1]
  const at = isBlank(second) ? 2 : 1
  const next = file.rows[at]
  const gap = next !== undefined && !isBlank(next) ? [blank(file)] : []
  return insertRows(file, at, [...(at === 1 ? [blank(file)] : []), item, ...gap])
}

function add(file: PlanFile, op: { text: string; after?: string }): OpResult {
  const text = cleanText(op.text)
  if (text === '') return refuse('A step needs some text.')
  const steps = stepRows(file)
  if (steps.length >= MAX_STEPS) return refuse(`The plan already has ${MAX_STEPS} steps; drop one first.`)
  const item = newItem(file, text)
  if (op.after !== undefined) {
    const at = stepAt(file, op.after)
    return at === undefined ? unknown(op.after) : accept(withIds(insertRows(file, at + 1, [item])))
  }
  const last = steps[steps.length - 1]
  return accept(withIds(last === undefined ? firstStep(file, item) : insertRows(file, last + 1, [item])))
}

function drop(file: PlanFile, id: string, active: ReadonlySet<string>): OpResult {
  const at = stepAt(file, id)
  if (at === undefined) return unknown(id)
  if (active.has(id)) return busy(id)
  // The step goes with its choices; any note a person indented under it stays where it was.
  return accept({ ...file, rows: file.rows.flatMap((row, i) => (i === at ? notesOf(itemAt(file, at)) : [row])) })
}

function move(file: PlanFile, op: { id: string; after?: string }): OpResult {
  const slots = stepRows(file)
  const order = slots.map(i => itemAt(file, i))
  const moving = order.find(item => item.id === op.id)
  if (moving === undefined) return unknown(op.id)
  const rest = order.filter(item => item !== moving)
  const target = op.after === undefined ? -1 : rest.findIndex(item => item.id === op.after)
  if (op.after !== undefined && op.after === op.id) return refuse('A step cannot be moved after itself.')
  if (op.after !== undefined && target === -1) return unknown(op.after)
  const next = [...rest.slice(0, target + 1), moving, ...rest.slice(target + 1)]
  if (next.every((item, k) => item === order[k])) return accept(file)
  // The notes and other lines stay in their places: only the steps change places among the step positions.
  return accept({ ...file, rows: file.rows.map((row, i) => (slots.includes(i) ? closeRow(next[slots.indexOf(i)]!, file.eol) : row)) })
}

function split(file: PlanFile, op: { id: string; steps: string[] }, active: ReadonlySet<string>): OpResult {
  const at = stepAt(file, op.id)
  if (at === undefined) return unknown(op.id)
  if (active.has(op.id)) return busy(op.id)
  const texts = (Array.isArray(op.steps) ? op.steps : []).map(cleanText).filter(text => text !== '')
  if (texts.length < 2) return refuse('A split needs at least two steps.')
  if (stepRows(file).length - 1 + texts.length > MAX_STEPS) return refuse(`A plan holds at most ${MAX_STEPS} steps.`)
  const old = closeRow(itemAt(file, at), file.eol) as Item
  const fresh = texts.map((text, k) => ({ ...newItem(file, text), sub: k === 0 ? decidedOf(old) : [] }))
  // The new steps are numbered while the old one is still there, so its number is not given out again.
  const numbered = withIds(insertRows({ ...file, rows: file.rows.map((row, i) => (i === at ? old : row)) }, at + 1, fresh))
  // The old step goes; its choices went to the first new step, and its notes stay, right after the new steps.
  const lastNew = at + fresh.length
  return accept({ ...numbered, rows: numbered.rows.flatMap((row, i) => (i === at ? [] : i === lastNew ? [row, ...notesOf(old)] : [row])) })
}

function tick(file: PlanFile, id: string, isDone: boolean): OpResult {
  const at = stepAt(file, id)
  if (at === undefined) return unknown(id)
  const item = itemAt(file, at)
  return accept(item.isDone === isDone ? file : { ...file, rows: file.rows.map((row, i) => (i === at ? changed(item, { isDone }) : row)) })
}

const sameChoice = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim()

/** The choices a step keeps: those it has and the new ones, nothing twice (any case or spacing), at most five in all. The step's own line stays as written unless it is ticked. */
function decide(file: PlanFile, op: { id: string; choices: string[]; tick?: boolean }): OpResult {
  const at = stepAt(file, op.id)
  if (at === undefined) return unknown(op.id)
  const item = itemAt(file, at)
  const have = decidedOf(item).map(d => d.text)
  const room = Math.max(0, MAX_CHOICES - have.length)
  const added = (Array.isArray(op.choices) ? op.choices : []).map(cleanText).filter(text => text !== '')
    .reduce<string[]>((list, text) => (list.some(one => sameChoice(one, text)) || have.some(one => sameChoice(one, text)) ? list : [...list, text]), []).slice(0, room)
  const isTick = op.tick === true && !item.isDone
  if (added.length === 0 && !isTick) return accept(file)
  const closed = added.length > 0 ? (closeRow(item, file.eol) as Item) : item
  const after = closed.sub.map(sub => sub.isDecision).lastIndexOf(true) + 1
  const sub = [...closed.sub.slice(0, after), ...added.map(text => ({ isDecision: true, text, eol: file.eol })), ...closed.sub.slice(after)]
  const next = isTick ? changed(closed, { sub, isDone: true }) : { ...closed, sub }
  return accept({ ...file, rows: file.rows.map((row, i) => (i === at ? next : row)) })
}

/** A Later item taken out of the file; the notes a person indented under it stay where they were. */
function forget(file: PlanFile, id: string): OpResult {
  const head = laterAt(file)
  const at = head === -1 ? -1 : file.rows.findIndex((row, i) => i > head && row.kind === 'item' && row.id === id)
  if (at === -1) return refuse(`There is no Later item ${fit(String(id), 20)}.`)
  return accept({ ...file, rows: file.rows.flatMap((row, i) => (i === at ? notesOf(itemAt(file, at)) : [row])) })
}

/** Where a Later item goes: below the last one, or under the heading, or under a new heading at the end of the file. */
function laterSlot(file: PlanFile, item: Item): PlanFile {
  const head = laterAt(file)
  if (head === -1) {
    // Before the `next` line when that closes the file.
    const end = file.rows[file.rows.length - 1]?.kind === 'next' ? file.rows.length - 1 : file.rows.length
    const last = file.rows[end - 1]
    const heading: Row = { kind: 'later', text: '## Later', eol: file.eol }
    return insertRows(file, end, [...(isBlank(last) ? [] : [blank(file)]), heading, blank(file), item])
  }
  const last = file.rows.map((row, i) => (row.kind === 'item' && i > head ? i : -1)).reduce((a, b) => Math.max(a, b), -1)
  if (last !== -1) return insertRows(file, last + 1, [item])
  return isBlank(file.rows[head + 1]) ? insertRows(file, head + 2, [item]) : insertRows(file, head + 1, [blank(file), item])
}

function later(file: PlanFile, text: string): OpResult {
  const clean = cleanText(text)
  if (clean === '') return refuse('A Later item needs some text.')
  if (sectionsOf(file).later.length >= MAX_LATER) return refuse(`The Later list holds at most ${MAX_LATER} items.`)
  return accept(withIds(laterSlot(file, newItem(file, clean))))
}

function dispatch(f: PlanFile, op: PlanOp, active: ReadonlySet<string>): OpResult {
  switch (op.op) {
    case 'add': return add(f, op)
    case 'drop': return drop(f, op.id, active)
    case 'move': return move(f, op)
    case 'split': return split(f, op, active)
    case 'done': return tick(f, op.id, true)
    case 'reopen': return tick(f, op.id, false)
    case 'later': return later(f, op.text)
    case 'decide': return decide(f, op)
    case 'forget': return forget(f, op.id)
    default: return refuse(`There is no operation called ${fit(String((op as { op?: unknown }).op), 20)}.`)
  }
}

const hasHugeId = (file: PlanFile) => file.rows.some(row => row.kind === 'item' && Number((row.id ?? 'x0').slice(1)) > MAX_ID)

/**
 * One operation on a plan that was read. `active` is the ids of the steps a specialist is working on now (the live state, which the
 * file does not hold): a step with a run at work is not dropped or split. A step added by hand with no id gets one here.
 * An operation that changes nothing gives back the file exactly as it came, so it is not written. One that changes something gives a
 * file whose `next` line is made right in the same go (after a drop it keeps the number of the step that went).
 */
export function applyOp(file: PlanFile, op: PlanOp, active: ReadonlySet<string>): OpResult {
  const f = withIds(file)
  const done = dispatch(f, op, active)
  if (!done.ok) return done
  if (hasHugeId(done.file)) return refuse(`The plan has used up its step numbers (the last is ${MAX_ID}).`)
  if (serialisePlanFile(done.file) === serialisePlanFile(f)) return accept(file)
  return accept(withMark(done.file, nextIds(f)))
}

/** The file with the ids a step added by hand lacks made real, the numbers `viewOf` showed for them; the very same file when none lacked one. For the loader, which saves them before it shows or links any. */
export function withSavedIds(file: PlanFile): PlanFile {
  const ided = withIds(file)
  return ided === file ? file : withMark(ided, nextIds(ided))
}
