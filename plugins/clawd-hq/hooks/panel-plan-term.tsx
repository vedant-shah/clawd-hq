// The plan on the terminal: a simple list with a rail down its left, no agent pictures and no card borders. The rail is a `│` this code puts in
// column 0 of every row, so every line is wrapped here (hooks/wrap-to.ts): a row the host wrapped would carry none. Marks: ✓ done, ● now,
// ○ next, ✗ failed. Agents are three lines: mark, name and task; what it is doing; the bar with its count, model, time and tokens.
import type { Employee, PlanStep } from '../types'
import { AMBER, RED } from './office'
import { tagged, titled } from './panel-model'
import { pairLine, pairTitle } from './pair-up'
import type { PairGroup, Slot } from './pair-up'
import type { Ctx } from './panel-desk'
import { laterFold } from './panel-later'
import { MUTED_GREEN } from './plan-marks'
import type { MarkKind } from './plan-marks'
import { FOLD, agentWords, askPrompt, doneInfo, failureLine, foldsOf, goalOf, retryPrompt, statsLine, stoppedAt } from './plan-view'
import type { PlanLayout, StepBlock } from './plan-view'
import { goalKey } from './plan-live'
import { cellText, widthOf, wrapSegs } from './wrap-to'
import type { Seg } from './wrap-to'
import { barOf } from './meters'

type Row = JSX.Element
type Tone = 'done' | 'amber' | 'dim'
const TONE: Record<Tone, { color?: string; dimColor?: boolean }> = { done: { color: MUTED_GREEN }, amber: { color: AMBER, dimColor: true }, dim: { dimColor: true } }
const SEG_COLOR = { red: RED, amber: AMBER, green: MUTED_GREEN } as const

/** A piece of a row, drawn in its style. */
function piece(kit: Ctx['kit'], seg: Seg, key: number) {
  const { Text } = kit
  const style = seg.style
  const color = style === 'red' || style === 'amber' || style === 'green' ? SEG_COLOR[style] : undefined
  return <Text key={String(key)} bold={style === 'bold' ? true : undefined} italic={style === 'italic' ? true : undefined} dimColor={style === 'dim' ? true : undefined} color={color}>{seg.text}</Text>
}

/** The rail, or the blank that stands for it: `width` cells. */
const railText = (kit: Ctx['kit'], tone: Tone, text: string, key: string) => <kit.Text key={key} {...TONE[tone]}>{text}</kit.Text>

/** One row: the lead, then the pieces. With a right-hand item it is a row of two, the item against the right edge. */
function line(kit: Ctx['kit'], key: string, lead: Row[], segs: readonly Seg[], right?: Row): Row {
  const { Box, Text } = kit
  const left = <Text key={`${key}-t`} wrap="truncate-end">{lead}{segs.map((seg, i) => piece(kit, seg, i))}</Text>
  return right === undefined ? <Box key={key} flexDirection="row">{left}</Box> : <Box key={key} flexDirection="row" justifyContent="space-between" columnGap={1}>{left}{right}</Box>
}

/**
 * Wrapped rows of `segs` in `width` cells; `first` leads the first row and `rest` the others. The right-hand item (`size` cells) goes against the
 * edge of the last row when it fits there with one cell between, else on a row of its own.
 */
function rows(kit: Ctx['kit'], key: string, o: { first: Row[]; rest: Row[]; width: number; segs: readonly Seg[]; right?: Row; size?: number }): Row[] {
  const wrapped = wrapSegs(o.segs, o.width)
  const room = o.width
  const out = wrapped.map((row, i) => {
    const isLast = i === wrapped.length - 1
    const takes = isLast && o.right !== undefined && widthOf(row) + 1 + (o.size ?? 0) <= room
    return line(kit, `${key}-${i}`, i === 0 ? o.first : o.rest, row, takes ? o.right : undefined)
  })
  const fitsLast = o.right !== undefined && widthOf(wrapped[wrapped.length - 1] ?? []) + 1 + (o.size ?? 0) <= room
  return o.right === undefined || fitsLast ? out : [...out, line(kit, `${key}-r`, o.rest, [], o.right)]
}

// ---- Agents ----

type Lead = { first: (mark: Row) => Row[]; rest: Row[]; width: number }

