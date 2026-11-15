import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { cellWidth } from '../hooks/wrap-to'
import { SETTINGS, PANE, START, SURFACES, host, paneProps } from './host'
import { planFs } from './plan-disk'

// The History tab (design: the History boards, terminal at 60 columns and desktop), drawn from the project's history files: the goal in hand,
// the goals that ended (folded, opened to their steps, Decided lines, retries, failures and pages; a set-aside goal with Resume), the work
// done off the plan, and the artifacts moved here from the Office tab.

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = 1_000 + 10 * DAY
const DIR = '/repo/.clawd-hq'
const HISTORY = paneProps('clawd-hq-history', 'History')
const PAGE = 'https://claude.ai/artifact/page1'
type Surface = (typeof SURFACES)[number]

const base = (kind: string, at: number, over: Record<string, unknown> = {}) => ({ v: 1, at, kind, session: 'old', ...over })
const goalEnd = (slug: string, title: string, at: number, over: Record<string, unknown> = {}) => base('goal_end', at, {
  goal: slug, title, outcome: 'done', startedAt: at - 3 * HOUR, stepsDone: 1, stepsTotal: 1, runs: 1, failedRuns: 0, workMs: 60_000,
  steps: [{ id: 's1', text: 'Do it', isDone: true, choices: [], retries: 0, lastOutcome: 'done' }], ...over,
})
const runRec = (id: string, at: number, over: Record<string, unknown> = {}) => base('run', at, {
  run: id, type: 'clawd-hq:core-researcher', name: 'Researcher', task: 'Find the CSV limits in Excel', startedAt: at - 60_000, endedAt: at, outcome: 'done',
  endedBy: 'signal', tools: 3, tokens: { inPeak: 1000, out: 100, in: 500, cached: 400, cacheWrite: 100 }, choices: 0, questions: 0, notes: 0, isRetry: false, ...over,
})
/** The boards' two goals: one done with a retry and a page, one set aside with a failed step. */
const LOGIN = goalEnd('fix-the-login-timeout', 'Fix the login timeout', NOW - 2 * HOUR, {
  summary: 'Sessions stay open as long as the mobile app\'s.', stepsDone: 4, stepsTotal: 4, runs: 5, workMs: 38 * 60_000,
  steps: [
    { id: 's1', text: 'Find why sessions end early', isDone: true, choices: [], retries: 0, lastOutcome: 'done' },
    { id: 's2', text: 'Change the timeout setting', isDone: true, choices: ['30 minutes, to match the mobile app'], retries: 0, lastOutcome: 'done' },
    { id: 's3', text: 'Tests for long sessions', isDone: true, choices: [], retries: 1, lastOutcome: 'done' },
    { id: 's4', text: 'Review', isDone: true, choices: [], retries: 0, lastOutcome: 'done' },
  ],
  artifacts: [{ url: PAGE, title: 'Timeout options compared' }],
})
const MOVE = goalEnd('move-scores-to-a-new-table', 'Move scores to a new table', NOW - 3 * DAY, {
  outcome: 'stopped', stepsDone: 2, stepsTotal: 5, runs: 3, workMs: 21 * 60_000,
  steps: [
    { id: 's1', text: 'Plan the move', isDone: true, choices: [], retries: 0, lastOutcome: 'done' },
    { id: 's2', text: 'Write the new table', isDone: true, choices: [], retries: 0, lastOutcome: 'done' },
    { id: 's3', text: 'Copy the old scores across', isDone: false, choices: [], retries: 0, lastOutcome: 'failed' },
    { id: 's4', text: 'Switch the page to the new table', isDone: false, choices: [] , retries: 0 },
    { id: 's5', text: 'Review', isDone: false, choices: [], retries: 0 },
  ],
})
/** The runs that made the login goal: five, 210K tokens in all. */
const LOGIN_RUNS = [1, 2, 3, 4, 5].map(n => runRec(`g${n}`, NOW - 2 * HOUR - n * 60_000, { goal: 'fix-the-login-timeout', step: 's1', tokens: { inPeak: 40_000, out: 2_000, in: 20_000, cached: 20_000, cacheWrite: 0 } }))
const lines = (records: readonly unknown[]) => records.map(r => JSON.stringify(r)).join('\n') + '\n'

