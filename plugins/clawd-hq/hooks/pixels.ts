// Pixel-art crabs in Clawd's shape: a 14×8 grid, drawn as half-block cells on the
// terminal (two pixels a cell) and as rects on the desktop.

export const W = 14
export const H = 8
export const CELL_ROWS = H / 2

export type Frame = 'idle' | 'typeA' | 'typeB' | 'cheerA' | 'cheerB' | 'walkA' | 'walkB' | 'blink' | 'sad'
type Gear = { rows?: [string, string]; color: string; overlay?: Record<number, string>; overlayColor?: string; tie?: string }

/** Each role's hat (rows 0–1) and face gear (overlay rows), on a 14-wide grid. */
export const GEAR: Record<string, Gear> = {
  clone: { rows: ['....H.HH.H....', '....HHHHHH....'], color: '#ffd54f' },
  security: { rows: ['....HHHHHH....', '...HHHHHHHHHH.'], color: '#3949ab' },
  detective: { rows: ['.....HHHH.....', '..HHHHHHHHHH..'], color: '#8d6e63' },
  reviewer: { color: '#111111', overlay: { 3: '....HH..HH....' } },
  designer: { rows: ['......HHH.....', '....HHHHHH.H..'], color: '#d81b60' },
  architect: { rows: ['.....HHHH.....', '...HHHHHHHH...'], color: '#fdd835' },
  marketer: { rows: ['....HHHHH.....', '....HHHHHHHH..'], color: '#e53935' },
  planner: { rows: ['..............', '...HHHHHHHH...'], color: '#43a047' },
  tester: { color: '#26c6da', overlay: { 3: '...HHH..HHH...' } },
  speed: { rows: ['..........HH..', '...HHHHHHHH...'], color: '#ff1744' },
  ops: { rows: ['..............', '...HHHHHHHH...'], color: '#9e9e9e', overlay: { 3: '..H........H..' } },
  fixer: { rows: ['..............', '...HHHHHHHH.HH'], color: '#1e88e5' },
  engineer: { rows: ['.....HHHH.....', '...HHHHHHHH...'], color: '#fb8c00' },
  comms: { rows: ['..............', '...HHHHHHHH...'], color: '#2e7d32', overlay: { 3: '..H........H..', 4: '..H...........' } },
  people: { rows: ['........H.H...', '.........H....'], color: '#f06292' },
  exec: { rows: ['....HHHHHH....', '...HHHHHHHH...'], color: '#212121', tie: '#c62828' },
  customer: { rows: ['..............', '...HHHHHHHH...'], color: '#00897b', overlay: { 3: '..H........H..' } },
  librarian: { color: '#6d4c41', overlay: { 3: '...HHH..HHH...' } },
  explorer: { rows: ['.....HHHH.....', '.HHHHHHHHHHHH.'], color: '#bfa36f' },
  writer: { rows: ['......HHH.....', '....HHHHHH....'], color: '#283593' },
  analyst: { color: '#1565c0', overlay: { 3: '...HHH..HHH...' } },
  generalist: { color: '#000000' },
}

export const SHADES: Gear = { color: '#111111', overlay: { 3: '...HHHHHHHH...' } }
export const NIGHTCAP: Gear = { rows: ['...........H..', '...HHHHHHHH...'], color: '#7986cb' }

export type Px = string | null

