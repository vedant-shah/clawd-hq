// The plan on the desktop: a timeline down the left (a mark for each step and a thin line joining them, coloured as on the terminal) and, beside it,
// the step with its agents as the same cards the floor draws (`deskRow`). A failed agent's card comes first, with a red border and a Details
// button at its right. The line and the colours are the design board's (design/DesktopBusy.dc.html and Main.dc.html); the spacing is the host's named steps.
import type { Employee } from '../types'
import { titled, workLine } from './panel-model'
import { laterFold } from './panel-later'
import { PLAN_SCALE, deskRow } from './panel-desk'
import type { Ctx } from './panel-desk'
import { pairDesk } from './panel-pair'
import type { Slot } from './pair-up'
import { goalKey } from './plan-live'
import { BOARD, MARK_WIDTH, RAIL_COLOR, RAIL_REACH, railSvg } from './plan-marks'
import type { MarkKind } from './plan-marks'
import { FOLD, askPrompt, doneInfo, failureLine, foldsOf, goalOf, retryPrompt, stoppedAt } from './plan-view'
import type { PlanLayout, StepBlock } from './plan-view'

type Item = JSX.Element
type Child = Item | null | false

/** The line's description: never empty, or the desktop draws no line. */
export const LINE_ALT = 'plan line'

/**
 * The line beside a step, from a cell below its mark to the step's foot, where the next step's mark begins. It rests only on what a live probe
 * showed the desktop draws: a box placed `absolute` with `top` and `bottom` and no `height` spans its parent between the two (BoxProps), and
 * its offsets are cells. `top={1}` starts it below the 20 pixel mark at the step's top (a cell is about 22 pixels there); no stacking order
 * and no clear part of the picture is relied on. The picture is a plain strip that fills the box, scaled or clipped. It must have a
 * description: the desktop draws nothing for an `Svg` whose `alt` is empty. A box that grows or stretches to its row draws a cell wide, too thick.
 */
function line(ctx: Ctx, key: string, kind: MarkKind): Item | null {
  const { Box, Svg } = ctx.kit
  if (Svg === undefined) return null
  return (
    <Box key={`${key}-rail`} position="absolute" top={1} bottom={0} left={0} overflow="hidden">
      <Svg source={railSvg(RAIL_COLOR[kind])} alt={LINE_ALT} width={MARK_WIDTH} height={RAIL_REACH} />
    </Box>
  )
}

/**
 * One item of the timeline: its mark, then its content, with the host's "sm" step (the board's 8 and 10 pixels) from the mark to the words,
 * between its lines and under it; and, but for the last, the line. The item is the line's parent (placed relative) and clips it; it never
 * shrinks, so its clipping never cuts its words. Its parts sit at its top, so the mark does too. No gap is a picture: one with no description
 * draws nothing, and a described one is read out.
 */
function item(ctx: Ctx, key: string, kind: MarkKind | undefined, isLast: boolean, children: Child[]): Item {
  const { Box } = ctx.kit
  const shown = children.filter((child): child is Item => child !== null && child !== false)
  return (
    <Box key={key} flexDirection="row" alignItems="flex-start" columnGap="sm" position="relative" overflow="hidden" flexShrink={0}>
      <Box key={`${key}-mark-col`} flexDirection="column" flexShrink={0} minWidth={2}>{kind !== undefined && ctx.kit.mark(kind, kind, `${key}-mark`)}</Box>
      <Box key={`${key}-body`} flexDirection="column" flexGrow={1} flexShrink={1} gap="sm" paddingBottom="sm">{shown}</Box>
      {kind !== undefined && !isLast && line(ctx, key, kind)}
    </Box>
  )
}

/** A line of words with a button (or any item) at its right. */
function withRight(ctx: Ctx, key: string, left: Item, right: Item | null): Item {
  return <ctx.kit.Box key={key} flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>{left}{right}</ctx.kit.Box>
}

const toggle = (ctx: Ctx, key: string, label: string, fold: string) => <ctx.kit.Button key={key} plain dimColor label={label} onPress={() => ctx.actions.toggleFold(fold)} />

