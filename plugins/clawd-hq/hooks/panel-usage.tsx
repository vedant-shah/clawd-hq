// The panel's footer, like Claude's own status line: the model and effort beside one Usage button. Pressing it opens
// three rows above it (context window, session limit, weekly limit), each with a bar; the button stays on the bottom
// edge. Everything wraps between its pieces; nothing is cut.
import { percentLabel } from './meters'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { localOffset, usageView } from './usage'
import type { UsageRow } from './usage'

function row(kit: Kit, r: UsageRow) {
  const { Box, Text, bar } = kit
  return (
    <Box key={`usage-${r.key}`} flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
        <Text wrap="wrap">{r.label}</Text>
        <Box flexDirection="row" columnGap={1}>
          {r.detail !== undefined && <Text dimColor wrap="wrap">{r.detail}</Text>}
          {r.percent !== undefined && <Text wrap="wrap">{r.percent}</Text>}
        </Box>
      </Box>
      {bar(r.value, `${r.label} ${percentLabel(r.value)} used`)}
    </Box>
  )
}

export function usageFooter(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const view = usageView(data.gauge, data.now, localOffset)
  const isOpen = data.fx.isUsageOpen === true
  return (
    <Box key="gauges" flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
      {isOpen && (
        <Box key="usage-details" flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
          {view.rows.map(r => row(kit, r))}
        </Box>
      )}
      <Box key="usage-bar" flexDirection="row" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap={2}>
        {(view.model !== undefined || view.effort !== undefined) && (
          <Box key="usage-model" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {view.model !== undefined && <Text bold wrap="wrap">{view.model}</Text>}
            {view.model !== undefined && view.effort !== undefined && <Text dimColor>·</Text>}
            {view.effort !== undefined && <Text wrap="wrap">{view.effort}</Text>}
          </Box>
        )}
        <Button key="usage-toggle" label={`${view.button} ${isOpen ? '▴' : '▾'}`} onPress={() => actions.toggleUsage()} />
      </Box>
    </Box>
  )
}
