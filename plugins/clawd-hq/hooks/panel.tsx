// One pane of the side panel: the view's body, then the gauges as a footer. The host draws the tabs between the views.
import { headerGauges } from './meters'
import type { GaugeView } from './meters'
import { kitOf } from './panel-kit'
import type { Kit, PanelTools } from './panel-kit'
import { decisionsTab } from './panel-decisions'
import { logTab } from './panel-log'
import { officeTab } from './panel-office'
import { peopleTab } from './panel-people'
import type { PanelActions, PanelData } from './panel-types'
import type { PaneView } from './panes'

/** What a pane knows about its room: cells across, and how much of its height the footer should stretch to. */
export type PanelLayout = { columns: number; minHeight?: number | string }

/** One gauge: a dim label, a thin bar, the bright percent, and the dim time left. It keeps its width, so the row wraps between gauges. */
function gauge(kit: Kit, g: GaugeView) {
  const { Box, Text, bar } = kit
  return (
    <Box key={`gauge-${g.key}`} flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
      <Text dimColor>{g.label}</Text>
      {bar(g.value, `${g.label} ${g.percent} used`)}
      <Text>{g.percent}</Text>
      {g.left !== undefined && <Text dimColor>{`· ${g.left}`}</Text>}
    </Box>
  )
}

function footer(kit: Kit, data: PanelData) {
  return (
    <kit.Box key="gauges" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
      {headerGauges(data.gauge, data.now).map(g => gauge(kit, g))}
    </kit.Box>
  )
}

function bodyOf(kit: Kit, data: PanelData, view: PaneView, actions: PanelActions, cw: number) {
  if (view === 'decisions') return decisionsTab(kit, data, actions)
  if (view === 'people') return peopleTab(kit, data, actions)
  return view === 'log' ? logTab(kit, data) : officeTab(kit, data, actions, cw)
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
      {footer(kit, data)}
    </Box>
  )
}
