// The Office tab: Clawd's card and who is at work. Finished work lives in the Log tab.
import { clawdAvatar, assemble, avatarFor, tinyIcon } from './avatars'
import { clawdMood, poseOf, quipOf } from './clawd-says'
import { ACCENT, AMBER, GREEN, givenName, hash } from './office'
import { atWork, recentFailures, statusOf, titled, workLine } from './panel-model'
import { overlay } from './pixels'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import type { Employee } from '../types'

// A failure stays on Clawd's status line this long.
const SICK_MS = 10 * 60_000
const BORDER = '#454542'
/** How many different beats the pictures at work are spread over. */
const BEATS = 11
/** How the status line opens and what colour it takes: all clear, Clawd at work, or a failure. */
const TONE = { clear: { mark: '✓ ', color: GREEN }, busy: { mark: '● ', color: ACCENT }, alert: { mark: '! ', color: AMBER } } as const

type Ctx = { kit: Kit; data: PanelData; actions: PanelActions; cw: number }

function clawdCard({ kit, data, cw }: Ctx) {
  const { Box, Text, sprite } = kit
  const { staff, boss, tick, now } = data
  const working = atWork(staff)
  const failed = recentFailures(staff, now, SICK_MS).map(one => titled(one, data))
  const status = statusOf(boss.isBusy, working.length, failed)
  const mood = clawdMood(boss, working.length, tick, now)
  const said = quipOf(boss, mood, tick, { title: boss.lastTitle, n: working.length })
  const isStacked = cw < 50
  // On the terminal, which cannot scale a picture, Clawd gets his small drawing: still the largest in the pane.
  // He blinks now and then, and his logbook moves while a turn of his runs.
  const [still, moving] = [clawdAvatar(), clawdAvatar(poseOf(tick, 0, boss.isBusy))]
  const [like, drawn] = kit.isTerminal ? [still.compact, moving.compact] : [still.full, moving.full]
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} flexDirection={isStacked ? 'column' : 'row'} gap={2} alignItems={isStacked ? 'flex-start' : 'center'}>
      <Box flexShrink={0}>{sprite('clawd', drawn, { scale: 4, like, alt: 'Clawd, the chief of staff, in a navy blazer and red tie, holding a logbook' })}</Box>
      <Box key="clawd-lines" flexDirection="column" flexShrink={1} flexGrow={1} gap={kit.isTerminal ? 0 : 1}>
        <Text bold>Clawd <Text dimColor>Chief of Staff</Text></Text>
        {/* What he says comes first, under his name; the status line sits below it. */}
        <Box borderStyle="round" borderDimColor paddingX={1} flexShrink={1}>
          <Text italic wrap="wrap">{said}</Text>
        </Box>
        <Text bold color={TONE[status.tone].color} wrap="wrap">{TONE[status.tone].mark}{status.text}</Text>
        {/* After a few quiet minutes: one line on where things stand, until the next turn starts. */}
        {!boss.isBusy && boss.recap !== undefined && (
          <Box key="recap" marginTop={kit.isTerminal ? 1 : 0} flexDirection="column">
            <Text bold dimColor>WHERE WE LEFT OFF</Text>
            <Text wrap="wrap">{boss.recap}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** One specialist at work, as wide as the pane: the picture, then its name and task, what it just said (in italics) with only its model, time and tokens under it, or, until it has said anything, the step it is on. Every line wraps. */
function deskRow(one: Employee, { kit, data }: Ctx) {
  const { Box, Text, sprite } = kit
  const line = workLine(one, data.now)
  // The terminal cannot scale a picture, so a row there gets the tiny 8 by 8 one and its words get the room.
  const look = avatarFor(givenName(one) ?? one.type)
  // At work it blinks now and then and moves what it holds, on a beat of its own.
  const [draw, pose] = [kit.isTerminal ? tinyIcon : assemble, poseOf(data.tick, hash(one.id) % BEATS, true)]
  // Its room is the still picture's; where there is height to spare, the lifted one's too, so what it holds is never cut.
  const like = kit.isTerminal ? draw(look) : overlay(draw(look), draw(look, { isLifted: true }))
  const picture = sprite(`desk-${one.id}`, draw(look, pose), { scale: 3, like, alt: `${titled(one, data)}` })
  return (
    <Box key={`desk-${one.id}`} borderStyle="round" borderDimColor paddingX={1} flexDirection="row" gap={2} alignItems="center">
      <Box flexShrink={0}>{picture}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap"><Text bold>{titled(one, data)}</Text><Text dimColor>{` ${one.description || one.type}`}</Text></Text>
        {line.said !== undefined
          ? [
            <Text key={`said-${one.id}`} italic wrap="wrap">{line.said}</Text>,
            // The specialist has said what it does, so the tool is not repeated: only the model, time and tokens, muted.
            <Text key={`stats-${one.id}`} dimColor wrap="wrap">{line.stats.replace(/^· /, '')}</Text>,
          ]
          : (
            // Nothing said yet: the step it is on stands in, labelled and muted.
            <Text wrap="wrap"><Text dimColor>Now: </Text><Text dimColor>{line.sentence}</Text><Text dimColor>{` ${line.stats}`}</Text></Text>
          )}
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
