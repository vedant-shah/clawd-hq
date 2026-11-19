import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, SURFACES, START, host, paneProps } from './host'
import { cellWidth } from '../hooks/wrap-to'
import { ROOT, planFs } from './plan-disk'
import { skKey } from './fake-secrets'

// The Office tab with a goal in hand, on the terminal and on the desktop: the plan with who is at work under each step, the folds, the failed
// agent's Details, the Later fold, and the groups around it. The tab with no goal is today's, unchanged.

const PLAN = `${ROOT}/.clawd-hq/plans/export-scores.md`
const PLAN_TEXT = [
  '# Export scores as CSV', '',
  '- [x] Find how exports work now  <!-- s1 -->',
  '- [x] Plan the change  <!-- s2 -->', '  - Decided: one CSV file, not one for each class',
  '- [x] Add the export button  <!-- s3 -->',
  '- [ ] Tests for the export  <!-- s4 -->',
  '- [ ] Review  <!-- s5 -->',
  '- [ ] Update the README  <!-- s6 -->', '',
  '## Later', '', '- [ ] Add an XLSX option  <!-- l1 -->', '',
  // The host of these tests does not say its session, so it is "unknown", and so is the owner of this goal.
  '<!-- session: unknown -->', '',
].join('\n')
type Surface = (typeof SURFACES)[number]

/** A project with the plan file in it, hires that get the ids p1, p2, ... and the prompt box's fills recorded. */
function office(on: Parameters<typeof host>[0], files: Record<string, string> = { [PLAN]: PLAN_TEXT }, store: Record<string, unknown> = {}) {
  const h = host(on, [], store)
  for (const [path, text] of Object.entries(files)) h.files.set(path, text)
  planFs(on, h.files)
  let n = 0
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: (e as { resume?: { agentId: string } }).resume?.agentId ?? `p${(n += 1)}` }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  const fills: Array<{ text: string; mode: string }> = []
  const submits: string[] = []
  on('prompt.fill', (_$, e) => (fills.push({ text: (e as { text: string }).text, mode: (e as { mode: string }).mode }), { isFilled: true }) as never)
  on('prompt.submit', (_$, e) => (submits.push((e as { text: string }).text), { text: (e as { text: string }).text }) as never)
  return { ...h, fills, submits }
}
type Office = ReturnType<typeof office>

/** A hire whose task (the line the card shows) is the last line of its brief. */
const hire = ($: Engine, prompt: string, name = 'builder', extra: Record<string, unknown> = {}) => $.agent.spawn({ prompt, description: prompt.split('\n').pop(), subagentType: 'general-purpose', name, ...extra } as never)
const stop = ($: Engine, id: string, answer = 'Done.', reason = 'answer') => $.turn.complete({ reason, answer, turnId: `t-${id}-${reason}`, agentId: id, isAborted: false } as never)

/** The Office tab as drawn: every Text, the rows of the terminal's plan (its lines are `truncate-end`), the keys, and the buttons' labels by key. */
async function view($: Engine, surface: Surface, columns = 60) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq', 'Office', { bodyColumns: columns }) })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const rows = (await ui.findAll({ type: 'Text' })).filter(t => t.props.wrap === 'truncate-end').map(t => String(t.text))
  const keys = (await ui.findAll({})).map(n => String(n.props.key ?? ''))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => ({ key: String(b.props.key ?? b.key ?? ''), label: String(b.props.label ?? b.text ?? '') }))
  await ui.unmount()
  return { texts, rows, keys, buttons, text: texts.join('\n'), flat: (rows.length > 0 ? rows : texts).join(' ').replace(/[│\s]+/g, ' ') }
}
type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null && 'props' in c)
const walk = (node: Tree, hit: (t: Tree) => boolean): Tree[] => [...(hit(node) ? [node] : []), ...elementsOf(node).flatMap(c => walk(c, hit))]
const textIn = (node: Tree | string): string => (typeof node === 'string' ? node : (node.children ?? []).map(c => textIn(c as Tree | string)).join(''))

