import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { STEP_MS } from '../hooks/demo'
import { parseHistory } from '../hooks/history'
import type { HistoryRecord } from '../hooks/history'
import { HISTORY, START, host } from './host'
import { planFs } from './plan-disk'
import { antKey } from './fake-secrets'

// history.jsonl through the real plugin: each record kind once per event, every field, no inputs or outputs, nothing from the demo, nothing
// lost at a normal session end, and with Clawd off the runs, tools and requests still kept.

const DIR = '/repo/.clawd-hq'
const FILE = `${DIR}/history-s1.jsonl`
const PLAN = 'mcp__clawd-hq__plan'
const USAGE = { model: 'claude-sonnet-5-5', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 }

function office(on: Parameters<typeof host>[0], tools: (tool: string) => unknown = () => ({ result: 'ok' })) {
  const h = host(on, [])
  planFs(on, h.files)
  on('session.id', () => ({ value: 's1' }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `p${(n += 1)}` }) as never)
  on('tool.call', (_$, e) => tools(String((e as { tool: string }).tool)) as never)
  // A model request: one with usage, unless the turn id says it carried none.
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: e.turnId === 'no-usage' ? null : USAGE } as never
  })
  return h
}
const hire = ($: Engine, prompt: string, name = 'builder') => $.agent.spawn({ prompt, description: prompt.split('\n').pop(), subagentType: 'clawd-hq:core-builder', name } as never)
const handBack = ($: Engine, id: string, answer = 'Done.', reason = 'answer') => $.turn.complete({ reason, answer, turnId: `t-${id}-${reason}`, agentId: id, isAborted: false } as never)
const request = async ($: Engine, agentId?: string, turnId = 'r1') => {
  const run = $.turn.step({ turnId, index: 0, model: 'claude-sonnet-5-5', messageCount: 3, ...(agentId ? { agentId } : {}) } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
}
const endSession = ($: Engine) => $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
/** Every record in every history file of the project, in time order. */
const records = (h: { files: Map<string, string> }): HistoryRecord[] =>
  parseHistory([...h.files.entries()].filter(([path]) => path.startsWith(`${DIR}/history`)).map(([, text]) => text).join('\n')).sort((a, b) => a.at - b.at)
const ofKind = <K extends HistoryRecord['kind']>(h: { files: Map<string, string> }, kind: K) => records(h).filter((r): r is Extract<HistoryRecord, { kind: K }> => r.kind === kind)
const start = ($: Engine) => $.tool.call({ tool: PLAN, op: 'start', goal: 'Export scores as CSV', summary: 'Teachers get one CSV.', steps: ['Find it', 'Build it'] } as never)

// ---- Goals ----

test('a goal_start is written once when a plan starts, with its title, summary, step count and who made it; a refused start writes none', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await start($)
  await start($) // refused: one goal only
  await endSession($)
  const [one, ...rest] = ofKind(h, 'goal_start')
  expect(rest).toEqual([])
  expect(one).toMatchObject({ v: 1, kind: 'goal_start', goal: 'export-scores-as-csv', title: 'Export scores as CSV', summary: 'Teachers get one CSV.', steps: 2, by: 'clawd' })
  expect(typeof one!.session).toBe('string')
})

test('a goal_end is written once at finish: the final plan with retries and the last outcome per step, the runs, the failed runs and the working time', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await start($)
  await hire($, 'PLAN: s1\nFind it.')
  await h.clock.advance(10_000)
  await handBack($, 'p1', 'It broke.', 'error')
  await h.clock.advance(1_000) // the failure ended before the retry began, so the retry's success ticks the step
  await hire($, 'PLAN: s1\nFind it again.')
  // Silence past 15 seconds would end a run the engine does not list: a tool call halfway is a sign of life.
  await h.clock.advance(10_000)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'p2' } as never)
  await h.clock.advance(10_000)
  await handBack($, 'p2', 'Found it.\nDECIDED: one file — simpler')
  await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never)
  await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never) // no goal now: refused, writes nothing
  await endSession($)
  const ends = ofKind(h, 'goal_end')
  expect(ends).toHaveLength(1)
  expect(ends[0]).toMatchObject({
    kind: 'goal_end', goal: 'export-scores-as-csv', title: 'Export scores as CSV', summary: 'Teachers get one CSV.', outcome: 'done', stepsDone: 1, stepsTotal: 2,
    runs: 2, failedRuns: 1, workMs: 30_000,
  })
  expect(ends[0]!.steps).toEqual([
    { id: 's1', text: 'Find it', isDone: true, choices: ['one file — simpler'], retries: 1, lastOutcome: 'done' },
    { id: 's2', text: 'Build it', isDone: false, choices: [], retries: 0 },
  ])
})

// ---- Runs ----

