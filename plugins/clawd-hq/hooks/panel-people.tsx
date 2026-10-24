// The People tab: the team on the payroll. The laid-off talent pool (and so the rest of what is installed) shows only under a search.
import { avatarFor, compactIcon, tinyIcon } from './avatars'
import { buildPeople, canLayOff, firstSentence, splitPeople } from './panel-model'
import type { Person } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

const MAX_ROWS = 20

function row(p: Person, kit: Kit, actions: PanelActions) {
  const { Box, Text, Button, sprite, isTerminal } = kit
  const icon = sprite(`person-${p.type}`, (isTerminal ? tinyIcon : compactIcon)(avatarFor(p.type)), { scale: 3, alt: '', keep: p.isOff ? 0.75 : undefined })
  return (
    <Box key={`person-${p.type}`} flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
      <Box flexShrink={0}>{icon}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text bold wrap="wrap">{p.name}</Text>
        {p.blurb !== '' && <Text dimColor wrap="wrap">{firstSentence(p.blurb)}</Text>}
      </Box>
      {p.isOff
        ? <Button key={`hire-${p.type}`} label="Hire" onPress={() => actions.hire(p.type)} />
        : canLayOff(p.type) && <Button key={`layoff-${p.type}`} plain dimColor label="lay off" onPress={() => actions.layOff(p.type)} />}
    </Box>
  )
}

function section(title: string, people: Person[], kit: Kit, actions: PanelActions) {
  const { Box, Text } = kit
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold dimColor>{`${title} · ${people.length}`}</Text>
      {people.slice(0, MAX_ROWS).map(p => row(p, kit, actions))}
      {people.length > MAX_ROWS && <Text dimColor>{`And ${people.length - MAX_ROWS} more · search to find them`}</Text>}
    </Box>
  )
}

/** The payroll review, when one waits: what the project has no use for, and the two answers. */
function review(kit: Kit, plan: NonNullable<PanelData['fx']['layoffs']>, actions: PanelActions) {
  const { Box, Text, Button } = kit
  return (
    <Box key="payroll-review" borderStyle="round" borderDimColor paddingX={1} flexDirection="column">
      <Text bold wrap="wrap">{`Payroll review: lay off ${plan.count} of ${plan.total} agent types this project does not use?`}</Text>
      <Text dimColor wrap="wrap">
        {`This project is ${plan.stacks.join(' + ') || 'an unknown stack'}. Not needed here: ${plan.why.join(', ')}. `}
        Laid-off agents stop being listed to Clawd, which saves context on every turn. You can rehire any of them below.
      </Text>
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Button key="payroll-layoff" variant="primary" label={`Lay off ${plan.count}`} onPress={() => actions.settlePayroll(true)} />
        <Button key="payroll-keep" label="Keep everyone" onPress={() => actions.settlePayroll(false)} />
      </Box>
    </Box>
  )
}

export function peopleTab(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Input } = kit
  const { staff, blurbs, roster, payroll } = data
  const types = [...Object.keys(blurbs), ...Object.keys(roster), ...staff.map(e => e.type)]
  const everyone = buildPeople(types, blurbs, roster, payroll.laidOff)
  const query = data.fx.finds?.people ?? ''
  const found = splitPeople(everyone, query)
  // Laid-off helpers (the pool) are listed only under a search; otherwise one line counts them.
  const isSearching = query.trim() !== ''
  const team = found.team
  const pool = isSearching ? found.pool : []
  const waiting = everyone.filter(p => p.isOff).length
  return (
    <Box flexDirection="column" gap={1}>
      {Input && (
        <Input key="find-people" label="/" placeholder="Search to hire someone else" value={query} onInput={v => actions.setFind('people', v)}
          onSubmit={v => actions.setFind('people', v)} />
      )}
      {data.fx.layoffs && review(kit, data.fx.layoffs, actions)}
      {everyone.length === 0 && <Text dimColor>No one on the books yet. Agents appear here once they are offered to Clawd.</Text>}
      {team.length > 0 && section('TEAM', team, kit, actions)}
      {pool.length > 0 && section('TALENT POOL', pool, kit, actions)}
      {!isSearching && waiting > 0 && <Text dimColor wrap="wrap">{`${waiting} more installed. Search to find and hire one.`}</Text>}
    </Box>
  )
}
