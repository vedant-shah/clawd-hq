// The History tab, drawn as the two History boards have it (terminal at 60 columns, and desktop), from history-view.ts: IN PROGRESS, FINISHED (the
// goals that ended, one line each; opened, a bordered card on the desktop and a list with a rail on the terminal), then the Other work and
// Artifacts folds. Marks are coloured glyphs, as the boards draw them (no pictures here). Spacing is the host's named steps and cells, borders
// the host's own Box border; no text weight or size props (bold is the one emphasis the oldest engines take).
import { ARTIFACT_SHOWN, realArtifacts } from './artifacts'
import { HISTORY_FOLD, safeHistoryLayout } from './history-view'
import type { GoalLine, HistoryLayout, OtherLine, StepLine } from './history-view'
import { AMBER, GREEN, RED, ago } from './office'
import { artifactRows } from './panel-artifacts'
import type { Ctx } from './panel-desk'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { BOARD, RAIL_COLOR } from './plan-marks'
import { SUMMARY_LABEL } from './plan-view'
import { rows } from './term-rows'
import { cellText, cellWidth, graphemes } from './wrap-to'

type Item = JSX.Element
const EMPTY = 'Nothing has finished yet in this project.'

/** The boards' colours: the terminal board's softer green and red, the desktop board's brighter green; amber on both. */
const COLOR = {
  terminal: { done: BOARD.doneWords, failed: BOARD.failedWords, red: BOARD.failedWords },
  desktop: { done: GREEN, failed: RED, red: BOARD.failedWords },
} as const
/** The terminal board's rail beside an open goal: green for one done, grey for one set aside. */
const RAIL = { done: RAIL_COLOR.done, setAside: '#5a5a55' } as const

/** How long ago, as the boards say it: minutes, hours, then days from a day on; a goal row says "yesterday" for the day before. */
export function ageOf(ms: number, isGoal = false): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return isGoal && hours < 48 ? 'yesterday' : `${Math.floor(hours / 24)}d ago`
}

type MarkKind = StepLine['mark'] | 'setAside' | 'now'
const GLYPH: Record<MarkKind, string> = { done: '✓', failed: '✗', open: '○', setAside: '◌', now: '●' }
function glyph(kit: Kit, kind: MarkKind, key: string): Item {
  const c = COLOR[kit.isTerminal ? 'terminal' : 'desktop']
  const color = kind === 'done' ? c.done : kind === 'failed' ? c.failed : kind === 'now' ? AMBER : undefined
  return <kit.Text key={key} color={color} dimColor={color === undefined ? true : undefined}>{GLYPH[kind]}</kit.Text>
}
const noteColor = (kit: Kit, tone: 'amber' | 'red' | 'dim') => (tone === 'amber' ? AMBER : tone === 'red' ? COLOR[kit.isTerminal ? 'terminal' : 'desktop'].red : undefined)
/** A fold or "show" button: plain and dim, the closest the host draws to the boards' link-like buttons. */
const toggle = (ctx: Ctx, key: string, fold: string, label: string) => <ctx.kit.Button key={key} plain dimColor label={label} onPress={() => ctx.actions.toggleFold(fold)} />
/** Text cut to `width` cells with "…" where it does not fit. */
const cut = (text: string, width: number) => (cellWidth(text) <= width ? text : `${graphemes(text).reduce((out, g) => (cellWidth(`${out}${g}`) < width ? `${out}${g}` : out), '')}…`)
/** A mark in a column of its own on the desktop, two cells wide, so what follows starts in one place whatever the glyph (◌ is wider than ✓). */
const markCell = (kit: Kit, mark: Item, key: string) => (kit.isTerminal ? mark : <kit.Box key={key} width={2} flexShrink={0} justifyContent="center">{mark}</kit.Box>)
/** A mark and what follows it: two cells apart on the terminal, the board's 10 pixels ("sm") on the desktop. */
const marked = (kit: Kit, mark: Item, rest: Item, key: string) => <kit.Box key={key} flexDirection="row" flexShrink={1} columnGap={kit.isTerminal ? 2 : 'sm'}>{markCell(kit, mark, 'mark')}{rest}</kit.Box>
/** Words from the history (a file anyone may have edited) as the terminal draws them: wide characters measured, nothing that moves the cursor. */
const say = (kit: Kit, text: string) => (kit.isTerminal ? cellText(text) : text)
/** The terminal's blank row. */
const blankRow = (kit: Kit, key: string) => <kit.Text key={key}>{' '}</kit.Text>

