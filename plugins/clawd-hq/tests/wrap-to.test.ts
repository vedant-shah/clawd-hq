import { expect, test } from 'claude-code/testing'
import { cellText, cellWidth, widthOf, wrapSegs, wrapTo } from '../hooks/wrap-to'

// Rows of a fixed width in terminal cells, for the plan's rail on the terminal.

// Built from code points, so a reader sees the invisible ones.
const ZWJ = '\u200d'
const VS16 = '\ufe0f'
const WOMAN_TECH = `\u{1F469}${ZWJ}\u{1F4BB}`
const THUMBS_UP_TONE = '\u{1F44D}\u{1F3FD}'
const FLAG_JP = '\u{1F1EF}\u{1F1F5}'
const CJK_EXT = '\u{20000}'

test('text breaks at spaces into rows no wider than the width', () => {
  expect(wrapTo('Test the import round trip', 12)).toEqual(['Test the', 'import round', 'trip'])
  expect(wrapTo('short', 12)).toEqual(['short'])
  expect(wrapTo('exactly twelve', 7)).toEqual(['exactly', 'twelve'])
  for (const width of [3, 7, 20, 40]) for (const row of wrapTo('A long line of words that must be cut into rows of the given width, and no more', width)) expect(cellWidth(row)).toBeLessThanOrEqual(width)
})

test('a row never starts or ends with a space, and spaces fold', () => {
  expect(wrapTo('  a   b  ', 10)).toEqual(['a b'])
  expect(wrapTo('one two three', 7).every(row => row === row.trim())).toBe(true)
})

test('a word longer than a row is cut into rows', () => {
  expect(wrapTo('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  expect(wrapTo('go abcdefghij now', 4)).toEqual(['go', 'abcd', 'efgh', 'ij', 'now'])
})

test('nothing, or a width below one, gives a row that is empty or one cell wide', () => {
  expect(wrapTo('', 10)).toEqual([''])
  expect(wrapTo('ab', 0)).toEqual(['a', 'b'])
})

test('segments keep their style across the cut and the space between them', () => {
  const rows = wrapSegs([{ text: 'Tester 5', style: 'bold' }, { text: '  Test the import round trip', style: 'dim' }], 18)
  expect(rows.map(row => row.map(seg => seg.text).join(''))).toEqual(['Tester 5 Test the', 'import round trip'])
  expect(rows[0]).toEqual([{ text: 'Tester 5', style: 'bold' }, { text: ' ', style: undefined }, { text: 'Test the', style: 'dim' }])
  expect(rows[1]).toEqual([{ text: 'import round trip', style: 'dim' }])
  expect(widthOf(rows[0]!)).toBe(17)
  // Joined without a space where none was written.
  expect(wrapSegs([{ text: 'Step', style: 'bold' }, { text: ': go' }], 20).map(row => row.map(seg => seg.text).join(''))).toEqual(['Step: go'])
})

// ---- Cells ----

test('a letter is one cell, a Chinese character two, one from the supplementary planes two', () => {
  expect(cellWidth('abc')).toBe(3)
  expect(cellWidth('日本語')).toBe(6)
  expect(cellWidth('한국어')).toBe(6)
  expect(cellWidth(CJK_EXT)).toBe(2)
  expect(cellWidth('Ｆｕｌｌ')).toBe(8)
})

test('symbols that are not emoji pictures stay one cell: ©, ™, ↔, ✔ and the arrows', () => {
  for (const symbol of ['©', '™', '↔', '✔', '→', '•', '§']) expect(cellWidth(symbol)).toBe(1)
})

test('an emoji is two cells, with its joiners, selectors and skin tones taking none', () => {
  expect(cellWidth('\u{1F680}')).toBe(2)
  expect(cellWidth(WOMAN_TECH)).toBe(2)
  expect(cellWidth(THUMBS_UP_TONE)).toBe(2)
  expect(cellWidth(FLAG_JP)).toBe(2)
  expect(cellWidth(`✔${VS16}`)).toBe(2)
  expect(cellWidth(`1${VS16}\u20e3`)).toBe(2)
  expect(cellWidth(ZWJ)).toBe(0)
  expect(cellWidth(VS16)).toBe(0)
})

test('a combining mark takes no room, whether joined or apart', () => {
  expect(cellWidth('e\u0301')).toBe(1)
  expect(cellWidth('\u0301')).toBe(0)
  expect(cellWidth('Cafe\u0301 menu')).toBe(9)
})

test('the text is kept: wide characters and emoji are not taken out, and what reorders text or draws nothing is', () => {
  expect(cellText('Ship the export \u{1F680}')).toBe('Ship the export \u{1F680}')
  expect(cellText('Fix 日本語 names')).toBe('Fix 日本語 names')
  expect(cellText(`Ship it ${WOMAN_TECH} now`)).toBe(`Ship it ${WOMAN_TECH} now`)
  expect(cellText('Cafe\u0301 menu')).toBe('Café menu')
  expect(cellText('a\nb\tc')).toBe('a b c')
  expect(cellText('a\u202eb\u200fc\u2066d\u00ade\u200bf')).toBe('abcdef')
  expect(cellText('a\u0085b\u009Fc')).toBe('a b c')
  expect(cellText('')).toBe('')
})

test('rows are cut by cells: wide characters count two, nothing is cut in half, and every row fits', () => {
  expect(wrapTo('日本語日本語', 6)).toEqual(['日本語', '日本語'])
  expect(wrapTo('日本語日本語', 7)).toEqual(['日本語', '日本語'])
  expect(wrapTo(`ab \u{1F680}\u{1F680}\u{1F680} cd`, 6)).toEqual(['ab', '\u{1F680}\u{1F680}\u{1F680}', 'cd'])
  // A character wider than the row stands alone.
  expect(wrapTo('日本', 1)).toEqual(['日', '本'])
  for (const width of [2, 5, 9, 20, 38]) {
    for (const row of wrapTo(`Ship the 日本語 export ${WOMAN_TECH} to the team \u{1F680} with ${FLAG_JP} flags and 한국어 notes ${CJK_EXT}${CJK_EXT}`, width)) {
      if (width >= 2) expect(cellWidth(row)).toBeLessThanOrEqual(width)
    }
  }
})

test('the width of a row of segments is the same measure', () => {
  const row = wrapSegs([{ text: '日本', style: 'bold' }, { text: ` ok \u{1F680}`, style: 'dim' }], 20)[0]!
  expect(widthOf(row)).toBe(cellWidth('日本 ok \u{1F680}'))
  expect(widthOf(row)).toBe(10)
})