function body(frame: Frame): string[] {
  const g = Array.from({ length: H }, () => '.'.repeat(W))
  const eyes = frame === 'blink' ? '...OOOOOOOO...' : '...O.OOOO.O...'
  g[2] = '...OOOOOOOO...'
  g[3] = frame === 'sad' ? '...OOOOOOOO...' : eyes
  g[4] = frame === 'sad' ? '...O.OOOO.O...' : '...OOOOOOOO...'
  g[5] = '...OOOOOOOO...'
  // Arms: out to the sides at rest, up and down while typing, raised to cheer, low when sad.
  const arms: Record<Frame, [number, string][]> = {
    idle: [[4, '.OO........OO.']], blink: [[4, '.OO........OO.']],
    typeA: [[4, '.OO........OO.']], typeB: [[5, '.OO........OO.']],
    cheerA: [[2, '.O..........O.'], [3, '..O........O..']], cheerB: [[1, '.O..........O.'], [2, '.O..........O.'], [3, '..O........O..']],
    walkA: [[4, '.OO........OO.']], walkB: [[4, '.OO........OO.']],
    sad: [[5, '..O........O..']],
  }
  for (const [row, mask] of arms[frame]) g[row] = merge(g[row]!, mask, 'O')
  g[6] = frame === 'walkA' ? '..O.O..O.O....' : frame === 'walkB' ? '....O.O..O.O..' : '...O.O..O.O...'
  return g
}

function merge(row: string, mask: string, ch: string): string {
  return [...row].map((c, i) => (mask[i] && mask[i] !== '.' ? ch : c)).join('')
}

/** The crab's pixels: null where the terminal shows through (the eyes are holes). */
export function crab(color: string, frame: Frame, gear: Gear[] = []): Px[][] {
  const g: Px[][] = body(frame).map(row => [...row].map(c => (c === 'O' ? color : null)))
  for (const one of gear) {
    one.rows?.forEach((mask, row) => [...mask].forEach((c, col) => { if (c === 'H') g[row]![col] = one.color }))
    for (const [row, mask] of Object.entries(one.overlay ?? {})) {
      // Face gear sits on the face, lower in a sad crab.
      const r = Number(row) + (frame === 'sad' && Number(row) === 3 ? 1 : 0)
      ;[...mask].forEach((c, col) => { if (c === 'H') g[r]![col] = one.overlayColor ?? one.color })
    }
    if (one.tie) { g[4]![6] = one.tie; g[4]![7] = one.tie; g[5]![6] = one.tie; g[5]![7] = one.tie }
  }
  return g
}

/** Puts a drop of sweat beside the head. */
export function sweat(g: Px[][], tick: number): Px[][] {
  const out = g.map(row => [...row])
  out[1 + (tick % 2)]![12] = '#64b5f6'
  return out
}

const DEF = 0x01000000
const hex = (c: string) => parseInt(c.slice(1), 16)

/** Half-block cells, two pixels a cell, as Raster's base64 of [codePoint, fg, bg] triplets. */
export function rasterCells(g: Px[][]): string {
  const [cols, rows] = [g[0]?.length ?? 0, Math.ceil(g.length / 2)]
  const words = new Uint32Array(cols * rows * 3)
  let i = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const top = g[2 * r]![c] ?? null
      const bot = g[2 * r + 1]?.[c] ?? null
      let cell: [number, number, number]
      if (top === null && bot === null) cell = [0x20, DEF, DEF]
      else if (top !== null && top === bot) cell = [0x2588, hex(top), DEF]
      else if (bot === null) cell = [0x2580, hex(top!), DEF]
      else if (top === null) cell = [0x2584, hex(bot), DEF]
      else cell = [0x2580, hex(top), hex(bot)]
      words[i++] = cell[0]; words[i++] = cell[1]; words[i++] = cell[2]
    }
  }
  return base64(new Uint8Array(words.buffer))
}

/** The same pixels as an SVG, for surfaces that draw one. */
export function svgOf(g: Px[][], scale = 4): string {
  const rects: string[] = []
  g.forEach((row, y) => row.forEach((c, x) => { if (c) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`) }))
  const [w, h] = [g[0]?.length ?? 0, g.length]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return out
}

/** A plain-text crab for previews and surfaces with neither Raster nor Svg. */
export function ascii(g: Px[][]): string[] {
  const rows: string[] = []
  for (let r = 0; r < CELL_ROWS; r++) {
    let line = ''
    for (let c = 0; c < W; c++) {
      const t = g[2 * r]![c] !== null, b = g[2 * r + 1]![c] !== null
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' '
    }
    rows.push(line)
  }
  return rows
}
