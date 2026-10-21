import { expect, test } from 'claude-code/testing'
import { BRIEF_NOTE } from '../hooks/desk'
import { CAP_CHARS, buildRecord, turnRows } from '../hooks/know-record'
import type { RecordInput } from '../hooks/know-record'

type Row = RecordInput['rows'][number]
type Use = Row['toolUses'][number]

const BRIEF = 'Fix the login bug in src/login.ts and run the tests.\n\nUse Vitest for any new test.'
const brief = (text = BRIEF + BRIEF_NOTE): Row => ({ role: 'user', text, toolUses: [] })
const said = (text: string, uses: Use[] = []): Row => ({ role: 'assistant', text, toolUses: uses })
const use = (n: number, tool: string, input: Record<string, unknown>, text?: string, isError = false): Use =>
  ({ tool_use_id: `u${n}`, tool, input, ...(text === undefined ? {} : { text }), ...(isError ? { isError: true as const } : {}) })
const record = (rows: Row[], over: Partial<RecordInput> = {}) =>
  buildRecord({ who: 'Tester', ended: 'answer', rows, report: 'Fixed the bug. All tests pass.', prompts: [], ...over })

test('the specialist\'s step reports are not steps of the record: they are left out and the numbering goes on without them', () => {
  const report = (n: number) => use(n, 'mcp__clawd-hq__step', { done: n, total: 2, note: 'Reading' }, 'Noted: 1 of 2 steps done.')
  const rows = [
    brief(),
    said('Step 1 of 2: reading.', [report(1), use(2, 'Read', { file_path: '/repo/src/login.ts' }, 'export function login() {}')]),
    said('Step 2 of 2: running the tests.', [report(3), use(4, 'Bash', { command: 'npm test' }, 'ok')]),
    said('Fixed the bug. All tests pass.'),
  ]
  const { text, steps } = record(rows)
  expect(steps).toBe(2)
  expect(text).not.toContain('mcp__clawd-hq__step')
  expect(text).not.toContain('Noted: 1 of 2')
  expect(text).toMatch(/STEP 1 · Read · \/repo\/src\/login\.ts/)
  expect(text).toMatch(/STEP 2 · Bash · npm test/)
  // What it said stays, including its step lines.
  expect(text).toContain('Step 1 of 2: reading.')
})

