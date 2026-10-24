// The People tab: the team on the payroll. The laid-off talent pool (and so the rest of what is installed) shows only under a search.
import { avatarFor, compactIcon, tinyIcon } from './avatars'
import { buildPeople, canLayOff, firstSentence, splitPeople, tokensLabel } from './panel-model'
import type { Person } from './panel-model'
import type { Kit } from './panel-kit'
import type { PanelActions, PanelData } from './panel-types'

const MAX_ROWS = 20

function row(p: Person, kit: Kit, actions: PanelActions) {
  const { Box, Text, Button, sprite, isTerminal } = kit
  const icon = sprite(`person-${p.type}`, (isTerminal ? tinyIcon : compactIcon)(avatarFor(p.type)), { scale: 3, alt: p.name, keep: p.isOff ? 0.75 : undefined })
  return (
    // One line at any width: the picture and the button keep their size, and only the text between them gives way and wraps.
    <Box key={`person-${p.type}`} flexDirection="row" gap={2} alignItems="center">
      <Box flexShrink={0}>{icon}</Box>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Text bold wrap="wrap">{p.name}</Text>
        {p.blurb !== '' && <Text dimColor wrap="wrap">{firstSentence(p.blurb)}</Text>}
        {(p.tokens ?? 0) > 0 && <Text dimColor wrap="wrap">{`${tokensLabel(p.tokens)} tokens`}</Text>}
      </Box>
      <Box flexShrink={0}>
        {p.isOff
          ? <Button key={`hire-${p.type}`} label="Hire" onPress={() => actions.hire(p.type)} />
          : canLayOff(p.type) && <Button key={`layoff-${p.type}`} plain dimColor label="lay off" onPress={() => actions.layOff(p.type)} />}
      </Box>
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

export function peopleTab(kit: Kit, data: PanelData, actions: PanelActions) {
  const { Box, Text, Input } = kit
  const { staff, blurbs, roster, payroll } = data
  const types = [...Object.keys(blurbs), ...Object.keys(roster), ...staff.map(e => e.type)]
  const everyone = buildPeople(types, blurbs, roster, payroll.laidOff)
  const query = data.fx.finds?.people ?? ''
  const found = splitPeople(everyone, query)
  // Laid-off helpers (the pool) are listed only under a search.
  const isSearching = query.trim() !== ''
  const team = found.team
  const pool = isSearching ? found.pool : []
  return (
    <Box flexDirection="column" gap={1}>
      {Input && (
        <Input key="find-people" label="/" placeholder="Search to hire someone else" value={query} onInput={v => actions.setFind('people', v)}
          onSubmit={v => actions.setFind('people', v)} />
      )}
      {everyone.length === 0 && <Text dimColor>No one on the books yet. Agents appear here once they are offered to Clawd.</Text>}
      {isSearching && team.length + pool.length === 0 && <Text dimColor wrap="wrap">{`Nothing matches "${query.trim()}".`}</Text>}
      {team.length > 0 && section('TEAM', team, kit, actions)}
      {pool.length > 0 && section('TALENT POOL', pool, kit, actions)}    </Box>
  )
}