type Seed = { records?: readonly unknown[]; store?: Record<string, unknown>; plan?: string }
function office(on: Parameters<typeof host>[0], seed: Seed = {}) {
  const h = host(on, [], seed.store ?? {})
  planFs(on, h.files)
  on('session.id', () => ({ value: 'now' }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const fills: Array<{ text: string; mode: string }> = []
  const submits: string[] = []
  on('prompt.fill', (_$, e) => (fills.push({ text: (e as { text: string }).text, mode: (e as { mode: string }).mode }), { isFilled: true }) as never)
  on('prompt.submit', (_$, e) => (submits.push((e as { text: string }).text), { text: (e as { text: string }).text }) as never)
  if (seed.records) h.files.set(`${DIR}/history-old.jsonl`, lines(seed.records))
  if (seed.plan) h.files.set(`${DIR}/plans/export-scores-as-csv.md`, seed.plan)
  return { ...h, fills, submits }
}
async function begin($: Engine, h: ReturnType<typeof office>) {
  await h.clock.advance(NOW - 1_000)
  await $.session.start(START)
}

/** The History tab as drawn: its texts, the terminal's rows, the keys, the buttons' labels by key, the links, and the tree. */
async function view($: Engine, surface: Surface, columns = 60, pane = HISTORY) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps(pane.requestId, (pane.props as { title: string }).title, { bodyColumns: columns }) })
  const all = await ui.findAll({ type: 'Text' })
  // Every Text and every button's words, in the order drawn: a goal's title and a fold's label are buttons.
  const texts = (await ui.findAll({})).filter(n => n.type === 'Text' || n.type === 'Button').map(n => String(n.type === 'Button' ? n.props.label ?? n.text ?? '' : n.text))
  const rows = all.filter(t => t.props.wrap === 'truncate-end').map(t => String(t.text))
  const keys = (await ui.findAll({})).map(n => String(n.props.key ?? ''))
  const buttons = new Map((await ui.findAll({ type: 'Button' })).map(b => [String(b.props.key ?? b.props.label ?? ''), String(b.props.label ?? b.text ?? '')]))
  // The test kit spells a link as its address and then its words: the words are what is drawn.
  const links = (await ui.findAll({ type: 'Link' })).map(l => ({ href: String(l.props.href), text: String(l.text ?? '').replace(String(l.props.href), '') }))
  const svgs = await ui.findAll({ type: 'Svg' })
  const red = all.filter(t => t.props.color === '#e05d5d' || t.props.color === '#ee8a8a').map(t => String(t.text))
  const amber = all.filter(t => t.props.color === '#e0a83a').map(t => String(t.text))
  await ui.unmount()
  return { texts, rows, keys, buttons, links, svgs, red, amber, text: texts.join('\n') }
}
async function press($: Engine, surface: Surface, key: string) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...HISTORY })
  if ((await ui.find({ key })) === undefined) throw new Error(`no ${key}`)
  await ui.press({ key })
  await ui.unmount()
}
const GOAL = (slug: string, at: number) => `history-goal-${slug}-${at}`
const inOrder = (text: string, ...parts: string[]) => parts.map(p => text.indexOf(p)).every((n, i, all) => n >= 0 && (i === 0 || n > all[i - 1]!))

// ---- The tabs ----

test('four tabs in order: Office, People, History, Settings; /office names them', async ($, on) => {
  const h = office(on)
  const answer = await $.command.run({ command: 'office', args: '' } as never) as { text?: string }
  expect(h.opened.slice(0, 4).map(o => [o.id, o.title])).toEqual([['clawd-hq', 'Office'], ['clawd-hq-people', 'People'], ['clawd-hq-history', 'History'], ['clawd-hq-settings', 'Settings']])
  expect(answer.text).toMatch(/Office · People · History · Settings/)
})

// ---- A finished goal from a previous session ----

test('a goal finished in an earlier session is one folded line; opened, its summary, totals, steps, Decided line, retry and page', async ($, on) => {
  const h = office(on, { records: [...LOGIN_RUNS, LOGIN] })
  await begin($, h)
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(inOrder(closed.text, 'FINISHED', 'Fix the login timeout', '2h ago'), surface).toBe(true)
    expect(closed.text, surface).not.toContain('Find why sessions end early')
    await press($, surface, GOAL('fix-the-login-timeout', LOGIN.at))
    const open = await view($, surface)
    expect(inOrder(open.text, 'Fix the login timeout', 'Summary: Sessions stay open', '4 steps · 5 agents · 38m · 210K tokens',
      'Find why sessions end early', 'Change the timeout setting', 'Decided: 30 minutes, to match the mobile app', 'Tests for long sessions', 'Review', '1 page made:'), surface).toBe(true)
    expect(open.amber, surface).toContain('1 retry')
    expect(open.links, surface).toContainEqual({ href: PAGE, text: 'Timeout options compared' })
    await press($, surface, GOAL('fix-the-login-timeout', LOGIN.at))
  }
})