test('every step is kept in order with its tool, target and outcome, beside the brief, the specialist\'s words and the report', () => {
  const rows = [
    brief(),
    said('Step 1 of 2: reading the login code.', [use(1, 'Read', { file_path: '/repo/src/login.ts' }, 'export function login() {}')]),
    said('Step 2 of 2: running the tests.', [use(2, 'Bash', { command: 'npm test', description: 'Run tests' }, '3 failed', true)]),
    said('Fixed the bug. All tests pass.'),
  ]
  const { text, steps } = record(rows)
  expect(steps).toBe(2)
  expect(text).toMatch(/WHO DID THE WORK: Tester, a specialist Clawd hired/)
  expect(text).toMatch(/HOW IT ENDED: It finished and handed back its report\./)
  expect(text).toMatch(/BRIEF:\nFix the login bug/)
  // Our own note on how to report is not the person's brief: it goes, with a mark; what Clawd wrote stays.
  expect(text).not.toContain(BRIEF_NOTE.trim().slice(0, 40))
  expect(text).toMatch(/\[trimmed: Clawd HQ's standard note on how to report, not shown\]/)
  expect(text).toMatch(/Use Vitest for any new test\./)
  const one = text.indexOf('STEP 1 · Read · /repo/src/login.ts · done')
  const two = text.indexOf('STEP 2 · Bash · npm test · ERROR')
  expect(one).toBeGreaterThan(0)
  expect(two).toBeGreaterThan(one)
  expect(text).toMatch(/THE SPECIALIST SAID: Step 1 of 2: reading the login code\./)
  expect(text).toMatch(/description: Run tests/)
  expect(text).toMatch(/error:\n3 failed/)
  // The report is given once, at the end, not again as the specialist's last words.
  expect(text.match(/Fixed the bug\. All tests pass\./g)).toHaveLength(1)
  expect(text).toMatch(/REPORT HANDED BACK:\nFixed the bug\. All tests pass\.$/)
})

test('a file read shows its first 600 characters and its size; a short one shows whole', () => {
  const long = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n')
  const { text } = record([brief(), said('', [use(1, 'Read', { file_path: 'a.ts' }, long), use(2, 'Grep', { pattern: 'login' }, 'a.ts:3: login')])])
  expect(text).toContain(long.slice(0, 600))
  expect(text).not.toContain(long.slice(600, 700))
  expect(text).toContain(`[trimmed: ${(long.length - 600).toLocaleString('en-US')} characters of file text not shown; 400 lines in all]`)
  expect(text).toMatch(/STEP 2 · Grep · login · done\noutput:\na\.ts:3: login/)
})

test('command output keeps its first 1,500 and last 2,500 characters, with a mark between', () => {
  const out = `${'a'.repeat(1500)}${'M'.repeat(6000)}${'z'.repeat(2500)}`
  const { text } = record([brief(), said('', [use(1, 'Bash', { command: 'npm test' }, out)])])
  expect(text).toContain(`${'a'.repeat(1500)}\n[trimmed: 6,000 characters of command output not shown; 1 line in all]\n${'z'.repeat(2500)}`)
  expect(text).not.toContain('MMMM')
})

test('error text is kept whole up to 4,000 characters; a longer one keeps its head and tail', () => {
  const short = 'E'.repeat(4000)
  const long = `${'h'.repeat(2000)}${'q'.repeat(3000)}${'t'.repeat(2000)}`
  const { text } = record([brief(), said('', [use(1, 'Bash', { command: 'a' }, short, true), use(2, 'Bash', { command: 'b' }, long, true)])])
  expect(text).toContain(short)
  expect(text).toContain(`${'h'.repeat(2000)}\n[trimmed: 3,000 characters of error text not shown; 1 line in all]\n${'t'.repeat(2000)}`)
})

test('a tool input field over 2,000 characters keeps its first 1,000 and last 500', () => {
  const content = `${'b'.repeat(1000)}${'k'.repeat(1500)}${'e'.repeat(500)}`
  const { text } = record([brief(), said('', [use(1, 'Write', { file_path: 'big.ts', content }, 'File written')])])
  expect(text).toContain(`content: ${'b'.repeat(1000)}\n[trimmed: 1,500 characters of input text not shown; 1 line in all]\n${'e'.repeat(500)}`)
  expect(text).toMatch(/STEP 1 · Write · big\.ts · done/)
})

test('a step with no outcome yet says so; one with a target of no usual name uses its first text field', () => {
  const { text } = record([brief(), said('', [use(1, 'mcp__db__query', { sql: 'select 1' }), use(2, 'TodoWrite', { todos: [{ content: 'a' }] }, 'ok')])])
  expect(text).toMatch(/STEP 1 · mcp__db__query · select 1 · no outcome recorded/)
  expect(text).toMatch(/STEP 2 · TodoWrite · done/)
  expect(text).toMatch(/todos: \[\{"content":"a"\}\]/)
})

test('a fake 108-step record ends under 60K tokens and keeps every step line, with no ellipsis anywhere', () => {
  const file = Array.from({ length: 900 }, (_, i) => `const line${i} = ${i}`).join('\n')
  const log = Array.from({ length: 2000 }, (_, i) => `test ${i} passed`).join('\n')
  const rows: Row[] = [brief()]
  for (let i = 1; i <= 108; i += 1) {
    const tool = i % 3 === 1 ? 'Read' : 'Bash'
    const input = tool === 'Bash' ? { command: `npm test -- part${i}` } : { file_path: `src/f${i}.ts` }
    rows.push(said(`Step ${i}: working.`, [use(i, tool, input, tool === 'Bash' ? log : file, i === 50)]))
  }
  const { text, steps, chars, isOverCap } = record(rows)
  expect(steps).toBe(108)
  expect(chars).toBe(text.length)
  expect(chars).toBeLessThanOrEqual(CAP_CHARS)
  expect(isOverCap).toBe(false)
  for (let i = 1; i <= 108; i += 1) expect(text).toContain(`STEP ${i} · `)
  for (let i = 1; i <= 108; i += 1) expect(text).toContain(`THE SPECIALIST SAID: Step ${i}: working.`)
  expect(text).not.toContain('…')
  // The newest outputs keep more than the oldest: reads were cut to their step line first, oldest first.
  expect(text).toMatch(/to keep the record short/)
})

test('a resumed run reads from the message that started it, with the first brief from the hire beside it', () => {
  const rows = [{ role: 'user' as const, text: 'Now also fix the signup page.', toolUses: [] }, said('On it.', [use(1, 'Read', { file_path: 'signup.ts' }, 'x')])]
  const { text } = record(rows, { brief: BRIEF + BRIEF_NOTE, isResumed: true })
  expect(text).toMatch(/BRIEF:\nFix the login bug/)
  expect(text).toMatch(/MESSAGE THAT STARTED THIS RUN:\nNow also fix the signup page\./)
  // A first run opens with its brief: the copy kept at the hire is not needed beside it.
  const firstRun = record([brief('Fix the login bug, as sent.'), said('', [use(1, 'Read', { file_path: 'a' }, 'x')])], { brief: 'Fix the login bug.' }).text
  expect(firstRun).toMatch(/BRIEF:\nFix the login bug, as sent\./)
  expect(firstRun).not.toMatch(/MESSAGE THAT STARTED/)
  // Rows that do not open with a message use the kept brief.
  expect(record([said('', [use(1, 'Read', { file_path: 'a' }, 'x')])], { brief: 'Kept brief.' }).text).toMatch(/BRIEF:\nKept brief\./)
  const none = record([said('', [use(1, 'Read', { file_path: 'a' }, 'x')])]).text
  expect(none).toMatch(/BRIEF:\nNot available\./)
})

test('the person\'s latest prompts ride along, each up to 2,000 characters, a longer one marked', () => {
  const long = `${'p'.repeat(1500)}${'o'.repeat(1000)}${'s'.repeat(500)}`
  const { text } = record([brief()], { prompts: ['Fix login please', long] })
  expect(text).toMatch(/THE PERSON'S LATEST PROMPTS TO CLAWD:\n1\. Fix login please\n2\. p+/)
  expect(text).toContain(`[trimmed: 1,000 characters of the prompt not shown; 1 line in all]\n${'s'.repeat(500)}`)
  expect(record([brief()]).text).not.toMatch(/LATEST PROMPTS/)
})

test('how the run ended, its time and tokens are said in plain words', () => {
  expect(record([brief()], { ended: 'error' }).text).toMatch(/HOW IT ENDED: It stopped on an error before it finished\./)
  expect(record([brief()], { ended: 'aborted' }).text).toMatch(/HOW IT ENDED: It was stopped before it finished\./)
  expect(record([brief()], { ended: 'refusal' }).text).toMatch(/HOW IT ENDED: The model refused to go on\./)
  expect(record([brief()], { durationMs: 252_000, tokens: { input: 512_000, output: 12_300 } }).text)
    .toMatch(/TIME AND TOKENS: 4m; 512,000 input tokens, 12,300 output tokens/)
})

test('Clawd\'s own long turn reads as his, with the person\'s request as the brief', () => {
  const rows = [{ role: 'user' as const, text: 'Tidy the README', toolUses: [] }, said('Done.', [use(1, 'Edit', { file_path: 'README.md', old_string: 'a', new_string: 'b' }, 'ok')])]
  const { text } = buildRecord({ who: 'Clawd', isClawd: true, ended: 'answer', rows, report: 'Done.', prompts: [] })
  expect(text).toMatch(/WHO DID THE WORK: Clawd, the chief of staff, in the main chat/)
  expect(text).toMatch(/HOW IT ENDED: He finished and answered\./)
  expect(text).toMatch(/THE PERSON'S REQUEST:\nTidy the README/)
  expect(text).toMatch(/STEP 1 · Edit · README\.md · done\nold_string: a\nnew_string: b/)
  expect(text).toMatch(/FINAL ANSWER:\nDone\.$/)
})

test('a message to the specialist mid-run is kept, and the rows handed in are never changed', () => {
  const rows = Object.freeze([
    Object.freeze(brief()),
    Object.freeze(said('', [use(1, 'Read', { file_path: 'a' }, 'x')])),
    Object.freeze({ role: 'user' as const, text: 'Stop and report.', toolUses: [] }),
    Object.freeze({ role: 'user' as const, text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'x', isError: false }] }),
  ]) as unknown as Row[]
  const { text } = record(rows)
  expect(text).toMatch(/MESSAGE TO THE SPECIALIST: Stop and report\./)
})

test('a turn of the main chat starts at the person\'s message that opened it, else after the last message they typed', () => {
  const rows: Row[] = [
    { role: 'user', text: 'Old ask', toolUses: [] }, said('Old answer.'),
    { role: 'user', text: 'Tidy the docs\n\n(pasted notes)', toolUses: [] }, said('', [use(1, 'Edit', { file_path: 'a.md' }, 'ok')]),
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'u1', text: 'ok', isError: false }] }, said('Done.'),
  ]
  const found = turnRows(rows, 'Tidy the docs')
  expect(found.rows.map(r => r.text)).toEqual(['Tidy the docs\n\n(pasted notes)', '', '', 'Done.'])
  expect(found.leftOut).toBe('earlier-turns')
  const guessed = turnRows(rows, 'something else')
  expect(guessed.rows.map(r => r.text)).toEqual(['Tidy the docs\n\n(pasted notes)', '', '', 'Done.'])
  expect(guessed.leftOut).toBe('earlier-turns-guess')
  expect(turnRows(rows.slice(3), 'x')).toEqual({ rows: rows.slice(3), leftOut: undefined })
  expect(turnRows(rows.slice(2), 'Tidy the docs').leftOut).toBeUndefined()
})

