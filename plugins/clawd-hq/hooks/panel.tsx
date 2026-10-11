// The side panel: a row of gauges, four tabs, and the tab's body.
import { ACCENT } from './office'
import { headerGauges } from './meters'
import type { GaugeView } from './meters'
import { kitOf } from './panel-kit'
import type { Kit, PanelTools } from './panel-kit'
import { decisionsTab } from './panel-decisions'
import { logTab } from './panel-log'
import { officeTab } from './panel-office'
import { peopleTab } from './panel-people'
import type { PanelActions, PanelData } from './panel-types'
import type { Fx } from '../types'

const TABS: Array<{ view: Fx['view']; hotkey: string; label: (data: PanelData) => string }> = [
  { view: 'office', hotkey: 'o', label: () => 'Office' },
  { view: 'decisions', hotkey: 'd', label: d => (d.memory.length > 0 ? `Decisions ${d.memory.length}` : 'Decisions') },
  { view: 'people', hotkey: 'p', label: () => 'People' },
  { view: 'log', hotkey: 'l', label: () => 'Log' },
]

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

function header(kit: Kit, data: PanelData) {
  return (
    <kit.Box key="gauges" flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap={2}>
      {headerGauges(data.gauge, data.now).map(g => gauge(kit, g))}
    </kit.Box>
  )
}

/** A strip of boxed tabs: the open one in a rounded accent box with a bright label, the rest in dim boxes. */
function tabs(kit: Kit, data: PanelData, view: Fx['view'], actions: PanelActions) {
  const { Box, Button } = kit
  return (
    <Box key="tabs" flexDirection="row" flexWrap="wrap" alignItems="center">
      {TABS.map(t => {
        const isOpen = t.view === view
        return (
          <Box key={`tabbox-${t.view}`} borderStyle="round" borderColor={isOpen ? ACCENT : undefined} borderDimColor={isOpen ? undefined : true} paddingX={1}>
            <Button key={`tab-${t.view}`} plain hotkey={t.hotkey} dimColor={isOpen ? undefined : true} label={t.label(data)} onPress={() => actions.setView(t.view)} />
          </Box>
        )
      })}
    </Box>
  )
}

function bodyOf(kit: Kit, data: PanelData, view: Fx['view'], actions: PanelActions, cw: number) {
  if (view === 'decisions') return decisionsTab(kit, data, actions)
  if (view === 'people') return peopleTab(kit, data, actions)
  return view === 'log' ? logTab(kit, data) : officeTab(kit, data, actions, cw)
}

export function renderPanel(tools: PanelTools, bodyColumns: number, data: PanelData, actions: PanelActions) {
  const kit = kitOf(tools)
  const { Box, Text } = kit
  const cw = Math.max(24, bodyColumns)
  // A view an older version stored (directory, memory) falls back to the office.
  const view: Fx['view'] = TABS.some(t => t.view === data.fx.view) ? data.fx.view : 'office'
  return (
    <Box flexDirection="column" gap={1}>
      {data.fx.demo && (
        <Box borderStyle="single" borderColor="yellow" paddingX={1}>
          <Text color="yellow" wrap="wrap">{`🎬 ${data.fx.demo.step}/${data.fx.demo.total} · ${data.fx.demo.caption}`}</Text>
        </Box>
      )}
      {header(kit, data)}
      {tabs(kit, data, view, actions)}
      {bodyOf(kit, data, view, actions, cw)}
    </Box>
  )
}
