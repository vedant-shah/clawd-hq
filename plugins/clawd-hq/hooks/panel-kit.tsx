// The elements a pane draws with on the surface it is drawn on, and sprites drawn the best way that surface can.
// register.tsx resolves them (`$` never leaves that file) and hands them over as PanelTools.
import type { Elements } from 'claude-code'
import { BAR_H, WIDTH, barGlyphs, barSvg } from './meters'
import type { BarSize } from './meters'
import { ACCENT } from './office'
import { fade, rasterCells, svgOf, trim, trimLike } from './pixels'
import type { Px } from './pixels'

/** What the surface offers: Input is missing on mobile, Raster only exists on the terminal, Svg everywhere else. */
export type PanelTools = {
  Box: Elements['terminal']['Box']
  Text: Elements['terminal']['Text']
  Button: Elements['terminal']['Button']
  Link: Elements['terminal']['Link']
  /** Every surface draws it. */
  Markdown: Elements['terminal']['Markdown']
  Input?: Elements['terminal']['Input']
  Raster?: Elements['terminal']['Raster']
  Svg?: Elements['desktop']['Svg']
}

export type SpriteOptions = {
  /** CSS pixels per sprite pixel where the surface draws an SVG; the terminal's cells are fixed. */
  scale: number
  alt: string
  /** 0 to 1: how much of the color is kept, for a dimmed picture. */
  keep?: number
  /** The picture standing still: one that moves is cut to this one's size, so it never shifts what is around it. */
  like?: Px[][]
}

export function kitOf(tools: PanelTools) {
  const { Box, Text, Button, Link, Markdown, Input, Raster, Svg } = tools

  /** A pixel grid, margins trimmed: a Raster of half-block cells on the terminal, an SVG on the other surfaces. */
  const sprite = (key: string, grid: Px[][], o: SpriteOptions) => {
    const g = o.like ? trimLike(grid, o.like) : trim(grid)
    const [gw, gh] = [g[0]?.length ?? 0, g.length]
    if (Raster) return <Raster key={key} columns={gw} rows={Math.ceil(gh / 2)} cells={rasterCells(o.keep === undefined ? g : fade(g, o.keep))} />
    if (Svg) return <Svg source={svgOf(g, o.scale, o.keep ?? 1)} alt={o.alt} width={gw * o.scale} height={gh * o.scale} />
    return <Text dimColor>{o.alt}</Text>
  }

  /** A thin gauge bar, `wide` for the footer or `small` for a specialist's progress: a rounded image where there is an Svg, line glyphs on the terminal. */
  const bar = (percent: number, alt: string, size: BarSize = 'wide', color: string = ACCENT) => {
    if (Svg) return <Svg source={barSvg(percent, size, color)} alt={alt} width={WIDTH[size]} height={BAR_H} />
    const { on, off } = barGlyphs(percent, size)
    return <Text>{on !== '' && <Text color={color}>{on}</Text>}<Text dimColor>{off}</Text></Text>
  }

  // Only Text props every engine in use takes: the desktop app can bundle an older one (2.1.295) than the terminal's,
  // and it refuses a whole drawing over one prop it does not know, such as `weight`, `size` or `tabular`.

  /** A section heading in capitals, as the Office tab's "AT WORK · N" reads: bold and dim. */
  const heading = (text: string, key?: string) => <Text key={key} bold dimColor>{text}</Text>

  /** A short side line under a section: dim. It wraps. */
  const aside = (text: string, key?: string) => <Text key={key} dimColor wrap="wrap">{text}</Text>

  return { Box, Text, Button, Link, Markdown, Input, sprite, bar, heading, aside, isTerminal: Raster !== undefined }
}

export type Kit = ReturnType<typeof kitOf>
