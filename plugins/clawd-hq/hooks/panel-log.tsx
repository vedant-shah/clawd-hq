// The list of finished work, shown inside the Settings tab: the specialists that finished this session, newest first, under a Back link.
import { avatarFor, compactIcon, tinyIcon } from './avatars'
import { givenName } from './office'
import { AMBER } from './office'
import { doneLine, doneThisSession, titled } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import type { Employee } from '../types'

const MAX_ROWS = 40

function row(one: Employee, { Box, Text, sprite, isTerminal }: Kit, data: PanelData) {
  const line = doneLine(one, data.now)
  const icon = sprite(`done-${one.id}`, (isTerminal ? tinyIcon : compactIcon)(avatarFor(givenName(one) ?? one.type)), { scale: 3, alt: '', keep: 0.7 })
  const isAlert = line.isFailed || line.isLost
  const tookColor = isAlert ? AMBER : undefined
  return (
    <Box key={`done-${one.id}`} flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      <Box flexShrink={0}>{icon}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap">{titled(one, data)}</Text>
        <Text dimColor wrap="wrap">{one.description || one.type}</Text>
        {isTerminal && <Text color={tookColor} dimColor={!isAlert} wrap="wrap">{`${line.when} · ${line.took}`}</Text>}
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

export function logTab(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = kit
  const done = doneThisSession(data.staff, data.gauge.startedAt)
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="settings-back" plain label="‹ Back" onPress={() => actions.showLog(false)} />
      {done.length === 0 && <Text dimColor wrap="wrap">Nothing has finished yet this session.</Text>}
      {done.length > 0 && <Text bold dimColor>{`FINISHED THIS SESSION · ${done.length}`}</Text>}
      {done.slice(0, MAX_ROWS).map(one => row(one, kit, data))}
      {done.length > MAX_ROWS && <Text dimColor>{`Showing ${MAX_ROWS} of ${done.length}`}</Text>}
    </Box>
  )
}
