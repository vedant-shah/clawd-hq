// Onboarding: setup drawn on Clawd's card in the Office tab. Drawing only: what to say and which button to show come in as an
// OnboardCard (hooks/onboard-types.ts); a press goes back as the button that was pressed.
// Only the Text props every engine takes (color, dimColor, bold, wrap): the desktop app can bundle an older engine.
// The one button, Dismiss, is dim. Every line wraps and none is cut with a mark.
import { LOOKING_LINE } from './onboard-cards'
import type { OnboardButton, OnboardCard } from './onboard-types'
import type { Kit } from './panel-kit'

export type OnboardActions = { readonly choose: (button: OnboardButton) => unknown }

const HEADINGS = { scan: 'SETTING UP', failed: 'SETTING UP', done: 'SET UP' } as const

const isDrawn = (card: OnboardCard | undefined): card is OnboardCard & { step: keyof typeof HEADINGS } => card !== undefined && card.step !== 'quiet'

/** What Clawd says: the card's lines, or "Looking around…" while setup works and nothing else has been said. */
function wordsBlock(kit: Kit, card: OnboardCard) {
  const { Box, Text } = kit
  const lines = card.lines.length === 0 && card.step === 'scan' ? [LOOKING_LINE] : card.lines
  return (
    <Box key="onboard-words" flexDirection="column">
      {lines.map((l, i) => <Text key={`line-${i}`} dimColor={i > 0} wrap="wrap">{l}</Text>)}
    </Box>
  )
}

/** The setup section of the Office tab, under Clawd's card: the quiet working line, the small card afterwards, or the stopped card; nothing once held quiet. */
export function onboardSection(kit: Kit, card: OnboardCard | undefined, actions: OnboardActions) {
  if (!isDrawn(card)) return null
  const { Box, Text, Button } = kit
  return (
    <Box key="onboard" flexDirection="column">
      <Text bold dimColor>{HEADINGS[card.step]}</Text>
      <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
        {wordsBlock(kit, card)}
        {card.note !== undefined && <Text key="onboard-note" dimColor wrap="wrap">{card.note}</Text>}
        {card.buttons.length > 0 && (
          <Box key="onboard-buttons" flexDirection="row" flexWrap="wrap" columnGap={1}>
            {card.buttons.map(b => <Button key={`onboard-${b.action}`} plain dimColor label={b.label} onPress={() => actions.choose(b)} />)}
          </Box>
        )}
      </Box>
    </Box>
  )
}
