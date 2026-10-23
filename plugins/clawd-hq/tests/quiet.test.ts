import { expect, test } from 'claude-code/testing'
import { NO_UPDATE, isBackgroundHint, isHandback, isNoUpdate, rowLook } from '../hooks/quiet'
import type { Employee } from '../types'

const emp = (over: Partial<Employee>): Employee => ({ id: 'a1', type: 'ecc:code-reviewer', description: 'Review', mood: 'done', tools: 0, startedAt: 0, joinedTick: 0, ...over })
const staff = [emp({}), emp({ id: 't1', type: 'general-purpose', name: 'judge' })]
const row = (over: Record<string, unknown>) => ({ isExpanded: false, originKind: 'task-notification', text: 'Message 5 of 6 received.', ...over })

test('a reply that is only the no-update mark is filler; anything more is not', () => {
  expect(NO_UPDATE).toBe('[no update]')
  expect(isNoUpdate('[no update]')).toBe(true)
  expect(isNoUpdate('  [No update].\n')).toBe(true)
  expect(isNoUpdate('[no update] but the tests failed')).toBe(false)
  expect(isNoUpdate('No update yet.')).toBe(false)
  expect(isNoUpdate('')).toBe(false)
})

test('a finished notice for one of the office\'s own specialists is a hand-back the chat can hide', () => {
  expect(isHandback(row({ task: { id: 'a1', status: 'completed' } }), staff)).toBe(true)
  // A failure, a stop, or a notice that does not say how it ended is always shown.
  expect(isHandback(row({ task: { id: 'a1', status: 'failed' } }), staff)).toBe(false)
  expect(isHandback(row({ task: { id: 'a1', status: 'killed' } }), staff)).toBe(false)
  expect(isHandback(row({ task: { id: 'a1' } }), staff)).toBe(false)
})

test('a background job the office did not hire is hidden when it finished well, and only then', () => {
  expect(isHandback(row({ text: 'Background command finished (2m 2s)', task: { id: 'shell-7', status: 'completed' } }), staff)).toBe(true)
  for (const status of ['failed', 'killed', 'stopped', 'timed_out', undefined]) {
    expect(isHandback(row({ task: { id: 'shell-7', status } }), staff)).toBe(false)
  }
  // The full view, a notice that asks for something, and a kind of task with content of its own (an artifact watch) stay.
  expect(isHandback(row({ isExpanded: true, task: { id: 'shell-7', status: 'completed' } }), staff)).toBe(false)
  expect(isHandback(row({ text: 'Needs your approval to continue', task: { id: 'shell-7', status: 'completed' } }), staff)).toBe(false)
  expect(isHandback(row({ text: 'Ready to go on?', task: { id: 'shell-7', status: 'completed' } }), staff)).toBe(false)
  expect(isHandback(row({ task: { id: 'w-1', status: 'completed', type: 'artifact_watch' } }), staff)).toBe(false)
  // Only a task notification is a finished notice: a scheduled wake or a channel message that names a task is not.
  for (const originKind of ['scheduled-trigger', 'channel', 'peer', 'composer']) {
    expect(isHandback(row({ originKind, task: { id: 'shell-7', status: 'completed' } }), staff)).toBe(false)
  }
})

const call = (over: Record<string, unknown>) => ({ tool: 'Bash', input: {}, isErrored: false, isInterrupted: false, ...over })

test('the plugin\'s step calls and tool-loading rows are hidden; the same rows that errored or were cut short are not', () => {
  expect(rowLook(call({ tool: 'mcp__clawd-hq__step' }), staff)).toBe('hide')
  expect(rowLook(call({ tool: 'ToolSearch' }), staff)).toBe('hide')
  for (const tool of ['mcp__clawd-hq__step', 'ToolSearch']) {
    expect(rowLook(call({ tool, isErrored: true }), staff)).toBe('show')
    expect(rowLook(call({ tool, isInterrupted: true }), staff)).toBe('show')
  }
  // Another plugin's step tool is not ours.
  expect(rowLook(call({ tool: 'mcp__other__step' }), staff)).toBe('show')
})

test('the offer of a lasting rule is dimmed like the other bookkeeping calls, and shown when it errored', () => {
  expect(rowLook(call({ tool: 'mcp__clawd-hq__offer_rule', input: { rule: 'Never use tabs' } }), staff)).toBe('dim')
  expect(rowLook(call({ tool: 'mcp__clawd-hq__offer_rule', isErrored: true }), staff)).toBe('show')
  expect(rowLook(call({ tool: 'mcp__other__offer_rule' }), staff)).toBe('show')
})

test('the helper search and a contractor hire are dimmed like the other bookkeeping calls, and shown when they errored', () => {
  for (const tool of ['mcp__clawd-hq__find_helpers', 'mcp__clawd-hq__hire_contractor']) {
    expect(rowLook(call({ tool, input: { job: 'design the settings page' } }), staff)).toBe('dim')
    expect(rowLook(call({ tool, isErrored: true }), staff)).toBe('show')
  }
})