// ---- In progress ----

function inProgress(ctx: Ctx, layout: HistoryLayout): Item | null {
  const now = layout.inProgress
  if (now === undefined) return null
  const { Box, Text, heading } = ctx.kit
  return (
    <Box key="history-now" flexDirection="column" gap={ctx.kit.isTerminal ? 0 : 'sm'}>
      {heading('IN PROGRESS')}
      <Box key="history-now-line" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
        {marked(ctx.kit, glyph(ctx.kit, 'now', 'm'), <Text key="t" bold wrap="wrap">{say(ctx.kit, now.title)}</Text>, 'left')}
        <Text dimColor>{`${now.done} of ${now.total} done`}</Text>
      </Box>
    </Box>
  )
}

// ---- A goal that ended ----

const keyOf = (goal: GoalLine) => `${goal.slug}-${goal.at}`

/**
 * Its one line: the mark, the title (a plain button that opens it: the boards' row is the press), "· set aside" dim, and how long ago at the right.
 * Opened, the title is bold, as the boards draw it.
 */
function goalHead(ctx: Ctx, goal: GoalLine): Item {
  const { Box, Text, Button } = ctx.kit
  const title = (
    <Button key={`history-goal-${keyOf(goal)}`} plain onPress={() => ctx.actions.toggleFold(goal.fold)}>
      {goal.isOpen ? <Text bold>{say(ctx.kit, goal.title)}</Text> : say(ctx.kit, goal.title)}
      {goal.isSetAside ? <Text dimColor> · set aside</Text> : ''}
      {goal.isElsewhere ? <Text dimColor> · open in another session</Text> : ''}
    </Button>
  )
  return (
    <Box key={`history-head-${keyOf(goal)}`} flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
      {marked(ctx.kit, glyph(ctx.kit, goal.isElsewhere ? 'open' : goal.isSetAside ? 'setAside' : 'done', 'm'), title, 'left')}
      <Text dimColor>{ageOf(ctx.data.now - goal.at, true)}</Text>
    </Box>
  )
}

/** Resume on a goal set aside fills the prompt box (nothing is sent); on another session's open goal it takes the goal over for this session. */
const resumeButton = (ctx: Ctx, goal: GoalLine) => (
  <ctx.kit.Button key={`history-resume-${keyOf(goal)}`} label="Resume" onPress={() => (goal.isElsewhere ? ctx.actions.resumeGoal(goal.slug) : ctx.actions.agentAsk(goal.resume ?? ''))} />
)
const hasResume = (goal: GoalLine) => goal.resume !== undefined || goal.canTakeOver === true
const pagesWord = (goal: GoalLine) => `${goal.pages.length} ${goal.pages.length === 1 ? 'page' : 'pages'} made:`