test('a run is written once when it ends, though both its hand-back and its stop signal arrive, with every field of 8.2', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await start($)
  await hire($, 'PLAN: s2\nBuild the export.')
  await $.tool.call({ tool: 'Skill', skill: 'ecc:frontend-patterns', agentId: 'p1' } as never)
  await request($, 'p1')
  await h.clock.advance(5_000)
  await handBack($, 'p1', 'Built.\nDECIDED: one file — simpler\nQUESTION: header? | a / b | recommend: a')
  await $.classic.SubagentStop({ agent_id: 'p1' } as never)
  await endSession($)
  const runs = ofKind(h, 'run')
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({
    kind: 'run', goal: 'export-scores-as-csv', step: 's2', stepText: 'Build it', run: 'p1', type: 'clawd-hq:core-builder', name: 'builder', task: 'Build the export.',
    model: 'claude-sonnet-5-5', skills: ['ecc:frontend-patterns'], outcome: 'done', endedBy: 'signal', tools: 1, choices: 1, questions: 1, notes: 0, isRetry: false,
    tokens: { inPeak: 350, out: 5, in: 10, cached: 300, cacheWrite: 40 },
  })
  expect(runs[0]!.endedAt - runs[0]!.startedAt).toBe(5_000)
})

test('a run whose stop signal comes first is still written once, its choices and questions counted from its last message', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around.')
  await $.classic.SubagentStop({ agent_id: 'p1', last_assistant_message: 'Done.\nDECIDED: a — b\nDECIDED: c — d' } as never)
  await handBack($, 'p1', 'Done.\nDECIDED: a — b\nDECIDED: c — d')
  await endSession($)
  const runs = ofKind(h, 'run')
  expect(runs).toHaveLength(1)
  expect(runs[0]).toMatchObject({ choices: 2, questions: 0 })
  expect(runs[0]).not.toHaveProperty('goal')
})

// ---- Tools and requests ----

test('one tool record per call, Clawd\'s and an agent\'s, with times and whether it went well; a refused or failed call is not ok', async ($, on) => {
  const h = office(on, tool => (tool === 'Write' ? { deny: 'no' } : tool === 'Bash' ? { isError: true, result: 'exit 1' } : { result: 'ok' }))
  await $.session.start(START)
  await start($)
  await hire($, 'PLAN: s1\nFind it.')
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'p1' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/b.ts', content: 'x', agentId: 'p1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false', agentId: 'p1' } as never)
  await endSession($)
  const tools = ofKind(h, 'tool').filter(r => r.tool !== PLAN)
  expect(tools.map(r => [r.tool, r.run ?? 'clawd', r.ok])).toEqual([['Read', 'clawd', true], ['Grep', 'p1', true], ['Write', 'p1', false], ['Bash', 'p1', false]])
  expect(tools[0]).toMatchObject({ name: 'Clawd', type: 'main' })
  expect(tools[0]).not.toHaveProperty('goal')
  expect(tools[1]).toMatchObject({ name: 'builder', type: 'clawd-hq:core-builder', goal: 'export-scores-as-csv', step: 's1' })
  for (const one of tools) expect(one.ms).toBe(one.endedAt - one.startedAt)
  // The plan tool's own calls are tool calls too, each once.
  expect(ofKind(h, 'tool').filter(r => r.tool === PLAN)).toHaveLength(1)
})

test('no input or output reaches the file: a secret-looking command and a file path are never written', async ($, on) => {
  const h = office(on, () => ({ result: `token=${antKey('OUTPUT')} /Users/me/out.txt` }))
  await $.session.start(START)
  await hire($, 'Deploy it.')
  await $.tool.call({ tool: 'Bash', command: `curl -H "Authorization: Bearer ${antKey('SECRETSECRET')}" https://example.com`, agentId: 'p1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/Users/me/.ssh/id_rsa' } as never)
  await handBack($, 'p1', `Used ${antKey('SECRETSECRET')} from /Users/me/.ssh/id_rsa.`)
  await endSession($)
  const text = h.files.get(FILE)!
  expect(ofKind(h, 'tool')).toHaveLength(2)
  for (const leak of ['sk-ant', 'SECRET', '/Users/me', 'id_rsa', 'example.com', 'curl', 'OUTPUT', 'Authorization']) expect(text).not.toContain(leak)
})

test('one request record per model request that reports usage, with its four token counts; none without usage; Clawd\'s has no run', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'Look around.')
  await request($, 'p1')
  await request($)
  await request($, 'p1', 'no-usage')
  await endSession($)
  const reqs = ofKind(h, 'request')
  expect(reqs.map(r => r.run ?? 'clawd')).toEqual(['p1', 'clawd'])
  expect(reqs[0]).toMatchObject({ model: 'claude-sonnet-5-5', tokens: { in: 10, out: 5, cached: 300, cacheWrite: 40 } })
})