/** Where an agent's lines go: inside the rail (five cells in), or against the left edge (three in) for "Also at work". */
function leadOf(ctx: Ctx, tone: Tone | undefined, id: string): Lead {
  const { kit, cw } = ctx
  if (tone === undefined) return { first: mark => [mark, <kit.Text key={`${id}-pad`}>{'  '}</kit.Text>], rest: [<kit.Text key={`${id}-rest`}>{'   '}</kit.Text>], width: cw - 3 }
  return { first: mark => [railText(kit, tone, '│  ', `${id}-rail`), mark, <kit.Text key={`${id}-gap`}>{' '}</kit.Text>], rest: [railText(kit, tone, '│    ', `${id}-rest`)], width: cw - 5 }
}

const markNode = (ctx: Ctx, kind: MarkKind, key: string) => ctx.kit.mark(kind, kind, key)

/** The third line: the bar and "3 of 5 · Sonnet 5.5 · 2m · 41K"; the words after the bar wrap under it. */
function barLine(ctx: Ctx, one: Employee, lead: Lead, id: string): Row[] {
  const { kit, data } = ctx
  const [done, total] = [one.stepDone ?? 0, one.stepTotal ?? 1]
  const cells = barOf(0, 'small').total + 1
  const text = `${done} of ${total} · ${statsLine(one, data.now)}`
  const first = wrapSegs([{ text, style: 'dim' }], Math.max(4, lead.width - cells))[0] ?? []
  const used = first.map(seg => seg.text).join('')
  const rest = wrapSegs([{ text: text.slice(used.length).trim(), style: 'dim' }], lead.width)
  const bar = <kit.Text key={`${id}-bar`}>{kit.bar((done / total) * 100, `${done} of ${total} steps done`, 'small')}{' '}</kit.Text>
  return [
    <kit.Box key={`${id}-b0`} flexDirection="row"><kit.Text wrap="truncate-end">{lead.rest}{bar}{first.map((seg, i) => piece(kit, seg, i))}</kit.Text></kit.Box>,
    ...(rest[0]?.length ? rest.map((row, i) => line(kit, `${id}-b${i + 1}`, lead.rest, row)) : []),
  ]
}

/** An agent at work: name and task, what it is doing, then the bar (or, with no step count, the stats joined to the second line). */
function workingRows(ctx: Ctx, one: Employee, tone: Tone | undefined): Row[] {
  const { data } = ctx
  const lead = leadOf(ctx, tone, `agent-${one.id}`)
  const words = agentWords(one, data.now)
  const hasCount = one.stepTotal !== undefined
  const head: Seg[] = [{ text: cellText(titled(one, data)), style: 'bold' }, { text: ' ' }, { text: cellText(`${tagged(one, data) ?? ''} ${one.description || one.type}`), style: 'dim' }]
  const body: Seg[] = [{ text: cellText(words.text), style: words.isSaid ? 'italic' : 'dim' }, ...(hasCount ? [] : [{ text: ` · ${statsLine(one, data.now)}`, style: 'dim' as const }])]
  return [
    ...rows(ctx.kit, `agent-${one.id}-h`, { first: lead.first(markNode(ctx, 'now', `agent-${one.id}-mark`)), rest: lead.rest, width: lead.width, segs: head }),
    ...rows(ctx.kit, `agent-${one.id}-w`, { first: lead.rest, rest: lead.rest, width: lead.width, segs: body }),
    ...(hasCount ? barLine(ctx, one, lead, `agent-${one.id}`) : []),
  ]
}