test('a message to a hired teammate and the task list are dimmed, never hidden; the old remember tool is no longer special', () => {
  expect(rowLook(call({ tool: 'mcp__clawd-hq__remember', input: { decision: 'Scores live in Postgres' } }), staff)).toBe('show')
  for (const tool of ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']) expect(rowLook(call({ tool }), staff)).toBe('dim')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'judge', message: 'Score round 2.' } }), staff)).toBe('dim')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'Judge', message: 'Score round 2.' } }), staff)).toBe('dim')
})

test('Clawd\'s own message to a hired teammate is dimmed however it is addressed or worded; one to anyone else is not', () => {
  // Addressed with the @ the row shows, and wording that mentions approval or asks something: still Clawd talking to his own team.
  expect(rowLook(call({ tool: 'SendMessage', input: { to: '@judge', message: 'Decisions on review findings' } }), staff)).toBe('dim')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'judge', message: 'Approved. Which side goes first?' } }), staff)).toBe('dim')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'judge', message: 'Please approve the plan.' } }), staff)).toBe('dim')
  // The result row carries no input: it is Clawd's own call's answer, dimmed with it.
  expect(rowLook({ tool: 'SendMessage', isErrored: false }, staff)).toBe('dim')
  expect(rowLook({ tool: 'SendMessage', isErrored: true }, staff)).toBe('show')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'someone-else', message: 'hi' } }), staff)).toBe('show')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: '@someone-else', message: 'hi' } }), staff)).toBe('show')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'a1', message: 'hi' } }), staff)).toBe('show')
  expect(rowLook(call({ tool: 'SendMessage', input: { to: 'judge' } }), staff)).toBe('dim')
  for (const input of [undefined, null, 'x', 7, [], { to: 5 }]) expect(rowLook(call({ tool: 'SendMessage', input }), staff)).toBe('show')
})

test('a dimmed row that errored or was cut short is drawn in full, and questions and ordinary tools are left alone', () => {
  for (const tool of ['mcp__clawd-hq__offer_rule', 'TodoWrite', 'SendMessage']) {
    const input = { to: 'judge', message: 'ok' }
    expect(rowLook(call({ tool, input, isErrored: true }), staff)).toBe('show')
    expect(rowLook(call({ tool, input, isInterrupted: true }), staff)).toBe('show')
  }
  for (const tool of ['AskUserQuestion', 'Agent', 'Bash', 'Read', 'mcp__clawd-hq__demo', 'ExitPlanMode', 'ScheduleWakeup', 'CronCreate', 'mcp__clawd-hq__artifact']) {
    expect(rowLook(call({ tool }), staff)).toBe('show')
  }
  // A result row carries no interrupted flag.
  expect(rowLook({ tool: 'mcp__clawd-hq__step', isErrored: false }, staff)).toBe('hide')
})

test('only the run-in-background hint is a progress row to hide', () => {
  expect(isBackgroundHint('background_hint')).toBe(true)
  expect(isBackgroundHint('something_else')).toBe(false)
})

test('a message from a teammate the office hired by name is a hand-back; one from anyone else is not', () => {
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' } }), staff)).toBe(true)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'Judge' } }), staff)).toBe(true)
  // Only a given name counts: an agent type is too easy for another sender to share.
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'ecc:code-reviewer' } }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'general-purpose' } }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'Another project' } }), staff)).toBe(false)
})

test('the merged "N background agents completed" line is hidden, whoever the tasks in it were', () => {
  // The merged row names no task of its own, so it cannot be checked against the specialists the office hired.
  expect(isHandback(row({ text: '2 background agents completed' }), staff)).toBe(true)
  expect(isHandback(row({ text: '12 background agents completed' }), [])).toBe(true)
  expect(isHandback(row({ text: '3 Background Agents Completed', task: { status: 'completed' } }), staff)).toBe(true)
})

test('the merged line is shown whenever it is not plainly a success, the full view, or the notification the engine stamped', () => {
  // A failure or a stop; a status that is not "completed"; a line that does not say "completed".
  expect(isHandback(row({ text: '2 background agents failed' }), staff)).toBe(false)
  expect(isHandback(row({ text: '2 background agents completed', task: { status: 'failed' } }), staff)).toBe(false)
  expect(isHandback(row({ text: '2 background agents completed', task: { status: 'killed' } }), staff)).toBe(false)
  expect(isHandback(row({ text: '2 background agents completed, 1 failed' }), staff)).toBe(false)
  expect(isHandback(row({ text: '2 background agents' }), staff)).toBe(false)
  // The full view, and words the person typed or another party sent.
  expect(isHandback(row({ text: '2 background agents completed', isExpanded: true }), staff)).toBe(false)
  for (const originKind of ['composer', 'peer', 'channel', 'unclassified', 'scheduled-trigger']) {
    expect(isHandback(row({ text: '2 background agents completed', originKind }), staff)).toBe(false)
  }
})