/** The whole width of every row of the terminal's plan that has an item at its right: what stands left, the one-cell gap, and the item. */
async function sideBySide($: Engine, columns: number) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq', 'Office', { bodyColumns: columns }) })
  const root = (await ui.drawn()) as unknown as Tree
  await ui.unmount()
  const rows = walk(root, t => t.type === 'Box' && t.props.justifyContent === 'space-between' && t.props.columnGap === 1 && t.props.flexWrap === undefined && elementsOf(t).length === 2 && elementsOf(t)[0]!.props.wrap === 'truncate-end')
  return rows.map(row => {
    const [left, right] = elementsOf(row)
    return { left: textIn(left!), right: right!.type === 'Button' ? String(right!.props.label) : textIn(right!), width: cellWidth(textIn(left!)) + 1 + cellWidth(right!.type === 'Button' ? String(right!.props.label) : textIn(right!)) }
  })
}
const labelOf = (v: Awaited<ReturnType<typeof view>>, key: string) => v.buttons.find(b => b.key === key)?.label
async function press($: Engine, surface: Surface, key: string, columns = 60) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq', 'Office', { bodyColumns: columns }) })
  if ((await ui.find({ key })) === undefined) throw new Error(`no ${key} button`)
  await ui.press({ key })
  await ui.unmount()
}
const order = (text: string, ...parts: string[]) => parts.map(p => text.indexOf(p))
const ascending = (list: number[]) => list.every((n, i) => n >= 0 && (i === 0 || n > list[i - 1]!))

// ---- No goal: the floor as it was ----

test('with no goal the floor and its empty state are what they were, and nothing of the plan is drawn', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts).toEqual(expect.arrayContaining(['THE FLOOR', 'No one at a desk yet.', 'Specialists appear here while they work.']))
    expect(v.text).not.toMatch(/PLAN|ALSO AT WORK|NEEDS YOU|LATER|WHERE WE LEFT OFF|office-council/)
  }
})

test('with no goal, specialists at work are on the floor as cards, headed "AT WORK · N"', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  await hire($, 'Fix the login bug')
  await hire($, 'Write the docs', 'writer')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts).toContain('AT WORK · 2')
    expect(v.keys).toEqual(expect.arrayContaining(['desk-p1', 'desk-p2', 'floor-rows']))
    expect(v.text).not.toMatch(/PLAN|ALSO AT WORK/)
  }
})

// ---- One agent on a step ----

test('one agent on a step: the plan, the done steps before the last folded, the last done step, the step with its agent, the next steps and the later line', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest the export.', 'tester')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    for (const words of ['Export scores as CSV', '3 of 6 done', 'Tests for the export', 'Review', 'Update the README']) expect(v.text).toContain(words)
    expect(v.text).toMatch(/2 steps done/)
    expect(v.text).toContain('1 at work')
    expect(v.text).not.toContain('Find how exports work now')
    expect(v.text).not.toContain('ALSO AT WORK')
    expect(ascending(order(v.text, 'PLAN', 'steps done', 'Add the export button', 'Tests for the export', 'Review', 'Update the README'))).toBe(true)
    expect(v.text).toMatch(/1 later/)
    if (surface === 'desktop') expect(v.keys).toContain('desk-p1') // the existing card
    else expect(v.keys.filter(k => k.startsWith('desk-'))).toEqual([]) // no card and no picture of an agent on the terminal
  }
})

test('the plan comes after Clawd\'s card and the cards that wait on the person, and before who else is at work and the artifacts', async ($, on) => {
  office(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'mcp__clawd-hq__offer_rule', rule: 'Always run the tests before a commit' } as never)
  await hire($, 'PLAN: s4\nTest it.', 'tester')
  await hire($, 'Look at spacing', 'designer')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts.some(t => t === 'NEEDS YOU · 1')).toBe(true)
    expect(ascending(order(v.text, 'Chief of Staff', 'NEEDS YOU · 1', 'LASTING RULE', 'PLAN', 'Tests for the export', 'ALSO AT WORK · 1'))).toBe(true)
  }
})

// ---- Six agents on a step, one failed ----

async function sixOnAStep($: Engine) {
  for (let i = 1; i <= 6; i += 1) await hire($, `PLAN: s4\nTest part ${i}.`, `tester ${i}`)
  await stop($, 'p1', 'It broke: there is no test database.', 'error')
}

test('six agents on a step, one failed: the failed one first and never folded, three working shown, the others counted', async ($, on) => {
  office(on)
  await $.session.start(START)
  await sixOnAStep($)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).toContain('5 at work · 1 failed')
    expect(v.text).toContain('2 more at work')
    expect(v.flat).toMatch(/Failed after \d+s: It broke: there is no test database\./)
    expect(labelOf(v, 'failed-p1-details')).toBe('Details')
    // The failed agent comes before the working ones.
    const at = (id: string) => v.keys.indexOf(surface === 'desktop' ? `desk-${id}` : `failed-${id}-details`)
    if (surface === 'desktop') {
      expect([at('p1'), at('p2'), at('p3'), at('p4')].every(i => i >= 0)).toBe(true)
      expect(ascending([at('p1'), at('p2'), at('p3'), at('p4')])).toBe(true)
      expect(v.keys).not.toContain('desk-p5')
      expect(v.keys).not.toContain('desk-p6')
    } else {
      expect(v.text).not.toMatch(/Test part 5/)
      expect(ascending(order(v.text, 'Test part 1', 'Test part 2', 'Test part 3', 'Test part 4'))).toBe(true)
    }
    expect(labelOf(v, 'more-s4-btn')).toBe('show')
  }
})