/** A failed agent is two lines, name and task with its Details button at the right, then the reason in red. It never folds. Opened, it shows the full reason, where it stopped, and Retry and Ask Clawd. */
function failedRows(ctx: Ctx, one: Employee, tone: Tone | undefined): Row[] {
  const { kit, data, actions } = ctx
  const lead = leadOf(ctx, tone, `failed-${one.id}`)
  const isOpen = foldsOf(data.fx).has(FOLD.details(goalOf(data), one.id))
  const name = titled(one, data)
  const head: Seg[] = [{ text: cellText(name), style: 'bold' }, { text: ' ' }, { text: cellText(`${tagged(one, data) ?? ''} ${one.description || one.type}`), style: 'dim' }]
  const button = <kit.Button key={`failed-${one.id}-details`} plain dimColor label={isOpen ? 'Hide' : 'Details'} onPress={() => actions.toggleFold(FOLD.details(goalOf(data), one.id))} />
  const size = (isOpen ? 'Hide' : 'Details').length
  const reason = isOpen ? one.reason?.trim() || 'It did not say why.' : failureLine(one, data.now)
  const stopped = isOpen ? stoppedAt(one) : undefined
  const open: Row[] = isOpen
    ? [
      ...(stopped === undefined ? [] : rows(kit, `failed-${one.id}-s`, { first: lead.rest, rest: lead.rest, width: lead.width, segs: [{ text: cellText(stopped), style: 'dim' }] })),
      <kit.Box key={`failed-${one.id}-buttons`} flexDirection="row" columnGap={1}>
        <kit.Text key="lead">{lead.rest}</kit.Text>
        <kit.Button key={`failed-${one.id}-retry`} plain label="Retry" onPress={() => actions.agentAsk(retryPrompt(name, one))} />
        <kit.Button key={`failed-${one.id}-ask`} plain label="Ask Clawd" onPress={() => actions.agentAsk(askPrompt(name, one))} />
      </kit.Box>,
    ]
    : []
  return [
    ...rows(kit, `failed-${one.id}-h`, { first: lead.first(markNode(ctx, 'attention', `failed-${one.id}-mark`)), rest: lead.rest, width: lead.width, segs: head, right: button, size }),
    ...rows(kit, `failed-${one.id}-w`, { first: lead.rest, rest: lead.rest, width: lead.width, segs: [{ text: cellText(isOpen ? `${failureLine({ ...one, reason: undefined }, data.now)}: ${reason}` : reason), style: 'red' }] }),
    ...open,
  ]
}

/** A pair-up or a council is one block: "A & B" with the goal, then the group's one status line. */
function groupRows(ctx: Ctx, group: PairGroup, tone: Tone | undefined): Row[] {
  const { data } = ctx
  const first = group.members[0]!
  const lead = leadOf(ctx, tone, `group-${first.id}`)
  const title = group.isCouncil ? 'Council' : pairTitle(group.members.map(one => titled(one, data)))
  return [
    ...rows(ctx.kit, `group-${first.id}-h`, { first: lead.first(markNode(ctx, 'now', `group-${first.id}-mark`)), rest: lead.rest, width: lead.width, segs: [{ text: cellText(title), style: 'bold' }, { text: ' ' }, { text: cellText(group.goal), style: 'dim' }] }),
    ...rows(ctx.kit, `group-${first.id}-w`, { first: lead.rest, rest: lead.rest, width: lead.width, segs: [{ text: pairLine(group.members, data.now).text, style: 'dim' }] }),
  ]
}

const slotRows = (ctx: Ctx, slot: Slot, tone: Tone | undefined) => (slot.kind === 'pair' ? groupRows(ctx, slot.group, tone) : workingRows(ctx, slot.one, tone))

/** Between the blocks of the plan: a row with only the rail. */
const railRow = (ctx: Ctx, tone: Tone, key: string): Row => <ctx.kit.Text key={key} wrap="truncate-end" {...TONE[tone]}>│</ctx.kit.Text>

/** "Also at work": the agents under no step, in the same simple lines against the left edge, one blank row between. */
export function outsiderRows(ctx: Ctx, slots: readonly Slot[]): Row[] {
  return slots.flatMap((slot, i) => [...(i > 0 ? [<ctx.kit.Text key={`out-gap-${i}`}>{' '}</ctx.kit.Text>] : []), ...slotRows(ctx, slot, undefined)])
}

// ---- The steps ----

const SIDE = 3

/** A fold's line: its words, and the button at the right. `rail`: the line is in the rail (three cells), else three blank cells. */
function foldRow(ctx: Ctx, key: string, tone: Tone | undefined, words: string, label: string, fold: string): Row[] {
  const { kit, actions } = ctx
  const lead: Row[] = [tone === undefined ? <kit.Text key={`${key}-pad`}>{'   '}</kit.Text> : railText(kit, tone, '│  ', `${key}-rail`)]
  const button = <kit.Button key={`${key}-btn`} plain dimColor label={label} onPress={() => actions.toggleFold(fold)} />
  return rows(kit, key, { first: lead, rest: lead, width: ctx.cw - SIDE, segs: [{ text: words, style: 'dim' }], right: button, size: label.length })
}