test('on the desktop an open goal is a bordered card in the board\'s colour; the terminal keeps its rail', async ($, on) => {
  const h = office(on, { records: [LOGIN] })
  await begin($, h)
  await press($, 'desktop', GOAL('fix-the-login-timeout', LOGIN.at))
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...HISTORY })
  const card = await ui.find({ key: `history-card-fix-the-login-timeout-${LOGIN.at}` })
  await ui.unmount()
  expect(card?.props).toMatchObject({ borderStyle: 'round', borderColor: '#454542' })
  const terminal = await view($, 'terminal')
  expect(terminal.rows.filter(r => r.startsWith('│')).length).toBeGreaterThan(4)
})

// ---- A goal set aside ----

test('a set-aside goal reads "◌ <title> · set aside"; opened, its failed step is red, and Resume fills the prompt box and sends nothing', async ($, on) => {
  const h = office(on, { records: [MOVE] })
  await begin($, h)
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.text, surface).toMatch(/◌[\s\S]*Move scores to a new table[\s\S]*· set aside/)
    expect(closed.text, surface).toContain('3d ago')
    await press($, surface, GOAL('move-scores-to-a-new-table', MOVE.at))
    const open = await view($, surface)
    expect(open.text, surface).toContain('2 of 5 steps done · 3 agents · 21m')
    expect(open.red, surface).toEqual(expect.arrayContaining(['✗', 'failed']))
    expect(open.buttons.get(`history-resume-move-scores-to-a-new-table-${MOVE.at}`), surface).toBe('Resume')
    await press($, surface, `history-resume-move-scores-to-a-new-table-${MOVE.at}`)
    await press($, surface, GOAL('move-scores-to-a-new-table', MOVE.at))
  }
  expect(h.submits).toEqual([])
  expect(h.fills).toHaveLength(2)
  for (const fill of h.fills) {
    expect(fill.mode).toBe('append')
    expect(fill.text).toMatch(/Move scores to a new table/)
    expect(fill.text).toMatch(/Copy the old scores across[\s\S]*Switch the page to the new table[\s\S]*Review/)
    expect(fill.text).not.toMatch(/Plan the move|Write the new table/)
  }
})

// ---- In progress ----

const PLAN_TEXT = '# Export scores as CSV\n\n- [x] A  <!-- s1 -->\n- [x] B  <!-- s2 -->\n- [x] C  <!-- s3 -->\n- [ ] D  <!-- s4 -->\n- [ ] E  <!-- s5 -->\n- [ ] F  <!-- s6 -->\n<!-- started: 500 -->\n'

test('IN PROGRESS shows the goal in hand with "3 of 6 done"', async ($, on) => {
  const h = office(on, { plan: PLAN_TEXT })
  await begin($, h)
  for (const surface of SURFACES) expect(inOrder((await view($, surface)).text, 'IN PROGRESS', 'Export scores as CSV', '3 of 6 done'), surface).toBe(true)
})

test('with no goal in hand there is no IN PROGRESS', async ($, on) => {
  const h = office(on, { records: [LOGIN] })
  await begin($, h)
  for (const surface of SURFACES) expect((await view($, surface)).text, surface).not.toContain('IN PROGRESS')
})

test('with Clawd off there is no IN PROGRESS, though a plan file is there', { options: { chiefOfStaff: false } }, async ($, on) => {
  const h = office(on, { plan: PLAN_TEXT, records: [LOGIN] })
  await begin($, h)
  for (const surface of SURFACES) expect((await view($, surface)).text, surface).not.toContain('IN PROGRESS')
})

// ---- Other work ----

