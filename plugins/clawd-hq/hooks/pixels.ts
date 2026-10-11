// Pixel grids drawn two ways: half-block cells on the terminal (two pixels a cell) and rects in an SVG elsewhere.
// A grid is rows of per-cell colors (hex), null where the surface shows through.

export type Px = string | null

const DEF = 0x01000000
const hex = (c: string) => parseInt(c.slice(1), 16)

/** The grid without empty columns or rows around it; an even number of rows above and below, so half-blocks stay aligned. */
export function trim(g: Px[][]): Px[][] {
  const rows = g.flatMap((row, y) => (row.some(c => c !== null) ? [y] : []))
  if (rows.length === 0) return []
  const cols = g[0]!.map((_, x) => x).filter(x => g.some(row => row[x] !== null && row[x] !== undefined))
  const top = rows[0]! - (rows[0]! % 2)
  const bottom = rows[rows.length - 1]! + 1
  const end = bottom + (bottom % 2)
  return g.slice(top, end).map(row => row.slice(cols[0]!, cols[cols.length - 1]! + 1))
}

const mix = (color: string, base: string, keep: number) => {
  const [a, b] = [hex(color), hex(base)]
  const channel = (shift: number) => Math.round((((a >> shift) & 255) * keep) + (((b >> shift) & 255) * (1 - keep)))
  return `#${[16, 8, 0].map(s => channel(s).toString(16).padStart(2, '0')).join('')}`
}

/** The same grid with each color pulled toward `base`, for the terminal, where a cell has no opacity. */
export function fade(g: Px[][], keep: number, base = '#1a1a1a'): Px[][] {
  return g.map(row => row.map(c => (c === null ? null : mix(c, base, keep))))
}

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

/** The same pixels as an SVG, for surfaces that draw one; `opacity` dims the whole picture. */
export function svgOf(g: Px[][], scale = 4, opacity = 1): string {
  const rects: string[] = []
  g.forEach((row, y) => row.forEach((c, x) => { if (c) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`) }))
  const [w, h] = [g[0]?.length ?? 0, g.length]
  const dim = opacity < 1 ? ` opacity="${opacity}"` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}"${dim} shape-rendering="crispEdges">${rects.join('')}</svg>`
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
