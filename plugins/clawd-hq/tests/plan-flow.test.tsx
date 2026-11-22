import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { SETTINGS, START, host } from './host'
import { ROOT, planFs } from './plan-disk'

// The plan end to end: Clawd's `plan` tool, a hire that starts its brief with `PLAN: <step id>`, and the step being ticked in the project's
// plan file when that run ends well. The panel does not draw the plan yet (Phase 3), so these look at the files and the tool's answers.

const TOOL = 'mcp__clawd-hq__plan'
const PLAN = `${ROOT}/.clawd-hq/plans/export-scores.md`
// A plan file names the session that started it; these tests' host does not say its session, so it is "unknown", and so is the goal's owner.
const OWNER = '<!-- session: unknown -->\n'
const THREE = `# Export scores\n\n- [ ] Find how it works  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n- [ ] Review  <!-- s3 -->\n${OWNER}`
const WITH_LATER = `${THREE}\n## Later\n\n- [ ] Add XLSX  <!-- l1 -->\n- [x] Old idea  <!-- l2 -->\n`

type Answer = { result?: string; deny?: string }
const plan = ($: Engine, input: Record<string, unknown>, agentId?: string) => $.tool.call({ tool: TOOL, ...input, ...(agentId ? { agentId } : {}) } as never) as Promise<Answer>
const hire = ($: Engine, prompt: string, extra: Record<string, unknown> = {}) => $.agent.spawn({ prompt, description: 'Build the export', subagentType: 'general-purpose', name: 'builder', ...extra } as never)
const end = ($: Engine, id: string, answer = 'Done.', reason = 'answer') => $.turn.complete({ reason, answer, turnId: `t-${id}-${reason}`, agentId: id, isAborted: false } as never)
const fileText = (h: ReturnType<typeof host>, path = PLAN) => h.files.get(path)
const debug = (h: ReturnType<typeof host>) => JSON.stringify(h.saved.get('debug:plan') ?? [])

/** A project with the plan file in it (if any), spawns that get the ids p1, p2, ... (a resume keeps its own), and the prompts the engine was about to send. */
function office(on: Parameters<typeof host>[0], files: Record<string, string> = { [PLAN]: THREE }) {
  const h = host(on, [])
  for (const [path, text] of Object.entries(files)) h.files.set(path, text)
  planFs(on, h.files)
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push((e as { prompt: string }).prompt)
    return { model: 'claude-opus-5-5', agentId: (e as { resume?: { agentId: string } }).resume?.agentId ?? `p${prompts.length}` } as never
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  // The settings the Settings tab shows, so a test can press a switch.
  const row = (key: string) => ({ key, label: key, kind: 'boolean', value: true, provider: { plugin: 'clawd-hq@inline', tier: 'user' }, isLocked: false })
  on('config.list', () => ({ value: ['chiefOfStaff', 'quietChat', 'youShouldKnow'].map(f => row(`clawd-hq.${f}`)) }) as never)
  on('config.set', (_$, e) => ({ value: (e as { value: unknown }).value }) as never)
  return { ...h, prompts }
}

test('the plan tool is registered at session start, in the prompt\'s own list', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  expect(h.tools).toContain('plan')
  expect(h.toolSpecs.find(t => t.name === 'plan')?.isDeferred).toBe(false)
})

// ---- The four things Phase 2 is done when it shows ----

test('hiring with PLAN: s2 and the run ending well puts [x] on s2 in the file', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild the export button.')
  expect(h.prompts[0]).not.toContain('PLAN:')
  expect(h.prompts[0]).toMatch(/^Build the export button\./)
  await end($, 'p1')
  expect(fileText(h)).toContain('- [x] Build it  <!-- s2 -->')
  expect(fileText(h)).toContain('- [ ] Find how it works  <!-- s1 -->')
  expect(fileText(h)).toContain('- [ ] Review  <!-- s3 -->')
  // Other steps are still open, so the goal stays open, and Clawd's next answer shows the new standing.
  expect((await plan($, { op: 'later', text: 'Tidy up' })).result).toContain('Plan: Export scores (1 of 3 done)')
})