test('the fold "N more at work" opens to show every agent and closes again, on both surfaces', async ($, on) => {
  office(on)
  await $.session.start(START)
  await sixOnAStep($)
  for (const surface of SURFACES) {
    await press($, surface, 'more-s4-btn')
    const open = await view($, surface)
    expect(labelOf(open, 'more-s4-btn')).toBe('hide')
    expect(open.text).not.toContain('2 more at work')
    expect(open.text).toMatch(/Test part 5/)
    expect(open.text).toMatch(/Test part 6/)
    await press($, surface, 'more-s4-btn')
    const closed = await view($, surface)
    expect(labelOf(closed, 'more-s4-btn')).toBe('show')
    expect(closed.text).toContain('2 more at work')
  }
})

test('Details opens the failed agent in place: the whole reason and Retry and Ask Clawd, which fill the prompt box and send nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest the import.', 'tester')
  await $.turn.complete({ reason: 'error', answer: 'there is no test database to run against', turnId: 'x', agentId: 'p1', isAborted: false } as never)
  for (const surface of SURFACES) {
    expect(labelOf(await view($, surface), 'failed-p1-details')).toBe('Details')
    await press($, surface, 'failed-p1-details')
    const open = await view($, surface)
    expect(labelOf(open, 'failed-p1-details')).toBe('Hide')
    expect(open.flat).toMatch(/Failed after \d+s: there is no test database to run against/)
    expect(open.buttons.map(b => b.label)).toEqual(expect.arrayContaining(['Retry', 'Ask Clawd']))
    await press($, surface, 'failed-p1-retry')
    await press($, surface, 'failed-p1-ask')
    await press($, surface, 'failed-p1-details')
    expect(labelOf(await view($, surface), 'failed-p1-details')).toBe('Details')
  }
  expect(h.fills.map(f => f.mode)).toEqual(['append', 'append', 'append', 'append'])
  expect(h.fills[0]!.text).toMatch(/^Tester failed: there is no test database to run against\. Hire it again once that is fixed\.$/)
  expect(h.fills[1]!.text).toMatch(/^Tester failed: there is no test database to run against\. What went wrong, and what should we do about it\?$/)
  expect(h.submits).toEqual([])
})

test('a step whose only run failed needs attention, and the plan still shows the failed agent', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest it.', 'tester')
  await stop($, 'p1', 'Broke.', 'error')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).toContain('1 failed')
    expect(v.text).not.toContain('at work ·')
    expect(labelOf(v, 'failed-p1-details')).toBe('Details')
  }
})

// ---- Off the plan, and pair-ups ----

test('a run with no step is "Also at work", with the same card, and is not counted under a step', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest it.', 'tester')
  await hire($, 'Find the CSV limits in Excel', 'researcher')
  await hire($, 'PLAN: s9\nNot a step.', 'builder')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts).toContain('ALSO AT WORK · 2')
    expect(v.text).toContain('1 at work')
    expect(v.text).toContain('Find the CSV limits in Excel')
    if (surface === 'desktop') expect(v.keys).toEqual(expect.arrayContaining(['desk-p2', 'desk-p3']))
    expect(ascending(order(v.text, 'Update the README', 'ALSO AT WORK', 'Find the CSV limits'))).toBe(true)
  }
})

test('a pair-up on a step is one block under it, and counts as its members', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PAIR-UP: Ship the export\nPLAN: s4\nYou are the author.', 'author')
  await hire($, 'PAIR-UP: Ship the export\nPLAN: s4\nYou are the critic.', 'critic')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).toContain('2 at work')
    expect(v.text).not.toContain('ALSO AT WORK')
    expect(v.flat).toContain('Author & Critic')
    // One block: the title once in a row (on the terminal) or one card (on the desktop).
    if (surface === 'desktop') expect(v.keys).toContain('pair-p1')
    else expect(v.rows.filter(r => r.includes('Author & Critic'))).toHaveLength(1)
    expect(v.flat).toContain('Ship the export')
  }
})

