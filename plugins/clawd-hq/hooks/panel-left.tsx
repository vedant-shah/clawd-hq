// The "Left undone" section of the Office tab (hooks/left-io.ts keeps the list): work Claude or a specialist put off. Each item
// is one wrapped line, never cut with a mark, with a dim note of where it came from and a Do it now button that fills the
// prompt box. Plain wrapped text only: the words come from answers, files and a model, so nothing in them is read as a link or as Markdown.
import { leftShown, noteOf } from './left-list'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

export function leftSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  if (data.leftUndone.length === 0) return null
  const { rows, more } = leftShown(data.leftUndone)
  return (
    <Box key="left-undone" flexDirection="column">
      <Box key="left-head" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
        <Text bold dimColor>{`LEFT UNDONE · ${data.leftUndone.length}`}</Text>
        <Button key="left-clear" plain dimColor label="Clear" onPress={() => actions.leftClear()} />
      </Box>
      {rows.map(one => (
        <Box key={`left-${one.id}`} flexDirection="column" marginTop={kit.isTerminal ? 0 : 1}>
          <Text wrap="wrap">{one.text}</Text>
          <Text dimColor wrap="wrap">{noteOf(one)}</Text>
          <Box flexDirection="row">
            <Button key={`left-do-${one.id}`} plain label="Do it now" onPress={() => actions.leftDo(one.id)} />
          </Box>
        </Box>
      ))}
      {more > 0 && <Text dimColor>{`${more} more`}</Text>}
    </Box>
  )
}