test('a failed run leaves s2 unticked, and the plan says it needs attention', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild the export button.')
  await end($, 'p1', 'It broke.', 'error')
  expect(fileText(h)).toBe(THREE)
  expect((await plan($, { op: 'later', text: 'Tidy up' })).result).toContain('s2 attention Build it')
})

test('an unknown step id books the run off-plan and leaves a debug record; the hire is never refused', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const hired = await hire($, 'PLAN: s9\nBuild the export button.')
  expect(hired).toMatchObject({ agentId: 'p1' })
  expect(h.prompts[0]).toMatch(/^Build the export button\./)
  expect(debug(h)).toContain('s9')
  await end($, 'p1')
  expect(fileText(h)).toBe(THREE)
})

test('a call of the plan tool that carries an agent id (from a specialist) is refused, and the file is untouched', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild it.')
  const a = await plan($, { op: 'done', id: 's1' }, 'p1')
  expect(a.result).toBeUndefined()
  expect(a.deny).toMatch(/Only Clawd keeps the plan/)
  expect(fileText(h)).toBe(THREE)
})

test('with "Clawd runs the chat" off the plan tool is refused, no plan is loaded or read, and a PLAN line ticks nothing', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  expect((await plan($, { op: 'done', id: 's1' })).deny).toMatch(/off/)
  expect((await plan($, { op: 'start', goal: 'G', steps: ['a'] })).deny).toMatch(/off/)
  await hire($, 'PLAN: s2\nBuild it.')
  expect(h.prompts[0]).not.toContain('PLAN:') // the header comes off as the effort and pair-up lines do when Clawd is off
  await end($, 'p1')
  expect(fileText(h)).toBe(THREE)
  expect(h.reads.filter(path => path.includes('.clawd-hq/plans'))).toEqual([])
})

// ---- The line, the tool and the books ----

test('the PLAN line is found before or after the pair-up line, and after the effort line; all come off the brief', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, '[effort: high]\nPAIR-UP: Ship the export\nPLAN: s1\nFind it.')
  await hire($, '[effort: high]\nPLAN: s2\nPAIR-UP: Ship the export\nBuild it.')
  expect(h.prompts[0]).toMatch(/^Find it\./)
  expect(h.prompts[1]).toMatch(/^Build it\./)
  await end($, 'p1')
  await end($, 'p2')
  expect(fileText(h)).toContain('- [x] Find how it works')
  expect(fileText(h)).toContain('- [x] Build it')
  expect(fileText(h)).toContain('- [ ] Review')
})

test('a resumed run keeps its first link, and a workflow\'s agent is never linked', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s1\nFind it.')
  await end($, 'p1')
  await hire($, 'PLAN: s2\nNow build it.', { resume: { agentId: 'p1' } })
  await end($, 'p1')
  expect(fileText(h)).toContain('- [x] Find how it works')
  expect(fileText(h)).toContain('- [ ] Build it')
  const before = fileText(h)
  await hire($, 'PLAN: s3\nReview it.', { workflow: { runId: 'wf_1', agentIndex: 1 } })
  expect(h.prompts[2]).toContain('PLAN: s3') // a workflow keeps its script's prompt
  await end($, 'p3')
  expect(fileText(h)).toBe(before)
})

test('a step with two runs on it is ticked when the last one ends well, and not at all if one of them failed', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild the button.')
  await hire($, 'PLAN: s2\nBuild the header.')
  await end($, 'p1')
  expect(fileText(h)).toContain('- [ ] Build it')
  await end($, 'p2')
  expect(fileText(h)).toContain('- [x] Build it')
})

