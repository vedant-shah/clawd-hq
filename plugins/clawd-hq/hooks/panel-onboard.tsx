// Onboarding, piece 7: every setup step drawn on Clawd's card in the Office tab. Drawing only: what to say and which
// buttons to show come in as an OnboardCard (hooks/onboard-types.ts); a press goes back as the button that was pressed.
// Only the Text props every engine takes (color, dimColor, bold, wrap): the desktop app can bundle an older engine.
// Buttons draw their label and nothing else. Every line wraps and none is cut with a mark.
import { SEATS, WORKFLOW_STEPS } from './onboard-types'
import type { OnboardButton, OnboardCard, Pick, Seat } from './onboard-types'
import type { Kit } from './panel-kit'

/** The one line on cost, drawn under the offer. */
export const OFFER_COST_LINE = 'Setup asks Opus once, which costs about $0.20 of your plan.'
/** Why skills are not parked with the agents. */
export const SKILLS_NOTE = "Skills can't be hidden, so they stay available to Claude. Only agents get parked."
/** Shown while the quiet look around runs and nothing else has been said. */
export const LOOKING_LINE = 'Looking around…'

export type OnboardActions = { readonly choose: (button: OnboardButton) => unknown }

type Keyed = { readonly button: OnboardButton; readonly key: string }
type Ctx = { readonly kit: Kit; readonly card: OnboardCard; readonly actions: OnboardActions; readonly items: readonly Keyed[] }

/** Buttons beside the line they answer, on the team step; every other button sits in the row at the bottom. */
const INLINE = new Set(['changeRole', 'searchYes', 'searchNo'])

/** A key per button: its action, with its place added when two share an action (the role choices). */
const keyed = (buttons: readonly OnboardButton[]): readonly Keyed[] =>
  buttons.map((button, i) => ({
    button,
    key: buttons.filter(b => b.action === button.action).length > 1 ? `onboard-${button.action}-${i}` : `onboard-${button.action}`,
  }))

/** A row of buttons: the primary ones stand out once any button is marked primary; the others are plain and muted. */
function buttonRow(ctx: Ctx, items: readonly Keyed[], key: string) {
  if (items.length === 0) return null
  const { Box, Button } = ctx.kit
  const hasPrimary = ctx.card.buttons.some(b => b.isPrimary)
  return (
    <Box key={key} flexDirection="row" flexWrap="wrap" columnGap={1}>
      {items.map(({ button, key: k }) => {
        // `plain` is true or absent, never false.
        const look = hasPrimary && !button.isPrimary ? { plain: true as const, dimColor: true } : {}
        return <Button key={k} {...look} label={button.label} onPress={() => ctx.actions.choose(button)} />
      })}
    </Box>
  )
}

const pickRow = (kit: Kit, p: Pick) => {
  const { Box, Text } = kit
  return (
    <Box key={`pick-${p.seat}-${p.name}`} flexDirection="column">
      <Text wrap="wrap"><Text dimColor>{p.seat}</Text><Text bold>{` ${p.name}`}</Text><Text dimColor>{` · ${p.kind}`}</Text></Text>
      <Text dimColor wrap="wrap">{p.receipt}</Text>
    </Box>
  )
}

/** "Looks like you're a <role>" with its Change button beside it. */
function roleRow(ctx: Ctx, role: string) {
  const { Box, Text } = ctx.kit
  const change = ctx.items.filter(i => i.button.action === 'changeRole')
  return (
    <Box key="onboard-role" flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
      <Text wrap="wrap">{"Looks like you're a "}<Text bold>{role}</Text></Text>
      {buttonRow(ctx, change, 'onboard-role-buttons')}
    </Box>
  )
}