/** An open done fold's step, beside the done line's rail: its own tick, its words, who did it with how long and its tokens, and its choices dim under it. */
function doneRow(ctx: Ctx, step: PlanLayout['doneSteps'][number]): Item {
  const { Box, Text } = ctx.kit
  const info = doneInfo(step, ctx.data.staff, goalKey(ctx.data.plan!), one => titled(one, ctx.data))
  return (
    <Box key={`done-${step.id}`} flexDirection="row" columnGap="sm">
      {ctx.kit.mark('done', 'done', `done-${step.id}-mark`)}
      <Box key={`done-${step.id}-words`} flexDirection="column" flexGrow={1} flexShrink={1}>
        {withRight(ctx, `done-${step.id}-line`, <Text key="t" color={BOARD.doneWords} wrap="wrap">{step.text}</Text>, info === '' ? null : <Text key="i" dimColor wrap="wrap">{info}</Text>)}
        {step.choices.map((choice, i) => <Text key={`done-${step.id}-c${i}`} dimColor wrap="wrap">{`Decided: ${choice}`}</Text>)}
      </Box>
    </Box>
  )
}

/** A failed agent's card: the existing card with a red border, its reason as its words, Details at the right, and (opened) the whole reason, where it stopped, Retry and Ask Clawd. */
function failedCard(ctx: Ctx, one: Employee): Item {
  const { Box, Text, Button } = ctx.kit
  const { data, actions } = ctx
  const isOpen = foldsOf(data.fx).has(FOLD.details(goalOf(data), one.id))
  const name = titled(one, data)
  const words = isOpen ? `${failureLine({ ...one, reason: undefined }, data.now)}: ${one.reason?.trim() || 'It did not say why.'}` : failureLine(one, data.now)
  const stopped = isOpen ? stoppedAt(one) : undefined
  const below = isOpen
    ? (
      <Box key={`failed-${one.id}-open`} flexDirection="column">
        {stopped !== undefined && <Text dimColor wrap="wrap">{stopped}</Text>}
        <Box flexDirection="row" columnGap={1}>
          <Button key={`failed-${one.id}-retry`} plain label="Retry" onPress={() => actions.agentAsk(retryPrompt(name, one))} />
          <Button key={`failed-${one.id}-ask`} plain label="Ask Clawd" onPress={() => actions.agentAsk(askPrompt(name, one))} />
        </Box>
      </Box>
    )
    : null
  // As the board has it: the reason in red, not italic, with the model, time and tokens dim under it.
  const stats = workLine(one, one.endedAt ?? data.now).stats.replace(/^· /, '')
  const lines = [<Text key={`failed-${one.id}-why`} color={BOARD.failedWords} wrap="wrap">{words}</Text>, <Text key={`failed-${one.id}-stats`} dimColor wrap="wrap">{stats}</Text>]
  // The button is a bordered one in the failed card's colour; the host draws a button's label in its own colour, so the border carries it.
  const button = (
    <Box key="failed-btn" flexShrink={0} borderStyle="round" borderColor={BOARD.failedCard} paddingX={1}>
      <Button key={`failed-${one.id}-details`} plain label={isOpen ? 'Hide' : 'Details'} onPress={() => actions.toggleFold(FOLD.details(goalOf(data), one.id))} />
    </Box>
  )
  return deskRow(one, { ...ctx, data: { ...data, now: one.endedAt ?? data.now } }, { scale: PLAN_SCALE, borderColor: BOARD.failedCard, isBoard: true, words: lines, below, right: button })
}

const slotCard = (ctx: Ctx, slot: Slot) => (slot.kind === 'pair' ? pairDesk(ctx.kit, ctx.data, slot.group) : deskRow(slot.one, ctx, { scale: PLAN_SCALE, borderColor: BOARD.card, isBoard: true }))

/** "Also at work": the agents under no step, as the same cards. */
export const outsiderCards = (ctx: Ctx, slots: readonly Slot[]): Item[] => slots.map(slot => slotCard(ctx, slot))

const standing = (block: StepBlock) => [block.atWork > 0 ? `${block.atWork} at work` : '', block.failed.length + block.earlierFailed > 0 ? `${block.failed.length + block.earlierFailed} failed` : ''].filter(Boolean).join(' · ')
const KIND: Record<StepBlock['status'], MarkKind> = { now: 'now', attention: 'attention', next: 'next' }

