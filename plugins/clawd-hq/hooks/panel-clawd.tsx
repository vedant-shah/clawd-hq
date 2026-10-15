// Clawd's instructions, the lower part of the Settings tab: the chief of staff's instructions and voice notes as Clawd
// gets them, each under a heading row with where the text comes from and one button that puts a ready-made edit request
// in the prompt box (never sent), then the fixed Always rules, short and dim, with no button. Every surface draws
// Markdown, so nothing here falls back to Text.
import type { ClawdBrief, ClawdPartView } from '../types'
import { LOCKED_RULES } from './instructions'
import type { BriefPart } from './instructions'
import { ACCENT, AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'
import { windowOf } from './scroll-window'

const TITLES: Record<BriefPart, string> = { rules: 'INSTRUCTIONS', voice: 'VOICE NOTES' }
const SOURCES: Record<ClawdPartView['source'], string> = { builtin: 'Built-in', own: 'Your copy', setting: 'Voice file setting' }
const OFF_LINE = 'Clawd isn\'t running the chat, so these are not in use until \'Clawd runs the chat\' is on.'
const WHEN = 'Edits apply from your next session.'
const NO_HOME = 'No home folder was found, so edits cannot be kept.'
/** The fixed rules without their "## Always" heading line, which the tab's own ALWAYS heading stands in for. */
const ALWAYS_BODY = LOCKED_RULES.replace(/^## .*\n+/, '')
/**
 * The backdrop of a file's box. On the terminal, the theme's band behind the person's own prompts, so it follows a
 * light or a dark theme. Elsewhere a faint grey wash, which shows on a light page and a dark one alike.
 */
const TINT = { terminal: 'userMessageBackground', other: '#8080801a' } as const

/** The file an edit goes to, only where it is not the built-in text: an own copy from the home folder on (`~/.clawd-hq/…`), the setting's path as set. */
function fileLine(view: ClawdPartView): string | undefined {
  if (view.path === '') return NO_HOME
  if (view.source === 'builtin') return undefined
  return view.source === 'own' ? view.path.replace(/^.*(?=\/\.clawd-hq\/[^/]+$)/, '~') : view.path
}

/** What is waiting or worth knowing about the part, on one line; none when there is nothing. */
function statusLine(view: ClawdPartView): string | undefined {
  const said = [
    view.isChanged ? 'Edited, not in use yet' : undefined,
    view.isNewer ? 'A newer built-in exists' : undefined,
    view.source === 'setting' ? 'Clear \'Your own voice file\' to go back to the built-in voice' : undefined,
  ].filter((s): s is string => s !== undefined)
  return said.length === 0 ? undefined : said.join(' · ')
}

/** The part's heading, where its text comes from and its buttons on one row; then, under it, its file and its status when there is something to say. */
function header(kit: Kit, part: BriefPart, view: ClawdPartView, actions: PanelActions) {
  const { Box, Text, Button, heading, aside, isTerminal } = kit
  const [file, status] = [fileLine(view), statusLine(view)]
  return (
    <Box key={`clawd-head-${part}`} flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        {heading(TITLES[part])}
        <Text dimColor>{SOURCES[view.source]}</Text>
        <Box flexGrow={1} />
        <Button key={`clawd-edit-${part}`} label="Edit with Claude" onPress={() => actions.editClawd(part, isTerminal)} />
        {view.source === 'own' && <Button key={`clawd-reset-${part}`} plain dimColor label="Reset" onPress={() => actions.resetClawd(part)} />}
      </Box>
      {part === 'rules' && aside(WHEN, 'clawd-when')}
      {file !== undefined && aside(file, `clawd-file-${part}`)}
      {status !== undefined && aside(status, `clawd-status-${part}`)}
    </Box>
  )
}

/** The fixed rules: said to be fixed, dim, with no button. */
function always({ Box, Text, Markdown, heading }: Kit) {
  return (
    <Box key="clawd-always" flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {heading('ALWAYS')}
        <Text dimColor>Fixed</Text>
      </Box>
      <Markdown key="clawd-always-text" text={ALWAYS_BODY} dimColor />
    </Box>
  )
}

/** ▲ and ▼ (each dim where it cannot move) and the count of the lines shown, under a box that has more than it shows. */
function scrollRow({ Box, Button, Text }: Kit, part: BriefPart, w: ReturnType<typeof windowOf>, actions: PanelActions) {
  return (
    <Box key={`clawd-scroll-${part}`} flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center" paddingX={1}>
      <Button key={`clawd-up-${part}`} plain label="▲" dimColor={w.isTop} onPress={() => actions.scrollClawd(part, -1)} />
      <Button key={`clawd-down-${part}`} plain label="▼" dimColor={w.isEnd} onPress={() => actions.scrollClawd(part, 1)} />
      <Text key={`clawd-lines-${part}`} dimColor size="footnote" tabular wrap="wrap">{w.count}</Text>
    </Box>
  )
}

/** The file in its box: a window of whole lines on a darker backdrop, then the row that moves it when the file is longer than the box. */
function textBox(kit: Kit, part: BriefPart, view: ClawdPartView, data: PanelData, actions: PanelActions) {
  const { Box, Markdown, isTerminal } = kit
  const kept = data.fx.scroll?.[part]
  const w = windowOf(view.text, kept?.at ?? 0, kept?.of)
  return (
    <Box flexDirection="column">
      <Box key={`clawd-box-${part}`} flexDirection="column" backgroundColor={isTerminal ? TINT.terminal : TINT.other} paddingX={1}>
        <Markdown key={`clawd-text-${part}`} text={w.text} />
      </Box>
      {!w.isAll && scrollRow(kit, part, w, actions)}
    </Box>
  )
}

function partSection(kit: Kit, part: BriefPart, data: PanelData, actions: PanelActions) {
  const view = data.brief[part]
  if (view === undefined) return null
  const { Box } = kit
  return (
    <Box key={`clawd-${part}`} flexDirection="column" gap={1}>
      {header(kit, part, view, actions)}
      {textBox(kit, part, view, data, actions)}
    </Box>
  )
}

/** The word the last button left: a plain line, or the line to type in a box where the prompt box could not take it. */
function noticeView({ Box, Text }: Kit, n: NonNullable<ClawdBrief['notice']>) {
  if (n.line === undefined) return <Text key="clawd-notice" color={ACCENT} wrap="wrap">{n.text}</Text>
  return (
    <Box key="clawd-notice" borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
      <Text wrap="wrap">{n.text}</Text>
      <Text weight="semibold" wrap="wrap">{n.line.trimEnd()}</Text>
    </Box>
  )
}

export function clawdTab(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text } = kit
  const b = data.brief
  const isEmpty = b.rules === undefined && b.voice === undefined
  return (
    <Box flexDirection="column" gap={1}>
      {!b.isOn && <Text key="clawd-off" color={AMBER} wrap="wrap">{OFF_LINE}</Text>}
      {b.notice !== undefined && noticeView(kit, b.notice)}
      {isEmpty && <Text dimColor wrap="wrap">Nothing to show yet. Clawd's instructions are read when a session starts.</Text>}
      {partSection(kit, 'rules', data, actions)}
      {partSection(kit, 'voice', data, actions)}
      {b.rules !== undefined && always(kit)}
    </Box>
  )
}
