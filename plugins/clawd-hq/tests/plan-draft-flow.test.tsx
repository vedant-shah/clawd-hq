import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { parseHistory } from '../hooks/history'
import type { HistoryRecord } from '../hooks/history'
import { PLAN_DRAFT_NOTE } from '../hooks/plan-draft'
import { BRIEF_NOTE } from '../hooks/desk'
import { START, host } from './host'
import { ROOT, planFs } from './plan-disk'

// The Planner's plan end to end: a hire with `PLAN-DRAFT:` is asked for STEP lines, and its real hand-back makes the plan, or leaves a draft.

const TOOL = 'mcp__clawd-hq__plan'
const DIR = `${ROOT}/.clawd-hq`
const PLANS = `${DIR}/plans`
const SCORES = `${PLANS}/export-scores.md`
const THREE = '# Export scores\n\n- [ ] Find how it works  <!-- s1 -->\n- [ ] Build it  <!-- s2 -->\n- [ ] Review  <!-- s3 -->\n<!-- session: s1 -->\n'
/** Where session `s1` (the session of these tests) keeps the draft waiting in /repo. */
const DRAFT_KEY = 'planDraft:/repo:s1'
const REPORT = 'Read the code.\nSTEP: Find where scores live\nSTEP: Write the export\nSTEP: Test it\n'

type Answer = { result?: string; deny?: string }
const plan = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never) as Promise<Answer>
const hire = ($: Engine, prompt: string, extra: Record<string, unknown> = {}) => $.agent.spawn({ prompt, description: 'Plan the export', subagentType: 'clawd-hq:core-planner', name: 'planner', ...extra } as never)
const end = ($: Engine, id: string, answer = REPORT, reason = 'answer') => $.turn.complete({ reason, answer, turnId: `t-${id}-${reason}`, agentId: id, isAborted: false } as never)
/** The plan files with a goal in them (a goal that ended leaves its file empty). */
const planFiles = (h: ReturnType<typeof host>) => [...h.files.entries()].filter(([k, text]) => k.startsWith(`${PLANS}/`) && text.trim() !== '').map(([k]) => k)
const records = (h: ReturnType<typeof host>): HistoryRecord[] => parseHistory([...h.files.entries()].filter(([p]) => p.startsWith(`${DIR}/history`)).map(([, t]) => t).join('\n'))

/** A project (with a plan file in it, if given), spawns that get the ids p1, p2, ..., and the prompts the engine was about to send. */
function office(on: Parameters<typeof host>[0], files: Record<string, string> = {}) {
  const h = host(on, [])
  for (const [path, text] of Object.entries(files)) h.files.set(path, text)
  planFs(on, h.files)
  on('session.id', () => ({ value: 's1' }) as never)
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => {
    prompts.push((e as { prompt: string }).prompt)
    return { model: 'claude-opus-5-5', agentId: (e as { resume?: { agentId: string } }).resume?.agentId ?? `p${prompts.length}` } as never
  })
  on('tool.call', () => ({ result: 'ok' }) as never)
  return { ...h, prompts }
}

test('a hire with PLAN-DRAFT: gets the STEP note and not the line; a hire without it gets no STEP note', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  await hire($, 'Plan the export.')
  await hire($, 'PLAN: s1\nBuild it.', { subagentType: 'general-purpose' })
  expect(h.prompts[0]).toBe(`Plan the export.${BRIEF_NOTE}${PLAN_DRAFT_NOTE}`)
  expect(h.prompts[0]).not.toContain('PLAN-DRAFT')
  expect(h.prompts[1]).toBe(`Plan the export.${BRIEF_NOTE}`)
  expect(h.prompts[2]).toBe(`Build it.${BRIEF_NOTE}`)
  for (const p of h.prompts.slice(1)) expect(p).not.toContain('STEP:')
})