/** The open done fold: one line for each finished step before the last, who did it, how long and how many tokens, with its choices under it. */
function doneRows(ctx: Ctx, earlier: readonly PlanStep[]): Row[] {
  const { kit, data } = ctx
  const key = goalKey(data.plan!)
  const label = (one: Employee) => cellText(titled(one, data))
  return earlier.flatMap(step => {
    const info = doneInfo(step, data.staff, key, label)
    const lead = [railText(kit, 'done', '│  ', `done-${step.id}-rail`), kit.mark('done', 'done', `done-${step.id}-mark`), <kit.Text key={`done-${step.id}-gap`}>{' '}</kit.Text>]
    const rest = [railText(kit, 'done', '│    ', `done-${step.id}-rest`)]
    const infoNode = info === '' ? undefined : <kit.Text key={`done-${step.id}-info`} dimColor>{info}</kit.Text>
    return [
      ...rows(kit, `done-${step.id}`, { first: lead, rest, width: ctx.cw - 5, segs: [{ text: cellText(step.text), style: 'green' }], right: infoNode, size: info.length }),
      ...step.choices.flatMap((choice, i) => rows(kit, `done-${step.id}-c${i}`, { first: rest, rest, width: ctx.cw - 5, segs: [{ text: cellText(`Decided: ${choice}`), style: 'dim' }] })),
    ]
  })
}

/** What a step says at its right: "5 at work · 1 failed". */
const standing = (block: StepBlock) => [block.atWork > 0 ? `${block.atWork} at work` : '', block.failed.length + block.earlierFailed > 0 ? `${block.failed.length + block.earlierFailed} failed` : ''].filter(Boolean).join(' · ')

const KIND: Record<StepBlock['status'], MarkKind> = { now: 'now', attention: 'attention', next: 'next' }
const STEP_TONE: Record<StepBlock['status'], Tone> = { now: 'amber', attention: 'amber', next: 'dim' }

/** A step: its mark and words, who is on it, and a fold for those not drawn. */
function stepRows(ctx: Ctx, block: StepBlock): Row[] {
  const { kit } = ctx
  const { step } = block
  const tone = STEP_TONE[block.status]
  const lead = [kit.mark(KIND[block.status], KIND[block.status], `step-${step.id}-mark`), <kit.Text key={`step-${step.id}-gap`}>{'  '}</kit.Text>]
  const rest = [railText(kit, tone, '│  ', `step-${step.id}-rest`)]
  const words = standing(block)
  const right = words === '' ? undefined : <kit.Text key={`step-${step.id}-stand`} dimColor>{words}</kit.Text>
  const title = rows(kit, `step-${step.id}`, { first: lead, rest, width: ctx.cw - SIDE, segs: [{ text: cellText(step.text), style: block.status === 'next' ? undefined : 'bold' }], right, size: words.length })
  const agents = [
    ...block.failed.map(one => failedRows(ctx, one, tone)),
    ...(block.earlierFailed > 0 ? [rows(kit, `earlier-${step.id}`, { first: [railText(kit, tone, '│    ', `earlier-${step.id}-lead`)], rest: [railText(kit, tone, '│    ', `earlier-${step.id}-rest`)], width: ctx.cw - 5, segs: [{ text: `${block.earlierFailed} earlier failed`, style: 'dim' }] })] : []),
    ...block.shown.map(slot => slotRows(ctx, slot, tone)),
  ]
  const more = block.moreBlocks > 0 ? [foldRow(ctx, `more-${step.id}`, tone, block.isMoreOpen ? 'fewer at work' : `${block.hidden} more at work`, block.isMoreOpen ? 'hide' : 'show', FOLD.more(goalOf(ctx.data), step.id))] : []
  return [...title, ...[...agents, ...more].flatMap((one, i) => [railRow(ctx, tone, `step-${step.id}-sp${i}`), ...one])]
}

