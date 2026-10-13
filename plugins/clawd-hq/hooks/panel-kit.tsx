// The elements a pane draws with on the surface it is drawn on, and sprites drawn the best way that surface can.
// register.tsx resolves them (`$` never leaves that file) and hands them over as PanelTools.
import type { Elements } from 'claude-code'
import { barGlyphs, barSvg } from './meters'
import { ACCENT } from './office'
import { fade, rasterCells, svgOf, trim, trimLike } from './pixels'
import type { Px } from './pixels'

/** What the surface offers: Input is missing on mobile, Raster only exists on the terminal, Svg everywhere else. */
export type PanelTools = {
  Box: Elements['terminal']['Box']
  Text: Elements['terminal']['Text']
  Button: Elements['terminal']['Button']
  Link: Elements['terminal']['Link']
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
  const { Box, Text, Button, Link, Input, Raster, Svg } = tools

  /** A pixel grid, margins trimmed: a Raster of half-block cells on the terminal, an SVG on the other surfaces. */
  const sprite = (key: string, grid: Px[][], o: SpriteOptions) => {
    const g = o.like ? trimLike(grid, o.like) : trim(grid)
    const [gw, gh] = [g[0]?.length ?? 0, g.length]
    if (Raster) return <Raster key={key} columns={gw} rows={Math.ceil(gh / 2)} cells={rasterCells(o.keep === undefined ? g : fade(g, o.keep))} />
    if (Svg) return <Svg source={svgOf(g, o.scale, o.keep ?? 1)} alt={o.alt} width={gw * o.scale} height={gh * o.scale} />
    return <Text dimColor>{o.alt}</Text>
  }

  /** A thin gauge bar: a small rounded image where there is an Svg, line glyphs on the terminal. */
  const bar = (percent: number, alt: string) => {
    if (Svg) return <Svg source={barSvg(percent)} alt={alt} width={48} height={4} />
    const { on, off } = barGlyphs(percent)
    return <Text>{on !== '' && <Text color={ACCENT}>{on}</Text>}<Text dimColor>{off}</Text></Text>
  }

  return { Box, Text, Button, Link, Input, sprite, bar, isTerminal: Raster !== undefined }
}

export type Kit = ReturnType<typeof kitOf>
