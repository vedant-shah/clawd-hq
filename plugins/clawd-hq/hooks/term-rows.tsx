// Rows of text for the terminal's lists with a rail down their left (the plan, and an open goal on the History tab): every line is wrapped
// here (hooks/wrap-to.ts), so each row carries its own lead (the rail, or the blank that stands for it); a row the host wrapped would carry none.
import type { Ctx } from './panel-desk'
import { AMBER, RED } from './office'
import { MUTED_GREEN } from './plan-marks'
import { widthOf, wrapSegs } from './wrap-to'
import type { Seg } from './wrap-to'

type Row = JSX.Element
export type Tone = 'done' | 'amber' | 'dim'
export const TONE: Record<Tone, { color?: string; dimColor?: boolean }> = { done: { color: MUTED_GREEN }, amber: { color: AMBER, dimColor: true }, dim: { dimColor: true } }
const SEG_COLOR = { red: RED, amber: AMBER, green: MUTED_GREEN } as const

/** A piece of a row, drawn in its style. */
export function piece(kit: Ctx['kit'], seg: Seg, key: number) {
  const { Text } = kit
  const style = seg.style
  const color = style === 'red' || style === 'amber' || style === 'green' ? SEG_COLOR[style] : undefined
  return <Text key={String(key)} bold={style === 'bold' ? true : undefined} italic={style === 'italic' ? true : undefined} dimColor={style === 'dim' ? true : undefined} color={color}>{seg.text}</Text>
}

/** The rail, or the blank that stands for it: `width` cells. */
export const railText = (kit: Ctx['kit'], tone: Tone, text: string, key: string) => <kit.Text key={key} {...TONE[tone]}>{text}</kit.Text>

/** One row: the lead, then the pieces. With a right-hand item it is a row of two, the item against the right edge. */
export function line(kit: Ctx['kit'], key: string, lead: Row[], segs: readonly Seg[], right?: Row): Row {
  const { Box, Text } = kit
  const left = <Text key={`${key}-t`} wrap="truncate-end">{lead}{segs.map((seg, i) => piece(kit, seg, i))}</Text>
  return right === undefined ? <Box key={key} flexDirection="row">{left}</Box> : <Box key={key} flexDirection="row" justifyContent="space-between" columnGap={1}>{left}{right}</Box>
}

/**
 * Wrapped rows of `segs` in `width` cells; `first` leads the first row and `rest` the others. The right-hand item (`size` cells) goes against the
 * edge of the last row when it fits there with one cell between, else on a row of its own.
 */
export function rows(kit: Ctx['kit'], key: string, o: { first: Row[]; rest: Row[]; width: number; segs: readonly Seg[]; right?: Row; size?: number }): Row[] {
  const wrapped = wrapSegs(o.segs, o.width)
  const room = o.width
  const out = wrapped.map((row, i) => {
    const isLast = i === wrapped.length - 1
    const takes = isLast && o.right !== undefined && widthOf(row) + 1 + (o.size ?? 0) <= room
    return line(kit, `${key}-${i}`, i === 0 ? o.first : o.rest, row, takes ? o.right : undefined)
  })
  const fitsLast = o.right !== undefined && widthOf(wrapped[wrapped.length - 1] ?? []) + 1 + (o.size ?? 0) <= room
  return o.right === undefined || fitsLast ? out : [...out, line(kit, `${key}-r`, o.rest, [], o.right)]
}