// ---- Batches, the demo, Clawd off ----

test('batched records are all written by a normal session end, with no timer run', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  for (let i = 0; i < 7; i += 1) await $.tool.call({ tool: 'Read', file_path: `/repo/${i}.ts` } as never)
  await request($)
  await endSession($)
  expect(ofKind(h, 'tool')).toHaveLength(7)
  expect(ofKind(h, 'request')).toHaveLength(1)
})

test('records waiting are written by the short timer too', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  expect(h.files.has(FILE)).toBe(false)
  await h.clock.advance(10_000)
  expect(ofKind(h, 'tool')).toHaveLength(1)
})

test('the demo\'s stand-ins write nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await h.clock.advance(20 * STEP_MS)
  await endSession($)
  expect([...h.files.keys()].some(k => k.startsWith(`${DIR}/history`))).toBe(false)
})

test('with Clawd off, runs, tools and requests are still kept, and no goal is (the plan is off)', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await start($)
  await hire($, 'Look around.')
  await $.tool.call({ tool: 'Grep', pattern: 'x', agentId: 'p1' } as never)
  await request($, 'p1')
  await handBack($, 'p1')
  await endSession($)
  expect(ofKind(h, 'goal_start')).toEqual([])
  expect(ofKind(h, 'run')).toHaveLength(1)
  expect(ofKind(h, 'tool').some(r => r.run === 'p1')).toBe(true)
  expect(ofKind(h, 'request')).toHaveLength(1)
})

// ---- The goal's start, kept in its plan file ----

const PLAN_FILE = `${DIR}/plans/export-scores-as-csv.md`
const seededPlan = (started?: number) => `# Export scores as CSV\n\n- [x] Find it  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n${started === undefined ? '' : `<!-- started: ${started} -->\n`}<!-- session: s1 -->\n<!-- next: s3 l1 -->\n`

test('a new plan writes its start in its file, beside the next line, and its goal_start is stamped with it', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await start($)
  await endSession($)
  expect(h.files.get(PLAN_FILE)).toContain('<!-- session: s1 -->') // and the session that started the goal, for the goal's owner
  const began = Number(/<!-- started: (\d+) -->\n<!-- session: s1 -->\n<!-- next: /.exec(h.files.get(PLAN_FILE)!)![1])
  expect(began).toBeGreaterThan(0)
  expect(ofKind(h, 'goal_start')[0]!.at).toBe(began)
})

test('a plan loaded in a later session takes its start from its file, and the goal_end uses it, not the file\'s time', async ($, on) => {
  const h = office(on)
  h.files.set(PLAN_FILE, seededPlan(700))
  await $.session.start(START)
  await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never)
  await endSession($)
  expect(ofKind(h, 'goal_end')[0]).toMatchObject({ goal: 'export-scores-as-csv', startedAt: 700 })
})

test('a plan from before the line takes its start from its goal_start record in the history; with none, the file\'s time, noted as a guess', async ($, on) => {
  const h = office(on)
  h.files.set(PLAN_FILE, seededPlan())
  h.files.set(`${DIR}/history-old.jsonl`, `${JSON.stringify({ v: 1, at: 777, kind: 'goal_start', session: 'old', goal: 'export-scores-as-csv', title: 'Export scores as CSV', steps: 2, by: 'clawd' })}\n`)
  await $.session.start(START)
  await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never)
  await endSession($)
  expect(ofKind(h, 'goal_end')[0]).toMatchObject({ startedAt: 777 })
})

test('a plan with no start anywhere uses its file\'s time, and says it guessed', async ($, on) => {
  const h = office(on)
  h.files.set(PLAN_FILE, seededPlan())
  await $.session.start(START)
  await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never)
  await endSession($)
  expect(ofKind(h, 'goal_end')[0]).toMatchObject({ startedAt: 0 }) // the test host's file time
  expect(JSON.stringify(h.saved.get('debug:plan'))).toMatch(/no start time.*a guess/)
})

// ---- Once per event ----

test('a finish that fails writes no goal_end; its retry writes one', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await start($)
  h.disk.isWriteFailing = true
  const failed = await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never) as { deny?: string }
  expect(failed.deny).toBeDefined()
  h.disk.isWriteFailing = false
  await $.tool.call({ tool: PLAN, op: 'finish', outcome: 'done' } as never)
  await endSession($)
  expect(ofKind(h, 'goal_end')).toHaveLength(1)
})

