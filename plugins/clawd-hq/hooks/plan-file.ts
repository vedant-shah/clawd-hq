// The plan file (pure): `plans/<slug>.md` read into rows and written back. Every line is kept with its own line break, and a line
// nobody changed is written back as it was read, so a file the person edited by hand comes back byte for byte. See plan.ts for what
// is done to the rows and plan-io.ts for the file calls.
//
//   # <goal title>                        line 1; without it the file is not a plan
//   > <summary>                           optional, line 2 only: the goal in one sentence
//   - [ ] <text>  <!-- s1 -->             a step (or `- [x]`); the id is `s` and a number, never reused
//     - Decided: <choice>                 under a step
//   ## Later                              the put-off list, same line format, ids `l1`, `l2`, ...
//   <!-- next: s7 l3 -->                  the next id to give out in each list, so a deleted step's number is not used again
//
// A step owns the indented lines straight under it (its `Decided:` lines and any note a person indented there): they move with it.
// Any other line (notes, blank lines, a step the parser does not know) is a row of its own, kept where it is.

/**
 * An indented line straight under a step. A `Decided:` line (`isDecision`) holds the choice in `text`; any other indented line is a
 * note of the person's, held whole in `text` and written back exactly. `src` is the line as read; a new decision has none.
 */
export type Sub = { isDecision: boolean; text: string; src?: string; eol: string }

/** A step, or an item of the Later list. `src` is the line as read (without its line break); an item that was changed has none. */
export type Item = { kind: 'item'; id?: string; text: string; isDone: boolean; sub: Sub[]; src?: string; eol: string }

export type Row =
  | { kind: 'title'; title: string; text: string; eol: string }
  /** The goal in one sentence: a `> ` line, and only the one straight under the title. */
  | { kind: 'summary'; summary: string; text: string; eol: string }
  | { kind: 'later'; text: string; eol: string }
  | { kind: 'other'; text: string; eol: string }
  /** The `next` line: the number the next step (`s`) and the next Later item (`l`) get. Only the first such line in a file counts. */
  | { kind: 'next'; s: number; l: number; text: string; eol: string }
  | Item

/** `rows[0]` is always the title. `eol` is the line break the file uses (the first one in it), for the lines that are added. */
export type PlanFile = { eol: string; rows: Row[] }

const TITLE = /^\uFEFF?# +(\S.*?)[ \t]*$/
const LATER = /^## Later[ \t]*$/
const SUMMARY = /^> *(\S.*?)[ \t]*$/
const DECIDED = /^ {2}- Decided:[ \t]*(\S.*?)[ \t]*$/
const INDENTED = /^[ \t]+\S/
const NEXT = /^<!-- next: s(\d{1,6}) l(\d{1,6}) -->$/
/** The largest number an id may have: the id pattern reads six digits. */
export const MAX_ID = 999_999
const itemLine = (prefix: 's' | 'l') => new RegExp(`^- \\[([ xX])\\] +(\\S.*?)(?: +<!-- *(${prefix}\\d{1,6}) *-->)?[ \\t]*$`)
const STEP_LINE = itemLine('s')
const LATER_LINE = itemLine('l')

const lineBreak = (piece: string) => (piece.endsWith('\r\n') ? '\r\n' : piece.endsWith('\n') ? '\n' : '')

function splitLines(text: string): Array<{ text: string; eol: string }> {
  return text.split(/(?<=\n)/).filter(piece => piece !== '').map(piece => {
    const eol = lineBreak(piece)
    return { text: piece.slice(0, piece.length - eol.length), eol }
  })
}

type Reading = { rows: Row[]; isLater: boolean; ids: ReadonlySet<string> }

function readLine(at: Reading, line: { text: string; eol: string }): Reading {
  const { text, eol } = line
  const last = at.rows[at.rows.length - 1]
  const summary = at.rows.length === 1 ? SUMMARY.exec(text) : null
  if (summary) return { ...at, rows: [...at.rows, { kind: 'summary', summary: summary[1]!, text, eol }] }
  if (!at.isLater && LATER.test(text)) return { ...at, rows: [...at.rows, { kind: 'later', text, eol }], isLater: true }
  const item = (at.isLater ? LATER_LINE : STEP_LINE).exec(text)
  if (item) {
    const claimed = item[3]
    const id = claimed !== undefined && !at.ids.has(claimed) ? claimed : undefined
    const row: Item = { kind: 'item', id, text: item[2]!, isDone: item[1] !== ' ', sub: [], src: text, eol }
    return { ...at, rows: [...at.rows, row], ids: id === undefined ? at.ids : new Set([...at.ids, id]) }
  }
  if (last?.kind === 'item' && INDENTED.test(text)) {
    const choice = at.isLater ? null : DECIDED.exec(text)
    const sub: Sub = choice ? { isDecision: true, text: choice[1]!, src: text, eol } : { isDecision: false, text, src: text, eol }
    return { ...at, rows: [...at.rows.slice(0, -1), { ...last, sub: [...last.sub, sub] }] }
  }
  const mark = NEXT.exec(text)
  if (mark && !at.rows.some(row => row.kind === 'next')) return { ...at, rows: [...at.rows, { kind: 'next', s: Number(mark[1]), l: Number(mark[2]), text, eol }] }
  return { ...at, rows: [...at.rows, { kind: 'other', text, eol }] }
}