test('rows left out before the run are marked in words, by why', () => {
  const steps = [said('', [use(1, 'Read', { file_path: 'a' }, 'x')])]
  expect(record(steps, { leftOut: 'earlier-runs' }).text).toMatch(/STEPS AND WORDS, IN ORDER:\n\n\[trimmed: the steps of earlier runs, already checked, not shown\]\n\nSTEP 1/)
  expect(record(steps, { leftOut: 'earlier-turns' }).text).toMatch(/\[trimmed: earlier turns of the main chat, not shown\]/)
  expect(record(steps, { leftOut: 'earlier-turns-guess' }).text).toMatch(/\[trimmed: earlier turns of the main chat, not shown; where this turn began is a best guess\]/)
  expect(record(steps).text).not.toMatch(/earlier/)
})

test('the cap never swaps a short output for a longer mark', () => {
  const log = Array.from({ length: 2000 }, (_, i) => `test ${i} passed`).join('\n')
  const rows: Row[] = [brief()]
  for (let i = 1; i <= 120; i += 1) {
    const isRead = i % 2 === 1
    rows.push(said('', [use(i, isRead ? 'Read' : 'Bash', isRead ? { file_path: `f${i}` } : { command: `c${i}` }, isRead ? `tiny ${i}` : log)]))
  }
  const { text, chars } = record(rows)
  expect(chars).toBeLessThanOrEqual(CAP_CHARS)
  for (let i = 1; i <= 120; i += 2) expect(text).toContain(`STEP ${i} · Read · f${i} · done\noutput:\ntiny ${i}`)
  expect(text).not.toMatch(/characters of file text not shown/)
})
