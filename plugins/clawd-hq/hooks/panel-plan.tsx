// The plan section of the Office tab and the "Also at work" section under it, drawn for the surface: the terminal's simple list with its rail
// (panel-plan-term.tsx) or the desktop's timeline of cards (panel-plan-desk.tsx).
import type { Ctx } from './panel-desk'
import { outsiderCards, planItems } from './panel-plan-desk'
import { outsiderRows, planRows } from './panel-plan-term'
import type { PlanLayout } from './plan-view'

export function planSection(ctx: Ctx, layout: PlanLayout) {
  const { Box } = ctx.kit
  return ctx.kit.isTerminal
    ? <Box key="plan" flexDirection="column">{planRows(ctx, layout)}</Box>
    : <Box key="plan" flexDirection="column" gap="sm">{planItems(ctx, layout)}</Box>
}

/** The agents at work that no step of the goal has: with a heading, and each as the surface draws an agent. None, no section. */
export function alsoAtWork(ctx: Ctx, layout: PlanLayout) {
  const { Box, Text } = ctx.kit
  if (layout.outsiders.length === 0) return null
  const slots = layout.outsiders
  return (
    <Box key="also-at-work" flexDirection="column" gap={ctx.kit.isTerminal ? undefined : 'sm'}>
      <Text bold dimColor>{`ALSO AT WORK · ${layout.outsidersAtWork}`}</Text>
      {ctx.kit.isTerminal ? <Box key="also-rows" flexDirection="column">{outsiderRows(ctx, slots)}</Box> : <Box key="floor-rows" flexDirection="column" gap="sm">{outsiderCards(ctx, slots)}</Box>}
    </Box>
  )
}
