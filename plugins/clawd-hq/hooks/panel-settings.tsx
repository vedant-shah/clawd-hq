// The Settings tab: the plugin's switches (read-only, with where to change them), a link that swaps the tab to the list of
// finished work, and Clawd's instructions and voice notes. Every text wraps; nothing here is cut.
import type { BriefingOptions } from './instructions'
import { ACCENT } from './office'
import { clawdTab } from './panel-clawd'
import { logTab } from './panel-log'
import { doneThisSession } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

type Row = {
  key: string
  title: string
  /** What the switch does, in one plain line. */
  says: string
  /** On or Off; the voice file's path; nothing when a voice file is not set (no row). */
  value: (o: BriefingOptions) => string | undefined
}

const onOff = (isOn: boolean) => (isOn ? 'On' : 'Off')

const ROWS: readonly Row[] = [
  { key: 'chiefOfStaff', title: 'Clawd runs the chat', value: o => onOff(o.isOn), says: 'The main chat works as Clawd, the chief of staff. He hands real work to specialists and reports in plain words.' },
  { key: 'quietChat', title: 'Quiet chat', value: o => onOff(o.isQuiet), says: 'Hides the "finished" notices of specialists he hired and his own no-update lines. The full view (ctrl+o) shows everything.' },
  { key: 'recap', title: 'Recap', value: o => onOff(o.isRecapOn), says: 'After a few quiet minutes, one line on where things stand on Clawd\'s card. It uses a little of your plan.' },
  { key: 'youShouldKnow', title: 'You should know', value: o => onOff(o.isKnowOn), says: 'A small model checks finished work and may leave one short note on Clawd\'s card. It uses a little of your plan.' },
  { key: 'voiceFile', title: 'Your own voice file', value: o => (o.voiceFile === '' ? undefined : o.voiceFile), says: 'Sets how Clawd sounds, in place of his built-in voice. It changes his tone only, never his rules.' },
]

const WHERE = 'Change them in /plugin, on the page of Clawd HQ, or in /config. A change takes effect when the plugin reloads.'

function row({ Box, Text }: Kit, r: Row, value: string) {
  const isOn = value === 'On'
  return (
    <Box key={`switch-${r.key}`} flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text bold wrap="wrap">{r.title}</Text>
        <Text dimColor>·</Text>
        <Text color={isOn ? ACCENT : undefined} dimColor={value === 'Off'} wrap="wrap">{value}</Text>
      </Box>
      <Text dimColor wrap="wrap">{r.says}</Text>
    </Box>
  )
}

function switches(kit: Kit, options: BriefingOptions) {
  const { Box, Text } = kit
  return (
    <Box key="settings-switches" flexDirection="column" gap={1}>
      <Text bold dimColor>SWITCHES</Text>
      {ROWS.flatMap(r => { const value = r.value(options); return value === undefined ? [] : [row(kit, r, value)] })}
    </Box>
  )
}

export function settingsTab(kit: Kit, data: PanelData, actions: PanelActions) {
  if (data.fx.isLogOpen === true) return logTab(kit, data, actions)
  const { Box, Text, Button } = kit
  const finished = doneThisSession(data.staff, data.gauge.startedAt).length
  return (
    <Box flexDirection="column" gap={1}>
      {switches(kit, data.options)}
      <Text dimColor wrap="wrap">{WHERE}</Text>
      <Button key="settings-log" plain label={`Finished this session · ${finished}`} onPress={() => actions.showLog(true)} />
      {clawdTab(kit, data, actions)}
    </Box>
  )
}
