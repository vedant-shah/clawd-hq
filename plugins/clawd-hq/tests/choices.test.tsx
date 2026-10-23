import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { CLEAR, PANE, SURFACES, START, host, mountLog } from './host'

// The key choices a specialist reports (its DECIDED lines) sit on that job's row in Settings > Finished this session, for the
// session only. They are no longer filed in a decisions file or a Decisions tab.

const REPORT = 'Done.\nDECIDED: Use Drizzle for migrations — typed and light\n- DECIDED: Keep the scores table flat — one join less\nQUESTION: Ship Friday? | Yes / No | recommend: Yes'
const DECISIONS_FILE = '/repo/.clawd-hq/decisions.md'

function office(on: Parameters<typeof host>[0]) {
  const h = host(on, [])
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

test('a finished job\'s row lists its DECIDED lines, whole and wrapped, on both surfaces', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($)
  await finish($, 'c1', REPORT)
  for (const surface of SURFACES) {
    const texts = await logTexts($, surface)
    const notes = texts.filter(t => /Drizzle|scores table/.test(t))
    expect(notes).toEqual(['Decided: Use Drizzle for migrations — typed and light', 'Decided: Keep the scores table flat — one join less'])
    expect(notes.join('')).not.toMatch(/…/)
  }
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

test('a job with no DECIDED line shows no notes line; a failed job\'s notes still show', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($)
  await hire($)
  await finish($, 'c1', 'Done. Nothing to decide.')
  await finish($, 'c2', 'It broke.\nDECIDED: Stop here — the schema is missing', 'error')
  const texts = await logTexts($, 'terminal')
  expect(texts.filter(t => t.startsWith('Decided:'))).toEqual(['Decided: Stop here — the schema is missing'])
})

test('a hand-back repeated by a resumed run adds new notes and not the same one twice, five at most', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($)
  await finish($, 'c1', 'DECIDED: A\nDECIDED: B')
  await finish($, 'c1', 'DECIDED: b\nDECIDED: C\nDECIDED: D\nDECIDED: E\nDECIDED: F')
  const texts = (await logTexts($, 'terminal')).filter(t => t.startsWith('Decided:'))
  expect(texts).toEqual(['Decided: B', 'Decided: C', 'Decided: D', 'Decided: E', 'Decided: F'])
})

test('the notes of a pair-up show on its finished card, from both members', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'author', 'Plan the storage')
  await hire($, 'critic', 'Plan the storage')
  await finish($, 'c1', 'DECIDED: Use Drizzle — typed')
  await finish($, 'c2', 'DECIDED: Keep the table flat — simple')
  for (const surface of SURFACES) {
    const ui = await mountLog($, surface)
    expect((await ui.findAll({})).map(n => String(n.props.key ?? ''))).toContain('done-pair-c1')
    const notes = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).filter(t => t.startsWith('Decided:'))
    expect(notes).toEqual(['Decided: Use Drizzle — typed', 'Decided: Keep the table flat — simple'])
    await ui.unmount()
  }
})

test('the notes belong to the finished list: the Office tab shows none, and a /clear empties the list with them', async ($, on) => {
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