test('under Also at work a pair-up with one member finished is still one pair card with its title, counted by the member at work', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest it.', 'tester')
  await hire($, 'PAIR-UP: Check the README\nYou are the author.', 'author')
  await hire($, 'PAIR-UP: Check the README\nYou are the critic.', 'critic')
  await stop($, 'p2')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts).toContain('ALSO AT WORK · 1')
    expect(v.flat).toContain('Author & Critic')
    expect(v.flat).toContain('Check the README')
    if (surface === 'desktop') {
      expect(v.keys).toContain('pair-p2')
      expect(v.keys).not.toContain('desk-p3') // the critic is not a lone plain card
    } else {
      expect(v.rows.filter(r => r.includes('Author & Critic'))).toHaveLength(1)
    }
  }
})

test('under Also at work a council with some voices finished is still one Council card, counted by the voices at work; with none at work it is gone', async ($, on) => {
  office(on)
  await $.session.start(START)
  const voices = ['skeptic', 'pragmatist', 'critic', 'architect']
  for (const voice of voices) await hire($, `COUNCIL: Which way?\nYou are the ${voice}.`, voice)
  await stop($, 'p1')
  await stop($, 'p2')
  await stop($, 'p3')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts).toContain('ALSO AT WORK · 1')
    expect(v.flat).toContain('Council Which way?')
    if (surface === 'desktop') {
      expect(v.keys).toContain('council-p1')
      for (const voice of ['Skeptic · Done', 'Pragmatist · Done', 'Critic · Done', 'Architect · Working']) expect(v.text).toContain(voice)
    }
  }
  await stop($, 'p4')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).not.toContain('ALSO AT WORK')
    expect(v.text).not.toContain('Council')
  }
})

// ---- The done fold ----

test('the done steps before the last are one line, "N steps done", that opens to a line for each with who did it, how long, the tokens and its choices', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest the export.', 'builder')
  await h.clock.advance(5_000)
  await stop($, 'p1', 'Added.')
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.text).toMatch(/3 steps done/)
    expect(labelOf(closed, 'done-fold-btn')).toBe('show')
    expect(closed.text).not.toContain('Plan the change')
    // The last finished step stands outside the fold, with who did it.
    expect(closed.text).toContain('Tests for the export')
    expect(closed.text).toMatch(/Builder · \d+[sm]/)
    await press($, surface, 'done-fold-btn')
    const open = await view($, surface)
    expect(labelOf(open, 'done-fold-btn')).toBe('hide')
    for (const words of ['Find how exports work now', 'Plan the change', 'Add the export button', 'Tests for the export']) expect(open.text).toContain(words)
    expect(open.text).toContain('Decided: one CSV file, not one for each class')
    expect(open.text).toMatch(/Builder · \d+[sm]/)
    await press($, surface, 'done-fold-btn')
    expect(labelOf(await view($, surface), 'done-fold-btn')).toBe('show')
  }
})

// ---- The next steps ----

test('the next steps: three are shown, the others folded into "N more steps", which opens and closes', async ($, on) => {
  const many = PLAN_TEXT.replace('- [ ] Update the README  <!-- s6 -->', ['- [ ] Update the README  <!-- s6 -->', '- [ ] Write the changelog  <!-- s7 -->', '- [ ] Tell the team  <!-- s8 -->', '- [ ] Close the tickets  <!-- s9 -->'].join('\n'))
  office(on, { [PLAN]: many })
  await $.session.start(START)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    for (const words of ['Tests for the export', 'Review', 'Update the README']) expect(v.text).toContain(words)
    expect(v.text).not.toContain('Write the changelog')
    expect(v.text).toContain('3 more steps')
    await press($, surface, 'more-steps-btn')
    const open = await view($, surface)
    for (const words of ['Write the changelog', 'Tell the team', 'Close the tickets']) expect(open.text).toContain(words)
    expect(labelOf(open, 'more-steps-btn')).toBe('hide')
    await press($, surface, 'more-steps-btn')
    expect((await view($, surface)).text).not.toContain('Write the changelog')
  }
})

// ---- Narrow panes, and the rail ----

const MARKS = /^[✓●○✗]/

