// The card of specialists hired together as a pair-up (hooks/pair-up.ts): on the Office tab's floor while any of them works.
// DECIDED: the pictures are the smallest ones that already exist (the list icon, and the tiny picture on the terminal), side by side, not new art.
import { avatarFor, compactIcon, tinyIcon } from './avatars'
import { givenName } from './office'
import { isActive, titled } from './panel-model'
import { pairLine, pairTitle } from './pair-up'
import type { PairGroup } from './pair-up'
import { councilDesk } from './panel-council'
import type { Kit } from './panel-kit'
import type { PanelData } from './panel-types'

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
  if (group.isCouncil) return councilDesk(kit, data, group) // a council has its own card (hooks/panel-council.tsx)
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

