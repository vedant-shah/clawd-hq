// The Decisions tab: what the project has settled, newest first, grouped by day.
import { whoOf } from './desk'
import { CLAWD_COLOR } from './office'
import { filterMemory, groupByDay, newestFirst } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import type { Memory } from '../types'

const MAX_SHOWN = 40
const INK = '#1b1b1a'
const TAG_WIDTH = 6

function entry(m: Memory, { Box, Text, Button }: Kit, actions: PanelActions) {
  const isYou = m.kind === 'decision'
  return (
    <Box key={`mem-${m.id}`} flexDirection="row" gap={1} alignItems="flex-start">
      <Box width={TAG_WIDTH} flexShrink={0}>
        {isYou ? <Text bold color={INK} backgroundColor={CLAWD_COLOR}>{' You '}</Text> : <Text dimColor>{'[Note]'}</Text>}
      </Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        {isYou
          ? <Text wrap="wrap">{m.text}</Text>
          : <Text wrap="wrap"><Text>{whoOf(m.by)}</Text><Text dimColor>{` · ${m.text}`}</Text></Text>}
      </Box>
      <Button key={`forget-${m.id}`} plain dimColor label="forget" onPress={() => actions.forget(m.id)} />
    </Box>
  )
}

export function decisionsTab(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Input } = kit
  const query = data.fx.finds?.decisions ?? ''
  const matches = filterMemory(data.memory, query)
  const groups = groupByDay(newestFirst(matches, MAX_SHOWN), data.now)
  const shown = groups.reduce((n, g) => n + g.entries.length, 0)
  const empty = data.memory.length === 0
    ? 'Nothing yet. Decisions you make on the desk, and key choices agents report back, land here.'
    : 'Nothing matches that.'
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2} alignItems="center">
        {Input && (
          <Box flexGrow={1}>
            <Input key="find-decisions" label="/" placeholder="Filter decisions" value={query} onInput={v => actions.setFind('decisions', v)}
              onSubmit={v => actions.setFind('decisions', v)} />
          </Box>
        )}
        <Text dimColor>{`${data.memory.length} total`}</Text>
      </Box>
      {shown === 0 && <Text dimColor wrap="wrap">{empty}</Text>}
      {groups.map(g => (
        <Box key={`day-${g.label}`} flexDirection="column" gap={1}>
          <Text bold dimColor>{g.label}</Text>
          {g.entries.map(m => entry(m, kit, actions))}
        </Box>
      ))}
      {shown < matches.length && <Text dimColor>{`Showing ${shown} of ${matches.length} · filter to narrow down`}</Text>}
    </Box>
  )
}
