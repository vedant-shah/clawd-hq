// Clawd's instructions, the lower part of the Settings tab: the chief of staff's instructions and voice notes as Clawd gets them, each file drawn whole as Markdown,
// with one button per file that puts a ready-made edit request in the prompt box (never sent). The fixed Always rules
// are shown the same way and have no edit button. Every surface draws Markdown, so nothing here falls back to Text.
import type { ClawdBrief, ClawdPartView } from '../types'
import { LOCKED_RULES } from './instructions'
import type { BriefPart } from './instructions'
import { ACCENT, AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

const TITLES: Record<BriefPart, string> = { rules: 'INSTRUCTIONS', voice: 'VOICE NOTES' }
const SOURCES: Record<ClawdPartView['source'], string> = { builtin: 'Built-in text', own: 'Your own copy', setting: 'Your voice file setting' }
const OFF_LINE = 'Clawd isn\'t running the chat (setting \'Clawd runs the chat\' is off). Edits apply once it\'s on.'
const WHEN = 'Changes apply from your next session or after /clear.'
/** The fixed rules without their "## Always" heading line, which the tab's own ALWAYS label stands in for. */
const ALWAYS_BODY = LOCKED_RULES.replace(/^## .*\n+/, '')

function pathLine(view: ClawdPartView): string {
  if (view.path === '') return 'No home folder was found, so edits cannot be kept.'
  return view.source === 'builtin' ? `Edits go to ${view.path}` : view.path
}

/** The part's title, where its text comes from, its buttons, its file, and what is waiting for the next session. */
function header(kit: Kit, part: BriefPart, view: ClawdPartView, actions: PanelActions) {
  const { Box, Text, Button, isTerminal } = kit
  return (
    <Box key={`clawd-head-${part}`} flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        <Text bold dimColor>{TITLES[part]}</Text>
        <Text dimColor>·</Text>
        <Text dimColor>{SOURCES[view.source]}</Text>
        <Box flexGrow={1} />
        <Button key={`clawd-edit-${part}`} label="Ask Claude to edit" onPress={() => actions.editClawd(part, isTerminal)} />
        {view.source === 'own' && <Button key={`clawd-reset-${part}`} plain dimColor label="Reset" onPress={() => actions.resetClawd(part)} />}
      </Box>
      <Text dimColor wrap="wrap">{pathLine(view)}</Text>
      {view.isChanged && <Text color={AMBER} wrap="wrap">Edited. Clawd uses this from your next session.</Text>}
      {view.isNewer && <Text dimColor wrap="wrap">A newer built-in version exists.</Text>}
      {view.source === 'setting' && <Text dimColor wrap="wrap">To go back to the built-in voice, clear the setting 'Your own voice file'.</Text>}
    </Box>
  )
}

/** The fixed rules: said to be fixed, with no edit button. */
function always({ Box, Text, Markdown }: Kit) {
  return (
    <Box key="clawd-always" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text bold dimColor>ALWAYS</Text>
        <Text dimColor>·</Text>
        <Text dimColor>Fixed, not editable</Text>
      </Box>
      <Markdown key="clawd-always-text" text={ALWAYS_BODY} />
    </Box>
  )
}

function partSection(kit: Kit, part: BriefPart, data: PanelData, actions: PanelActions) {
  const view = data.brief[part]
  if (view === undefined) return null
  const { Box, Markdown } = kit
  return (
    <Box key={`clawd-${part}`} flexDirection="column">
      {header(kit, part, view, actions)}
      <Box marginTop={1}><Markdown key={`clawd-text-${part}`} text={view.text} /></Box>
      {part === 'rules' && always(kit)}
    </Box>
  )
}

/** The word the last button left: a plain line, or the line to type in a box where the prompt box could not take it. */
function noticeView({ Box, Text }: Kit, n: NonNullable<ClawdBrief['notice']>) {
  if (n.line === undefined) return <Text key="clawd-notice" color={ACCENT} wrap="wrap">{n.text}</Text>
  return (
    <Box key="clawd-notice" borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
      <Text wrap="wrap">{n.text}</Text>
      <Text bold wrap="wrap">{n.line.trimEnd()}</Text>
    </Box>
  )
}

export function clawdTab(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text } = kit
  const b = data.brief
  return (
    <Box flexDirection="column" gap={1}>
      {!b.isOn && <Text key="clawd-off" color={AMBER} wrap="wrap">{OFF_LINE}</Text>}
      {b.notice !== undefined && noticeView(kit, b.notice)}
      <Text dimColor wrap="wrap">{WHEN}</Text>
      {b.rules === undefined && b.voice === undefined && <Text dimColor wrap="wrap">Nothing to show yet. Clawd's instructions are read when a session starts.</Text>}
      {partSection(kit, 'rules', data, actions)}
      {partSection(kit, 'voice', data, actions)}
    </Box>
  )
}
