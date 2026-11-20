// While the office is closed Clawd is out, but the work he started is not lost: a specialist that hands back still ticks its step, the plan
// is loaded, and a draft is kept. The tool texts the host caches follow the office (asked for again at every open and close).
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { DENY_CLOSED, DENY_OFF } from '../hooks/plan-run'
import { HANDOVER_NOTE, STAFFING_NOTE } from '../hooks/desk'
import { CLOSED, START, host as baseHost } from './host'
import { ROOT, planFs } from './plan-disk'

type On = Parameters<typeof baseHost>[0]

const TOOL = 'mcp__clawd-hq__plan'
const PLAN = `${ROOT}/.clawd-hq/plans/export-scores.md`
const OWNER = '<!-- session: unknown -->\n'
const THREE = `# Export scores\n\n- [ ] Find how it works  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n- [ ] Review  <!-- s3 -->\n${OWNER}`
const BUILT_IN = 'Launch a new agent to handle complex, multi-step tasks.'

type Answer = { result?: string; deny?: string }
const plan = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never) as Promise<Answer>
const hire = ($: Engine, prompt: string) => $.agent.spawn({ prompt, description: 'Build the export', subagentType: 'general-purpose', name: 'builder' } as never)
const end = ($: Engine, id: string) => $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: `t-${id}`, agentId: id, isAborted: false } as never)
const office = ($: Engine) => $.command.run({ command: 'office', args: '' } as never)
const agentText = async ($: Engine) => ((await $.tool.describe({ tool: 'Agent', description: BUILT_IN } as never)) as { description: string }).description

/** A project with the plan file in it, spawns that get the ids p1, p2, ... `isClosed`: the real default, a closed office. */
function setup(on: On, isClosed = false) {
  const h = baseHost(on, [], isClosed ? { ...CLOSED } : {})
  h.files.set(PLAN, THREE)
  planFs(on, h.files)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `p${(n += 1)}` }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('tool.describe', (_$, e) => ({ description: (e as { description: string }).description }) as never)
  return h
}

// ---- The plan's bookkeeping goes on while the office is closed ----

test('a specialist that hands back while the office is closed still ticks its step', async ($, on) => {
  const h = setup(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild the export button.') // hired while the office was open
  await office($) // the person closes it; the specialist is still at work
  await end($, 'p1')
  expect(h.files.get(PLAN)).toContain('- [x] Build it  <!-- s2 -->')
})

test('the plan on disk is loaded at a start with the office closed, so it is the goal in hand once /office brings Clawd back', async ($, on) => {
  setup(on, true)
  await $.session.start(START)
  await office($)
  expect((await plan($, { op: 'later', text: 'Tidy up' })).result).toContain('Plan: Export scores (0 of 3 done)')
})

test('the plan tool, with the switch on and the office closed, says the office is closed and /office brings Clawd back', async ($, on) => {
  setup(on, true)
  await $.session.start(START)
  const answer = await plan($, { op: 'later', text: 'Tidy up' })
  expect(answer.deny).toBe(DENY_CLOSED)
  expect(answer.deny).toMatch(/office is closed/)
  expect(answer.deny).toMatch(/\/office/)
})

test('the plan tool, with the switch off, still says "Clawd runs the chat" is off', { options: { chiefOfStaff: false } }, async ($, on) => {
  setup(on, true)
  await $.session.start(START)
  expect((await plan($, { op: 'later', text: 'Tidy up' })).deny).toBe(DENY_OFF)
})

test('with the switch off nothing is booked: a hand-back ticks nothing', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = setup(on)
  await $.session.start(START)
  await end($, 'p1')
  expect(h.files.get(PLAN)).toBe(THREE)
})

// ---- The host's cached texts follow the office ----

test('the Agent tool\'s staffing and handover notes come with the office and go with it', async ($, on) => {
  const h = setup(on, true)
  await $.session.start(START)
  expect(await agentText($)).toBe(BUILT_IN)
  h.invalidated.length = 0
  await office($)
  const open = await agentText($)
  expect(open).toContain(STAFFING_NOTE)
  expect(open.endsWith(HANDOVER_NOTE)).toBe(true)
  expect(h.invalidated).toEqual(expect.arrayContaining(['tool.describe', 'prompt.attachment', 'prompt.context', 'ui.render']))
  h.invalidated.length = 0
  await office($)
  expect(await agentText($)).toBe(BUILT_IN)
  expect(h.invalidated).toEqual(expect.arrayContaining(['tool.describe', 'prompt.attachment']))
})

test('a restored state asks the host for its cached texts again', { options: { openAtStart: false } }, async ($, on) => {
  const h = baseHost(on, [], { ...CLOSED, 'office:sessions': { s1: { open: true, seen: 1 } } })
  on('session.id', () => ({ value: 's1' }) as never)
  await $.session.start(START)
  expect(h.invalidated).toContain('tool.describe')
})

// ---- Closing the Office pane takes the others with it ----

test('/office closing the panes leaves them all closed, and the frame check does not open the office again', async ($, on) => {
  const h = setup(on, true)
  await $.session.start(START)
  await office($)
  await office($)
  expect(h.panes).toEqual([])
  for (let i = 0; i < 20; i++) await h.clock.advance(400)
  expect(await agentText($)).toBe(BUILT_IN) // still closed
  expect(h.panes).toEqual([])
})
