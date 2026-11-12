// One specialist at work, drawn as a card (the Office tab's floor, and under a step of the plan on the desktop). The picture is the specialist's
// own on the desktop; the terminal's smallest (8 by 8 dots) where a card is drawn there at all.
import { assemble, avatarFor, tinyIcon } from './avatars'
import { poseOf } from './clawd-says'
import { givenName, hash } from './office'
import { deskWords, tagged, titled, workLine } from './panel-model'
import { overlay } from './pixels'
import { BOARD } from './plan-marks'
import { stepCount } from './steps'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import type { Employee } from '../types'

export type Ctx = { kit: Kit; data: PanelData; actions: PanelActions; cw: number }

/** How many different beats the pictures at work are spread over. */
const BEATS = 11

/** What a card may take besides the specialist: a border colour, a button (or any item) at its right, and lines under its words. */
export type DeskExtras = {
  borderColor?: string; right?: JSX.Element | null; below?: JSX.Element | null; scale?: number
  /** Lines to draw in place of what it said and its stats (a failed card's reason in red, with the stats dim under it). */
  words?: JSX.Element[] | null
  /** The card as the design board draws it: a 120 pixel bar on its own track, drawn only once a step is done. */
  isBoard?: boolean
}

/** CSS pixels per picture pixel on the floor's cards, and (the design board's) on the plan's: 23 dots across are 46 pixels there. */
export const FLOOR_SCALE = 3
export const PLAN_SCALE = 2

/** How far along a specialist says it is: a small bar and "Step 2 of 5", drawn only once it has reported a plan; never a guess before. */
function progress(kit: Kit, one: Employee, isBoard = false) {
  if (one.stepTotal === undefined) return null
  // On the design board a bar is not drawn until a step is done; the floor's cards keep drawing it from the first report.
  if (isBoard && (one.stepDone ?? 0) === 0) return null
  const { Box, Text, bar } = kit
  const [done, total] = [one.stepDone ?? 0, one.stepTotal]
  const alt = `${done} of ${total} steps done`
  // The board's bar is 120 pixels on its own track; the floor's keeps its size.
  return (
    <Box key={`steps-${one.id}`} flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
      {isBoard ? bar((done / total) * 100, alt, 'small', undefined, { width: BOARD.barWidth, track: BOARD.barTrack }) : bar((done / total) * 100, alt, 'small')}
      <Text dimColor wrap="wrap">{stepCount(done, total)}</Text>
    </Box>
  )
}

/** One specialist at work, as wide as the pane: the picture, then its name and task, what it just said (in italics) with only its model, time and tokens under it, or, until it has said anything, the step it is on. Every line wraps. */
export function deskRow(one: Employee, { kit, data }: Ctx, extras: DeskExtras = {}) {
  const { Box, Text, sprite } = kit
  const line = workLine(one, data.now)
  // A step note stands in for the words before it; a leading "Step N of M" is left to the count beside the bar.
  const { said, sentence } = deskWords(one, line)
  // The terminal cannot scale a picture, so a row there gets the tiny 8 by 8 one and its words get the room.
  const look = avatarFor(givenName(one) ?? one.type)
  const tag = tagged(one, data)
  // At work it blinks now and then and moves what it holds, on a beat of its own.
  const [draw, pose] = [kit.isTerminal ? tinyIcon : assemble, poseOf(data.tick, hash(one.id) % BEATS, true)]
  // Its room is the still picture's; where there is height to spare, the lifted one's too, so what it holds is never cut.
  const like = kit.isTerminal ? draw(look) : overlay(draw(look), draw(look, { isLifted: true }))
  const picture = sprite(`desk-${one.id}`, draw(look, pose), { scale: extras.scale ?? FLOOR_SCALE, like, alt: `${titled(one, data)}` })
  const isBoard = extras.isBoard === true && !kit.isTerminal
  return (
    <Box key={`desk-${one.id}`} borderStyle="round" borderDimColor={extras.borderColor === undefined} borderColor={extras.borderColor} paddingX={1} flexDirection="row" gap={2} alignItems="center">
      <Box flexShrink={0}>{picture}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text wrap="wrap"><Text bold>{titled(one, data)}</Text>{tag !== undefined && <Text dimColor>{tag}</Text>}<Text dimColor>{` ${one.description || one.type}`}</Text></Text>
        {extras.words ?? (said !== undefined
          ? [
            <Text key={`said-${one.id}`} italic wrap="wrap">{said}</Text>,
            // The specialist has said what it does, so the tool is not repeated: only the model, time and tokens, muted.
            <Text key={`stats-${one.id}`} dimColor wrap="wrap">{line.stats.replace(/^· /, '')}</Text>,
          ]
          : (
            // Nothing said yet: the step it is on stands in, labelled and muted.
            <Text wrap="wrap"><Text dimColor>Now: </Text><Text dimColor>{sentence}</Text><Text dimColor>{` ${line.stats}`}</Text></Text>
          ))}
        {progress(kit, one, isBoard)}
        {extras.below}
      </Box>
      {extras.right}
    </Box>
  )
}
