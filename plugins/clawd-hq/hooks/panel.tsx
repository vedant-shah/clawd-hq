// One pane of the side panel: the view's body, then the usage footer. The host draws the tabs between the views.
import { kitOf } from './panel-kit'
import type { Kit, PanelTools } from './panel-kit'
import { decisionsTab } from './panel-decisions'
import { officeTab } from './panel-office'
import { peopleTab } from './panel-people'
import { settingsTab } from './panel-settings'
import type { PanelActions, PanelData } from './panel-types'
import { usageFooter } from './panel-usage'
import type { PaneView } from './panes'

/** What a pane knows about its room: cells across, and how much of its height the footer should stretch to. */
export type PanelLayout = { columns: number; minHeight?: number | string }

function bodyOf(kit: Kit, data: PanelData, view: PaneView, actions: PanelActions, cw: number) {
  if (view === 'decisions') return decisionsTab(kit, data, actions)
  if (view === 'people') return peopleTab(kit, data, actions)
  return view === 'settings' ? settingsTab(kit, data, actions) : officeTab(kit, data, actions, cw)
}

export function renderPanel(tools: PanelTools, layout: PanelLayout, data: PanelData, actions: PanelActions, view: PaneView) {
  const kit = kitOf(tools)
  const { Box, Text } = kit
  const cw = Math.max(24, layout.columns)
  return (
    <Box flexDirection="column" gap={1} minHeight={layout.minHeight}>
      {data.fx.demo && (
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow" wrap="wrap">{`🎬 ${data.fx.demo.step}/${data.fx.demo.total} · ${data.fx.demo.caption}`}</Text>
        </Box>
      )}
      {bodyOf(kit, data, view, actions, cw)}
      {/* Where the room is known, a spacer takes what is left and the footer sits on the bottom edge. */}
      {layout.minHeight !== undefined && <Box flexGrow={1} />}
      {usageFooter(kit, data, actions)}
    </Box>
  )
}
