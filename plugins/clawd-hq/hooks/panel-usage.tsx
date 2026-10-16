// The panel's footer, like Claude's own status line: the model and effort beside one Usage button (and, at a break in the work, a coffee
// break button between them, hooks/coffee-break.ts). Pressing Usage opens
// three rows above it (context window, session limit, weekly limit), each with a bar; the button stays on the bottom
// edge. Everything wraps between its pieces; nothing is cut.
import { coffeeView } from './coffee-break'
import type { CoffeeView } from './coffee-break'
import { percentLabel } from './meters'
import { AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { localOffset, usageView } from './usage'
import type { UsageReading, UsageRow } from './usage'
import { usageTint } from './usage-tint'

function row(kit: Kit, r: UsageRow) {
  const { Box, Text, bar } = kit
  const tint = usageTint(r.value)
  return (
    <Box key={`usage-${r.key}`} flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
        <Text wrap="wrap">{r.label}</Text>
        <Box flexDirection="row" columnGap={1}>
          {r.detail !== undefined && <Text dimColor={tint === undefined} color={tint} wrap="wrap">{r.detail}</Text>}
          {r.percent !== undefined && <Text color={tint} wrap="wrap">{r.percent}</Text>}
        </Box>
      </Box>
      {bar(r.value, `${r.label} ${percentLabel(r.value)} used`)}
    </Box>
  )
}

/**
 * The button's text in pieces, so each number can carry its own colour: "Usage", then the numbers with a dot between.
 * The Button's label still names it whole, for the address and for a screen reader.
 */
function buttonText(kit: Kit, readings: UsageReading[], arrow: string) {
  const { Text } = kit
  return [
    'Usage ',
    ...readings.flatMap((r, i) => [
      ...(i > 0 ? [' · '] : []),
      <Text key={`usage-n${i}`} color={usageTint(r.value)}>{r.text}</Text>,
    ]),
    ` ${arrow}`,
  ]
}

/** The coffee break button in the footer row, or the plain word that stands in for it while the chat is compacting; nothing when it is not time. */
function coffeeButton(kit: Kit, state: CoffeeView['state'], actions: PanelActions) {
  const { Text, Button, isTerminal } = kit
  if (state === 'hidden') return undefined
  if (state === 'running') return <Text key="coffee-working" dimColor wrap="wrap">Compacting the chat…</Text>
  return <Button key="coffee-break" label="☕ Coffee break" onPress={() => actions.coffeeBreak(isTerminal)} />
}

export function usageFooter(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const view = usageView(data.gauge, data.now, localOffset)
  const coffee = coffeeView(data)
  const isOpen = data.fx.isUsageOpen === true
  const arrow = isOpen ? '▴' : '▾'
  return (
    <Box key="gauges" flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
      {isOpen && (
        <Box key="usage-details" flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
          {view.rows.map(r => row(kit, r))}
        </Box>
      )}
      {coffee.note !== undefined && <Text key="coffee-note" color={coffee.note.isProblem ? AMBER : undefined} dimColor={!coffee.note.isProblem} wrap="wrap">{coffee.note.text}</Text>}
      <Box key="usage-bar" flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={2}>
        {(view.model !== undefined || view.effort !== undefined) && (
          <Box key="usage-model" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {view.model !== undefined && <Text bold wrap="wrap">{view.model}</Text>}
            {view.model !== undefined && view.effort !== undefined && <Text dimColor>·</Text>}
            {view.effort !== undefined && <Text wrap="wrap">{view.effort}</Text>}
          </Box>
        )}
        {coffeeButton(kit, coffee.state, actions)}
        <Button key="usage-toggle" label={`${view.button} ${arrow}`} onPress={() => actions.toggleUsage()}>{buttonText(kit, view.readings, arrow)}</Button>
      </Box>
    </Box>
  )
}
