// The card of a council (voices hired with a `COUNCIL: <question>` line, hooks/pair-up.ts): one card with the council's own picture
// (hooks/council-avatar.ts), not the voices'. On the Office tab's floor while any voice works, each voice with its status. Every line wraps
// and nothing is cut with a mark.
import type { Employee, Mood } from '../types'
import { councilIcon, councilTinyIcon } from './council-avatar'
import { tagged, titled } from './panel-model'
import { pairLine } from './pair-up'
import type { PairGroup } from './pair-up'
import type { Kit } from './panel-kit'
import type { PanelData } from './panel-types'


const STATUS: Record<Mood, string> = {
  arriving: 'Working', working: 'Working', thinking: 'Thinking', done: 'Done', failed: 'Failed', lost: 'Lost contact', stopped: 'Stopped',
}

/** The council's picture: the tiny one on the terminal, the list-sized one elsewhere. */
function picture(kit: Kit, key: string, keep: number) {
  const { Box, sprite, isTerminal } = kit
  return (
    <Box key={`${key}-picture`} flexShrink={0}>
      {sprite(`${key}-avatar`, isTerminal ? councilTinyIcon() : councilIcon(), { scale: 3, alt: 'Council', keep })}
    </Box>
  )
}

/** A voice's name (or role) and, dim, its other role and what it is doing. */
function voiceName(kit: Kit, data: PanelData, one: Employee, key: string) {
  const { Text } = kit
  const status = ` · ${STATUS[one.mood]}`
  return <Text key={key} wrap="wrap"><Text>{titled(one, data)}</Text><Text dimColor>{`${tagged(one, data) ?? ''}${status}`}</Text></Text>
}

/** The floor's card: the picture, "Council" with the question beside it, each voice and its status, and one status line. */
export function councilDesk(kit: Kit, data: PanelData, group: PairGroup) {
  const { Box, Text } = kit
  const first = group.members[0]!
  return (
    <Box key={`council-${first.id}`} borderStyle="round" borderDimColor paddingX={1} flexDirection="row" gap={2} alignItems="center">
      {picture(kit, 'council', 1)}
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap"><Text bold>Council</Text><Text dimColor>{` ${group.goal}`}</Text></Text>
        {group.members.map(one => voiceName(kit, data, one, `council-voice-${one.id}`))}
        <Text key={`council-status-${first.id}`} dimColor wrap="wrap">{pairLine(group.members, data.now).text}</Text>
      </Box>
    </Box>
  )
}

/** One finished voice: its name, then the first line of its report in plain words (a voice with no report has only its name). */

