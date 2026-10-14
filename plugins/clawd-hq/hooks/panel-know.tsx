// The "You should know" section of the Office tab, from the check on finished work (hooks/know-check.ts): a card with the
// note's tag and who did the work, the line, and the buttons; Learn more opens the title and explanation that came in
// the same reply. Plain wrapped text only: the words are the model's, so nothing in them is read as a link or as Markdown.
import { ACCENT, AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

/** The heading, with how many more notes wait in the line behind the one shown. */
const headingOf = (waiting: number) => `YOU SHOULD KNOW${waiting > 0 ? ` · ${waiting} more waiting` : ''}`

export function knowSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const [note, ...waiting] = data.know.notes
  if (!note) return null
  const isOpen = data.know.isOpen && note.explain !== undefined
  return (
    <Box key="know" flexDirection="column">
      <Text bold dimColor>{headingOf(waiting.length)}</Text>
      <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
        <Box key="know-who" flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold color={note.tag === 'Heads up' ? AMBER : ACCENT}>{note.tag.toUpperCase()}</Text>
          <Text dimColor wrap="wrap">{`· ${note.who}`}</Text>
        </Box>
        <Text wrap="wrap">{note.line}</Text>
        {isOpen && (
          <Box key="know-more-text" flexDirection="column" marginTop={kit.isTerminal ? 1 : 0}>
            {note.title !== undefined && <Text key="know-title" bold wrap="wrap">{note.title}</Text>}
            <Text key="know-explain" dimColor wrap="wrap">{note.explain}</Text>
          </Box>
        )}
        <Box key="know-buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {isOpen
            ? <Button key="know-got-it" label="Got it" onPress={() => actions.knowGotIt()} />
            : note.explain !== undefined && <Button key="know-more" label="Learn more" onPress={() => actions.knowMore()} />}
          <Button key="know-knew" plain dimColor label="Knew this already" onPress={() => actions.knowKnew()} />
          <Button key="know-dismiss" plain dimColor label="Dismiss" onPress={() => actions.knowDismiss()} />
        </Box>
      </Box>
    </Box>
  )
}
