// The host's own task list, while Clawd runs the chat: its reminders are dropped and its write tools point at the plan.
// Soft only: no call is ever refused. Clawd off, or a teammate's or bare session, keeps the host's own behaviour.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { TASK_LIST_NOTE, TASK_REMINDERS, TASK_WRITE_TOOLS } from '../hooks/task-tools'
import { host } from './host'

type On = Parameters<typeof host>[0]
type Described = { description: string; isDeferred?: boolean }

const BUILT_IN = 'Use this tool to create and manage a structured task list for your current coding session.'
const REMINDER = 'The task tools haven\'t been used recently. Consider using them to track progress.'

/** The engine's own answers beneath the plugin: the tool's text as given, the reminder as given, the system prompt's opening. */
function office(on: On) {
  host(on)
  on('tool.describe', (_$, e) => ({ description: (e as { description: string }).description }) as never)
  on('prompt.attachment', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }) as never)
}
const describe = ($: Engine, tool: string) => $.tool.describe({ tool, description: BUILT_IN } as never) as Promise<Described>
const remind = async ($: Engine, type: string, agentId?: string) =>
  ((await $.prompt.attachment({ type, text: REMINDER, origin: { kind: 'engine' }, ...(agentId === undefined ? {} : { agentId }) } as never)) as { text: string | null }).text
const compose = ($: Engine, traits: string[]) =>
  $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits } as never)

const isUntouched = (d: Described) => d.description === BUILT_IN && d.isDeferred === undefined

test('the reminders it drops are both kinds: the todo list\'s and the newer task tools\'', () => {
  expect([...TASK_REMINDERS]).toEqual(['todo_reminder', 'task_reminder'])
  expect([...TASK_WRITE_TOOLS]).toEqual(['TodoWrite', 'TaskCreate', 'TaskUpdate'])
  expect(TASK_LIST_NOTE).toContain('While Clawd HQ runs the chat, keep the plan with the plan tool; the Office tab cannot see this list.')
})

test('Clawd on, main chat: the three write tools carry the note and wait behind tool search', async ($, on) => {
  office(on)
  for (const tool of TASK_WRITE_TOOLS) {
    const d = await describe($, tool)
    expect(d.description.startsWith(BUILT_IN)).toBe(true)
    expect(d.description.endsWith(TASK_LIST_NOTE)).toBe(true)
    expect(d.isDeferred).toBe(true)
  }
})

test('Clawd on: the task list\'s read tools and any other tool keep their own text and place', async ($, on) => {
  office(on)
  for (const tool of ['TaskList', 'TaskGet', 'Bash', 'Read']) expect(isUntouched(await describe($, tool))).toBe(true)
})

test('Clawd on, main chat: both task-list reminders are dropped, and every other kind is kept', async ($, on) => {
  office(on)
  expect(await remind($, 'todo_reminder')).toBeNull()
  expect(await remind($, 'task_reminder')).toBeNull()
  expect(await remind($, 'file')).toBe(REMINDER)
})

test('Clawd on: a specialist\'s or teammate\'s reminder reaches it as the host made it', async ($, on) => {
  office(on)
  for (const type of TASK_REMINDERS) expect(await remind($, type, 'a1')).toBe(REMINDER)
})

test('Clawd off: the host\'s tools and reminders are left exactly as they are', { options: { chiefOfStaff: false } }, async ($, on) => {
  office(on)
  for (const tool of TASK_WRITE_TOOLS) expect(isUntouched(await describe($, tool))).toBe(true)
  for (const type of TASK_REMINDERS) expect(await remind($, type)).toBe(REMINDER)
})

test('a teammate\'s own session is no chief of staff: nothing changes there', async ($, on) => {
  office(on)
  await compose($, ['teammate'])
  for (const tool of TASK_WRITE_TOOLS) expect(isUntouched(await describe($, tool))).toBe(true)
  for (const type of TASK_REMINDERS) expect(await remind($, type)).toBe(REMINDER)
})

test('a bare session is no chief of staff either', async ($, on) => {
  office(on)
  await compose($, ['bare'])
  expect(isUntouched(await describe($, 'TodoWrite'))).toBe(true)
  expect(await remind($, 'todo_reminder')).toBe(REMINDER)
})

test('the main chat decides: a teammate\'s prompt rendered later in the same session does not turn it off', async ($, on) => {
  office(on)
  await compose($, [])
  await compose($, ['teammate'])
  expect((await describe($, 'TaskCreate')).isDeferred).toBe(true)
  expect(await remind($, 'task_reminder')).toBeNull()
})