test('"N background commands completed" and the "N background task completed, M running" summary are hidden when plainly a success', () => {
  for (const text of ['2 background commands completed', '3 background commands completed', '1 background command completed', '1 background task completed, 1 running', '2 background tasks completed, 3 running', '2 background tasks completed']) {
    expect(isHandback(row({ text }), staff)).toBe(true)
    expect(isHandback(row({ text }), [])).toBe(true)
    expect(isHandback(row({ text, task: { status: 'completed' } }), staff)).toBe(true)
  }
})

test('those merged lines are shown when a failure is in them, or in the full view, or when the person or another party wrote them', () => {
  for (const text of ['2 background commands failed', '2 background commands completed, 1 failed', '1 background task completed, 1 failed', '1 background task completed, 1 running, 1 failed', '2 background commands', '1 background task running']) {
    expect(isHandback(row({ text }), staff)).toBe(false)
  }
  expect(isHandback(row({ text: '2 background commands completed', task: { status: 'failed' } }), staff)).toBe(false)
  expect(isHandback(row({ text: '1 background task completed, 1 running', task: { status: 'killed' } }), staff)).toBe(false)
  expect(isHandback(row({ text: '2 background commands completed', isExpanded: true }), staff)).toBe(false)
  for (const originKind of ['composer', 'peer', 'channel', 'unclassified', 'scheduled-trigger', 'bridge']) {
    expect(isHandback(row({ text: '2 background commands completed', originKind }), staff)).toBe(false)
    expect(isHandback(row({ text: '1 background task completed, 1 running', originKind }), staff)).toBe(false)
  }
})

test('a specialist\'s message to Clawd (a peer SendMessage) is hidden when it asks for nothing and reports no trouble', () => {
  const peer = (over: Record<string, unknown> = {}) => row({ originKind: 'peer-send-message', text: 'Decisions on review findings: kept 3, dropped 1.', from: { name: 'judge' }, ...over })
  expect(isHandback(peer(), staff)).toBe(true)
  // The row can come without a sender ("Message from subagent"), under the generic name, or under an unnamed specialist's agent type.
  expect(isHandback(peer({ from: undefined }), staff)).toBe(true)
  expect(isHandback(peer({ from: { name: 'subagent' } }), staff)).toBe(true)
  expect(isHandback(peer({ from: { name: 'ecc:code-reviewer' } }), staff)).toBe(true)
  expect(isHandback(peer({ from: { name: 'Judge' } }), staff)).toBe(true)
  // A named sender the office did not hire is not its own, and no staff means a named sender cannot be placed.
  expect(isHandback(peer({ from: { name: 'Judge' } }), [])).toBe(false)
  expect(isHandback(peer({ from: undefined }), [])).toBe(true)
})

test('a peer message that asks, fails or needs a permission is shown, and so is one from a session that is not the office\'s', () => {
  const texts = ['Which side goes first?', 'I need permission to run the build.', 'Please approve the plan.', 'Shutdown requested.', 'The build failed with 3 errors.', 'Tests are failing.', 'I am blocked on the schema.', 'I cannot reach the database.', 'Unable to write the file.', 'Error: ENOENT on config.json']
  for (const text of texts) expect(isHandback(row({ originKind: 'peer-send-message', from: { name: 'judge' }, text }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'peer-send-message', from: { name: 'Another session' }, text: 'All done.' }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'peer-send-message', from: { name: 'judge' }, text: 'All done.', isExpanded: true }), staff)).toBe(false)
})

test('a message with a stamp of where it came from is never hidden, even under a teammate\'s name', () => {
  for (const originKind of ['peer', 'channel', 'composer', 'bridge', 'sdk', 'scheduled-trigger', 'task-notification']) {
    expect(isHandback(row({ originKind, from: { name: 'judge' } }), staff)).toBe(false)
  }
})

test('a teammate\'s message that asks for something is never hidden', () => {
  const asks = ['Should I also score tone?', 'I need permission to run the build.', 'Plan ready: please approve it.', 'Requesting plan approval.', 'Shutdown requested: shall I stop?', 'shut down request']
  for (const text of asks) expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' }, text }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' }, text: 'Turn 3 of 3 sent. I am done.' }), staff)).toBe(true)
})

test('the person\'s own messages and the full view are never hidden', () => {
  expect(isHandback(row({ originKind: 'composer' }), staff)).toBe(false)
  expect(isHandback(row({ isExpanded: true, task: { id: 'a1', status: 'completed' } }), staff)).toBe(false)
  expect(isHandback(row({ isExpanded: true, originKind: 'unclassified', from: { name: 'judge' } }), staff)).toBe(false)
  expect(isHandback(row({ originKind: 'unclassified', from: { name: 'judge' } }), [])).toBe(false)
})