/** Empty seats in plain words, and the offer to search skills.sh for the one the card names. */
function emptySeats(ctx: Ctx, empty: readonly Seat[]) {
  const { Box, Text } = ctx.kit
  const { searchSeat } = ctx.card
  if (empty.length === 0 && searchSeat === undefined) return null
  const search = ctx.items.filter(i => i.button.action === 'searchYes' || i.button.action === 'searchNo')
  return (
    <Box key="onboard-empty" flexDirection="column">
      {empty.length > 0 && <Text dimColor wrap="wrap">{`No pick yet for ${SEATS.filter(s => empty.includes(s)).join(', ')}.`}</Text>}
      {searchSeat !== undefined && (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
          <Text wrap="wrap">{`Search skills.sh for a ${searchSeat} helper?`}</Text>
          {buttonRow(ctx, search, 'onboard-search-buttons')}
        </Box>
      )}
    </Box>
  )
}

/** The role, the starting team seat by seat with receipts, the empty seats, and the note on skills. */
function teamBlock(ctx: Ctx) {
  const { Box, Text } = ctx.kit
  const { team, role, parked } = ctx.card
  if (!team) return null
  const picks = SEATS.flatMap(seat => team.picks.filter(p => p.seat === seat))
  return (
    <Box key="onboard-team" flexDirection="column" gap={ctx.kit.isTerminal ? 0 : 1}>
      {role !== undefined && roleRow(ctx, role)}
      <Text bold wrap="wrap">{`Starting team (${picks.length})${parked !== undefined ? ` · Parked ${parked}` : ''}`}</Text>
      {picks.map(p => pickRow(ctx.kit, p))}
      {emptySeats(ctx, team.empty)}
      <Text dimColor wrap="wrap">{SKILLS_NOTE}</Text>
    </Box>
  )
}

function workflowBlock(ctx: Ctx) {
  const { Box, Text } = ctx.kit
  const steps = (ctx.card.workflow ?? []).slice(0, WORKFLOW_STEPS)
  if (steps.length === 0) return null
  return (
    <Box key="onboard-workflow" flexDirection="column">
      {steps.map((s, i) => <Text key={`workflow-${i}`} wrap="wrap">{`${i + 1}. ${s}`}</Text>)}
    </Box>
  )
}

/** What Clawd says: the card's lines, or "Looking around…" while the scan runs and nothing else has been said. */
function wordsBlock(ctx: Ctx) {
  const { Box, Text } = ctx.kit
  const { card } = ctx
  const lines = card.lines.length === 0 && card.step === 'scan' ? [LOOKING_LINE] : card.lines
  return (
    <Box key="onboard-words" flexDirection="column">
      {lines.map((l, i) => <Text key={`line-${i}`} wrap="wrap">{l}</Text>)}
      {card.step === 'offer' && <Text key="onboard-cost" dimColor wrap="wrap">{OFFER_COST_LINE}</Text>}
    </Box>
  )
}

const isDrawn = (card: OnboardCard | undefined): card is OnboardCard => card !== undefined && card.step !== 'done' && card.step !== 'skipped'

/** The setup section of the Office tab, under Clawd's card: the current step, or nothing once setup is finished or skipped. */
export function onboardSection(kit: Kit, card: OnboardCard | undefined, actions: OnboardActions) {
  if (!isDrawn(card)) return null
  const { Box, Text } = kit
  const items = keyed(card.buttons)
  const ctx: Ctx = { kit, card, actions, items }
  const isTeam = card.step === 'team'
  const bottom = items.filter(i => !(isTeam && INLINE.has(i.button.action)))
  return (
    <Box key="onboard" flexDirection="column">
      <Text bold dimColor>SETTING UP</Text>
      <Box borderStyle="round" borderDimColor paddingX={1} flexDirection="column" gap={kit.isTerminal ? 0 : 1}>
        {wordsBlock(ctx)}
        {teamBlock(ctx)}
        {workflowBlock(ctx)}
        {card.suggestion !== undefined && <Text key="onboard-suggestion" bold wrap="wrap">{card.suggestion}</Text>}
        {card.note !== undefined && <Text key="onboard-note" dimColor wrap="wrap">{card.note}</Text>}
        {buttonRow(ctx, bottom, 'onboard-buttons')}
      </Box>
    </Box>
  )
}