/** The plan: "PLAN", the goal and "3 of 6 done"; the done steps folded into one line; the steps; the folds; and the later line. */
export function planRows(ctx: Ctx, layout: PlanLayout): Row[] {
  const { kit, data } = ctx
  const head = rows(kit, 'plan-head', {
    first: [], rest: [], width: ctx.cw,
    segs: [{ text: 'PLAN', style: 'bold' }, { text: '  ' }, { text: cellText(layout.title), style: 'bold' }],
    right: <kit.Text key="plan-count" dimColor>{`${layout.done} of ${layout.total} done`}</kit.Text>, size: `${layout.done} of ${layout.total} done`.length,
  })
  const isDoneOpen = foldsOf(data.fx).has(FOLD.done(goalOf(data)))
  const earlier = layout.earlierDone
  // The steps done before the last one fold into one line; the last one is a done row of its own, on the rail.
  const done = [
    ...(earlier.length === 0 ? [] : [[...foldRowMarked(ctx, 'done-fold', 'done', `${earlier.length} ${earlier.length === 1 ? 'step' : 'steps'} done`, isDoneOpen ? 'hide' : 'show', FOLD.done(goalOf(data))), ...(isDoneOpen ? [railRow(ctx, 'done', 'done-open-sp'), ...doneRows(ctx, earlier)] : [])]]),
    ...(layout.lastDone === undefined ? [] : [lastDoneRows(ctx, layout.lastDone)]),
  ]
  const steps = layout.steps.map(block => stepRows(ctx, block))
  const moreSteps = layout.extraSteps > 0 ? [foldRow(ctx, 'more-steps', 'dim', layout.isStepsOpen ? 'fewer steps' : `${layout.extraSteps} more ${layout.extraSteps === 1 ? 'step' : 'steps'}`, layout.isStepsOpen ? 'hide' : 'show', FOLD.steps(goalOf(data)))] : []
  const groups = [...done, ...steps, ...moreSteps]
  const body = groups.flatMap((group, i) => [...(i > 0 ? [railRow(ctx, i <= done.length ? 'done' : 'dim', `plan-sp${i}`)] : []), ...group])
  return [...head, <kit.Text key="plan-gap">{' '}</kit.Text>, ...body, ...laterFold(ctx, { indent: SIDE })]
}

/** The last finished step: its tick on the rail, its words in green with who did it, how long and its tokens at the right, its choices under it. */
function lastDoneRows(ctx: Ctx, step: PlanStep): Row[] {
  const { kit, data } = ctx
  const info = doneInfo(step, data.staff, goalKey(data.plan!), one => cellText(titled(one, data)))
  const lead = [kit.mark('done', 'done', `done-${step.id}-mark`), <kit.Text key={`done-${step.id}-gap`}>{'  '}</kit.Text>]
  const rest = [railText(kit, 'done', '│  ', `done-${step.id}-rest`)]
  const infoNode = info === '' ? undefined : <kit.Text key={`done-${step.id}-info`} dimColor>{info}</kit.Text>
  return [
    ...rows(kit, `done-${step.id}`, { first: lead, rest, width: ctx.cw - SIDE, segs: [{ text: cellText(step.text), style: 'green' }], right: infoNode, size: info.length }),
    ...step.choices.flatMap((choice, i) => rows(kit, `done-${step.id}-c${i}`, { first: rest, rest, width: ctx.cw - SIDE, segs: [{ text: cellText(`Decided: ${choice}`), style: 'dim' }] })),
  ]
}

/** A fold line that begins with a mark: "✓  3 steps done" and its button. */
function foldRowMarked(ctx: Ctx, key: string, kind: MarkKind, words: string, label: string, fold: string): Row[] {
  const { kit, actions } = ctx
  const lead = [kit.mark(kind, kind, `${key}-mark`), <kit.Text key={`${key}-gap`}>{'  '}</kit.Text>]
  const rest = [railText(kit, kind === 'done' ? 'done' : 'dim', '│  ', `${key}-rest`)]
  const button = <kit.Button key={`${key}-btn`} plain dimColor label={label} onPress={() => actions.toggleFold(fold)} />
  return rows(kit, key, { first: lead, rest, width: ctx.cw - SIDE, segs: [{ text: words, style: kind === 'done' ? 'green' : undefined }], right: button, size: label.length })
}
