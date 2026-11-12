// The Later fold of the Office tab: what was put off. The plan's own Later items come first, then the rows of Left undone (hooks/left-io.ts keeps
// that list). Closed it is one line, "N later" with a show button; open it shows every item, each with Do it now and Dismiss, and Clear (which
// empties the Left undone list) on the header. With no goal in hand it stands alone under "At work" as "LATER · N". Plain wrapped text only: the
// words come from files, answers and a model, so nothing in them is read as a link or as Markdown.
import { noteOf } from './left-list'
import type { Ctx } from './panel-desk'
import { FOLD, foldsOf, goalOf } from './plan-view'

/** How many items are put off in all. */
export const laterCount = ({ data }: Pick<Ctx, 'data'>) => (data.plan?.later.length ?? 0) + data.leftUndone.length

type Options = {
  /** Cells the fold sits in from the left: three on the terminal, under the rail's marks. */
  indent: number
  /** No goal in hand: the fold stands alone with a heading, "LATER · N". */
  isAlone?: boolean
}

/** The fold, as one element in a list; none when nothing is put off. */
export function laterFold(ctx: Ctx, { indent, isAlone }: Options): JSX.Element[] {
  const { kit, data, actions } = ctx
  const { Box, Text, Button } = kit
  const count = laterCount(ctx)
  if (count === 0) return []
  const goal = goalOf(data)
  const isOpen = foldsOf(data.fx).has(FOLD.later(goal))
  const plan = data.plan?.later ?? []
  const toggle = <Button key="later-toggle" plain dimColor label={isOpen ? 'hide' : 'show'} onPress={() => actions.toggleFold(FOLD.later(goal))} />
  const head = (
    <Box key="later-head" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
      {isAlone ? <Text bold dimColor>{`LATER · ${count}`}</Text> : <Text dimColor>{`${count} later`}</Text>}
      {toggle}
    </Box>
  )
  const item = (key: string, text: string, note: string | undefined, doIt: () => unknown, dismiss: () => unknown) => (
    <Box key={key} flexDirection="column" marginTop={kit.isTerminal ? 0 : 1}>
      <Text wrap="wrap">{text}</Text>
      {note !== undefined && <Text dimColor wrap="wrap">{note}</Text>}
      <Box flexDirection="row" columnGap={1}>
        <Button key={`${key}-do`} plain label="Do it now" onPress={doIt} />
        <Button key={`${key}-dismiss`} plain dimColor label="Dismiss" onPress={dismiss} />
      </Box>
    </Box>
  )
  // The Clear button belongs to the Left undone rows, under their own small heading: it empties that list and nothing of the plan.
  const left = data.leftUndone.length === 0
    ? null
    : (
      <Box key="later-left" flexDirection="column">
        <Box key="later-left-head" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1} marginTop={kit.isTerminal ? 0 : 1}>
          <Text dimColor>Left undone</Text>
          <Button key="later-clear" plain dimColor label="Clear left undone" onPress={() => actions.leftClear()} />
        </Box>
        {data.leftUndone.map(one => item(`later-left-${one.id}`, one.text, noteOf(one), () => actions.leftDo(one.id), () => actions.leftDismiss(one.id)))}
      </Box>
    )
  return [
    <Box key="later-fold" flexDirection="column" paddingLeft={indent}>
      {head}
      {isOpen && plan.map(one => item(`later-plan-${one.id}`, one.text, 'In the plan', () => actions.planLaterDo(goal, one.id), () => actions.planLaterDismiss(goal, one.id)))}
      {isOpen && left}
    </Box>,
  ]
}