test('Other work is folded with its count; opened, each run is a row with its name, task and age, a failed one red', async ($, on) => {
  const failed = runRec('t1', NOW - DAY - HOUR, { name: 'Tester', task: 'Check the old import', outcome: 'failed' })
  const h = office(on, { records: [runRec('r1', NOW - 2 * HOUR), runRec('r2', NOW - 3 * HOUR, { name: 'Designer', task: 'Look at the button spacing' }), failed] })
  await begin($, h)
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.text, surface).toContain('Other work · 3')
    expect(closed.text, surface).not.toContain('Find the CSV limits in Excel')
    await press($, surface, 'history-other')
    const open = await view($, surface)
    expect(inOrder(open.text, 'Researcher', 'Find the CSV limits in Excel', '2h ago', 'Designer', 'Look at the button spacing', 'Tester', 'Check the old import'), surface).toBe(true)
    expect(open.red.join(' '), surface).toMatch(/failed · 1d ago/)
    await press($, surface, 'history-other')
  }
})

test('this session\'s finished runs are one line each, as earlier ones are; the runs of a goal are not other work', async ($, on) => {
  const h = office(on, { records: [...LOGIN_RUNS, LOGIN, runRec('r1', NOW - DAY - HOUR, { name: 'Designer', task: 'Look at the button spacing' })] })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'p1' }) as never)
  await begin($, h)
  await $.agent.spawn({ prompt: 'Look around.', description: 'Look around the code', subagentType: 'clawd-hq:core-builder', name: 'builder' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.\nDECIDED: keep the old names — simpler', turnId: 't1', agentId: 'p1', isAborted: false } as never)
  for (const surface of SURFACES) {
    await press($, surface, 'history-other')
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...HISTORY })
    const lines = (await ui.findAll({})).filter(n => String(n.props.key ?? '').startsWith('history-run-'))
    const fold = await ui.find({ key: 'history-other' })
    await ui.unmount()
    expect(fold?.props.label, surface).toBe('▾ Other work · 2')
    expect(lines.map(n => n.props.key), surface).toEqual([expect.stringMatching(/^history-run-p1@/), expect.stringMatching(/^history-run-r1@/)])
    const v = await view($, surface)
    expect(inOrder(v.text, 'Builder', 'Look around the code', 'just now', 'Designer', 'Look at the button spacing', '1d ago'), surface).toBe(true)
    await press($, surface, 'history-other')
  }
})

test('Other work never shows a picture or a Decided line; a council\'s voices are a line each', async ($, on) => {
  const h = office(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `v${(n += 1)}` }) as never)
  await begin($, h)
  for (const role of ['skeptic', 'pragmatist']) await $.agent.spawn({ prompt: `COUNCIL: SQLite or Postgres?\nYou are the ${role}.`, description: `Weigh it as the ${role}`, subagentType: 'clawd-hq:core-researcher', name: role } as never)
  for (const id of ['v1', 'v2']) await $.turn.complete({ reason: 'answer', answer: 'SQLite.\nDECIDED: SQLite — one writer', turnId: `t-${id}`, agentId: id, isAborted: false } as never)
  for (const surface of SURFACES) {
    await press($, surface, 'history-other')
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...HISTORY })
    const rows = await ui.find({ key: 'history-other-rows' })
    const pictures = (await ui.findAll({ type: 'Svg' })).length + (await ui.findAll({ type: 'Raster' })).length
    const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
    const lines = (await ui.findAll({})).filter(x => String(x.props.key ?? '').startsWith('history-run-'))
    await ui.unmount()
    expect(rows, surface).toBeDefined()
    expect(pictures, surface).toBe(0)
    expect(texts.some(t => /Decided/.test(t)), surface).toBe(false)
    expect(lines, surface).toHaveLength(2)
    await press($, surface, 'history-other')
  }
})

// ---- Artifacts ----

const ARTIFACTS = { 'artifacts:/repo': [{ url: PAGE, title: 'Timeout options compared', at: NOW - 2 * HOUR }, { url: 'https://claude.ai/artifact/page2', title: 'Export format notes', at: NOW - DAY }] }

test('Artifacts is folded with its count; opened, the pages as links with Hide, which still works from here; the Office tab has none', async ($, on) => {
  const h = office(on, { store: ARTIFACTS })
  await begin($, h)
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.text, surface).toContain('Artifacts · 2')
    expect(closed.links, surface).toEqual([])
    const office$ = await view($, surface, 60, PANE)
    expect(office$.text, surface).not.toMatch(/ARTIFACTS|Timeout options compared/)
  }
  await press($, 'desktop', 'history-artifacts')
  const open = await view($, 'desktop')
  expect(open.links.map(l => l.text)).toEqual(['Timeout options compared', 'Export format notes'])
  await press($, 'desktop', `artifact-hide-${PAGE}`)
  for (let i = 0; i < 20; i += 1) await h.clock.advance(0)
  expect((await view($, 'desktop')).links.map(l => l.text)).toEqual(['Export format notes'])
  expect(h.saved.get('artifacts:/repo')).toEqual([expect.objectContaining({ title: 'Export format notes' })])
})

