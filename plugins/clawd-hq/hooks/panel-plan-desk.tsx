// The plan on the desktop: a timeline down the left (a mark for each step and a thin line joining them, coloured as on the terminal) and, beside it,
// the step with its agents as the same cards the floor draws (`deskRow`). A failed agent's card comes first, with a red border and a Details
// button at its right. The line is a narrow box with a background colour, grown to the height of its step.
import type { Employee } from '../types'
import { RED } from './office'
import { titled } from './panel-model'
import { laterFold } from './panel-later'
import { deskRow } from './panel-desk'
import type { Ctx } from './panel-desk'
import { pairDesk } from './panel-pair'
import type { Slot } from './pair-up'
import { goalKey } from './plan-live'
import { RAIL_COLOR } from './plan-marks'
import type { MarkKind } from './plan-marks'
import { FOLD, askPrompt, doneInfo, failureLine, foldsOf, goalOf, retryPrompt, stoppedAt } from './plan-view'
import type { PlanLayout, StepBlock } from './plan-view'

type Item = JSX.Element

/** One item of the timeline: its mark over the thin line, and its content beside. The last item has no line below it. */
function item(ctx: Ctx, key: string, kind: MarkKind | undefined, isLast: boolean, children: Array<Item | null | false>): Item {
  const { Box } = ctx.kit
  return (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Box key={`${key}-line`} flexDirection="column" alignItems="center" flexShrink={0} width={3}>
        {kind !== undefined && ctx.kit.mark(kind, kind, `${key}-mark`)}
        {kind !== undefined && !isLast && <Box key={`${key}-rail`} flexGrow={1} width={1} backgroundColor={RAIL_COLOR[kind]} />}
      </Box>
      <Box key={`${key}-body`} flexDirection="column" flexGrow={1} flexShrink={1} gap={1} paddingBottom={isLast ? 0 : 1}>{children}</Box>
    </Box>
  )
}

/** A line of words with a button (or any item) at its right. */
function withRight(ctx: Ctx, key: string, left: Item, right: Item | null): Item {
  return <ctx.kit.Box key={key} flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>{left}{right}</ctx.kit.Box>
}

const toggle = (ctx: Ctx, key: string, label: string, fold: string) => <ctx.kit.Button key={key} plain dimColor label={label} onPress={() => ctx.actions.toggleFold(fold)} />

/** The open done fold: each finished step with who did it, how long and its tokens, and its choices in dim under it. */
function doneLines(ctx: Ctx, layout: PlanLayout): Item[] {
  const { Box, Text } = ctx.kit
  const key = goalKey(ctx.data.plan!)
  return layout.doneSteps.map(step => {
    const info = doneInfo(step, ctx.data.staff, key, one => titled(one, ctx.data))
    return (
      <Box key={`done-${step.id}`} flexDirection="column">
        {withRight(ctx, `done-${step.id}-line`, <Text key="t" wrap="wrap">{step.text}</Text>, info === '' ? null : <Text key="i" dimColor wrap="wrap">{info}</Text>)}
        {step.choices.map((choice, i) => <Text key={`done-${step.id}-c${i}`} dimColor wrap="wrap">{`Decided: ${choice}`}</Text>)}
      </Box>
    )
  })
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
  const shown: Employee = { ...one, said: words, stepNote: undefined }
  return deskRow(shown, { ...ctx, data: { ...data, now: one.endedAt ?? data.now } }, {
    borderColor: RED, below, right: <Box key="failed-btn" flexShrink={0}><Button key={`failed-${one.id}-details`} plain dimColor label={isOpen ? 'Hide' : 'Details'} onPress={() => actions.toggleFold(FOLD.details(goalOf(data), one.id))} /></Box>,
  })
}

const slotCard = (ctx: Ctx, slot: Slot) => (slot.kind === 'pair' ? pairDesk(ctx.kit, ctx.data, slot.group) : deskRow(slot.one, ctx))

/** "Also at work": the agents under no step, as the same cards. */
export const outsiderCards = (ctx: Ctx, slots: readonly Slot[]) => slots.map(slot => slotCard(ctx, slot))