/** The file as rows, or nothing when line 1 is not `# <title>`: a file that is not a plan is left alone by everything. */
export function parsePlanFile(text: string): PlanFile | undefined {
  const [first, ...rest] = splitLines(text)
  const title = first === undefined ? null : TITLE.exec(first.text)
  if (first === undefined || title === null) return undefined
  const head: Row = { kind: 'title', title: title[1]!, text: first.text, eol: first.eol }
  const read = rest.reduce(readLine, { rows: [head], isLater: false, ids: new Set<string>() })
  const eol = [first, ...rest].find(line => line.eol !== '')?.eol ?? '\n'
  return { eol, rows: read.rows }
}

const itemText = (item: Item) => item.src ?? `- [${item.isDone ? 'x' : ' '}] ${item.text}${item.id === undefined ? '' : `  <!-- ${item.id} -->`}`

/** The file's text: each unchanged line as it was read, each new line in canonical form. */
export function serialisePlanFile(file: PlanFile): string {
  return file.rows.map(row => {
    if (row.kind !== 'item') return row.text + row.eol
    return itemText(row) + row.eol + row.sub.map(sub => (sub.src ?? `  - Decided: ${sub.text}`) + sub.eol).join('')
  }).join('')
}

/** The goal in one sentence, as written under the title; none when the file has no summary line. */
export function summaryOf(file: PlanFile): string | undefined {
  const row = file.rows[1]
  return row?.kind === 'summary' ? row.summary : undefined
}

/** The position of the `## Later` heading, or -1. */
export const laterAt = (file: PlanFile) => file.rows.findIndex(row => row.kind === 'later')

/** The title, the steps and the Later items, each in file order. */
export function sectionsOf(file: PlanFile): { title: string; steps: Item[]; later: Item[] } {
  const split = laterAt(file)
  const items = file.rows.map((row, i) => ({ row, i })).filter((one): one is { row: Item; i: number } => one.row.kind === 'item')
  const title = (file.rows[0] as { title: string }).title
  return {
    title,
    steps: items.filter(one => split === -1 || one.i < split).map(one => one.row),
    later: items.filter(one => split !== -1 && one.i > split).map(one => one.row),
  }
}

/** The choices a specialist reported under a step. */
export const decidedOf = (item: Item): Sub[] => item.sub.filter(sub => sub.isDecision)

const numberOf = (id: string | undefined) => (id === undefined ? 0 : Number(id.slice(1)))

/**
 * The number the next step (`s`) and the next Later item (`l`) get: the larger of what the `next` line says and one more than the
 * highest id in the file, so a line that was lowered or deleted by hand mends itself.
 */
export function nextIds(file: PlanFile): { s: number; l: number } {
  const mark = file.rows.find((row): row is Extract<Row, { kind: 'next' }> => row.kind === 'next')
  const items = file.rows.filter((row): row is Item => row.kind === 'item')
  const highest = (prefix: string) => Math.max(0, ...items.filter(i => i.id?.startsWith(prefix)).map(i => numberOf(i.id)))
  return { s: Math.max(mark?.s ?? 1, highest('s') + 1), l: Math.max(mark?.l ?? 1, highest('l') + 1) }
}

type Giving = { rows: Row[]; isLater: boolean; s: number; l: number }

/** The file with an id on every item that has none, in file order, from the numbers `nextIds` gives. Ids already there never change. */
export function withIds(file: PlanFile): PlanFile {
  const items = file.rows.filter((row): row is Item => row.kind === 'item')
  if (items.every(item => item.id !== undefined)) return file
  const start: Giving = { rows: [], isLater: false, ...nextIds(file) }
  const given = file.rows.reduce<Giving>((at, row) => {
    if (row.kind === 'later') return { ...at, rows: [...at.rows, row], isLater: true }
    if (row.kind !== 'item' || row.id !== undefined) return { ...at, rows: [...at.rows, row] }
    const prefix = at.isLater ? 'l' : 's'
    const { src: _read, ...rest } = row
    return { ...at, rows: [...at.rows, { ...rest, id: `${prefix}${at[prefix]}` }], [prefix]: at[prefix] + 1 }
  }, start)
  return { ...file, rows: given.rows }
}

/** The row with a line break at its end, for a row that was the last line of a file with none. */
export function closeRow(row: Row, eol: string): Row {
  const last = row.kind === 'item' ? row.sub[row.sub.length - 1] : undefined
  if (row.kind === 'item' && last !== undefined) return last.eol === '' ? { ...row, sub: [...row.sub.slice(0, -1), { ...last, eol }] } : row
  return row.eol === '' ? { ...row, eol } : row
}

/**
 * The file with its `next` line saying at least `floor` (and never less than `nextIds` of the file itself): made at the end of the file
 * when there is none, mended in place when it is lower. A line that is right is not touched. Called only when the file is to be written.
 */
export function withMark(file: PlanFile, floor: { s: number; l: number }): PlanFile {
  const need = nextIds(file)
  const [s, l] = [Math.min(Math.max(floor.s, need.s), MAX_ID), Math.min(Math.max(floor.l, need.l), MAX_ID)]
  const text = `<!-- next: s${s} l${l} -->`
  const at = file.rows.findIndex(row => row.kind === 'next')
  if (at !== -1) return (file.rows[at] as { text: string }).text === text ? file : { ...file, rows: file.rows.map((row, i) => (i === at ? { ...row, s, l, text } : row)) }
  const last = file.rows[file.rows.length - 1]!
  return { ...file, rows: [...file.rows.slice(0, -1), closeRow(last, file.eol), { kind: 'next', s, l, text, eol: file.eol }] }
}