test('a run that failed on a step blocks the tick of a sibling that ended well; Clawd ticks it with done', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild the button.')
  await hire($, 'PLAN: s2\nBuild the header.')
  await end($, 'p1', 'Broke.', 'error')
  await end($, 'p2')
  expect(fileText(h)).toContain('- [ ] Build it')
  expect((await plan($, { op: 'done', id: 's2' })).result).toContain('s2 done')
  expect(fileText(h)).toContain('- [x] Build it')
})

test('the choices a run reported go under its step, and they are copied once however many signals come', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild it.')
  const report = 'Built.\nDECIDED: One CSV file, not one for each class — simpler\n- DECIDED: Keep the header row — Excel needs it'
  await $.classic.SubagentStop({ agent_id: 'p1' } as never).catch(() => undefined)
  await end($, 'p1', report)
  await end($, 'p1', report)
  const text = fileText(h)!
  expect(text).toContain('- [x] Build it  <!-- s2 -->\n  - Decided: One CSV file, not one for each class — simpler\n  - Decided: Keep the header row — Excel needs it\n')
  expect(text.match(/Decided:/g)).toHaveLength(2)
})

// ---- Starting, finishing, loading ----

test('Clawd starts a plan with the tool; the file is made, the answer lists the ids, and a second start is refused', async ($, on) => {
  const h = office(on, {})
  await $.session.start(START)
  const a = await plan($, { op: 'start', goal: 'Export scores', steps: ['Find how it works', 'Build it'] })
  expect(a.result).toBe('Plan: Export scores (0 of 2 done)\ns1 next      Find how it works\ns2 next      Build it')
  expect(fileText(h)).toContain('# Export scores')
  expect((await plan($, { op: 'start', goal: 'Another', steps: ['x'] })).deny).toContain('finish the current goal first (done or stopped)')
  await hire($, 'PLAN: s2\nBuild it.')
  await end($, 'p1')
  expect(fileText(h)).toContain('- [x] Build it  <!-- s2 -->')
})

test('finish moves the unticked Later items to the project\'s Later list, empties the file and leaves no goal; a new one may then start', async ($, on) => {
  const h = office(on, { [PLAN]: WITH_LATER })
  await $.session.start(START)
  const a = await plan($, { op: 'finish', outcome: 'done' })
  expect(a.result).toContain('is over (done)')
  expect(fileText(h)).toBe('')
  const kept = h.saved.get(`leftUndone:${ROOT}`) as Array<{ text: string; source: string }>
  expect(kept.map(i => [i.text, i.source])).toEqual([['Add XLSX', 'plan']])
  expect((await plan($, { op: 'add', text: 'x' })).deny).toContain('op "start"')
  expect((await plan($, { op: 'start', goal: 'Export scores', steps: ['again'] })).result).toContain('Plan: Export scores')
})

test('at session start the newest plan is the goal in hand, and steps added by hand get their ids in the file first', async ($, on) => {
  const h = office(on, { [PLAN]: `# Export scores\n- [ ] By hand\n- [ ] Build it  <!-- s4 -->\n${OWNER}` })
  await $.session.start(START)
  expect(fileText(h)).toBe(`# Export scores\n- [ ] By hand  <!-- s5 -->\n- [ ] Build it  <!-- s4 -->\n${OWNER}<!-- next: s6 l1 -->\n`)
  expect((await plan($, { op: 'done', id: 's5' })).result).toContain('s5 done')
})

test('a person\'s message does not disturb the plan, and the plan tool does not count as Clawd\'s own work', async ($, on) => {
  const h = office(on)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  await $.session.start(START)
  await plan($, { op: 'add', text: 'Docs' })
  await $.prompt.submit({ text: 'Looks good, go on', origin: { kind: 'composer' } } as never)
  expect(fileText(h)).toContain('- [ ] Docs')
  await $.turn.start({ text: 'go on', turnId: 'm1' } as never)
  await plan($, { op: 'done', id: 's1' })
  const done = await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'm1', isAborted: false } as never)
  expect(done).toBeDefined()
})

