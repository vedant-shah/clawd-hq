// The note on Clawd's card from the check on finished work (hooks/know-check.ts): its tag and who did the work, the
// line, and the buttons; Learn more opens the title and explanation that came in the same reply. Plain wrapped text
// only: the words are the model's, so nothing in them is read as a link or as Markdown.
import { ACCENT, AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

export function knowBlock(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const [note, ...waiting] = data.know.notes
  if (!note) return null
  const isOpen = data.know.isOpen && note.explain !== undefined
  return (
    <Box key="know" flexDirection="column" marginTop={kit.isTerminal ? 1 : 0}>
      <Text bold color={note.tag === 'Heads up' ? AMBER : ACCENT} wrap="wrap">{`${note.tag.toUpperCase()} · ${note.who}`}</Text>
      <Text wrap="wrap">{note.line}</Text>
      {isOpen && note.title !== undefined && <Text key="know-title" bold wrap="wrap">{note.title}</Text>}
      {isOpen && <Text key="know-explain" wrap="wrap">{note.explain}</Text>}
      <Box key="know-buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
        {isOpen
          ? <Button key="know-got-it" label="Got it" onPress={() => actions.knowGotIt()} />
          : note.explain !== undefined && <Button key="know-more" label="Learn more" onPress={() => actions.knowMore()} />}
        <Button key="know-knew" plain dimColor label="Knew this already" onPress={() => actions.knowKnew()} />
        <Button key="know-dismiss" plain dimColor label="Dismiss" onPress={() => actions.knowDismiss()} />
      </Box>
      {waiting.length > 0 && <Text dimColor wrap="wrap">{waiting.length === 1 ? '1 more note waiting' : `${waiting.length} more notes waiting`}</Text>}
    </Box>
  )
}