const standing = (block: StepBlock) => [block.atWork > 0 ? `${block.atWork} at work` : '', block.failed.length + block.earlierFailed > 0 ? `${block.failed.length + block.earlierFailed} failed` : ''].filter(Boolean).join(' · ')
const KIND: Record<StepBlock['status'], MarkKind> = { now: 'now', attention: 'attention', next: 'next' }

function stepItem(ctx: Ctx, block: StepBlock, isLast: boolean): Item {
  const { Text } = ctx.kit
  const { step } = block
  const words = standing(block)
  const title = withRight(ctx, `step-${step.id}-title`, <Text key="t" bold={block.status !== 'next' ? true : undefined} dimColor={block.status === 'next' ? true : undefined} wrap="wrap">{step.text}</Text>, words === '' ? null : <Text key="s" dimColor wrap="wrap">{words}</Text>)
  const more = block.moreBlocks > 0
    ? withRight(ctx, `more-${step.id}`, <Text key="t" dimColor wrap="wrap">{block.isMoreOpen ? 'Fewer at work' : `${block.hidden} more at work`}</Text>, toggle(ctx, `more-${step.id}-btn`, block.isMoreOpen ? 'hide' : 'show', FOLD.more(goalOf(ctx.data), step.id)))
    : null
  return item(ctx, `step-${step.id}`, KIND[block.status], isLast, [title, ...block.failed.map(one => failedCard(ctx, one)), ...(block.earlierFailed > 0 ? [<Text key={`earlier-${step.id}`} dimColor wrap="wrap">{`${block.earlierFailed} earlier failed`}</Text>] : []), ...block.shown.map(slot => slotCard(ctx, slot)), more])
}

/** The plan: the heading, the goal with "3 of 6 done", the timeline, and the Later fold under it. */
export function planItems(ctx: Ctx, layout: PlanLayout): Item[] {
  const { Box, Text } = ctx.kit
  const isDoneOpen = foldsOf(ctx.data.fx).has(FOLD.done(goalOf(ctx.data)))
  const hasDone = layout.doneSteps.length > 0
  const moreSteps = layout.extraSteps > 0
  const count = layout.steps.length + (hasDone ? 1 : 0) + (moreSteps ? 1 : 0)
  const doneLine = hasDone
    ? item(ctx, 'done-fold', 'done', count === 1, [
      withRight(ctx, 'done-fold-line', <Text key="t" wrap="wrap">{`${layout.doneSteps.length} ${layout.doneSteps.length === 1 ? 'step' : 'steps'} done`}</Text>, toggle(ctx, 'done-fold-btn', isDoneOpen ? 'hide' : 'show', FOLD.done(goalOf(ctx.data)))),
      ...(isDoneOpen ? doneLines(ctx, layout) : []),
    ])
    : null
  const offset = hasDone ? 1 : 0
  const steps = layout.steps.map((block, i) => stepItem(ctx, block, i + offset === count - 1))
  const stepsFold = moreSteps
    ? item(ctx, 'more-steps', undefined, true, [withRight(ctx, 'more-steps-line', <Text key="t" dimColor wrap="wrap">{layout.isStepsOpen ? 'Fewer steps' : `${layout.extraSteps} more ${layout.extraSteps === 1 ? 'step' : 'steps'}`}</Text>, toggle(ctx, 'more-steps-btn', layout.isStepsOpen ? 'hide' : 'show', FOLD.steps(goalOf(ctx.data))))])
    : null
  return [
    <Box key="plan-head" flexDirection="column">
      <Text bold dimColor>PLAN</Text>
      {withRight(ctx, 'plan-title', <Text key="t" bold wrap="wrap">{layout.title}</Text>, <Text key="c" dimColor>{`${layout.done} of ${layout.total} done`}</Text>)}
    </Box>,
    <Box key="plan-timeline" flexDirection="column">{[doneLine, ...steps, stepsFold]}</Box>,
    ...laterFold(ctx, { indent: 0 }),
  ]
}