/** A step: its title with who is at work on it, its failed agents first, its cards, the fold of more; and `tail` (the Later line, under the last). */
function stepItem(ctx: Ctx, block: StepBlock, isLast: boolean, tail: Child[]): Item {
  const { Text } = ctx.kit
  const { step } = block
  const words = standing(block)
  // The step now is bold in the board's amber (the host has no weight between normal and bold); a step next is dim.
  const title = withRight(ctx, `step-${step.id}-title`, <Text key="t" bold={block.status !== 'next' ? true : undefined} color={block.status === 'now' ? BOARD.nowTitle : undefined} dimColor={block.status === 'next' ? true : undefined} wrap="wrap">{step.text}</Text>, words === '' ? null : <Text key="s" dimColor wrap="wrap">{words}</Text>)
  const more = block.moreBlocks > 0
    ? withRight(ctx, `more-${step.id}`, <Text key="t" dimColor wrap="wrap">{block.isMoreOpen ? 'Fewer at work' : `${block.hidden} more at work`}</Text>, toggle(ctx, `more-${step.id}-btn`, block.isMoreOpen ? 'hide' : 'show', FOLD.more(goalOf(ctx.data), step.id)))
    : null
  return item(ctx, `step-${step.id}`, KIND[block.status], isLast, [title, ...block.failed.map(one => failedCard(ctx, one)), ...(block.earlierFailed > 0 ? [<Text key={`earlier-${step.id}`} dimColor wrap="wrap">{`${block.earlierFailed} earlier failed`}</Text>] : []), ...block.shown.map(slot => slotCard(ctx, slot)), more, ...tail])
}

type Make = (isLast: boolean, tail: Child[]) => Item

/** The done fold's step: "3 steps done" in the board's green with its show button, and, opened, each done step under it, beside its line. */
function doneFold(ctx: Ctx, layout: PlanLayout): Make {
  const { Text } = ctx.kit
  const isOpen = foldsOf(ctx.data.fx).has(FOLD.done(goalOf(ctx.data)))
  const count = layout.doneSteps.length
  const head = withRight(ctx, 'done-fold-line', <Text key="t" color={BOARD.doneWords} wrap="wrap">{`${count} ${count === 1 ? 'step' : 'steps'} done`}</Text>, toggle(ctx, 'done-fold-btn', isOpen ? 'hide' : 'show', FOLD.done(goalOf(ctx.data))))
  return (isLast, tail) => item(ctx, 'done-fold', 'done', isLast, [head, ...(isOpen ? layout.doneSteps.map(step => doneRow(ctx, step)) : []), ...tail])
}

/** The fold of the steps past the first few: no mark of its own, always last. */
function moreStepsFold(ctx: Ctx, layout: PlanLayout): Make {
  const words = layout.isStepsOpen ? 'Fewer steps' : `${layout.extraSteps} more ${layout.extraSteps === 1 ? 'step' : 'steps'}`
  const line = withRight(ctx, 'more-steps-line', <ctx.kit.Text key="t" dimColor wrap="wrap">{words}</ctx.kit.Text>, toggle(ctx, 'more-steps-btn', layout.isStepsOpen ? 'hide' : 'show', FOLD.steps(goalOf(ctx.data))))
  return (isLast, tail) => item(ctx, 'more-steps', undefined, isLast, [line, ...tail])
}

/**
 * The plan, as the board has it: "PLAN" and the goal on one line with "3 of 6 done" at the right (the host cannot space the letters or size
 * them smaller: bold and dim stand for the heading), then the timeline, the "sm" step under it. The Later line is the last step's last line, as the
 * board's "2 later" is; with no step at all, it stands under the heading.
 */
export function planItems(ctx: Ctx, layout: PlanLayout): Item[] {
  const { Box, Text } = ctx.kit
  const timeline: Make[] = [
    ...(layout.doneSteps.length > 0 ? [doneFold(ctx, layout)] : []),
    ...layout.steps.map((block): Make => (isLast, tail) => stepItem(ctx, block, isLast, tail)),
    ...(layout.extraSteps > 0 ? [moreStepsFold(ctx, layout)] : []),
  ]
  const later = laterFold(ctx, { indent: 0 })
  const items = timeline.map((make, i) => (i === timeline.length - 1 ? make(true, later) : make(false, [])))
  return [
    withRight(ctx, 'plan-head', <Text key="t" wrap="wrap"><Text bold dimColor>PLAN</Text>{'  '}<Text bold>{layout.title}</Text></Text>, <Text key="c" dimColor>{`${layout.done} of ${layout.total} done`}</Text>),
    ...(items.length > 0 ? [<Box key="plan-timeline" flexDirection="column">{items}</Box>] : later),
  ]
}