test('the plan tool is no work of Clawd\'s own: a turn of plan calls starts no check on his answer, while the same number of reads does', async ($, on) => {
  const h = office(on)
  const asked: unknown[] = []
  on('model.complete', (_$, e) => (asked.push(e), { value: { isAnswered: false } }) as never)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  // The main chat as the check reads it back: the request, a step that used a tool, and the answer.
  const chat = [
    { role: 'user', text: 'Add the export', toolUses: [] },
    { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u1', tool: 'Read', input: { file_path: '/repo/f1.ts' }, text: 'code' }] },
    { role: 'assistant', text: 'Added the export.', toolUses: [] },
  ]
  on('session.messages', () => ({ value: chat }) as never)
  await $.session.start(START)
  const turn = async (id: string, calls: Array<Record<string, unknown>>) => {
    await $.prompt.submit({ text: 'Add the export', origin: { kind: 'composer' } } as never)
    await $.turn.start({ text: 'Add the export', turnId: id } as never)
    for (const call of calls) await $.tool.call(call as never)
    await $.turn.complete({ reason: 'answer', answer: 'Added the export.', turnId: id, isAborted: false, durationMs: 5 } as never)
    for (let i = 0; i < 30; i += 1) await h.clock.advance(0)
  }
  await turn('m1', [1, 2, 3, 4, 5, 6].map(i => ({ tool: TOOL, op: 'later', text: `Put off ${i}` })))
  expect(asked).toHaveLength(0)
  await turn('m2', [1, 2, 3, 4, 5, 6].map(i => ({ tool: 'Read', file_path: `/repo/f${i}.ts` })))
  expect(asked.length).toBeGreaterThan(0)
})

test('when the host moves the session to the project, the project\'s plan becomes the goal in hand', async ($, on) => {
  const h = office(on, { '/project/.clawd-hq/plans/export-scores.md': THREE })
  const where = { folder: '/spare' }
  on('session.root', () => ({ value: where.folder }) as never)
  on('classic.CwdChanged', () => ({}) as never)
  await $.session.start({ cwd: '/spare', surface: 'terminal', isInteractive: true } as never)
  expect((await plan($, { op: 'done', id: 's1' })).deny).toMatch(/op "start"/)
  where.folder = '/project'
  await $.classic.CwdChanged({ old_cwd: '/spare', new_cwd: '/project' } as never)
  expect((await plan($, { op: 'done', id: 's1' })).result).toContain('Plan: Export scores (1 of 3 done)')
  expect(h.files.get('/project/.clawd-hq/plans/export-scores.md')).toContain('- [x] Find how it works')
})

// ---- Review fixes ----

/** The person presses the "Clawd runs the chat" switch on the Settings tab: the plugin reads it live from then on. */
async function turnClawdOff($: Engine) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...SETTINGS })
  await ui.press({ key: 'config-chiefOfStaff' })
  await ui.unmount()
}

test('a brief whose first line is "Plan: ..." in words is left byte for byte, with Clawd on and off; only a step id makes a plan line', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const brief = 'Plan: update the docs\nThen tell me what changed.'
  await hire($, brief)
  await hire($, 'PLAN: s2 build it now\nGo.')
  expect(h.prompts[0]).toMatch(/^Plan: update the docs\nThen tell me what changed\./)
  expect(h.prompts[1]).toMatch(/^build it now\nGo\./) // the words after the id are the brief's first line
})

test('a brief whose first line is "Plan: ..." in words is left byte for byte with Clawd off too', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Plan: update the docs\nThen tell me what changed.')
  await hire($, 'PLAN: s2 build it now\nGo.')
  expect(h.prompts[0]).toMatch(/^Plan: update the docs\nThen tell me what changed\./)
  expect(h.prompts[1]).toMatch(/^build it now\nGo\./)
})

