// The card on the Office tab that tells who the automatic trim laid off (hooks/payroll.ts). It stays until dismissed. Plain wrapped text.
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

const SHOWN = 8

export function layoffSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const types = data.fx.layoffNotice?.types
  if (!types || types.length === 0) return null
  const names = types.slice(0, SHOWN).join(', ') + (types.length > SHOWN ? `, and ${types.length - SHOWN} more` : '')
  return (
    <Box key="layoff-notice" borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
      <Text bold wrap="wrap">{types.length === 1 ? '1 helper was set aside' : `${types.length} helpers were set aside`} because this project has no use for them.</Text>
      <Text dimColor wrap="wrap">{names}. To bring one back, search for it in People and press Hire.</Text>
      <Box key="layoff-buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="layoff-dismiss" plain dimColor label="Dismiss" onPress={() => actions.layoffDismiss()} />
      </Box>
    </Box>
  )
}