test('at 40 columns every row of the plan is wrapped to the width and carries the rail or its mark; the later line is indented', async ($, on) => {
  office(on, { [PLAN]: PLAN_TEXT.replace('Tests for the export', 'Tests for the export of a very large file with many accents') })
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest the import round trip.', 'tester')
  await hire($, 'PLAN: s4\nTest a large file with fifty thousand rows.', 'tester')
  await stop($, 'p1', 'It stopped: there is no test database for the import round trip.', 'error')
  const v = await view($, 'terminal', 40)
  const start = v.rows.findIndex(r => MARKS.test(r))
  const end = v.rows.findIndex(r => /Update the README/.test(r))
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const inside = v.rows.slice(start, end + 1)
  for (const row of inside) {
    expect(cellWidth(row)).toBeLessThanOrEqual(40)
    expect(row.startsWith('│') || MARKS.test(row)).toBe(true)
  }
  // The long step and the long reason were wrapped by this code, so each of their rows has the rail.
  expect(inside.filter(r => r.startsWith('│') && /accents|large file with|many/.test(r)).length).toBeGreaterThan(0)
  expect(inside.some(r => r.startsWith('│    ') && /database/.test(r))).toBe(true)
  expect(inside.filter(r => r === '│').length).toBeGreaterThan(2)
  // Everything said is still said.
  expect(v.flat).toContain('there is no test database for the import round')
})

test('at 40 columns the desktop plan keeps all its words too', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest the import round trip.', 'tester')
  const v = await view($, 'desktop', 40)
  for (const words of ['Export scores as CSV', 'Tests for the export', 'Review']) expect(v.text).toContain(words)
})

test('at 40 columns a row with an item at its right is never wider than the pane: the words, one cell, and the item', async ($, on) => {
  office(on, { [PLAN]: PLAN_TEXT.replace('Tests for the export', 'Tests for the export of a very large file') })
  await $.session.start(START)
  for (const i of [1, 2, 3, 4, 5]) await hire($, `PLAN: s4\nTest part ${i} of the long import round trip.`, `tester ${i}`)
  await stop($, 'p1', 'It stopped: there is no test database for the import round trip.', 'error')
  await press($, 'terminal', 'done-fold-btn', 40)
  for (const columns of [40, 33, 60]) {
    const rows = await sideBySide($, columns)
    expect(rows.length).toBeGreaterThan(3)
    for (const row of rows) expect(row.width, `${row.left} | ${row.right}`).toBeLessThanOrEqual(columns)
    expect(rows.some(r => r.right === 'Details')).toBe(true)
    expect(rows.some(r => /at work/.test(r.right))).toBe(true)
  }
})

// Wide characters and emoji stay in the text and are measured as the cells they take.
const ZWJ = String.fromCodePoint(0x200d)
const TECH = `\u{1F469}${ZWJ}\u{1F4BB}`
const WIDE_STEP = `日本語のエクスポート \u{1F680} Ship it ${TECH} \u{20000}\u{20001} ©™↔✔ ${'とても長い説明 '.repeat(3)}`.trim()

test('CJK, emoji and symbols on the terminal at 40 columns: the text is kept whole, every row fits the pane, and every row has the rail', async ($, on) => {
  office(on, { [PLAN]: PLAN_TEXT.replace('Tests for the export', WIDE_STEP) })
  await $.session.start(START)
  await hire($, 'PLAN: s4\n日本語のテストを書く \u{1F680} with ©™↔✔ marks', 'tester')
  await hire($, `PLAN: s4\nTest ${TECH} flags \u{1F1EF}\u{1F1F5} and \u{20000}`, 'tester')
  await stop($, 'p1', '失敗しました: データベースがありません \u{1F680} no database', 'error')
  const v = await view($, 'terminal', 40)
  const start = v.rows.findIndex(r => MARKS.test(r))
  const end = v.rows.findIndex(r => /Update the README/.test(r))
  const inside = v.rows.slice(start, end + 1)
  expect(inside.length).toBeGreaterThan(10)
  for (const row of inside) {
    expect(cellWidth(row), row).toBeLessThanOrEqual(40)
    expect(row.startsWith('│') || MARKS.test(row), row).toBe(true)
  }
  // Nothing was taken out: every wide character, emoji and symbol is still on the tab.
  for (const kept of ['日本語のエクスポート', '\u{1F680}', TECH, '\u{20000}\u{20001}', '©™↔✔', '日本語のテストを書く', '\u{1F1EF}\u{1F1F5}', '失敗しました']) expect(inside.join('').replace(/[│ ]/g, '')).toContain(kept.replace(/ /g, ''))
  // The wrapped rows of the long step carry the rail.
  expect(inside.filter(r => r.startsWith('│') && /とても長い説明|エクスポート/.test(r)).length).toBeGreaterThan(0)
  for (const row of await sideBySide($, 40)) expect(row.width, `${row.left} | ${row.right}`).toBeLessThanOrEqual(40)
})

