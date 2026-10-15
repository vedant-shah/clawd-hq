// The Settings tab, made to scan: the plugin's configs (each on/off one a name with its toggle on the right; the voice
// file read-only), one line on when a change applies, a link that swaps the tab to the list of finished work, and
// Clawd's instructions and voice notes. Every text wraps; nothing here is cut.
import { TOGGLES, WAIT_FOR_FREE, WHEN_APPLIED } from './configs'
import type { ConfigToggle } from './configs'
import { AMBER } from './office'
import { clawdTab } from './panel-clawd'
import { logTab } from './panel-log'
import { doneThisSession } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

/** One config: its name, and at the row's right end a toggle that reads its value and turns it the other way (only its value, dimmed, while Clawd is busy). */
function toggleRow({ Box, Text, Button }: Kit, t: ConfigToggle, isOn: boolean, isBusy: boolean, actions: PanelActions) {
  const label = isOn ? '● On' : '○ Off'
  return (
    <Box key={`config-row-${t.field}`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
      <Box flexShrink={1}><Text wrap="wrap">{t.title}</Text></Box>
      {isBusy
        ? <Text key={`config-value-${t.field}`} dimColor>{label}</Text>
        : <Button key={`config-${t.field}`} label={label} dimColor={!isOn} onPress={() => actions.setConfig(t.field, !isOn)} />}
    </Box>
  )
}

/** The voice file is a path, not a switch: shown as set, only when one is. */
function voiceRow({ Box, Text, aside }: Kit, path: string) {
  return (
    <Box key="config-row-voiceFile" flexDirection="column">
      <Text wrap="wrap">Your own voice file</Text>
      {aside(path)}
    </Box>
  )
}

function configs(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, heading, aside } = kit
  const note = data.fx.configNote
  const isBusy = data.boss.isBusy
  return (
    <Box key="settings-configs" flexDirection="column">
      {heading('CONFIGS')}
      {TOGGLES.map(t => toggleRow(kit, t, t.isOn(data.options), isBusy, actions))}
      {data.options.voiceFile !== '' && voiceRow(kit, data.options.voiceFile)}
      {aside(isBusy ? WAIT_FOR_FREE : WHEN_APPLIED, 'config-when')}
      {note !== undefined && <Text key="config-note" color={AMBER} wrap="wrap">{note}</Text>}
    </Box>
  )
}

export function settingsTab(kit: Kit, data: PanelData, actions: PanelActions) {
  if (data.fx.isLogOpen === true) return logTab(kit, data, actions)
  const { Box, Button } = kit
  const finished = doneThisSession(data.staff, data.gauge.startedAt).length
  return (
    <Box flexDirection="column" gap={1}>
      {configs(kit, data, actions)}
      <Button key="settings-log" plain label={`Finished this session · ${finished} ›`} onPress={() => actions.showLog(true)} />
      {clawdTab(kit, data, actions)}
    </Box>
  )
}