test('PLAN-DRAFT: is read in either header order, with the effort line first', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, '[effort: high]\nPLAN-DRAFT: One\nPAIR-UP: Plan it\nThe job.')
  await hire($, '[effort: high]\nPAIR-UP: Plan it\nPLAN-DRAFT: Two\nThe job.')
  for (const p of h.prompts) expect(p).toBe(`The job.${BRIEF_NOTE}${PLAN_DRAFT_NOTE}`)
  await end($, 'p1', 'STEP: a\nSTEP: b')
  expect(planFiles(h)).toEqual([`${PLANS}/one.md`])
})

test('the Planner\'s real hand-back with three STEP lines and no goal makes the plan, exactly as start does, and the history says the Planner made it', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  await end($, 'p1')
  expect(h.files.get(SCORES)).toMatch(/^# Export scores\n\n- \[ \] Find where scores live {2}<!-- s1 -->\n- \[ \] Write the export {2}<!-- s2 -->\n- \[ \] Test it {2}<!-- s3 -->\n/)
  expect(h.files.get(SCORES)).not.toMatch(/^> /m) // no summary line
  expect((await plan($, { op: 'later', text: 'Tidy' })).result).toContain('Plan: Export scores (0 of 3 done)')
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
  const starts = records(h).filter(r => r.kind === 'goal_start')
  expect(starts).toHaveLength(1)
  expect(starts[0]).toMatchObject({ title: 'Export scores', steps: 3, by: 'planner' })
})

test('a goal Clawd started himself is recorded as his', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await plan($, { op: 'start', goal: 'Mine', steps: ['a', 'b'] })
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(records(h).filter(r => r.kind === 'goal_start')[0]).toMatchObject({ by: 'clawd' })
})

test('with a goal in hand the steps wait as a draft: no second file, and one note in Clawd\'s next plan answer, then none', async ($, on) => {
  const h = office(on, { [SCORES]: THREE })
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Add XLSX\nPlan XLSX.')
  await end($, 'p1', 'STEP: Pick a library\nSTEP: Write it')
  expect(planFiles(h)).toEqual([SCORES])
  const first = await plan($, { op: 'later', text: 'Tidy' })
  expect(first.result).toContain('A plan from the Planner is waiting: Add XLSX, 2 steps.')
  expect((await plan($, { op: 'later', text: 'Tidy more' })).result).not.toContain('waiting')
  // Finishing the goal leaves the draft for Clawd's own start, which uses it up.
  await plan($, { op: 'finish', outcome: 'done' })
  expect(planFiles(h)).toEqual([])
  expect((await plan($, { op: 'start', goal: 'Add XLSX', steps: ['Pick a library', 'Write it'] })).result).not.toContain('waiting')
})

test('a newer draft replaces the older one', async ($, on) => {
  office(on, { [SCORES]: THREE })
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Old plan\nPlan.')
  await hire($, 'PLAN-DRAFT: New plan\nPlan.')
  await end($, 'p1', 'STEP: a\nSTEP: b')
  await end($, 'p2', 'STEP: c\nSTEP: d\nSTEP: e')
  const answer = (await plan($, { op: 'later', text: 'Tidy' })).result
  expect(answer).toContain('A plan from the Planner is waiting: New plan, 3 steps.')
  expect(answer).not.toContain('Old plan')
})

test('a draft survives a reload of the plugin: it is kept in the store', async ($, on) => {
  const h = office(on, { [SCORES]: THREE })
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Add XLSX\nPlan XLSX.')
  await end($, 'p1', 'STEP: Pick a library\nSTEP: Write it')
  expect(JSON.stringify(h.saved.get(DRAFT_KEY))).toContain('Add XLSX')
})

test('a draft belongs to the session whose Planner made it: another session\'s draft, and one saved before drafts named a session, are not shown', async ($, on) => {
  const h = office(on, { [SCORES]: THREE })
  const draft = { folder: '/repo', title: 'Not mine', steps: ['a', 'b'], at: 1_000, isTold: false, kind: 'waiting' }
  h.saved.set('planDraft:/repo:s2', draft)
  h.saved.set('planDraft:/repo', draft)
  await $.session.start(START)
  expect((await plan($, { op: 'later', text: 'Tidy' })).result).not.toContain('waiting')
  expect(h.saved.get('planDraft:/repo:s2')).toEqual(draft)
})