test('CJK and emoji on the desktop keep their words too', async ($, on) => {
  office(on, { [PLAN]: PLAN_TEXT.replace('Tests for the export', WIDE_STEP) })
  await $.session.start(START)
  await hire($, 'PLAN: s4\n日本語のテストを書く \u{1F680}', 'tester')
  const v = await view($, 'desktop', 40)
  expect(v.text).toContain('日本語のエクスポート')
  expect(v.text).toContain('\u{1F680}')
  expect(v.text).toContain('日本語のテストを書く')
})

// ---- The Later fold ----

const LEFT = [
  { id: 'o1', text: 'Handle the empty list in the export', source: 'check', by: 'Clawd', at: 5 },
  { id: 'o2', text: 'Write the tests for accents', source: 'check', by: 'Reviewer', at: 4 },
]

function withLeft(on: Parameters<typeof host>[0], files?: Record<string, string>) {
  const h = host(on, [], { [`leftUndone:${ROOT}`]: LEFT })
  for (const [path, text] of Object.entries(files ?? { [PLAN]: PLAN_TEXT })) h.files.set(path, text)
  planFs(on, h.files)
  const fills: string[] = []
  on('prompt.fill', (_$, e) => (fills.push((e as { text: string }).text), { isFilled: true }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `p${(n += 1)}` }) as never)
  return { ...h, fills }
}

test('with a goal the Later fold is the last line of the plan: "N later", counting the plan\'s items and Left undone\'s', async ($, on) => {
  withLeft(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.texts).toContain('3 later')
    expect(v.text).not.toContain('LATER · ')
    expect(labelOf(v, 'later-toggle')).toBe('show')
    expect(v.text).not.toContain('Add an XLSX option')
    expect(v.text).not.toContain('Handle the empty list')
  }
})

test('open, the fold shows the plan\'s Later items then every Left undone row, each with Do it now and Dismiss, and "Clear left undone" on the Left undone rows', async ($, on) => {
  withLeft(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    await press($, surface, 'later-toggle')
    const v = await view($, surface)
    expect(labelOf(v, 'later-toggle')).toBe('hide')
    expect(ascending(order(v.text, '3 later', 'Add an XLSX option', 'Handle the empty list in the export', 'Write the tests for accents'))).toBe(true)
    expect(v.text).toContain('Second check · Reviewer')
    expect(v.buttons.filter(b => b.label === 'Do it now')).toHaveLength(3)
    expect(v.buttons.filter(b => b.label === 'Dismiss')).toHaveLength(3)
    expect(labelOf(v, 'later-clear')).toBe('Clear left undone')
    // The button heads the Left undone rows, after the plan's own items: it is not the fold's.
    expect(ascending(order(v.text, 'Add an XLSX option', 'Left undone', 'Handle the empty list in the export'))).toBe(true)
    await press($, surface, 'later-toggle')
    expect(labelOf(await view($, surface), 'later-toggle')).toBe('show')
  }
})

test('Do it now fills the prompt box with the item and sends nothing; Dismiss takes that one item away', async ($, on) => {
  const h = withLeft(on)
  await $.session.start(START)
  await press($, 'terminal', 'later-toggle')
  await press($, 'terminal', 'later-plan-l1-do')
  await press($, 'terminal', 'later-left-o1-do')
  expect(h.fills).toEqual(['You put this off: Add an XLSX option. Do it now.', 'You left this undone: Handle the empty list in the export. Do it now.'])
  await press($, 'terminal', 'later-left-o1-dismiss')
  expect((h.saved.get(`leftUndone:${ROOT}`) as Array<{ id: string }>).map(i => i.id)).toEqual(['o2'])
  expect((await view($, 'terminal')).text).not.toContain('Handle the empty list')
  await press($, 'desktop', 'later-plan-l1-dismiss')
  expect(h.files.get(PLAN)).not.toContain('Add an XLSX option')
  expect(h.files.get(PLAN)).toContain('- [ ] Review')
  const after = await view($, 'desktop')
  expect(after.text).not.toContain('Add an XLSX option')
  expect(after.texts).toContain('1 later')
})

