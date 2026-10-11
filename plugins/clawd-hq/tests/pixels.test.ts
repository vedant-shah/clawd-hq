import { expect, test } from 'claude-code/testing'
import { fade, rasterCells, svgOf, trim } from '../hooks/pixels'
import type { Px } from '../hooks/pixels'

const R = '#d64545'
const B = '#4a8fe0'
const words = (cells: string) => {
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  return [...new Uint32Array(bytes.buffer)]
}

test('trim drops empty margins, keeping an even number of rows for half-block cells', () => {
  const grid: Px[][] = [
    [null, null, null, null],
    [null, null, null, null],
    [null, R, null, null],
    [null, null, B, null],
    [null, null, null, null],
    [null, null, null, null],
  ]
  expect(trim(grid)).toEqual([[R, null], [null, B]])
  // The first painted row is odd, so the row above it is kept to stay aligned.
  const odd: Px[][] = [[null, null], [R, null], [null, null], [null, null]]
  expect(trim(odd)).toEqual([[null], [R]])
  expect(grid[2]![1]).toBe(R)
})

test('trimming an empty grid leaves it empty', () => {
  expect(trim([[null, null], [null, null]])).toEqual([])
})

test('fade mixes every color toward the background and leaves empty cells empty', () => {
  const out = fade([[R, null]], 0.5, '#000000')
  expect(out[0]![1]).toBeNull()
  expect(out[0]![0]).toBe('#6b2323')
  expect(fade([[R]], 1, '#000000')).toEqual([[R]])
})

test('half-block cells carry a color for each of the two pixels', () => {
  const [ch, fg, bg] = words(rasterCells([[R], [B]]))
  expect(ch).toBe(0x2580)
  expect(fg).toBe(0xd64545)
  expect(bg).toBe(0x4a8fe0)
  expect(words(rasterCells([[R], [R]]))[0]).toBe(0x2588)
  expect(words(rasterCells([[null], [B]]))[0]).toBe(0x2584)
  expect(words(rasterCells([[R, null], [null, null]]))).toHaveLength(6)
})

test('an SVG has one rect per painted pixel, in its own color, and can be dimmed', () => {
  const svg = svgOf([[R, null], [null, B]], 3)
  expect(svg.match(/<rect /g)).toHaveLength(2)
  expect(svg).toContain(`fill="${R}"`)
  expect(svg).toContain(`fill="${B}"`)
  expect(svg).toContain('width="6"')
  expect(svg).not.toContain('opacity')
  expect(svgOf([[R]], 3, 0.7)).toContain('opacity="0.7"')
})