/** The terminal's open goal, as the terminal board: every row wrapped here with the rail at its left, then a blank row. */
function goalRail(ctx: Ctx, goal: GoalLine): Item[] {
  const { kit, cw } = ctx
  const { Box, Text, Link } = kit
  const color = goal.isSetAside || goal.isElsewhere ? RAIL.setAside : RAIL.done
  const id = `history-rail-${keyOf(goal)}`
  const rail = (key: string, text = '│  ') => <Text key={key} color={color}>{text}</Text>
  const blank = (key: string) => <Text key={key} wrap="truncate-end" color={color}>│</Text>
  const dim = (key: string, text: string, indent = '│  ') => rows(kit, key, { first: [rail(`${key}-l`, indent)], rest: [rail(`${key}-r`, indent)], width: cw - indent.length, segs: [{ text: cellText(text), style: 'dim' }] })
  const step = (s: StepLine): Item[] => {
    const note = s.note === undefined ? undefined : <Text key={`${id}-${s.id}-note`} color={noteColor(kit, s.note.tone)} dimColor={s.note.tone === 'dim' ? true : undefined}>{s.note.text}</Text>
    const lead = [rail(`${id}-${s.id}-l`), glyph(kit, s.mark, `${id}-${s.id}-m`), <Text key={`${id}-${s.id}-g`}>{' '}</Text>]
    return [
      ...rows(kit, `${id}-${s.id}`, { first: lead, rest: [rail(`${id}-${s.id}-r`, '│    ')], width: cw - 5, segs: [{ text: cellText(s.text), style: s.mark === 'open' ? 'dim' : undefined }], right: note, size: s.note?.text.length ?? 0 }),
      ...s.choices.flatMap((c, i) => dim(`${id}-${s.id}-c${i}`, `Decided: ${c}`, '│    ')),
    ]
  }
  // "1 page made: <link>" on one row where it fits, as the board; else the words, then each link on a row of its own, cut to the width.
  const first = goal.pages[0]
  const oneRow = goal.pages.length === 1 && first !== undefined && 3 + cellWidth(pagesWord(goal)) + 1 + cellWidth(first.title || first.url) <= cw
  const linkRow = (p: { url: string; title: string }, i: number, words?: string) => (
    <Box key={`${id}-page${i}`} flexDirection="row">
      <Text wrap="truncate-end">{rail(`${id}-page${i}-l`)}{words === undefined ? '' : <Text dimColor>{`${words} `}</Text>}<Link href={p.url}>{cut(cellText(p.title || p.url), cw - 3 - (words === undefined ? 0 : cellWidth(words) + 1))}</Link></Text>
    </Box>
  )
  const pages = goal.pages.length === 0 ? [] : [
    blank(`${id}-pages-gap`), ...(oneRow ? [linkRow(first!, 0, pagesWord(goal))] : [...dim(`${id}-pages`, pagesWord(goal)), ...goal.pages.map((p, i) => linkRow(p, i))]),
  ]
  const resume = !hasResume(goal) ? [] : [blank(`${id}-resume-gap`), <Box key={`${id}-resume`} flexDirection="row">{rail(`${id}-resume-l`)}{resumeButton(ctx, goal)}</Box>]
  return [
    ...(goal.summary === undefined ? [] : dim(`${id}-summary`, `${SUMMARY_LABEL}${goal.summary}`)),
    ...dim(`${id}-stats`, goal.stats), blank(`${id}-gap`), ...goal.steps.flatMap(step), ...pages, ...resume, blankRow(kit, `${id}-after`),
  ]
}

/** The desktop's open goal, as the desktop board: a bordered card in its colour, padded, its line, then the rest indented under the title. */
function goalCard(ctx: Ctx, goal: GoalLine): Item {
  const { Box, Text, Link } = ctx.kit
  const step = (s: StepLine) => (
    <Box key={`history-step-${keyOf(goal)}-${s.id}`} flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
        {marked(ctx.kit, glyph(ctx.kit, s.mark, 'm'), <Text key="t" dimColor={s.mark === 'open' ? true : undefined} wrap="wrap">{s.text}</Text>, 'left')}
        {s.note !== undefined && <Text color={noteColor(ctx.kit, s.note.tone)} dimColor={s.note.tone === 'dim' ? true : undefined}>{s.note.text}</Text>}
      </Box>
      {s.choices.map((c, i) => <Box key={`c${i}`} paddingLeft={3}><Text dimColor wrap="wrap">{`Decided: ${c}`}</Text></Box>)}
    </Box>
  )
  const pages = goal.pages.length === 1
    ? <Text key="pages" wrap="wrap"><Text dimColor>{`${pagesWord(goal)} `}</Text><Link href={goal.pages[0]!.url}>{goal.pages[0]!.title || goal.pages[0]!.url}</Link></Text>
    : goal.pages.length > 1
      ? <Box key="pages" flexDirection="column"><Text dimColor>{pagesWord(goal)}</Text>{goal.pages.map((p, i) => <Text key={`p${i}`} wrap="wrap"><Link href={p.url}>{p.title || p.url}</Link></Text>)}</Box>
      : null
  return (
    <Box key={`history-card-${keyOf(goal)}`} borderStyle="round" borderColor={BOARD.card} paddingX={1} paddingY={1} flexDirection="column" gap="sm">
      {goalHead(ctx, goal)}
      {goal.summary !== undefined && <Box paddingLeft={3}><Text dimColor wrap="wrap">{`${SUMMARY_LABEL}${goal.summary}`}</Text></Box>}
      <Box paddingLeft={3}><Text dimColor wrap="wrap">{goal.stats}</Text></Box>
      <Box flexDirection="column" gap="xs" paddingLeft={3}>{goal.steps.map(step)}</Box>
      {pages !== null && <Box paddingLeft={3}>{pages}</Box>}
      {hasResume(goal) && <Box flexDirection="row" paddingLeft={3}>{resumeButton(ctx, goal)}</Box>}
    </Box>
  )
}

