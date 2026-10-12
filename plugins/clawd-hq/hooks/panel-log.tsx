// The Log tab: the specialists that finished this session, newest first.
import { avatarFor, compactIcon } from './avatars'
import { givenName } from './office'
import { AMBER } from './office'
import { doneLine, doneThisSession, titled } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelData } from './panel-types'
import type { Employee } from '../types'

const MAX_ROWS = 40

function row(one: Employee, { Box, Text, sprite, isTerminal }: Kit, data: PanelData) {
  const line = doneLine(one, data.now)
  const icon = sprite(`done-${one.id}`, compactIcon(avatarFor(givenName(one) ?? one.type)), { scale: 3, alt: '', keep: 0.7 })
  const isAlert = line.isFailed || line.isLost
  const tookColor = isAlert ? AMBER : undefined
  return (
    <Box key={`done-${one.id}`} flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      <Box flexShrink={0}>{icon}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="truncate">{titled(one, data)}</Text>
        <Text dimColor wrap="truncate">{one.description || one.type}</Text>
        {isTerminal && <Text color={tookColor} dimColor={!isAlert} wrap="truncate">{`${line.when} · ${line.took}`}</Text>}
      </Box>
      {!isTerminal && (
        <Box flexDirection="column" alignItems="flex-end" flexShrink={0}>
          <Text dimColor>{line.when}</Text>
          <Text color={tookColor} dimColor={!isAlert}>{line.took}</Text>
        </Box>
      )}
    </Box>
  )
}

export function logTab(kit: Kit, data: PanelData) {
  const { Box, Text } = kit
  const done = doneThisSession(data.staff, data.gauge.startedAt)
  if (done.length === 0) return <Text dimColor wrap="wrap">Nothing has finished yet this session.</Text>
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold dimColor>{`FINISHED THIS SESSION · ${done.length}`}</Text>
      {done.slice(0, MAX_ROWS).map(one => row(one, kit, data))}
      {done.length > MAX_ROWS && <Text dimColor>{`Showing ${MAX_ROWS} of ${done.length}`}</Text>}
    </Box>
  )
}