// ---- Older items ----

test('past 20 goals and 40 other runs: "N older · show", which opens them', async ($, on) => {
  const goals = Array.from({ length: 23 }, (_, i) => goalEnd(`goal-${i}`, `Goal number ${i}`, NOW - (i + 1) * HOUR))
  const runs = Array.from({ length: 43 }, (_, i) => runRec(`r${i}`, NOW - (i + 1) * 60_000, { task: `Task number ${i}` }))
  const h = office(on, { records: [...goals, ...runs] })
  await begin($, h)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text, surface).toContain('Goal number 19')
    expect(v.text, surface).not.toContain('Goal number 20')
    expect(v.text, surface).toContain('3 older')
    expect(v.buttons.get('history-goals-older'), surface).toBe('show')
  }
  await press($, 'terminal', 'history-goals-older')
  await press($, 'terminal', 'history-other')
  const v = await view($, 'terminal')
  expect(v.text).toContain('Goal number 22')
  expect(v.buttons.get('history-goals-older')).toBe('hide')
  expect(v.text).toContain('Task number 39')
  expect(v.text).not.toContain('Task number 40')
  expect(v.buttons.get('history-other-older')).toBe('show')
  await press($, 'terminal', 'history-other-older')
  expect((await view($, 'terminal')).text).toContain('Task number 42')
})

// ---- Empty ----

test('with nothing finished: "Nothing has finished yet in this project."', async ($, on) => {
  const h = office(on)
  await begin($, h)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text, surface).toContain('Nothing has finished yet in this project.')
    expect(v.text, surface).not.toMatch(/FINISHED|Other work|Artifacts/)
  }
})

// ---- Narrow ----

test('at 40 columns an open goal on the terminal is wrapped to the width, and every row of it carries the rail', async ($, on) => {
  const long = goalEnd('a-long-goal', 'A goal', NOW - HOUR, {
    summary: 'A summary that is long enough to need more than one row at forty columns wide.', stepsDone: 1, stepsTotal: 1,
    steps: [{ id: 's1', text: 'A step whose words are long enough to wrap onto a second row', isDone: true, choices: ['a choice long enough to wrap onto a second row too'], retries: 2, lastOutcome: 'done' }],
    artifacts: [{ url: PAGE, title: 'A page with a long title that will not fit in forty columns' }],
  })
  const h = office(on, { records: [long] })
  await begin($, h)
  await press($, 'terminal', GOAL('a-long-goal', long.at))
  const v = await view($, 'terminal', 40)
  const inside = v.rows.slice(v.rows.findIndex(r => r.includes('Summary:')))
  const end = inside.findIndex(r => !r.startsWith('│'))
  const card = end === -1 ? inside : inside.slice(0, end)
  expect(card.length).toBeGreaterThan(6)
  // A link's row is cut by the tab to the width; the test kit spells out the link's address in the row's text, so its title is measured.
  for (const row of card.filter(r => !r.includes('https://'))) expect(cellWidth(row), row).toBeLessThanOrEqual(40)
  expect(cellWidth(v.links.find(l => l.href === PAGE)!.text)).toBeLessThanOrEqual(37)
  expect(v.texts).toContain('2 retries') // drawn at the right of its step's row
  expect(v.links.map(l => l.href)).toContain(PAGE)
})

// ---- Pictures, Settings ----

test('no picture on the desktop History tab has an empty description', async ($, on) => {
  const h = office(on, { records: [...LOGIN_RUNS, LOGIN, MOVE, runRec('r1', NOW - HOUR)], store: ARTIFACTS })
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'p1' }) as never)
  await begin($, h)
  await $.agent.spawn({ prompt: 'Look around.', description: 'Look around', subagentType: 'clawd-hq:core-builder' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', agentId: 'p1', isAborted: false } as never)
  for (const key of [GOAL('fix-the-login-timeout', LOGIN.at), GOAL('move-scores-to-a-new-table', MOVE.at), 'history-other', 'history-artifacts']) await press($, 'desktop', key)
  const v = await view($, 'desktop')
  expect(v.svgs.filter(s => String(s.props.alt ?? '').trim() === '')).toEqual([])
})

