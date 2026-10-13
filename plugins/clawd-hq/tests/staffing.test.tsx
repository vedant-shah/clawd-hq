import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { HANDOVER_NOTE, STAFFING_NOTE } from '../hooks/desk'
import { host } from './host'

const BUILT_IN = 'Launch a new agent to handle complex, multi-step tasks. **Do not spawn agents unless the user asks.** Each spawn starts cold.'
const describe = ($: Engine, tool: string) =>
  $.tool.describe({ tool, description: BUILT_IN } as never) as Promise<{ description: string }>

test('the hiring tool tells Clawd that handing work over is the person\'s standing wish, whatever the tool\'s own text says', async ($, on) => {
  host(on)
  on('tool.describe', (_$, e) => ({ description: (e as { description: string }).description }) as never)
  for (const tool of ['Agent', 'Task']) {
    const { description } = await describe($, tool)
    expect(description.startsWith(BUILT_IN)).toBe(true)
    expect(description).toContain(STAFFING_NOTE)
    expect(description.endsWith(HANDOVER_NOTE)).toBe(true)
  }
  expect(HANDOVER_NOTE).toMatch(/standing instruction/)
  expect(HANDOVER_NOTE).toMatch(/without being asked each time/)
  expect(HANDOVER_NOTE).toMatch(/replaces any line above that says to start agents only when the user asks/)
  expect(HANDOVER_NOTE).toMatch(/in the background/)
})

test('with the chief of staff option off, the hiring tool keeps its own rule about when to hire', { options: { chiefOfStaff: false } }, async ($, on) => {
  host(on)
  on('tool.describe', (_$, e) => ({ description: (e as { description: string }).description }) as never)
  const { description } = await describe($, 'Agent')
  expect(description).toContain(STAFFING_NOTE)
  expect(description).not.toContain(HANDOVER_NOTE)
})