test('Clear left undone empties the Left undone list, and the plan\'s own items stay', async ($, on) => {
  const h = withLeft(on)
  await $.session.start(START)
  await press($, 'terminal', 'later-toggle')
  await press($, 'terminal', 'later-clear')
  expect(h.saved.get(`leftUndone:${ROOT}`)).toEqual([])
  const v = await view($, 'terminal')
  expect(v.texts).toContain('1 later')
  expect(v.text).toContain('Add an XLSX option')
  expect(v.buttons.some(b => b.key === 'later-clear')).toBe(false)
})

test('with no goal the fold stands alone under "At work" as "LATER · N", closed to begin with, and open it shows every item', async ($, on) => {
  withLeft(on, {})
  await $.session.start(START)
  await hire($, 'Fix the login bug')
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.texts).toContain('LATER · 2')
    expect(closed.text).not.toContain('PLAN')
    expect(closed.text).not.toContain('Handle the empty list')
    expect(ascending(order(closed.text, 'AT WORK · 1', 'LATER · 2'))).toBe(true)
    await press($, surface, 'later-toggle')
    const open = await view($, surface)
    expect(open.text).toContain('Handle the empty list in the export')
    expect(open.text).toContain('Write the tests for accents')
    expect(open.buttons.filter(b => b.label === 'Dismiss')).toHaveLength(2)
    await press($, surface, 'later-toggle')
  }
})

test('every kept item is shown when the fold is open, not just three', async ($, on) => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, text: `Put-off job ${i} about thing${i}x`, source: 'check', by: 'Clawd', at: i }))
  const h = host(on, [], { [`leftUndone:${ROOT}`]: many })
  planFs(on, h.files)
  await $.session.start(START)
  await press($, 'terminal', 'later-toggle')
  const v = await view($, 'terminal')
  expect(v.texts.filter(t => /^Put-off job/.test(t))).toHaveLength(8)
  expect(v.buttons.filter(b => b.label === 'Do it now')).toHaveLength(8)
})

// ---- Clawd off, and what was removed ----

test('with Clawd not running the chat there is no plan section at all, though a plan file is there; the floor is the plain floor', { options: { chiefOfStaff: false } }, async ($, on) => {
  office(on, undefined, { [`leftUndone:${ROOT}`]: LEFT })
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest it.', 'tester')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).not.toMatch(/PLAN|steps done|ALSO AT WORK/)
    expect(v.texts).toContain('AT WORK · 1')
    // Left undone is not the plan's: it stays, alone, and none of the plan's Later items with it.
    expect(v.texts).toContain('LATER · 2')
    await press($, surface, 'later-toggle')
    const open = await view($, surface)
    expect(open.text).toContain('Handle the empty list in the export')
    expect(open.text).not.toContain('Add an XLSX option')
    await press($, surface, 'later-toggle')
  }
})

test('turning Clawd off during the session takes the plan off the tab at once, its Later items with it, and Left undone stays', async ($, on) => {
  office(on, undefined, { [`leftUndone:${ROOT}`]: LEFT })
  const row = (key: string) => ({ key, label: key, kind: 'boolean', value: true, provider: { plugin: 'clawd-hq@inline', tier: 'user' }, isLocked: false })
  on('config.list', () => ({ value: ['chiefOfStaff', 'quietChat', 'youShouldKnow'].map(f => row(`clawd-hq.${f}`)) }) as never)
  on('config.set', (_$, e) => ({ value: (e as { value: unknown }).value }) as never)
  await $.session.start(START)
  await press($, 'terminal', 'later-toggle')
  const before = await view($, 'terminal')
  expect(before.text).toContain('PLAN')
  expect(before.text).toContain('Add an XLSX option')
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq-settings', 'Settings') })
  await ui.press({ key: 'config-chiefOfStaff' })
  await ui.unmount()
  for (const surface of SURFACES) {
    // With no goal in hand the fold is the stand-alone one, a fold of its own: closed to begin with.
    await press($, surface, 'later-toggle')
    const after = await view($, surface)
    expect(after.text).not.toContain('PLAN')
    expect(after.text).not.toContain('Add an XLSX option')
    expect(after.texts).toContain('LATER · 2')
    expect(after.text).toContain('Handle the empty list in the export')
    expect(after.buttons.filter(b => b.label === 'Dismiss')).toHaveLength(2)
    await press($, surface, 'later-toggle')
  }
})

test('Clawd\'s card has no recap section and no line about the council command', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  for (const turn of [1, 2, 3]) {
    await $.turn.start({ text: `Ask ${turn}`, turnId: `m${turn}` } as never).catch(() => undefined)
    await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `m${turn}`, isAborted: false } as never)
  }
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).not.toMatch(/WHERE WE LEFT OFF|Next:|office-council|hold a council/)
  }
})