test('Settings has no list of finished work any more', async ($, on) => {
  const h = office(on)
  await begin($, h)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...SETTINGS })
    expect(await ui.find({ key: 'settings-log' }), surface).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Finished this session|FINISHED THIS SESSION/ }), surface).toBeUndefined()
    await ui.unmount()
  }
})

// ---- The boards' details ----

type Node = { type?: string; props: Record<string, unknown>; text?: unknown }
const colorOf = (nodes: readonly Node[], text: string) => nodes.find(n => n.type === 'Text' && String(n.text) === text)?.props.color

test('the terminal board\'s colours: ✓ #8fb597, ✗ and "failed" #ee8a8a, "1 retry" amber; the rail green #3f6a48 for a goal done, grey #5a5a55 set aside', async ($, on) => {
  const h = office(on, { records: [LOGIN, MOVE] })
  await begin($, h)
  for (const key of [GOAL('fix-the-login-timeout', LOGIN.at), GOAL('move-scores-to-a-new-table', MOVE.at)]) await press($, 'terminal', key)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...HISTORY })
  const nodes = await ui.findAll({}) as Node[]
  await ui.unmount()
  const texts = nodes.filter(n => n.type === 'Text')
  expect(new Set(texts.filter(n => String(n.text) === '✓').map(n => n.props.color))).toEqual(new Set(['#8fb597']))
  expect(colorOf(nodes, '✗')).toBe('#ee8a8a')
  expect(colorOf(nodes, 'failed')).toBe('#ee8a8a')
  expect(colorOf(nodes, '1 retry')).toBe('#e0a83a')
  const rails = new Set(texts.filter(n => /^│ *$/.test(String(n.text))).map(n => n.props.color)) // the rail's own pieces
  expect(rails).toEqual(new Set(['#3f6a48', '#5a5a55']))
})

test('the desktop board: ✓ #6bbf7a, the open goal a padded card in #454542, the folds "md" under the goals with no bordered box for a line', async ($, on) => {
  const h = office(on, { records: [LOGIN, runRec('r1', NOW - HOUR)], store: ARTIFACTS })
  await begin($, h)
  await press($, 'desktop', GOAL('fix-the-login-timeout', LOGIN.at))
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...HISTORY })
  const nodes = await ui.findAll({}) as Node[]
  const card = await ui.find({ key: `history-card-fix-the-login-timeout-${LOGIN.at}` })
  const rule = await ui.find({ key: 'history-rule' })
  const tab = (await ui.findAll({})).find(n => n.type === 'Box' && n.props.gap === 'md')
  await ui.unmount()
  expect(new Set(nodes.filter(n => n.type === 'Text' && String(n.text) === '✓').map(n => n.props.color))).toEqual(new Set(['#6bbf7a']))
  expect(card?.props).toMatchObject({ borderStyle: 'round', borderColor: '#454542', paddingX: 1, paddingY: 1, gap: 'sm' })
  // The host draws every side of a bordered box: an empty one would be a rectangle, not the board's line. The "md" gap sets the folds off.
  expect(rule).toBeUndefined()
  expect(tab).toBeDefined()
})

test('an open goal\'s title and an open fold\'s line are bold, as the boards draw them; closed, a fold\'s line is dim', async ($, on) => {
  const h = office(on, { records: [LOGIN, runRec('r1', NOW - HOUR)] })
  await begin($, h)
  for (const surface of SURFACES) {
    const before = await $.ui.mount({ plugin: 'clawd-hq', surface, ...HISTORY })
    expect((await before.find({ key: 'history-other' }))?.props.dimColor, surface).toBe(true)
    await before.unmount()
    await press($, surface, GOAL('fix-the-login-timeout', LOGIN.at))
    await press($, surface, 'history-other')
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...HISTORY })
    const bold = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold === true).map(t => String(t.text))
    await ui.unmount()
    expect(bold, surface).toEqual(expect.arrayContaining(['Fix the login timeout', '▾ Other work · 1']))
    await press($, surface, GOAL('fix-the-login-timeout', LOGIN.at))
    await press($, surface, 'history-other')
  }
})