test('a run that only stopped (no hand-back) ticks nothing; the hand-back that follows does', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild it.')
  await $.classic.SubagentStop({ agent_id: 'p1' } as never)
  expect(fileText(h)).toBe(THREE)
  expect((await plan($, { op: 'later', text: 'Tidy up' })).result).toContain('s2 next')
  await end($, 'p1', 'Built.\nDECIDED: One CSV file — simpler')
  expect(fileText(h)).toContain('- [x] Build it  <!-- s2 -->\n  - Decided: One CSV file — simpler\n')
})

test('turning Clawd off during the session stops the ticking, and nothing is recorded for a PLAN line', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild it.')
  await turnClawdOff($)
  await end($, 'p1')
  expect(fileText(h)).toBe(THREE)
  const before = debug(h)
  await hire($, 'PLAN: s9\nBuild it.')
  expect(debug(h)).toBe(before)
})

test('a rerun that succeeds ticks the step its earlier run failed on', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild it.')
  await end($, 'p1', 'Broke.', 'error')
  await h.clock.advance(5_000)
  await hire($, 'PLAN: s2\nBuild it again.')
  await end($, 'p2')
  expect(fileText(h)).toContain('- [x] Build it  <!-- s2 -->')
})

test('a new goal starts clean: the earlier goal\'s failed and working s2 runs do not touch the new s2', async ($, on) => {
  const h = office(on, {})
  await $.session.start(START)
  await plan($, { op: 'start', goal: 'Export scores', steps: ['Find how it works', 'Build it'] })
  await hire($, 'PLAN: s2\nBuild it.')
  await hire($, 'PLAN: s2\nBuild it another way.')
  await end($, 'p1', 'Broke.', 'error') // p2 is still at work
  await plan($, { op: 'finish', outcome: 'stopped' })
  await h.clock.advance(60_000)
  const second = await plan($, { op: 'start', goal: 'Export scores', steps: ['Find how it works', 'Build it'] })
  expect(second.result).toContain('s2 next      Build it')
  // The old run ends well: the new s2 is not ticked and takes none of its choices.
  await end($, 'p2', 'Built.\nDECIDED: Use a stream — big files')
  expect(fileText(h)).not.toContain('[x]')
  expect(fileText(h)).not.toContain('Decided')
  // The new s2 can be dropped: nothing is at work on it.
  expect((await plan($, { op: 'drop', id: 's2' })).result).toContain('(0 of 1 done)')
})

test('finish keeps every put-off item even when the Later list is full, says how many it moved, and refuses when it cannot keep them', async ($, on) => {
  const many = Array.from({ length: 12 }, (_, i) => `- [ ] Put off thing ${i + 1} for later  <!-- l${i + 1} -->`).join('\n')
  const full = Array.from({ length: 10 }, (_, i) => ({ id: `o${i}`, text: `Alpha${i} Beta${i} Gamma${i}`, source: 'check', by: 'Clawd', at: i }))
  const h = host(on, [], { [`leftUndone:${ROOT}`]: full })
  h.files.set(PLAN, `${THREE}\n## Later\n\n${many}\n`)
  planFs(on, h.files)
  await $.session.start(START)
  h.kv.failKeys.add(`leftUndone:${ROOT}`)
  const refused = await plan($, { op: 'finish', outcome: 'done' })
  expect(refused.deny).toMatch(/store\.set/)
  expect(fileText(h)).toContain('# Export scores')
  expect((await plan($, { op: 'done', id: 's1' })).result).toContain('Plan: Export scores')
  h.kv.failKeys.clear()
  const ended = await plan($, { op: 'finish', outcome: 'done' })
  expect(ended.result).toContain('12 put-off items were moved')
  expect(fileText(h)).toBe('')
  const kept = h.saved.get(`leftUndone:${ROOT}`) as Array<{ source: string }>
  expect(kept.filter(i => i.source === 'plan')).toHaveLength(12)
  expect(kept.filter(i => i.source === 'check')).toHaveLength(10)
})
