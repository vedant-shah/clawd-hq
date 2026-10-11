// The Office tab: Clawd's card and who is at work. Finished work lives in the Log tab.
import { clawdAvatar, assemble, avatarFor } from './avatars'
import { clawdMood, isBlinking, quipOf } from './clawd-says'
import { AMBER, GREEN, displayName } from './office'
import { atWork, isWaiting, recentFailures, seeNeedsLabel, statusOf, titled, workLine } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import type { Employee } from '../types'

// A failure stays on Clawd's status line this long.
const SICK_MS = 10 * 60_000
const BORDER = '#454542'

type Ctx = { kit: Kit; data: PanelData; actions: PanelActions; cw: number }

function clawdCard({ kit, data, actions, cw }: Ctx) {
  const { Box, Text, Button, sprite } = kit
  const { staff, boss, tick, now, asks } = data
  const waiting = asks.filter(isWaiting)
  const working = atWork(staff)
  const failed = recentFailures(staff, now, SICK_MS).map(one => displayName(one, staff, data.roster))
  const status = statusOf(waiting.length, failed)
  const mood = clawdMood(boss, working.length, waiting.length, tick, now)
  const said = quipOf(boss, mood, tick, { name: boss.lastName, title: boss.lastTitle, n: working.length, q: waiting.length })
  const canResume = !boss.isBusy && working.length === 0 && boss.task !== undefined
  const isStacked = cw < 50
  const { full } = clawdAvatar(isBlinking(tick))
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} flexDirection={isStacked ? 'column' : 'row'} gap={2} alignItems={isStacked ? 'flex-start' : 'center'}>
      <Box flexShrink={0}>{sprite('clawd', full, { scale: 4, alt: 'Clawd, the chief of staff, in a navy blazer and red tie, holding a logbook' })}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text bold>Clawd <Text dimColor>Chief of Staff</Text></Text>
        <Text bold color={status.isClear ? GREEN : AMBER} wrap="truncate">{status.isClear ? '✓ ' : '! '}{status.text}</Text>
        <Box marginTop={1} borderStyle="round" borderDimColor paddingX={1} flexShrink={1}>
          <Text italic wrap="wrap">{said}</Text>
        </Box>
        {waiting.length > 0 && (
          <Box marginTop={1}>
            <Button key="see-needs" hotkey="i" variant="primary" label={seeNeedsLabel(waiting)} onPress={() => actions.openDesk()} />
          </Box>
        )}
        {waiting.length === 0 && canResume && (
          <Box marginTop={1}>
            <Button key="resume" label={boss.outcome === 'stopped' ? 'retry last task' : 'pick up where we left off'}
              onPress={() => actions.resume(boss.task ?? '')} />
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** One specialist at work, as wide as the pane: the picture, then its name and task, what it just said, and what it is doing now. Every line wraps. */
function deskRow(one: Employee, { kit, data }: Ctx) {
  const { Box, Text, sprite } = kit
  const line = workLine(one, data.asks, data.now)
  const picture = sprite(`desk-${one.id}`, assemble(avatarFor(one.type)), { scale: 3, alt: `${titled(one, data)}` })
  return (
    <Box key={`desk-${one.id}`} borderStyle="round" borderColor={line.isWaiting ? AMBER : undefined} borderDimColor={!line.isWaiting}
      paddingX={1} flexDirection="row" gap={2} alignItems="center">
      <Box flexShrink={0}>{picture}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap"><Text bold>{titled(one, data)}</Text><Text dimColor>{` ${one.description || one.type}`}</Text></Text>
        {line.said !== undefined && <Text key={`said-${one.id}`} wrap="wrap">{line.said}</Text>}
        <Text wrap="wrap"><Text color={line.isWaiting ? AMBER : undefined}>{line.sentence}</Text><Text dimColor>{` ${line.stats}`}</Text></Text>
      </Box>
    </Box>
  )
}

function floor(ctx: Ctx) {
  const { Box, Text } = ctx.kit
  const working = atWork(ctx.data.staff)
  if (working.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold dimColor>THE FLOOR</Text>
        <Box borderStyle="round" borderColor={BORDER} borderDimColor paddingX={2} paddingY={1} flexDirection="column">
          <Text>No one at a desk yet.</Text>
          <Text dimColor>Specialists appear here while they work.</Text>
        </Box>
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Text bold dimColor>{`AT WORK · ${working.length}`}</Text>
      <Box key="floor-rows" flexDirection="column">{working.map(one => deskRow(one, ctx))}</Box>
    </Box>
  )
}

export function officeTab(kit: Kit, data: PanelData, actions: PanelActions, cw: number) {
  const ctx: Ctx = { kit, data, actions, cw }
  return (
    <kit.Box flexDirection="column" gap={1}>
      {clawdCard(ctx)}
      {floor(ctx)}
    </kit.Box>
  )
}
