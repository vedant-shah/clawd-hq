// The Office tab: Clawd's card and who is at work. Finished work is listed in the Settings tab.
import { clawdAvatar, assemble, avatarFor, tinyIcon } from './avatars'
import { artifactsShown, since } from './artifacts'
import { clawdMood, poseOf, quipOf } from './clawd-says'
import { lookAlt, lookOf, stepOf } from './clawd-look'
import { COFFEE_OFFER_LINE, isDrinking, isOffering } from './coffee-break'
import { AMBER, GREEN, RED, givenName, hash } from './office'
import { atWork, deskWords, modelLabel, recentFailures, statusOf, titled, workLine } from './panel-model'
import { effortLabel } from './usage'
import { stepCount } from './steps'
import { overlay } from './pixels'
import { knowSection } from './panel-know'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import type { Employee } from '../types'

// A failure stays on Clawd's status line this long.
const SICK_MS = 10 * 60_000
const BORDER = '#454542'
/** How many different beats the pictures at work are spread over. */
const BEATS = 11
/** The colour of the dot before the status line: green when Clawd is free, amber while a turn of his runs, red on a failure. */
const TONE = { clear: GREEN, busy: AMBER, alert: RED } as const

type Ctx = { kit: Kit; data: PanelData; actions: PanelActions; cw: number }

function clawdCard({ kit, data, actions, cw }: Ctx) {
  const { Box, Text, sprite } = kit
  const { staff, boss, tick, now } = data
  const working = atWork(staff)
  const failed = recentFailures(staff, now, SICK_MS).map(one => titled(one, data))
  const status = statusOf(boss.isBusy, working.length, failed)
  // While the button shows he is awake (DECIDED: no napping through his own invitation) and his one fixed line wins over any quip.
  const isOffer = isOffering(data)
  const felt = clawdMood(boss, working.length, tick, now)
  const mood = isOffer && felt === 'sleepy' ? 'chill' : felt
  const said = isOffer ? COFFEE_OFFER_LINE : quipOf(boss, mood, tick, { title: boss.lastTitle, n: working.length })
  const chatModel = [modelLabel(data.gauge.model), effortLabel(data.gauge.effort)].filter(Boolean).join(' · ')
  const isStacked = cw < 50
  // On the terminal, which cannot scale a picture, Clawd gets his small drawing: still the largest in the pane.
  // He blinks now and then, and his logbook moves while a turn of his runs. Asleep or at a coffee break he looks it (hooks/clawd-look.ts).
  const look = lookOf(mood, isDrinking(data))
  const [still, moving] = [clawdAvatar(), clawdAvatar({ ...poseOf(tick, 0, boss.isBusy), look, step: stepOf(tick) })]
  const [like, drawn] = kit.isTerminal ? [still.compact, moving.compact] : [still.full, moving.full]
  return (
    <Box borderStyle="round" borderDimColor paddingX={1} flexDirection={isStacked ? 'column' : 'row'} gap={2} alignItems={isStacked ? 'flex-start' : 'center'}>
      <Box flexShrink={0}>{sprite('clawd', drawn, { scale: 4, like, alt: lookAlt(look) })}</Box>
      <Box key="clawd-lines" flexDirection="column" flexShrink={1} flexGrow={1} gap={kit.isTerminal ? 0 : 1}>
        <Text bold>Clawd <Text dimColor>Chief of Staff</Text></Text>
        {/* The main chat's model and effort, muted like a specialist's; nothing while the model is unknown. */}
        {chatModel !== '' && <Text key="clawd-model" dimColor wrap="wrap">{chatModel}</Text>}
        {/* What he says comes first, under his name; the status line sits below it. */}
        <Box borderStyle="round" borderDimColor paddingX={1} flexShrink={1}>
          <Text italic wrap="wrap">{said}</Text>
        </Box>
        <Box flexDirection="row" columnGap={1}>
          <Text color={TONE[status.tone]}>●</Text>
          <Text bold wrap="wrap">{status.text}</Text>
        </Box>
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

/** How far along a specialist says it is: a small bar and "Step 2 of 5", drawn only once it has reported a plan; never a guess before. */
function progress(kit: Kit, one: Employee) {
  if (one.stepTotal === undefined) return null
  const { Box, Text, bar } = kit
  const [done, total] = [one.stepDone ?? 0, one.stepTotal]
  return (
    <Box key={`steps-${one.id}`} flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
      {bar((done / total) * 100, `${done} of ${total} steps done`, 'small')}
      <Text dimColor wrap="wrap">{stepCount(done, total)}</Text>
    </Box>
  )
}

/** One specialist at work, as wide as the pane: the picture, then its name and task, what it just said (in italics) with only its model, time and tokens under it, or, until it has said anything, the step it is on. Every line wraps. */
function deskRow(one: Employee, { kit, data }: Ctx) {
  const { Box, Text, sprite } = kit
  const line = workLine(one, data.now)
  // A step note stands in for the words before it; a leading "Step N of M" is left to the count beside the bar.
  const { said, sentence } = deskWords(one, line)
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
        {said !== undefined
          ? [
            <Text key={`said-${one.id}`} italic wrap="wrap">{said}</Text>,
            // The specialist has said what it does, so the tool is not repeated: only the model, time and tokens, muted.
            <Text key={`stats-${one.id}`} dimColor wrap="wrap">{line.stats.replace(/^· /, '')}</Text>,
          ]
          : (
            // Nothing said yet: the step it is on stands in, labelled and muted.
            <Text wrap="wrap"><Text dimColor>Now: </Text><Text dimColor>{sentence}</Text><Text dimColor>{` ${line.stats}`}</Text></Text>
          )}
        {progress(kit, one)}
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

/** The pages Claude made in this project, newest first: each title a link that opens it, with how long ago. None, no section. */
function artifactDesk({ kit, data }: Ctx) {
  const { Box, Text, Link } = kit
  const { rows, older } = artifactsShown(data.artifacts)
  if (rows.length === 0) return null
  return (
    <Box key="artifact-desk" flexDirection="column">
      <Text bold dimColor>{`ARTIFACTS · ${rows.length + older}`}</Text>
      {rows.map(one => (
        // A long title wraps under itself and is never cut with a mark; the time keeps its place beside it.
        <Box key={`artifact-${one.url}`} flexDirection="row" columnGap={1}>
          <Box flexShrink={1}><Text wrap="wrap"><Link href={one.url}>{one.title}</Link></Text></Box>
          <Box flexShrink={0}><Text dimColor wrap="wrap">{since(data.now - one.at)}</Text></Box>
        </Box>
      ))}
      {older > 0 && <Text dimColor>{older === 1 ? '1 older artifact' : `${older} older artifacts`}</Text>}
    </Box>
  )
}

export function officeTab(kit: Kit, data: PanelData, actions: PanelActions, cw: number) {
  const ctx: Ctx = { kit, data, actions, cw }
  return (
    <kit.Box flexDirection="column" gap={1}>
      {clawdCard(ctx)}
      {knowSection(kit, data, actions)}
      {floor(ctx)}
      {artifactDesk(ctx)}
    </kit.Box>
  )
}
