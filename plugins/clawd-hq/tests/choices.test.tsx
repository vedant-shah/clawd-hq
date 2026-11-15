import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Employee } from '../types'
import { withChoices } from '../hooks/staff-model'
import { parseHistory } from '../hooks/history'
import type { RunRecord } from '../hooks/history'
import { CLEAR, PANE, SURFACES, START, host, mountLog } from './host'
import { planFs } from './plan-disk'

// The key choices a specialist reports (its DECIDED lines): kept with its run (counted on its record in the history; a plan step's go under
// the step), never drawn in Other work, whose rows are one line each. They are not filed in a decisions file or a Decisions tab.

const REPORT = 'Done.\nDECIDED: Use Drizzle for migrations — typed and light\n- DECIDED: Keep the scores table flat — one join less\nQUESTION: Ship Friday? | Yes / No | recommend: Yes'
const DECISIONS_FILE = '/repo/.clawd-hq/decisions.md'

function office(on: Parameters<typeof host>[0]) {
  const h = host(on, [])
  planFs(on, h.files)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `c${(n += 1)}` }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  return h
}
const hire = ($: Engine, name?: string, goal?: string) =>
  $.agent.spawn({ prompt: `${goal ? `PAIR-UP: ${goal}\n` : ''}Plan storage`, description: 'Plan storage', subagentType: 'ecc:planner', ...(name ? { name } : {}) } as never)
const finish = ($: Engine, id: string, answer: string, reason = 'answer') =>
  $.turn.complete({ reason, answer, turnId: `t-${id}`, agentId: id, isAborted: false } as never)
const logTexts = async ($: Engine, surface: 'terminal' | 'desktop') => {
  const ui = await mountLog($, surface)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return texts
}
/** The run records written so far (the session's end writes what waits). */
async function runsOf($: Engine, h: ReturnType<typeof office>): Promise<RunRecord[]> {
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
  const text = [...h.files.entries()].filter(([path]) => path.includes('/.clawd-hq/history')).map(([, t]) => t).join('\n')
  return parseHistory(text).filter((r): r is RunRecord => r.kind === 'run')
}

test('a finished job\'s DECIDED lines are counted on its run record; Other work shows its one line and none of their words, on both surfaces', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($)
  await finish($, 'c1', REPORT)
  for (const surface of SURFACES) {
    const texts = await logTexts($, surface)
    expect(texts.some(t => t.includes('Plan storage')), surface).toBe(true)
    expect(texts.filter(t => /Decided|Drizzle/.test(t)), surface).toEqual([])
  }
  expect((await runsOf($, h)).map(r => r.choices)).toEqual([2])
})

test('the notes are not filed anywhere: no decisions file is written, no Decisions entry, and nothing is stored', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($)
  await finish($, 'c1', REPORT)
  expect(h.files.has(DECISIONS_FILE)).toBe(false)
  expect(h.toasts.filter(t => /decisions/i.test(t))).toEqual([])
  expect([...h.saved.keys()].filter(k => /decision|memory|choice/i.test(k))).toEqual([])
})

test('a job with no DECIDED line counts none; a failed job\'s choices still count', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($)
  await hire($)
  await finish($, 'c1', 'Done. Nothing to decide.')
  await finish($, 'c2', 'It broke.\nDECIDED: Stop here — the schema is missing', 'error')
  const runs = await runsOf($, h)
  expect(runs.map(r => [r.run, r.outcome, r.choices])).toEqual(expect.arrayContaining([['c1', 'done', 0], ['c2', 'failed', 1]]))
})

test('a hand-back repeated by a resumed run adds new notes and not the same one twice, five at most', () => {
  const one = { id: 'c1', type: 'ecc:planner', description: 'Plan storage', mood: 'done', tools: 0, startedAt: 0, joinedTick: 0 } as Employee
  const first = withChoices(one, ['A', 'B'])
  const again = withChoices(first, ['b', 'C', 'D', 'E', 'F'])
  expect(again.choices).toEqual(['B', 'C', 'D', 'E', 'F'])
})

test('a pair-up\'s members are a line each in Other work, with none of their notes', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'author', 'Plan the storage')
  await hire($, 'critic', 'Plan the storage')
  await finish($, 'c1', 'DECIDED: Use Drizzle — typed')
  await finish($, 'c2', 'DECIDED: Keep the table flat — simple')
  for (const surface of SURFACES) {
    const ui = await mountLog($, surface)
    const lines = (await ui.findAll({})).filter(n => String(n.props.key ?? '').startsWith('history-run-'))
    const notes = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => /Decided|Drizzle/.test(t))
    await ui.unmount()
    expect(lines, surface).toHaveLength(2)
    expect(notes, surface).toEqual([])
  }
})

test('the notes are shown nowhere: not on the Office tab, not in Other work, before or after a /clear', async ($, on) => {
  const { clock } = office(on)
  await $.session.start(START)
  await hire($)
  await finish($, 'c1', REPORT)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect((await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => t.startsWith('Decided:'))).toEqual([])
  await ui.unmount()
  await clock.advance(60_000)
  await $.session.end(CLEAR)
  expect((await logTexts($, 'terminal')).filter(t => t.startsWith('Decided:'))).toEqual([])
})
