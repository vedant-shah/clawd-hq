// The card of specialists hired together as a pair-up (hooks/pair-up.ts): on the Office tab's floor while any of them works, in the finished list once none does.
// DECIDED: the pictures are the smallest ones that already exist (the list icon, and the tiny picture on the terminal), side by side, not new art.
import { avatarFor, compactIcon, tinyIcon } from './avatars'
import { AMBER, ago, givenName } from './office'
import { isActive, titled } from './panel-model'
import { pairLine, pairTitle } from './pair-up'
import type { PairGroup, PairState } from './pair-up'
import type { Kit } from './panel-kit'
import type { PanelData } from './panel-types'

/** A failure, or contact lost, is amber like the single rows; every other end is dim. */
const TONE: Partial<Record<PairState, string>> = { failed: AMBER, lost: AMBER }

/** The members' small pictures in a row that wraps on a narrow pane. A member that has finished while another still works is dimmed. */
function pictures(kit: Kit, group: PairGroup, data: PanelData, prefix: string, keep?: number) {
  const { Box, sprite, isTerminal } = kit
  const draw = isTerminal ? tinyIcon : compactIcon
  return (
    <Box key={`${prefix}-pictures`} flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
      {group.members.map(one => sprite(`${prefix}-avatar-${one.id}`, draw(avatarFor(givenName(one) ?? one.type)), {
        scale: 3, alt: titled(one, data), keep: keep ?? (isActive(one) ? 1 : 0.5),
      }))}
    </Box>
  )
}

const titleOf = (group: PairGroup, data: PanelData) => pairTitle(group.members.map(one => titled(one, data)))

/** The floor's card: the pictures, "A & B" with the goal beside it, and one status line. Every line wraps. */
export function pairDesk(kit: Kit, data: PanelData, group: PairGroup) {
  const { Box, Text } = kit
  const first = group.members[0]!
  return (
    <Box key={`pair-${first.id}`} borderStyle="round" borderDimColor paddingX={1} flexDirection="row" gap={2} alignItems="center">
      {pictures(kit, group, data, 'pair')}
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap"><Text bold>{titleOf(group, data)}</Text><Text dimColor>{` ${group.goal}`}</Text></Text>
        <Text key={`pair-status-${first.id}`} dimColor wrap="wrap">{pairLine(group.members, data.now).text}</Text>
      </Box>
    </Box>
  )
}

/** The finished list's row for a pair-up that is over: dimmed pictures, "A & B" with the goal, and when and how it ended. */
export function pairDone(kit: Kit, data: PanelData, group: PairGroup) {
  const { Box, Text, isTerminal } = kit
  const first = group.members[0]!
  const { state, text } = pairLine(group.members, data.now)
  const when = `${ago(data.now - Math.max(...group.members.map(one => one.endedAt ?? 0)))} ago`
  const color = TONE[state]
  return (
    <Box key={`done-pair-${first.id}`} flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      {pictures(kit, group, data, 'done-pair', 0.7)}
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap">{titleOf(group, data)}</Text>
        <Text dimColor wrap="wrap">{group.goal}</Text>
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
