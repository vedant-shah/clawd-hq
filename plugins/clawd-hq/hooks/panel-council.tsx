// The card of a council (voices hired with a `COUNCIL: <question>` line, hooks/pair-up.ts): one card with the council's own picture
// (hooks/council-avatar.ts), not the voices'. On the Office tab's floor while any voice works, each voice with its status; in the finished
// list once none does, each voice with the first line of its report. Every line wraps and nothing is cut with a mark.
import type { Employee, Mood } from '../types'
import { councilIcon, councilTinyIcon } from './council-avatar'
import { AMBER, ago } from './office'
import { choiceLines } from './panel-choices'
import { tagged, titled } from './panel-model'
import { pairLine } from './pair-up'
import type { PairGroup, PairState } from './pair-up'
import type { Kit } from './panel-kit'
import type { PanelData } from './panel-types'

/** A failure, or contact lost, is amber like the single rows; every other end is dim. Shared with the pair-up card. */
export const TONE: Partial<Record<PairState, string>> = { failed: AMBER, lost: AMBER }

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

/** A voice's name (or role) and, dim, its other role and what it is doing; the status of a finished voice only when it did not end well. */
function voiceName(kit: Kit, data: PanelData, one: Employee, key: string, isShowingDone: boolean) {
  const { Text } = kit
  const status = one.mood === 'done' && !isShowingDone ? '' : ` · ${STATUS[one.mood]}`
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
        {group.members.map(one => voiceName(kit, data, one, `council-voice-${one.id}`, true))}
        <Text key={`council-status-${first.id}`} dimColor wrap="wrap">{pairLine(group.members, data.now).text}</Text>
      </Box>
    </Box>
  )
}

/** One finished voice: its name, then the first line of its report in plain words (a voice with no report has only its name). */
function voiceReport(kit: Kit, data: PanelData, one: Employee, key: string) {
  const { Box, Text } = kit
  return (
    <Box key={key} flexDirection="column">
      {voiceName(kit, data, one, `${key}-name`, false)}
      {one.report !== undefined && <Text key={`${key}-report`} dimColor wrap="wrap">{one.report}</Text>}
    </Box>
  )
}

/** The finished list's row for a council that is over: dimmed picture, "Council" and the question, each voice with its first report line, and when and how it ended. */
export function councilDone(kit: Kit, data: PanelData, group: PairGroup) {
  const { Box, Text, isTerminal } = kit
  const first = group.members[0]!
  const { state, text } = pairLine(group.members, data.now)
  const when = `${ago(data.now - Math.max(...group.members.map(one => one.endedAt ?? 0)))} ago`
  const color = TONE[state]
  return (
    <Box key={`done-council-${first.id}`} flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      {picture(kit, 'done-council', 0.7)}
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap">Council</Text>
        <Text dimColor wrap="wrap">{group.goal}</Text>
        {group.members.map(one => voiceReport(kit, data, one, `done-council-${first.id}-${one.id}`))}
        {choiceLines(kit, `done-council-${first.id}`, group.members)}
        {isTerminal && <Text color={color} dimColor={color === undefined} wrap="wrap">{`${when} · ${text}`}</Text>}
      </Box>
      {!isTerminal && (
        <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
          <Text dimColor>{when}</Text>
          <Text color={color} dimColor={color === undefined}>{text}</Text>
        </Box>
      )}
    </Box>
  )
}