test('an earlier session\'s failed run on the same step makes this run a retry', async ($, on) => {
  const h = office(on)
  h.files.set(PLAN_FILE, seededPlan(100))
  const earlier = { v: 1, at: 300, kind: 'run', session: 'old', goal: 'export-scores-as-csv', step: 's2', run: 'old1', type: 't', task: 'x', startedAt: 200, endedAt: 300, outcome: 'failed', endedBy: 'signal', tools: 0, tokens: { inPeak: 0, out: 0 }, choices: 0, questions: 0, notes: 0, isRetry: false }
  h.files.set(`${DIR}/history-old.jsonl`, `${JSON.stringify(earlier)}\n`)
  await $.session.start(START)
  await hire($, 'PLAN: s2\nBuild it again.')
  await handBack($, 'p1')
  await endSession($)
  expect(ofKind(h, 'run').find(r => r.run === 'p1')).toMatchObject({ step: 's2', isRetry: true })
})

// ---- Filters at the edge ----

test('a skill is put on its run only when its Skill call went well', async ($, on) => {
  const h = office(on, tool => (tool === 'Skill' ? { deny: 'not allowed' } : { result: 'ok' }))
  await $.session.start(START)
  await hire($, 'Look around.')
  await $.tool.call({ tool: 'Skill', skill: 'ecc:frontend-patterns', agentId: 'p1' } as never)
  await handBack($, 'p1')
  await endSession($)
  expect(ofKind(h, 'run')[0]).not.toHaveProperty('skills')
})

// ---- No hook waits on the disk ----

test('a run\'s end and a plan tool call never wait on writing the history', async ($, on) => {
  let release = () => undefined as void
  const gate = new Promise<void>(resolve => { release = resolve })
  let isHit = false
  on('fs.write', { path: FILE }, async (_$, e, next) => {
    isHit = true
    await gate
    return next(e)
  })
  const h = office(on)
  await $.session.start(START)
  /** Whether the work settles while the disk holds the history's write: the held clock moved on, a round trip at a time. */
  const settles = async (work: Promise<unknown>) => {
    let isDone = false
    void work.then(() => { isDone = true })
    for (let i = 0; i < 300 && !isDone; i += 1) await h.clock.advance(0)
    return isDone
  }
  expect(await settles(start($))).toBe(true)
  await hire($, 'PLAN: s1\nFind it.')
  expect(await settles(handBack($, 'p1'))).toBe(true)
  expect(isHit).toBe(true)
  release()
  await endSession($)
  expect(ofKind(h, 'run')).toHaveLength(1)
})

test('a history that cannot be written keeps its notes under its own debug key, not the plan\'s', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  h.disk.isWriteFailing = true
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts' } as never)
  await endSession($)
  expect(JSON.stringify(h.saved.get('debug:history'))).toMatch(/records wait/)
  expect(JSON.stringify(h.saved.get('debug:plan') ?? '')).not.toMatch(/history/)
})

// ---- The History tab's first read ----

test('the History tab asks to be drawn again once its first read of the files lands, so a step ticked during the read is not left out', async ($, on) => {
  let release = () => undefined as void
  const gate = new Promise<void>(resolve => { release = resolve })
  /** Only the first read of an earlier session's file once armed (the History tab's) is held: the history's own later reads go through. */
  const held = { isArmed: false, isHit: false }
  const OLD = `${DIR}/history-old.jsonl`
  on('fs.read', { path: OLD }, async (_$, e, next) => {
    if (held.isArmed && !held.isHit) {
      held.isHit = true
      await gate
    }
    return next(e)
  })
  const redraws = { isCounting: false, count: 0 }
  on('ui.invalidate', { event: 'ui.render' }, (_$, e, next) => {
    if (redraws.isCounting) redraws.count += 1
    return next(e)
  })
  const h = office(on)
  h.files.set(OLD, `${JSON.stringify({ v: 1, at: 1, kind: 'note', session: 'old', text: 'earlier' })}\n`)
  await $.session.start(START)
  await start($)
  await $.tool.call({ tool: PLAN, op: 'add', text: 'Check it' } as never) // a third step, so the tick below is not the goal's last (that would close the goal)
  await $.tool.call({ tool: PLAN, op: 'done', id: 's1' } as never)
  await hire($, 'PLAN: s2\nBuild it.')
  held.isArmed = true
  const drawing = $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...HISTORY })
  for (let i = 0; i < 300 && !held.isHit; i += 1) await h.clock.advance(0)
  expect(held.isHit).toBe(true)
  // A step is ticked while the tab's read is held, and what that writes is settled before the read lands.
  await handBack($, 'p1')
  for (let i = 0; i < 50; i += 1) await h.clock.advance(0)
  redraws.isCounting = true
  release()
  const ui = await drawing
  for (let i = 0; i < 50; i += 1) await h.clock.advance(0)
  await ui.unmount()
  // The draw that waited on the read began with the plan as it stood then: one more draw is asked for at once, not at the next frame.
  expect(redraws.count).toBeGreaterThan(0)
  // That draw shows the step ticked during the read.
  const again = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...HISTORY })
  expect((await again.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')).toContain('2 of 3 done')
  await again.unmount()
  await endSession($)
})
