// Text cut into rows of a fixed width (pure), for the plan on the terminal: the rail is a character in column 0 of every row, and a row the
// host wrapped would carry none, so the rows are made here. Rows are measured in terminal cells, not characters (`cellWidth`): a letter is one
// cell, a Chinese character or an emoji two, and the joiners, variation selectors, skin tones and combining marks that ride on a character none.

/**
 * Marks that draw nothing or reorder the text around them (hooks/plain.ts lists them), but for the zero-width joiner, which holds an emoji
 * sequence together. Written as escapes so a reader can see them.
 */
const UNSEEN = /[\u00ad\u061c\u180e\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}]/gu

/** Control characters become spaces, the marks that reorder text go, accents are joined to their letter, and the spaces fold. Emoji and wide characters stay. */
export function cellText(text: string): string {
  return text.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(UNSEEN, '').replace(/\s+/g, ' ').trim()
}

// ---- Cells ----

const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined

/** The characters a person sees as one: a letter with its accents, an emoji with its joiners, skin tone and selector, a flag. */
export const graphemes = (text: string): string[] => (segmenter ? Array.from(segmenter.segment(text), part => part.segment) : Array.from(text))

/** The East Asian wide and fullwidth blocks, the supplementary ideographs included. */
const WIDE_BASE = /[\u1100-\u115f\u231a\u231b\u2329\u232a\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u
const MARKS_ONLY = /^[\p{M}\p{Cf}\p{Cc}]+$/u
const EMOJI_SEQUENCE = /[\ufe0f\u200d\u20e3\u{1f3fb}-\u{1f3ff}]/u

function graphemeWidth(one: string): number {
  // A joiner, a selector, a combining mark or a control on its own takes no room.
  if (MARKS_ONLY.test(one)) return 0
  // A flag is two regional indicators; a keycap, a picture with a selector, a joined sequence or a skin tone is one emoji.
  if (/\p{Regional_Indicator}/u.test(one) || /\p{Emoji_Presentation}/u.test(one)) return 2
  if (/\p{Extended_Pictographic}/u.test(one) && EMOJI_SEQUENCE.test(one)) return 2
  if (one.includes('\u20e3')) return 2
  // Symbols such as ©, ™, ↔ and ✔ are one cell; a wide character is two.
  return WIDE_BASE.test(String.fromCodePoint(one.codePointAt(0)!)) ? 2 : 1
}

/** How many terminal cells the text takes. The one measure the wrapping, the row widths and the fit of a right-hand item all use. */
export const cellWidth = (text: string): number => graphemes(text).reduce((n, one) => n + graphemeWidth(one), 0)

// ---- Rows ----

/** A piece of a row and how it is drawn. */
export type Seg = { text: string; style?: 'bold' | 'dim' | 'italic' | 'red' | 'amber' | 'green' }

type Word = { text: string; style?: Seg['style']; spaceBefore: boolean }

/** The words of the segments, each a run of non-space characters in one style, with whether a space came before it. */
function wordsOf(segs: readonly Seg[]): Word[] {
  const tokens = segs.flatMap(seg => seg.text.split(/(\s+)/).filter(part => part !== '').map(part => ({ part, style: seg.style })))
  return tokens.reduce<{ words: Word[]; space: boolean }>((at, token) => (
    /^\s+$/.test(token.part)
      ? { ...at, space: true }
      : { words: [...at.words, { text: token.part, style: token.style, spaceBefore: at.space }], space: false }
  ), { words: [], space: false }).words
}

/** A word cut into pieces no wider than `max` cells (a character wider than that stands alone). */
function piecesOf(word: string, max: number): string[] {
  return graphemes(word).reduce<string[]>((all, one) => {
    const last = all[all.length - 1]
    return last !== undefined && cellWidth(last) + cellWidth(one) <= max ? [...all.slice(0, -1), last + one] : [...all, one]
  }, [])
}

/** The row with a piece added: a piece in the style the row ends in joins it. */
const added = (row: Seg[], piece: Seg): Seg[] => {
  const last = row[row.length - 1]
  return last !== undefined && last.style === piece.style ? [...row.slice(0, -1), { text: last.text + piece.text, style: piece.style }] : [...row, piece]
}

/**
 * Rows no wider than `width` cells, broken at spaces; a word longer than a row is cut into rows. Segments keep their style across the cut; a
 * space between two words of one style is in that style, and between two styles it is plain. A row never starts or ends with a space.
 * `width` below 1 is read as 1.
 */
export function wrapSegs(segs: readonly Seg[], width: number): Seg[][] {
  const max = Math.max(1, Math.floor(width))
  const rows = wordsOf(segs).reduce<{ rows: Seg[][]; used: number }>((at, word) => {
    return piecesOf(word.text, max).reduce((acc, piece, k) => {
      const row = acc.rows[acc.rows.length - 1]
      const gap = k === 0 && word.spaceBefore && acc.used > 0 ? 1 : 0
      const size = cellWidth(piece)
      if (row !== undefined && acc.used + gap + size <= max) {
        const spaced = gap ? added(row, { text: ' ', style: row[row.length - 1]?.style === word.style ? word.style : undefined }) : row
        return { rows: [...acc.rows.slice(0, -1), added(spaced, { text: piece, style: word.style })], used: acc.used + gap + size }
      }
      return { rows: [...acc.rows, [{ text: piece, style: word.style }]], used: size }
    }, at)
  }, { rows: [], used: 0 })
  return rows.rows.length === 0 ? [[]] : rows.rows
}

/** Rows of plain text no wider than `width` cells. */
export function wrapTo(text: string, width: number): string[] {
  return wrapSegs([{ text }], width).map(row => row.map(seg => seg.text).join(''))
}

/** The width of a row of segments, in cells. */
export const widthOf = (row: readonly Seg[]) => row.reduce((n, seg) => n + cellWidth(seg.text), 0)
