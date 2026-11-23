// The "You should know" section of the Office tab (hooks/know-check.ts): a card with the note's tag and who it is about, the
// line, and the buttons. Learn more opens the title and explanation (the reply's own, or one it asks for), with Simpler, Shorter
// and More detail to ask again. Plain wrapped text only: the words are the model's, so nothing in them is read as a link or as Markdown.
import { ACCENT, AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

export function knowSection(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const { note, isOpen, explaining, explainNote } = data.know
  if (!note) return null
  const canAsk = isOpen && explaining === undefined && note.explain !== undefined
  return (
    // No heading of its own: it sits under Needs you, and its tag is its label (a heading above it said the same words twice).
    <Box key="know" flexDirection="column">
      <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
        <Box key="know-who" flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text bold color={note.tag === 'Heads up' ? AMBER : ACCENT}>{note.tag.toUpperCase()}</Text>
          <Text dimColor wrap="wrap">{`· ${note.who}`}</Text>
        </Box>
        <Text wrap="wrap">{note.line}</Text>
        {isOpen && (
          <Box key="know-more-text" flexDirection="column" marginTop={kit.isTerminal ? 1 : 0}>
            {note.title !== undefined && note.explain !== undefined && <Text key="know-title" bold wrap="wrap">{note.title}</Text>}
            {note.explain !== undefined && <Text key="know-explain" dimColor wrap="wrap">{note.explain}</Text>}
            {explaining !== undefined && <Text key="know-writing" dimColor italic wrap="wrap">Writing the explanation…</Text>}
            {explaining === undefined && explainNote !== undefined && <Text key="know-explain-note" dimColor wrap="wrap">{explainNote}</Text>}
          </Box>
        )}
        <Box key="know-buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {!isOpen && <Button key="know-more" label="Learn more" onPress={() => actions.knowMore()} />}
          {canAsk && <Button key="know-simpler" plain dimColor label="Simpler" onPress={() => actions.knowSimpler()} />}
          {canAsk && <Button key="know-shorter" plain dimColor label="Shorter" onPress={() => actions.knowShorter()} />}
          {canAsk && <Button key="know-detail" plain dimColor label="More detail" onPress={() => actions.knowDetail()} />}
          <Button key="know-got-it" label="Knew this" onPress={() => actions.knowGotIt()} />
          <Button key="know-discuss" plain dimColor label="Ask Clawd" onPress={() => actions.knowDiscuss()} />
          <Button key="know-dismiss" plain dimColor label="Dismiss" onPress={() => actions.knowDismiss()} />
        </Box>
      </Box>
    </Box>
  )
}
