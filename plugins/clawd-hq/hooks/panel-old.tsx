// The one-time card on the Office tab for a project with an old decisions file (hooks/old-decisions.ts). Plain wrapped text.
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

export function oldSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  if (!data.fx.oldDecisions) return null
  return (
    <Box key="old-decisions" borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
      <Text bold wrap="wrap">Clawd HQ no longer reads your old decisions file.</Text>
      <Text dimColor wrap="wrap">The file stays where it is. Want the decisions that still matter turned into CLAUDE.md rules? You choose each one.</Text>
      <Box key="old-buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Button key="old-offer" label="Offer them as rules" onPress={() => actions.oldOffer()} />
        <Button key="old-dismiss" plain dimColor label="Dismiss" onPress={() => actions.oldDismiss()} />
      </Box>
    </Box>
  )
}