test('a goal that ended the day before says "yesterday", as the boards do; a run a day old says "1d ago"', async ($, on) => {
  const h = office(on, { records: [goalEnd('dark-mode', 'Add dark mode to settings', NOW - 30 * HOUR), runRec('r1', NOW - 30 * HOUR)] })
  await begin($, h)
  await press($, 'terminal', 'history-other')
  const v = await view($, 'terminal')
  expect(inOrder(v.text, 'Add dark mode to settings', 'yesterday', 'Researcher', '1d ago')).toBe(true)
})

test('past six artifacts: "N older · show", which shows them all, as the boards say', async ($, on) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ url: `https://claude.ai/artifact/page${i + 1}`, title: `Page ${i + 1}`, at: NOW - (i + 1) * HOUR }))
  const h = office(on, { store: { 'artifacts:/repo': many } })
  await begin($, h)
  for (const surface of SURFACES) {
    await press($, surface, 'history-artifacts')
    const v = await view($, surface)
    expect(v.links, surface).toHaveLength(6)
    expect(v.text, surface).toContain('2 older')
    expect(v.buttons.get('history-artifacts-older'), surface).toBe('show')
    await press($, surface, 'history-artifacts-older')
    expect((await view($, surface)).links, surface).toHaveLength(8)
    await press($, surface, 'history-artifacts-older')
    await press($, surface, 'history-artifacts')
  }
})

test('on the desktop every mark has a column of its own, two cells wide, so the titles and names after ✓, ◌, ● and ✗ start in one place', async ($, on) => {
  const failed = runRec('t1', NOW - DAY, { name: 'Tester', outcome: 'failed' })
  const h = office(on, { records: [LOGIN, MOVE, runRec('r1', NOW - HOUR), failed], plan: PLAN_TEXT })
  await begin($, h)
  await press($, 'desktop', 'history-other')
  await press($, 'desktop', GOAL('move-scores-to-a-new-table', MOVE.at))
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...HISTORY })
  const root = (await ui.drawn()) as unknown as { type: string; props: Record<string, unknown>; children?: unknown[] }
  await ui.unmount()
  type T = typeof root
  const kids = (t: T) => (t.children ?? []).filter((c): c is T => typeof c === 'object' && c !== null && 'props' in c)
  const marks: Array<{ glyph: string; width: unknown }> = []
  const visit = (t: T, parent?: T) => {
    const words = (t.children ?? []).filter(c => typeof c === 'string').join('')
    if (t.type === 'Text' && /^[✓◌●✗○]$/.test(words)) marks.push({ glyph: words, width: parent?.props.width })
    for (const c of kids(t)) visit(c, t)
  }
  visit(root)
  expect(new Set(marks.map(m => m.glyph))).toEqual(new Set(['●', '✓', '◌', '✗', '○']))
  expect(marks.filter(m => m.width !== 2)).toEqual([])
})

// ---- Safe, cheap reading ----

test('the history is not read while the History pane is hidden; it is read on its first draw once shown', async ($, on) => {
  const h = office(on, { records: [LOGIN] })
  await begin($, h)
  await $.command.run({ command: 'office', args: '' } as never) // the tabs open, the Office tab in front
  h.front.id = 'clawd-hq'
  const hidden = await view($, 'terminal')
  expect(h.reads.filter(p => p.includes('/history-'))).toEqual([])
  expect(hidden.text).not.toContain('Fix the login timeout')
  h.front.id = 'clawd-hq-history'
  expect((await view($, 'terminal')).text).toContain('Fix the login timeout')
  expect(h.reads.filter(p => p.includes('/history-')).length).toBeGreaterThan(0)
})

test('on the terminal no row carries a control or escape character, though a run\'s task had them', async ($, on) => {
  const h = office(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'p1' }) as never)
  await begin($, h)
  await $.agent.spawn({ prompt: 'Look around.', description: 'Look\naround\u001b[2J the\u0085 code‮', subagentType: 'clawd-hq:core-builder', name: 'builder' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 't1', agentId: 'p1', isAborted: false } as never)
  await press($, 'terminal', 'history-other')
  const v = await view($, 'terminal')
  expect(v.text).toContain('Look around [2J the code')
  for (const row of v.texts) expect(row, JSON.stringify(row)).not.toMatch(/[\u0000-\u001f\u007f-\u009f‪-‮]/)
})