test('a guessed end makes nothing: a stop signal that is not a hand-back, or a hand-back that failed, ticks and files nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  await end($, 'p1', REPORT, 'error')
  await $.classic.SubagentStop({ agent_id: 'p1', last_assistant_message: REPORT } as never)
  expect(planFiles(h)).toEqual([])
  expect((await plan($, { op: 'later', text: 'Tidy' })).deny).toMatch(/no goal in hand/i)
})

test('a report with fewer than two steps makes no plan', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  await end($, 'p1', 'STEP: Only one')
  expect(planFiles(h)).toEqual([])
})

test('with Clawd off the PLAN-DRAFT: line stays in the brief untouched: no note, no plan, no draft', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  expect(h.prompts[0]).toBe(`PLAN-DRAFT: Export scores\nPlan the export.${BRIEF_NOTE}`)
  await end($, 'p1')
  expect(planFiles(h)).toEqual([])
  expect(h.saved.get(DRAFT_KEY)).toBeUndefined()
})

test('a long PLAN-DRAFT: line is cut for the title but its full text stays as the first line of the brief; a short one is gone from it', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const long = `Export the scores as a CSV file for every class, ${'with all the columns the teachers asked for, '.repeat(4)}and a header row.`
  await hire($, `PLAN-DRAFT: ${long}\nPlan the export.`)
  await hire($, 'PLAN-DRAFT: Export scores. Then also read the docs first.\nPlan the export.')
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  expect(h.prompts[0]).toBe(`${long}\nPlan the export.${BRIEF_NOTE}${PLAN_DRAFT_NOTE}`)
  expect(h.prompts[1]).toBe(`Export scores. Then also read the docs first.\nPlan the export.${BRIEF_NOTE}${PLAN_DRAFT_NOTE}`)
  expect(h.prompts[2]).toBe(`Plan the export.${BRIEF_NOTE}${PLAN_DRAFT_NOTE}`)
  await end($, 'p1', 'STEP: a\nSTEP: b')
  expect(planFiles(h)).toHaveLength(1) // the title was cut to a size a plan can hold, and the plan was made
})

test('PLAN-DRAFT: on an agent that is not the Planner works the same: it is the line that asks, not the type', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.', { subagentType: 'general-purpose' })
  expect(h.prompts[0]).toBe(`Plan the export.${BRIEF_NOTE}${PLAN_DRAFT_NOTE}`)
  await end($, 'p1')
  expect(planFiles(h)).toEqual([SCORES])
})

test('a draft another session spent cannot come back: the store is read again, not a copy held here', async ($, on) => {
  const h = office(on, { [SCORES]: THREE })
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Add XLSX\nPlan XLSX.')
  await end($, 'p1', 'STEP: Pick a library\nSTEP: Write it')
  expect(JSON.stringify(h.saved.get(DRAFT_KEY))).toContain('Add XLSX')
  h.saved.set(DRAFT_KEY, null) // a copy of this session's (a hot reload ran another copy of the plugin) started it and spent it
  expect((await plan($, { op: 'later', text: 'Tidy' })).result).not.toContain('waiting')
  expect(h.saved.get(DRAFT_KEY)).toBeNull()
})

test('a plan the office started by itself is told to Clawd once on his next plan answer, and the store keeps nothing after', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.')
  await end($, 'p1')
  expect((await plan($, { op: 'later', text: 'Tidy' })).result).toContain("The Planner's plan for Export scores was started: 3 steps.")
  expect((await plan($, { op: 'later', text: 'Tidy more' })).result).not.toContain('was started')
  expect(h.saved.get(DRAFT_KEY)).toBeNull()
})

test('a workflow agent keeps its prompt as the script wrote it, and files nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN-DRAFT: Export scores\nPlan the export.', { workflow: { name: 'w', index: 0 } })
  expect(h.prompts[0]).toBe('PLAN-DRAFT: Export scores\nPlan the export.')
  await end($, 'p1')
  expect(planFiles(h)).toEqual([])
})
