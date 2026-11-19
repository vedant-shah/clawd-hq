import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BRIEF_NOTE } from '../hooks/desk'
import { parseHistory } from '../hooks/history'
import { START, host } from './host'
import { planFs } from './plan-disk'

// A "You should know" note raised about a run joins the history as a `note` record: the run and the tag, never the note's words, so the
// notes about a run can be counted when the history is read (the check ends after the run's own record is written).

const DIR = '/repo/.clawd-hq'
const USAGE = { input_tokens: 9_000, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const NOTE = 'learn: The Tester says all tests pass, but the last test run failed.\ntag: Heads up\nexplain: **The tests did not pass**\nThe last run ended with 3 failures.'
const ROWS = (brief: string) => [
  { role: 'user', text: brief, toolUses: [] },
  { role: 'assistant', text: 'Step 1 of 2: reading the code.', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: 'src/login.ts' }, text: 'code' }] },
  { role: 'assistant', text: 'Step 2 of 2: testing.', toolUses: [{ tool_use_id: 'u2', tool: 'Bash', input: { command: 'npm test' }, text: '3 failed', isError: true }] },
  { role: 'assistant', text: 'All tests pass.', toolUses: [] },
]

test('a note raised about a run is written as its run and its tag, never its words', { timeoutMs: 15_000, options: { openAtStart: true } }, async ($, on) => { // the note check runs while an office tab is open, so the office opens at the start
  const h = host(on, [])
  planFs(on, h.files)
  on('session.id', () => ({ value: 's1' }) as never)
  on('model.complete', () => ({ value: { isAnswered: true, text: NOTE, usage: USAGE } }) as never)
  on('session.messages', (_$, e) => ({ value: (e as { agentId?: string } | undefined)?.agentId === 'a1' ? ROWS(`Fix the login bug.${BRIEF_NOTE}`) : { deny: 'no' } }) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
  await $.agent.spawn({ prompt: 'Fix the login bug.', description: 'Fix login', subagentType: 'ecc:tdd-guide' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'All tests pass.', turnId: 't-a1', agentId: 'a1', isAborted: false, durationMs: 60_000, usage: { ...USAGE, model: 'claude-opus-5-5' } } as never)
  const shown = () => ((h.saved.get('know:log:/repo') ?? []) as Array<{ outcome: string }>).some(e => e.outcome === 'shown')
  for (let i = 0; i < 300 && !shown(); i += 1) await h.clock.advance(0)
  expect(shown()).toBe(true)
  await ($ as Engine).session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
  const text = [...h.files.entries()].filter(([path]) => path.startsWith(`${DIR}/history`)).map(([, t]) => t).join('\n')
  expect(parseHistory(text).filter(r => r.kind === 'note')).toEqual([{ v: 1, at: expect.any(Number), kind: 'note', session: 's1', run: 'a1', tag: 'Heads up' }])
  expect(text).not.toContain('all tests pass')
  expect(text).not.toContain('3 failures')
})
