import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, START, host } from './host'
import { ROOT, planFs } from './plan-disk'

// A follow-up Clawd sends a specialist he already hired (the SendMessage tool, which resumes it) that starts with `PLAN: <step id>`:
// the line comes off the message, and the resumed run is linked to that step, shown under it and ticking it on a hand-back that ended well.

const TOOL = 'mcp__clawd-hq__plan'
const PLAN = `${ROOT}/.clawd-hq/plans/export-scores.md`
// The host of these tests does not say its session, so it is "unknown", and so is the owner this plan file names.
const THREE = '# Export scores\n\n- [ ] Find how it works  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n- [ ] Review  <!-- s3 -->\n<!-- session: unknown -->\n'

type Answer = { result?: string; deny?: string }
const plan = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never) as Promise<Answer>
const hire = ($: Engine, prompt: string, extra: Record<string, unknown> = {}) => $.agent.spawn({ prompt, description: 'Build the export', subagentType: 'general-purpose', name: 'builder', ...extra } as never)
const end = ($: Engine, id: string, answer = 'Done.', reason = 'answer') => $.turn.complete({ reason, answer, turnId: `t-${id}-${reason}-${answer.length}`, agentId: id, isAborted: false } as never)
/** A message as the model's own SendMessage call sends it; `origin` names another sender, such as a plugin. */
const send = ($: Engine, to: string, text: string, agentId?: string, origin: Record<string, unknown> = { kind: 'model' }) => $.session.send({ to, text, origin, ...(agentId ? { agentId } : {}) } as never) as Promise<{ isDelivered: boolean; reason?: string }>
/** The follow-up resuming its specialist, as the engine raises it after the send: the message it delivered is the resumed run's prompt. */
const resume = ($: Engine, id: string, text: string) => hire($, text, { resume: { agentId: id } })
const debug = (h: ReturnType<typeof host>) => JSON.stringify(h.saved.get('debug:plan') ?? [])

/** A project with the plan file, spawns that get the ids p1, p2, ... (a resume keeps its own), and the messages the engine was handed to send. */
function office(on: Parameters<typeof host>[0], files: Record<string, string> = { [PLAN]: THREE }) {
  const h = host(on, [])
  for (const [path, text] of Object.entries(files)) h.files.set(path, text)
  planFs(on, h.files)
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: 'claude-opus-5-5', agentId: (e as { resume?: { agentId: string } }).resume?.agentId ?? `p${(n += 1)}` }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const sent: Array<{ to: string; text: string }> = []
  const delivery = { isRefused: false }
  on('session.send', (_$, e) => {
    const { to, text } = e as { to: string; text: string }
    sent.push({ to, text })
    return (delivery.isRefused ? { isDelivered: false, reason: 'nobody by that name' } : { isDelivered: true }) as never
  })
  return { ...h, sent, delivery }
}
const fileText = (h: ReturnType<typeof office>) => h.files.get(PLAN)

async function officeTab($: Engine) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const text = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')
  await ui.unmount()
  return text
}

test('a follow-up that starts with PLAN: s2 loses the line, shows its specialist under s2, and ticks s2 when it hands back well', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s1\nFind how it works.')
  await end($, 'p1')
  expect(fileText(h)).toContain('- [x] Find how it works  <!-- s1 -->')
  const r = await send($, 'builder', 'PLAN: s2\nNow build it.')
  expect(r.isDelivered).toBe(true)
  expect(h.sent.at(-1)).toEqual({ to: 'builder', text: 'Now build it.' })
  await resume($, 'p1', 'Now build it.')
  // At work under s2, not on the "Also at work" list.
  expect((await plan($, { op: 'later', text: 'Tidy up' })).result).toMatch(/s2 now +Build it/)
  const tab = await officeTab($)
  expect(tab).not.toContain('ALSO AT WORK')
  expect(tab).toContain('1 at work')
  await end($, 'p1', 'Built it.')
  expect(fileText(h)).toContain('- [x] Build it  <!-- s2 -->')
  // The old step keeps what it had, and the next is untouched.
  expect(fileText(h)).toContain('- [x] Find how it works  <!-- s1 -->')
  expect(fileText(h)).toContain('- [ ] Review  <!-- s3 -->')
})

test('a follow-up addressed by the agent id links too, and an effort line before the PLAN line stays on the message', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1')
  await send($, 'p1', '[effort: high]\nPLAN: s3\nReview it.')
  expect(h.sent.at(-1)?.text).toBe('[effort: high]\nReview it.')
  await resume($, 'p1', '[effort: high]\nReview it.')
  await end($, 'p1')
  expect(fileText(h)).toContain('- [x] Review  <!-- s3 -->')
  expect(fileText(h)).toContain('- [ ] Build it  <!-- s2 -->')
})

test('a step with a resumed specialist on it cannot be dropped', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1')
  await send($, 'builder', 'PLAN: s2\nBuild it.')
  await resume($, 'p1', 'Build it.')
  const a = await plan($, { op: 'drop', id: 's2' })
  expect(a.result).toBeUndefined()
  expect(a.deny).toBeDefined()
  expect(fileText(h)).toContain('Build it  <!-- s2 -->')
})

test('an unknown step id is ignored with no error: the line comes off, the old link stays, and nothing new is ticked', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s1\nFind it.')
  await end($, 'p1', 'Found it, but not all.', 'error')
  const r = await send($, 'builder', 'PLAN: s9\nTry again.')
  expect(r.isDelivered).toBe(true)
  expect(h.sent.at(-1)?.text).toBe('Try again.')
  expect(debug(h)).toContain('s9')
  await resume($, 'p1', 'Try again.')
  await end($, 'p1')
  // Still on s1 from its first brief, which its hand-back ticks as before; s2 and s3 are untouched.
  expect(fileText(h)).toContain('- [x] Find how it works  <!-- s1 -->')
  expect(fileText(h)).toContain('- [ ] Build it  <!-- s2 -->')
})