/** "12 older" with its show (or hide) button at the right, indented as its list is. */
function olderLine(ctx: Ctx, key: string, fold: string, n: number, isOpen: boolean, indent: number): Item {
  const { Box, Text } = ctx.kit
  return (
    <Box key={`${key}-line`} flexDirection="row" justifyContent="space-between" columnGap={1} paddingLeft={indent}>
      <Text dimColor>{`${n} older`}</Text>
      {toggle(ctx, key, fold, isOpen ? 'hide' : 'show')}
    </Box>
  )
}

const goalRows = (ctx: Ctx, goals: readonly GoalLine[]) =>
  goals.flatMap(goal => (goal.isOpen ? (ctx.kit.isTerminal ? [goalHead(ctx, goal), ...goalRail(ctx, goal)] : [goalCard(ctx, goal)]) : [goalHead(ctx, goal)]))

function finished(ctx: Ctx, layout: HistoryLayout): Item | null {
  if (layout.goals.length === 0) return null
  const { Box, heading, isTerminal } = ctx.kit
  return (
    <Box key="history-finished" flexDirection="column" gap={isTerminal ? 0 : 'sm'}>
      {heading('FINISHED')}
      {goalRows(ctx, layout.goals)}
      {layout.olderGoals > 0 && olderLine(ctx, 'history-goals-older', HISTORY_FOLD.goalsOlder, layout.olderGoals, layout.isGoalsOlderOpen, 3)}
    </Box>
  )
}

/** Goals other sessions left open in this folder, above the finished ones: each opens to its steps, and Resume takes it over for this session. */
function openElsewhere(ctx: Ctx, layout: HistoryLayout): Item | null {
  if (layout.open.length === 0) return null
  const { Box, heading, isTerminal } = ctx.kit
  return (
    <Box key="history-open-elsewhere" flexDirection="column" gap={isTerminal ? 0 : 'sm'}>
      {heading('OPEN IN OTHER SESSIONS')}
      {goalRows(ctx, layout.open)}
    </Box>
  )
}

// ---- Other work and Artifacts, folded ----

/** A fold's line: "▸ Other work · 14", dim while closed; "▾ …", bold, while open, as the terminal board. */
function foldLine(ctx: Ctx, key: string, fold: string, word: string, n: number, isOpen: boolean): Item {
  const label = `${isOpen ? '▾' : '▸'} ${word} · ${n}`
  return (
    <ctx.kit.Button key={key} plain dimColor={!isOpen} label={label} onPress={() => ctx.actions.toggleFold(fold)}>
      {isOpen ? <ctx.kit.Text bold>{label}</ctx.kit.Text> : label}
    </ctx.kit.Button>
  )
}

const OUTCOME_WORD = { done: '', failed: 'failed', stopped: 'stopped', lost: 'lost contact' } as const
/**
 * DECIDED: a run that lost contact is amber, with how long it ran: the board has no such line, and amber is its colour for what needs a look
 * ("1 retry"); red is for a failure.
 */
const outcomeColor = (kit: Kit, outcome: OtherLine['outcome']) => (outcome === 'failed' ? COLOR[kit.isTerminal ? 'terminal' : 'desktop'].red : outcome === 'lost' ? AMBER : undefined)

/** A run off the plan, this session's or an earlier one's: one line, its mark, its name and dim task, and at the right how long ago (and how it ended, unless well). */
function otherLine(ctx: Ctx, one: OtherLine): Item {
  const { Box, Text } = ctx.kit
  const word = one.outcome === 'lost' ? `lost contact after ${ago(one.at - one.startedAt)}` : OUTCOME_WORD[one.outcome]
  const age = ageOf(ctx.data.now - one.at)
  const isFailed = one.outcome === 'failed'
  const color = outcomeColor(ctx.kit, one.outcome)
  const mark = glyph(ctx.kit, one.outcome === 'done' ? 'done' : isFailed ? 'failed' : 'open', 'm')
  // The terminal's line is one text, its mark a cell wide; the desktop's mark has a column of its own, so every name starts in one place.
  const words = ctx.kit.isTerminal
    ? <Text wrap="wrap">{mark}{` ${say(ctx.kit, one.name)}  `}<Text dimColor>{say(ctx.kit, one.task)}</Text></Text>
    : marked(ctx.kit, mark, <Text key="t" wrap="wrap">{`${one.name}  `}<Text dimColor>{one.task}</Text></Text>, 'left')
  return (
    <Box key={`history-run-${one.id}`} flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={1}>
      {words}
      <Text color={color} dimColor={color === undefined ? true : undefined}>{word === '' ? age : `${word} · ${age}`}</Text>
    </Box>
  )
}

