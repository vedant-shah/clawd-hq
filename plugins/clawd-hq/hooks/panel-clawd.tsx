// The Clawd tab: the chief of staff's instructions and voice notes as Clawd gets them, each "## " section folded shut,
// and buttons that put a ready-made edit request in the prompt box (never sent). The fixed Always rules are shown
// open and have no edit button. Plain wrapped text only: the files are the person's, so nothing is read as Markdown.
import type { ClawdBrief, ClawdPartView } from '../types'
import { blocksOf, sectionsOf } from './clawd-edit'
import type { Block, Section } from './clawd-edit'
import { LOCKED_RULES } from './instructions'
import type { BriefPart } from './instructions'
import { ACCENT, AMBER } from './office'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

const TITLES: Record<BriefPart, string> = { rules: 'INSTRUCTIONS', voice: 'VOICE NOTES' }
const SOURCES: Record<ClawdPartView['source'], string> = { builtin: 'Built-in text', own: 'Your own copy', setting: 'Your voice file setting' }
const OFF_LINE = 'Clawd isn\'t running the chat (setting \'Clawd runs the chat\' is off). Edits apply once it\'s on.'
const WHEN = 'Changes apply from your next session or after /clear.'
const ALWAYS_BODY = sectionsOf(LOCKED_RULES).sections[0]?.body ?? ''

/** One title, paragraph or bullet. A bullet's mark sits in its own column, so wrapped lines hang under the words. */
function blockView({ Box, Text }: Kit, b: Block, key: string) {
  const top = b.isSpaced ? 1 : 0
  if (b.kind !== 'bullet') return <Box key={key} marginTop={top}><Text bold={b.kind === 'title'} wrap="wrap">{b.text}</Text></Box>
  return (
    <Box key={key} flexDirection="row" marginTop={top}>
      <Box width={2} flexShrink={0}><Text dimColor>•</Text></Box>
      <Box flexShrink={1} flexGrow={1}><Text wrap="wrap">{b.text}</Text></Box>
    </Box>
  )
}

function blocks(kit: Kit, body: string, key: string) {
  const { Box } = kit
  return <Box key={key} flexDirection="column">{blocksOf(body).map((b, i) => blockView(kit, b, `${key}-${i}`))}</Box>
}

/** A section: its fold, its heading (wrapped, never cut) and a small edit button; the text below only when opened. */
function sectionRow(kit: Kit, part: BriefPart, s: Section, i: number, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button, isTerminal } = kit
  const fold = `${part}:${s.heading}`
  const isOpen = (data.fx.clawdOpen ?? []).includes(fold)
  return (
    <Box key={`clawd-sec-${part}-${i}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1} alignItems="flex-start">
        <Button key={`clawd-fold-${part}-${i}`} plain label={isOpen ? '▾' : '▸'} onPress={() => actions.toggleClawd(fold)} />
        <Box flexShrink={1} flexGrow={1}><Text bold wrap="wrap">{s.heading}</Text></Box>
        <Button key={`clawd-edit-${part}-${i}`} plain dimColor label="edit" onPress={() => actions.editClawd({ part, heading: s.heading }, isTerminal)} />
      </Box>
      {isOpen && <Box paddingLeft={2} flexDirection="column">{blocks(kit, s.body, `clawd-body-${part}-${i}`)}</Box>}
    </Box>
  )
}

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
        <Button key={`clawd-edit-${part}`} label="Ask Claude to edit" onPress={() => actions.editClawd({ part }, isTerminal)} />
        {view.source === 'own' && <Button key={`clawd-reset-${part}`} plain dimColor label="Reset" onPress={() => actions.resetClawd(part)} />}
      </Box>
      <Text dimColor wrap="wrap">{pathLine(view)}</Text>
      {view.isChanged && <Text color={AMBER} wrap="wrap">Edited. Clawd uses this from your next session.</Text>}
      {view.isNewer && <Text dimColor wrap="wrap">A newer built-in version exists.</Text>}
      {view.source === 'setting' && <Text dimColor wrap="wrap">To go back to the built-in voice, clear the setting 'Your own voice file'.</Text>}
    </Box>
  )
}

/** The fixed rules: always open, said to be fixed, and with no edit button. */
function always(kit: Kit) {
  const { Box, Text } = kit
  return (
    <Box key="clawd-always" flexDirection="column" marginTop={1}>
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text bold dimColor>ALWAYS</Text>
        <Text dimColor>·</Text>
        <Text dimColor>Fixed, not editable</Text>
      </Box>
      {blocks(kit, ALWAYS_BODY, 'clawd-always-body')}
    </Box>
  )
}

function partSection(kit: Kit, part: BriefPart, data: PanelData, actions: PanelActions) {
  const view = data.brief[part]
  if (view === undefined) return null
  const { Box } = kit
  const { intro, sections } = sectionsOf(view.text)
  return (
    <Box key={`clawd-${part}`} flexDirection="column">
      {header(kit, part, view, actions)}
      {intro !== '' && <Box marginTop={1}>{blocks(kit, intro, `clawd-intro-${part}`)}</Box>}
      {sections.length > 0 && <Box flexDirection="column" marginTop={1}>{sections.map((s, i) => sectionRow(kit, part, s, i, data, actions))}</Box>}
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