test('the group for what waits on the person has an amber heading that counts its cards, and is not there when nothing waits', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  expect((await view($, 'terminal')).text).not.toContain('NEEDS YOU')
  await $.tool.call({ tool: 'mcp__clawd-hq__offer_rule', rule: 'Always run the tests' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const heading = await ui.find({ type: 'Text', text: 'NEEDS YOU · 1' })
    expect(heading?.props.bold).toBe(true)
    expect(heading?.props.color).toBe('#e0a83a')
    await ui.unmount()
  }
})

// ---- The failure rule, the reason, the folds and the buttons of a goal ----

test('only the latest failure gets a card; "N earlier failed" counts the rest, and the step says how many failed in all', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  for (const i of [1, 2, 3]) await hire($, `PLAN: s4\nTest part ${i}.`, `tester ${i}`)
  for (const id of ['p1', 'p2', 'p3']) {
    await h.clock.advance(1_000)
    await stop($, id, `Run ${id} broke.`, 'error')
  }
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).toContain('3 failed')
    expect(v.text).toContain('2 earlier failed')
    expect(v.buttons.filter(b => b.label === 'Details')).toHaveLength(1)
    expect(v.buttons.find(b => b.label === 'Details')?.key).toBe('failed-p3-details')
  }
})

test('a failure that overlapped a later success still blocks: its card shows and the step needs attention, not done', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest part 1.', 'tester 1')
  await h.clock.advance(1_000)
  await hire($, 'PLAN: s4\nTest part 2.', 'tester 2')
  await stop($, 'p1', 'Part 1 broke.', 'error') // p1 failed while p2 was running: they overlapped
  await stop($, 'p2', 'Part 2 is done.')
  expect(h.files.get(PLAN)).toContain('- [ ] Tests for the export')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.buttons.map(b => b.key)).toContain('failed-p1-details')
    expect(v.text).toContain('1 failed')
    expect(v.text).not.toContain('at work')
  }
})

test('a reason is the end of what the run said, a second failure does not show the first one\'s, and unsafe words are not shown', async ($, on) => {
  office(on)
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest the import.', 'tester')
  await stop($, 'p1', `${'Setting things up. '.repeat(40)}The run stopped: there is no test database.`, 'error')
  await press($, 'terminal', 'failed-p1-details')
  const first = await view($, 'terminal')
  expect(first.flat).toContain('The run stopped: there is no test database.')
  expect(first.flat).not.toContain('Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up. Setting things up.')
  // The same run is brought back and fails again without a word: the old reason is gone.
  await hire($, 'Try the import again.', 'tester', { resume: { agentId: 'p1' } })
  await stop($, 'p1', '', 'error')
  const second = await view($, 'terminal')
  expect(second.flat).not.toContain('there is no test database')
  expect(second.flat).toContain('An error ended its turn.')
  // Words that look like a link or a key are not drawn.
  await hire($, 'PLAN: s4\nTest the export.', 'tester')
  await stop($, 'p2', `It failed. Visit https://example.com/fix and use ${skKey(['abcdefghijklmnopqr', 'stuvwxyz0123456789'].join(''))} to go on.`, 'error')
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text).not.toMatch(/example\.com|sk-abcdef/)
  }
})

test('the folds are the goal\'s: one opened in a goal is closed in the next', async ($, on) => {
  const h = office(on, {})
  await $.session.start(START)
  const steps = ['Find it', 'Plan it', 'Build it', 'Review it']
  await $.tool.call({ tool: 'mcp__clawd-hq__plan', op: 'start', goal: 'Export scores', steps } as never)
  for (const id of ['s1', 's2']) await $.tool.call({ tool: 'mcp__clawd-hq__plan', op: 'done', id } as never)
  await press($, 'terminal', 'done-fold-btn')
  expect(labelOf(await view($, 'terminal'), 'done-fold-btn')).toBe('hide')
  await $.tool.call({ tool: 'mcp__clawd-hq__plan', op: 'finish', outcome: 'done' } as never)
  await h.clock.advance(60_000)
  await $.tool.call({ tool: 'mcp__clawd-hq__plan', op: 'start', goal: 'Export scores', steps } as never)
  for (const id of ['s1', 's2']) await $.tool.call({ tool: 'mcp__clawd-hq__plan', op: 'done', id } as never)
  for (const surface of SURFACES) expect(labelOf(await view($, surface), 'done-fold-btn')).toBe('show')
})
