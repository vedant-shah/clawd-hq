// The Office tab: Clawd's card, what waits on the person, the goal's plan with who is at work on it, and who else is at work. Finished work is listed in the Settings tab.
import { clawdAvatar } from './avatars'
import { artifactsShown, since } from './artifacts'
import { clawdMood, poseOf, quipOf } from './clawd-says'
import { lookAlt, lookOf, stepOf } from './clawd-look'
import { COFFEE_OFFER_LINE, isDrinking, isOffering } from './coffee-break'
import { AMBER, GREEN, RED } from './office'
import { atWork, modelLabel, recentFailures, statusOf, titled } from './panel-model'
import { effortLabel } from './usage'
import { floorSlots } from './pair-up'
import { pairDesk } from './panel-pair'
import { knowSection } from './panel-know'
import { layoffSection } from './panel-layoffs'
import { oldSection } from './panel-old'
import { ruleSection } from './panel-rules'
import { contractorSection } from './panel-contractor'
import { onboardSection } from './panel-onboard'
import { LOST_LINE } from './rules-reach'
import { deskRow } from './panel-desk'
import type { Ctx } from './panel-desk'
import { laterFold } from './panel-later'
import { alsoAtWork, planSection } from './panel-plan'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { foldsOf, planLayout } from './plan-view'
import type { PlanLayout } from './plan-view'

// A failure stays on Clawd's status line this long.
const SICK_MS = 10 * 60_000
const BORDER = '#454542'
/** The colour of the dot before the status line: green when Clawd is free, amber while a turn of his runs, red on a failure. */
const TONE = { clear: GREEN, busy: AMBER, alert: RED } as const

function clawdCard({ kit, data, cw }: Ctx) {
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
      <Box flexShrink={0}>{sprite('clawd', drawn, { scale: 3, like, alt: lookAlt(look) })}</Box>
      <Box key="clawd-lines" flexDirection="column" flexShrink={1} flexGrow={1} gap={kit.isTerminal ? 0 : 1}>
        {/* His name on the top row, with his status to its right; on a narrow pane the status wraps under the name, never cut. */}
        <Box key="clawd-head" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
          <Text bold>Clawd <Text dimColor>Chief of Staff</Text></Text>
          <Box flexDirection="row" columnGap={1} flexShrink={1}>
            <Text color={TONE[status.tone]}>●</Text>
            <Text bold wrap="wrap">{status.text}</Text>
          </Box>
        </Box>
        {/* The main chat's model and effort, muted like a specialist's; nothing while the model is unknown. */}
        {chatModel !== '' && <Text key="clawd-model" dimColor wrap="wrap">{chatModel}</Text>}
        {boss.isRulesLost === true && <Text key="clawd-rules-lost" color={AMBER} wrap="wrap">{LOST_LINE}</Text>}
        {/* What he says sits in its bubble under the model line. */}
        <Box borderStyle="round" borderDimColor paddingX={1} flexShrink={1}>
          <Text italic wrap="wrap">{said}</Text>
        </Box>
      </Box>
    </Box>
  )
}

/** Who is at work. With a goal in hand only those under no step of it, headed "Also at work"; otherwise everyone, as the floor has always been. */
function floor(ctx: Ctx, layout: PlanLayout | undefined) {
  const { Box, Text } = ctx.kit
  if (layout !== undefined) return alsoAtWork(ctx, layout)
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
      <Box key="floor-rows" flexDirection="column" gap={1}>{floorSlots(ctx.data.staff).map(slot => (slot.kind === 'pair' ? pairDesk(ctx.kit, ctx.data, slot.group) : deskRow(slot.one, ctx)))}</Box>
    </Box>
  )
}

/** What waits on the person, under one amber heading: the check on finished work, offers of a rule or of staff, the old decisions file, the layoff notice and the setup step. None, no section. */
function needsYou({ kit, data, actions }: Ctx) {
  const { Box, Text } = kit
  const cards = [
    knowSection(kit, data, actions), ruleSection(kit, data, actions), contractorSection(kit, data, actions), oldSection(kit, data, actions),
    layoffSection(kit, data, actions), onboardSection(kit, data.onboard, { choose: actions.choose }),
  ].filter(card => card !== null && card !== undefined)
  if (cards.length === 0) return null
  return (
    <Box key="needs-you" flexDirection="column" gap={1}>
      <Text bold color={AMBER}>{`NEEDS YOU · ${cards.length}`}</Text>
      {cards}
    </Box>
  )
}

/** The pages Claude made in this project, newest first: each title a link that opens it, with how long ago and a dim Hide button. None, no section. */
function artifactDesk({ kit, data, actions }: Ctx) {
  const { Box, Text, Link, Button } = kit
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
          <Button key={`artifact-hide-${one.url}`} plain dimColor label="Hide" onPress={() => actions.hideArtifact(one.url)} />
        </Box>
      ))}
      {older > 0 && <Text dimColor>{older === 1 ? '1 older artifact' : `${older} older artifacts`}</Text>}
    </Box>
  )
}

export function officeTab(kit: Kit, data: PanelData, actions: PanelActions, cw: number) {
  // Clawd off means no plan at all: none is drawn, and none of its Later items, even if one was loaded before he was switched off.
  const plan = data.options.isOn ? data.plan : null
  const ctx: Ctx = { kit, data: { ...data, plan }, actions, cw }
  const layout = plan === null ? undefined : planLayout(plan, data.staff, foldsOf(data.fx))
  // With a goal in hand the desktop's sections are the board's 16 pixels apart: the host's "md" step. The terminal, and the tab with no goal, keep a cell.
  return (
    <kit.Box flexDirection="column" gap={kit.isTerminal || layout === undefined ? 1 : 'md'}>
      {clawdCard(ctx)}
      {needsYou(ctx)}
      {layout !== undefined && planSection(ctx, layout)}
      {floor(ctx, layout)}
      {layout === undefined && laterFold(ctx, { indent: 0, isAlone: true })}
      {artifactDesk(ctx)}
    </kit.Box>
  )
}
