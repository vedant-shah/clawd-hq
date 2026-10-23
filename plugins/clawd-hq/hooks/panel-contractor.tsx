// The contractor card of the Office tab (hooks/contractor.ts keeps the offers): shown when a skill has been hired for a second job here.
// Make staff adds the skill to the project's saved team; Not now puts the question off. Plain wrapped text only.
import { offerText } from './contractor'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

export function contractorSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const offers = data.contractorOffers
  if (offers.length === 0) return null
  return (
    <Box key="contractors" flexDirection="column">
      <Text bold dimColor>CONTRACTOR</Text>
      {offers.map(one => (
        <Box key={`contractor-${one.id}`} borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
          <Text wrap="wrap">{offerText(one.role, one.times)}</Text>
          <Box key={`contractor-buttons-${one.id}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key={`contractor-staff-${one.id}`} label="Make staff" onPress={() => actions.contractorStaff(one.id)} />
            <Button key={`contractor-later-${one.id}`} plain dimColor label="Not now" onPress={() => actions.contractorLater(one.id)} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