test('a follow-up after the goal finished links nothing, and a link never leaks into the next goal', async ($, on) => {
  const h = office(on, {})
  await $.session.start(START)
  await plan($, { op: 'start', goal: 'Export scores', steps: ['Find how it works', 'Build it'] })
  await hire($, 'Look around first.')
  await end($, 'p1')
  await send($, 'builder', 'PLAN: s2\nBuild it.')
  await plan($, { op: 'finish', outcome: 'stopped' })
  await h.clock.advance(60_000)
  await send($, 'builder', 'PLAN: s1\nOne more look.') // no goal in hand: ignored
  expect(h.sent.at(-1)?.text).toBe('One more look.')
  await plan($, { op: 'start', goal: 'Export again', steps: ['Find how it works', 'Build it'] })
  await resume($, 'p1', 'Build it.')
  await end($, 'p1')
  const file = [...h.files.entries()].find(([path, text]) => path.includes('.clawd-hq/plans/') && text.includes('# Export again'))?.[1]
  expect(file).toBeDefined()
  expect(file).not.toContain('[x]')
})

test('a follow-up the engine did not deliver links nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1')
  h.delivery.isRefused = true
  const r = await send($, 'builder', 'PLAN: s2\nBuild it.')
  expect(r.isDelivered).toBe(false)
  await hire($, 'Something else.') // p2, not linked
  await resume($, 'p1', 'Build it.') // a later resume of p1 carries no link from the refused send
  expect((await plan($, { op: 'later', text: 'Tidy up' })).result).toMatch(/s2 next +Build it/)
})

test('a message to anyone not on the books, or a specialist\'s own message, is left byte for byte', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s1\nFind it.')
  await send($, 'another-session', 'PLAN: s2\nHello.')
  expect(h.sent.at(-1)?.text).toBe('PLAN: s2\nHello.')
  await send($, 'main', 'PLAN: s2\nA note for Clawd.', 'p1')
  expect(h.sent.at(-1)?.text).toBe('PLAN: s2\nA note for Clawd.')
  await end($, 'p1')
  expect(fileText(h)).toContain('- [ ] Build it  <!-- s2 -->')
})

test('a follow-up whose first line is "Plan: ..." in words is left byte for byte and links nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s1\nFind it.')
  await end($, 'p1')
  await send($, 'builder', 'Plan: update the docs\nThen stop.')
  expect(h.sent.at(-1)?.text).toBe('Plan: update the docs\nThen stop.')
})

test('with "Clawd runs the chat" off the line still comes off, as a brief\'s does, and nothing is linked or ticked', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1')
  await send($, 'builder', 'PLAN: s2\nBuild it.')
  expect(h.sent.at(-1)?.text).toBe('Build it.')
  await resume($, 'p1', 'Build it.')
  await end($, 'p1')
  expect(fileText(h)).toBe(THREE)
})

test('a specialist moved to a new step by a follow-up brings none of its earlier choices: only the new run\'s go under the new step', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s1\nFind it.')
  await end($, 'p1', 'Found it.\nDECIDED: Read the old export first — it shows the format')
  await send($, 'builder', 'PLAN: s2\nNow build it.')
  await resume($, 'p1', 'Now build it.')
  await end($, 'p1', 'Built it.\nDECIDED: Stream big files — memory')
  const text = fileText(h)!
  // The old step keeps its own choice; the new one has only the new run's.
  expect(text).toContain('- [x] Find how it works  <!-- s1 -->\n  - Decided: Read the old export first — it shows the format\n')
  expect(text).toContain('- [x] Build it  <!-- s2 -->\n  - Decided: Stream big files — memory\n')
  expect(text.match(/Decided:/g)).toHaveLength(2)
})

test('an off-plan run\'s choices stay off the step a follow-up then links its specialist to', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1', 'Looked.\nDECIDED: Skip the legacy folder — unused')
  await send($, 'builder', 'PLAN: s2\nBuild it.')
  await resume($, 'p1', 'Build it.')
  await end($, 'p1', 'Built it.\nDECIDED: Stream big files — memory')
  const text = fileText(h)!
  expect(text).toContain('- [x] Build it  <!-- s2 -->\n  - Decided: Stream big files — memory\n')
  expect(text).not.toContain('legacy folder')
})

test('a follow-up that is only the PLAN line goes out as written, never empty, and still links on delivery', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1')
  await send($, 'builder', 'PLAN: s2')
  expect(h.sent.at(-1)?.text).toBe('PLAN: s2')
  await send($, 'builder', '[effort: high]\nPLAN: s2\n')
  expect(h.sent.at(-1)?.text).toBe('[effort: high]\nPLAN: s2\n')
  await resume($, 'p1', 'PLAN: s2')
  await end($, 'p1')
  expect(fileText(h)).toContain('- [x] Build it  <!-- s2 -->')
})

test('a plugin\'s message with a PLAN line passes untouched and links nothing: only the model\'s own SendMessage counts', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around first.')
  await end($, 'p1')
  await send($, 'builder', 'PLAN: s2\nBuild it.', undefined, { kind: 'plugin', name: 'another-mod' })
  expect(h.sent.at(-1)?.text).toBe('PLAN: s2\nBuild it.')
  await resume($, 'p1', 'PLAN: s2\nBuild it.')
  await end($, 'p1')
  expect(fileText(h)).toBe(THREE)
})