function otherWork(ctx: Ctx, layout: HistoryLayout): Item[] {
  const o = layout.other
  if (o.count === 0) return []
  const { Box, isTerminal } = ctx.kit
  return [
    foldLine(ctx, 'history-other', HISTORY_FOLD.other, 'Other work', o.count, o.isOpen),
    ...(o.isOpen ? [<Box key="history-other-rows" flexDirection="column" gap={isTerminal ? 0 : 'xs'} paddingLeft={2}>{o.lines.map(one => otherLine(ctx, one))}</Box>] : []),
    ...(o.isOpen && o.older > 0 ? [olderLine(ctx, 'history-other-older', HISTORY_FOLD.otherOlder, o.older, o.isOlderOpen, 2)] : []),
    // The terminal board leaves a blank row under an open fold.
    ...(o.isOpen && isTerminal ? [blankRow(ctx.kit, 'history-other-after')] : []),
  ]
}

function artifacts(ctx: Ctx): Item[] {
  const n = realArtifacts(ctx.data.artifacts).length
  if (n === 0) return []
  const folds = ctx.data.fx.folds ?? []
  const [isOpen, isAll] = [folds.includes(HISTORY_FOLD.artifacts), folds.includes(HISTORY_FOLD.artifactsOlder)]
  const { Box } = ctx.kit
  const { rows: list } = artifactRows(ctx, isAll, ms => ageOf(ms))
  return [
    foldLine(ctx, 'history-artifacts', HISTORY_FOLD.artifacts, 'Artifacts', n, isOpen),
    ...(isOpen ? [<Box key="history-artifact-rows" flexDirection="column" gap={ctx.kit.isTerminal ? 0 : 'xs'} paddingLeft={2}>{list}</Box>] : []),
    ...(isOpen && n > ARTIFACT_SHOWN ? [olderLine(ctx, 'history-artifacts-older', HISTORY_FOLD.artifactsOlder, n - ARTIFACT_SHOWN, isAll, 2)] : []),
  ]
}

/**
 * The folds, together, "sm" apart on the desktop. The board's line above them is no line here: the host draws every side of a bordered box, so
 * an empty one is a rectangle. The tab's "md" gap sets the folds off from the goals instead.
 */
function folds(ctx: Ctx, layout: HistoryLayout): Item | null {
  const all = [...otherWork(ctx, layout), ...artifacts(ctx)]
  if (all.length === 0) return null
  const { Box, isTerminal } = ctx.kit
  return <Box key="history-folds" flexDirection="column" gap={isTerminal ? 0 : 'sm'}>{all}</Box>
}

export function historyTab(kit: Kit, data: PanelData, actions: PanelActions, cw: number) {
  const ctx: Ctx = { kit, data, actions, cw }
  // A record no check foresaw cannot break the tab: it draws empty, and the reason goes to the history's debug record.
  const input = { records: data.history ?? [], staff: data.staff, sessionStart: data.gauge.startedAt, plan: data.plan, isOn: data.options.isOn, folds: data.fx.folds, openGoals: data.openGoals }
  const layout = safeHistoryLayout(input, why => void actions.historyError(why))
  const rest = [openElsewhere(ctx, layout), finished(ctx, layout), folds(ctx, layout)].filter((one): one is Item => one !== null)
  const body = rest.length === 0 ? [<kit.Text key="history-empty" dimColor wrap="wrap">{EMPTY}</kit.Text>] : rest
  return <kit.Box flexDirection="column" gap={kit.isTerminal ? 1 : 'md'}>{[inProgress(ctx, layout), ...body].filter((one): one is Item => one !== null)}</kit.Box>
}
