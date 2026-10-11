// The CEO Desk pane: what is waiting for the CEO, the answers not yet sent, and the decision log.
import { ACCENT, ago, clip } from './office'
import type { PanelTools } from './panel-kit'
import { isWaiting } from './panel-model'
import type { Ask, Boss } from '../types'

export type DeskTools = Pick<PanelTools, 'Box' | 'Text' | 'Button' | 'Input'>
export type DeskData = { list: Ask[]; boss: Boss; now: number }
export type DeskActions = {
  answer: (id: string, value: string, status?: 'answered' | 'dismissed') => unknown
  send: () => unknown
}

const MAX_LOGGED = 8
const YELLOW = '#ffdb00'

function item(a: Ask, i: number, { Box, Text, Button, Input }: DeskTools, now: number, acts: DeskActions) {
  const isTop = i === 0
  return (
    <Box key={`ask-${a.id}`} borderStyle={isTop ? 'double' : 'round'} borderColor={a.kind === 'decision' ? ACCENT : YELLOW} paddingX={1} flexDirection="column" marginBottom={1}>
      <Text dimColor wrap="truncate">{a.id} · {a.kind === 'decision' ? 'DECISION' : 'QUESTION'} · from {a.from} · {ago(now - a.askedAt)} ago</Text>
      <Text bold wrap="wrap">{a.title}</Text>
      {a.detail !== undefined && <Text dimColor wrap="wrap">{a.detail}</Text>}
      {a.recommend !== undefined && <Text color="green" wrap="wrap">★ Recommends: {a.recommend}</Text>}
      {a.fallback !== undefined && <Text dimColor wrap="wrap">Meanwhile: {a.fallback}</Text>}
      {a.status === 'live'
        ? <Text color="yellow">↳ Clawd is asking you this now. Answer in the dialog below the transcript.</Text>
        : (
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            {a.kind === 'decision' && a.options.map((o, n) => (
              <Button key={`opt-${a.id}-${n}`} hotkey={isTop ? String(n + 1) : undefined} variant={o === a.recommend ? 'primary' : undefined}
                label={o === a.recommend ? `${o} ★` : o} onPress={() => acts.answer(a.id, o)} />
            ))}
            {a.kind === 'question' && Input && (
              <Input key={`in-${a.id}`} placeholder="Type your answer, Enter to send" submitLabel="answer" onSubmit={value => (value.trim() ? acts.answer(a.id, value.trim()) : undefined)} />
            )}
            <Button key={`dismiss-${a.id}`} hotkey={isTop ? 'x' : undefined} dimColor label="dismiss" onPress={() => acts.answer(a.id, 'dismissed', 'dismissed')} />
          </Box>
        )}
    </Box>
  )
}

export function renderDesk(tools: DeskTools, { list, boss, now }: DeskData, acts: DeskActions) {
  const { Box, Text, Button } = tools
  const open = list.filter(isWaiting)
  const pending = list.filter(a => a.status === 'answered' && !a.isDelivered)
  const done = list.filter(a => !isWaiting(a)).slice(-MAX_LOGGED).reverse()
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={ACCENT}>CEO DESK</Text>
        <Text dimColor>{open.length} waiting · {list.filter(a => a.status === 'answered').length} decided</Text>
      </Box>
      <Text dimColor wrap="wrap">The agents keep working while these wait. Your answer goes back to whoever asked.</Text>
      <Box marginTop={1} flexDirection="column">
        {open.length === 0 && <Text dimColor>Nothing waiting for you. Clawd has it handled. ☕</Text>}
        {open.map((a, i) => item(a, i, tools, now, acts))}
      </Box>
      {pending.length > 0 && (
        <Box flexDirection="row" gap={1}>
          <Text color="yellow">{pending.length} answer{pending.length === 1 ? '' : 's'} not yet sent{boss.isBusy ? '' : ' (Clawd is idle)'}.</Text>
          <Button key="send" hotkey="s" variant="primary" label="send to Clawd now" onPress={() => acts.send()} />
        </Box>
      )}
      {done.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>DECISION LOG</Text>
          {done.map(a => (
            <Text wrap="truncate">
              <Text color={a.status === 'dismissed' ? undefined : 'green'} dimColor={a.status === 'dismissed'}>{a.status === 'dismissed' ? '–' : '✓'} {a.id}</Text>
              <Text> {clip(a.title, 40)}</Text>
              <Text dimColor> → {a.answer} · {a.from}</Text>
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
