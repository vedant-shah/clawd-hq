// The Settings tab: the plugin's configs (each on/off one a toggle; the voice file read-only), when a change applies, a
// link that swaps the tab to the list of finished work, and Clawd's instructions and voice notes. Every text wraps; nothing here is cut.
import { TOGGLES, WHEN_APPLIED } from './configs'
import type { ConfigToggle } from './configs'
import { AMBER } from './office'
import { clawdTab } from './panel-clawd'
import { logTab } from './panel-log'
import { doneThisSession } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

/** One config: its name, a toggle that reads its value and turns it the other way, and one short line on what it does. */
function toggleRow({ Box, Text, Button }: Kit, t: ConfigToggle, isOn: boolean, actions: PanelActions) {
  return (
    <Box key={`config-row-${t.field}`} flexDirection="column">
      <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
        <Text bold wrap="wrap">{t.title}</Text>
        <Button key={`config-${t.field}`} label={isOn ? '● On' : '○ Off'} dimColor={!isOn} onPress={() => actions.setConfig(t.field, !isOn)} />
      </Box>
      <Text dimColor wrap="wrap">{t.says}</Text>
    </Box>
  )
}

/** The voice file is a path, not a switch: shown as set, only when one is. */
function voiceRow({ Box, Text }: Kit, path: string) {
  return (
    <Box key="config-row-voiceFile" flexDirection="column">
      <Text bold wrap="wrap">Your own voice file</Text>
      <Text wrap="wrap">{path}</Text>
      <Text dimColor wrap="wrap">Sets how Clawd sounds; his rules stay the same.</Text>
    </Box>
  )
}

function configs(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text } = kit
  const note = data.fx.configNote
  return (
    <Box key="settings-configs" flexDirection="column" gap={1}>
      <Text bold dimColor>CONFIGS</Text>
      {TOGGLES.map(t => toggleRow(kit, t, t.isOn(data.options), actions))}
      {data.options.voiceFile !== '' && voiceRow(kit, data.options.voiceFile)}
      {note !== undefined && <Text color={AMBER} wrap="wrap">{note}</Text>}
    </Box>
  )
}

export function settingsTab(kit: Kit, data: PanelData, actions: PanelActions) {
  if (data.fx.isLogOpen === true) return logTab(kit, data, actions)
  const { Box, Text, Button } = kit
  const finished = doneThisSession(data.staff, data.gauge.startedAt).length
  return (
    <Box flexDirection="column" gap={1}>
      {configs(kit, data, actions)}
      <Text dimColor wrap="wrap">{WHEN_APPLIED}</Text>
      <Button key="settings-log" plain label={`Finished this session · ${finished}`} onPress={() => actions.showLog(true)} />
      {clawdTab(kit, data, actions)}
    </Box>
  )
}
