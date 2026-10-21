// The "Lasting rule?" section of the Office tab (hooks/rule-io.ts keeps the offers): a rule Clawd offers to add to the project's
// CLAUDE.md. It shows the exact line, in full and wrapped, never cut with a mark; Add to CLAUDE.md writes that line on the press.
// Plain wrapped text only: the words came from a model, so nothing in them is read as a link or as Markdown.
import { AMBER, GREEN } from './office'
import { ruleLine } from './rule-offers'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

export function ruleSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const { ruleOffers: offers } = data
  const done = data.fx.ruleDone
  if (offers.length === 0 && !done) return null
  return (
    <Box key="rules" flexDirection="column">
      {offers.length > 0 && <Text bold dimColor>LASTING RULE?</Text>}
      {offers.map(one => (
        <Box key={`rule-${one.id}`} borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
          <Text dimColor wrap="wrap">{'Add this line to the project\'s CLAUDE.md?'}</Text>
          <Text wrap="wrap">{ruleLine(one.text)}</Text>
          {one.problem !== undefined && <Text key={`rule-problem-${one.id}`} color={AMBER} wrap="wrap">{one.problem}</Text>}
          <Box key={`rule-buttons-${one.id}`} flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key={`rule-add-${one.id}`} label="Add to CLAUDE.md" onPress={() => actions.ruleAdd(one.id)} />
            <Button key={`rule-dismiss-${one.id}`} plain dimColor label="Dismiss" onPress={() => actions.ruleDismiss(one.id)} />
          </Box>
        </Box>
      ))}
      {done && <Text key="rule-done" color={GREEN} wrap="wrap">{done.text}</Text>}
    </Box>
  )
}
