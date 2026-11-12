import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { START, host, paneProps } from './host'
import { ROOT, planFs } from './plan-disk'

// The desktop plan as the design boards draw it (design/DesktopBusy.dc.html and Main.dc.html): the line down the rail, the marks, the spacing,
// the cards. A test can only read the tree, never the paint, so these pin what a live probe showed the desktop draws (see `line` in
// hooks/panel-plan-desk.tsx): a box placed `absolute` with `top` and `bottom` spanning its step, holding a tall 2 pixel picture; pictures only
// with a description (the desktop draws nothing for an empty `alt`); and spacing from the host's named steps, never from pictures.

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
].join('\n')

function office(on: Parameters<typeof host>[0], files: Record<string, string> = { [PLAN]: PLAN_TEXT }) {
  const h = host(on, [], {})
  for (const [path, text] of Object.entries(files)) h.files.set(path, text)
  planFs(on, h.files)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: `p${(n += 1)}` }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  return h
}
const hire = ($: Engine, prompt: string, name: string) => $.agent.spawn({ prompt, description: prompt.split('\n').pop(), subagentType: 'general-purpose', name } as never)
/** Three at work, as on the board: two on the step now (s4), one under no step. */
async function busy($: Engine) {
  await $.session.start(START)
  await hire($, 'PLAN: s4\nTest a large file.', 'tester')
  await hire($, 'PLAN: s4\nFix the header row.', 'builder')
  await hire($, 'Find the CSV limits in Excel', 'researcher')
}

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null && 'props' in c)
const walk = (node: Tree, hit: (t: Tree) => boolean): Tree[] => [...(hit(node) ? [node] : []), ...elementsOf(node).flatMap(c => walk(c, hit))]
const keyedIn = (root: Tree, key: string) => walk(root, t => t.props.key === key)[0]

/** The Office tab drawn on the desktop, as a tree. */
async function desktop($: Engine): Promise<Tree> {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...paneProps('clawd-hq', 'Office', { bodyColumns: 60 }) })
  const root = (await ui.drawn()) as unknown as Tree
  await ui.unmount()
  return root
}
async function pressOnDesktop($: Engine, key: string) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...paneProps('clawd-hq', 'Office', { bodyColumns: 60 }) })
  await ui.press({ key })
  await ui.unmount()
}

/** Every picture in a tree whose description is empty or missing: the desktop draws none of them. */
const undescribed = (root: Tree) => walk(root, t => t.type === 'Svg' && String(t.props.alt ?? '').trim() === '')

// ---- The line ----

test('the line is drawn by the host\'s own sizing rules: each step but the last holds a box placed at its top and bottom that clips a 2 pixel strip in the board\'s colour', async ($, on) => {
  office(on)
  await busy($)
  const root = await desktop($)
  for (const [key, color] of [['done-fold', '#3f6a48'], ['step-s4', '#6a5a33'], ['step-s5', '#454542']] as const) {
    const row = keyedIn(root, key)!
    // The step is placed relative, so the line is placed against it; it clips, so the line can never run past its foot; it never shrinks.
    expect(row.props, key).toMatchObject({ flexDirection: 'row', position: 'relative', overflow: 'hidden', flexShrink: 0 })
    // The parts sit at the step's top, so the mark does; the line is the step's last part, placed apart from the flow.
    expect(row.props.alignItems, key).toBe('flex-start')
    expect(elementsOf(row).map(c => c.props.key), key).toEqual([`${key}-mark-col`, `${key}-body`, `${key}-rail`])
    expect(keyedIn(row, `${key}-mark-col`)!.props.position, key).toBeUndefined()
    const rail = elementsOf(row).find(c => c.props.key === `${key}-rail`)!
    // "With `bottom` and no `height` the Box spans the two": from a cell below the mark (top 1) to the step's foot (bottom 0).
    expect(rail.props, key).toMatchObject({ position: 'absolute', top: 1, bottom: 0, left: 0, overflow: 'hidden' })
    expect(rail.props.height, key).toBeUndefined()
    expect(rail.props.flexGrow, key).toBeUndefined()
    const [line, ...rest] = elementsOf(rail)
    expect(rest).toEqual([])
    expect(line!.type).toBe('Svg')
    expect(line!.props.alt).toBe('plan line') // never empty: the desktop draws no picture with an empty description
    expect([line!.props.width, line!.props.height]).toEqual([16, 4000])
    // A plain strip down the middle of the mark's column, top to foot: no clear top, so scaled or clipped it is the line.
    expect(String(line!.props.source)).toContain(`<rect x="7" y="0" width="2" height="4000" fill="${color}"/>`)
    expect(String(line!.props.source)).toContain('preserveAspectRatio="none"')
  }
  // The line stops under the last step, as on the board.
  expect(keyedIn(root, 'step-s6')).toBeDefined()
  expect(keyedIn(root, 'step-s6-rail')).toBeUndefined()
  expect(elementsOf(keyedIn(root, 'step-s6')!).map(c => c.props.key)).toEqual(['step-s6-mark-col', 'step-s6-body'])
  expect(walk(root, t => String(t.props.key ?? '').endsWith('-rail'))).toHaveLength(3)
})

test('the marks are 16 by 20 and the plan\'s pictures 2 pixels a dot; with no goal the floor\'s cards keep 3', async ($, on) => {
  office(on)
  await busy($)
  const root = await desktop($)
  const marks = walk(root, t => t.type === 'Svg' && ['done', 'now', 'next'].includes(String(t.props.alt)))
  expect(marks.map(m => m.props.alt)).toEqual(['done', 'now', 'next', 'next'])
  for (const mark of marks) expect([mark.props.width, mark.props.height], String(mark.props.alt)).toEqual([16, 20])
  const sprites = walk(root, t => t.type === 'Svg' && /^(Tester|Builder|Researcher|Generalist)/.test(String(t.props.alt)))
  expect(sprites).toHaveLength(3)
  for (const sprite of sprites) expect(sprite.props.width, String(sprite.props.alt)).toBe(46)
})

test('with no goal the floor\'s cards and the tab\'s spacing are as they were', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  await hire($, 'Fix the login bug', 'tester')
  const root = await desktop($)
  const [sprite] = walk(root, t => t.type === 'Svg' && /^Tester|^Generalist/.test(String(t.props.alt)))
  expect(sprite!.props.width).toBe(69)
  const card = keyedIn(root, 'desk-p1')!
  expect(card.props).toMatchObject({ paddingX: 1, gap: 2 })
  expect(undescribed(root)).toEqual([])
})

// ---- The open done fold ----

test('opened, the done steps sit inside the done line\'s step, beside its line, each with a tick of its own', async ($, on) => {
  office(on)
  await busy($)
  await pressOnDesktop($, 'done-fold-btn')
  const root = await desktop($)
  const fold = keyedIn(root, 'done-fold')!
  expect(elementsOf(fold).some(c => c.props.key === 'done-fold-rail')).toBe(true)
  const body = keyedIn(fold, 'done-fold-body')!
  expect(elementsOf(body).map(c => c.props.key)).toEqual(['done-fold-line', 'done-s1', 'done-s2', 'done-s3'])
  for (const id of ['s1', 's2', 's3']) {
    const row = keyedIn(body, `done-${id}`)!
    expect(row.props.columnGap, id).toBe('sm')
    const [mark, words] = elementsOf(row)
    expect([mark!.type, mark!.props.alt, mark!.props.width, mark!.props.height]).toEqual(['Svg', 'done', 16, 20])
    expect(words!.type).toBe('Box')
  }
  // The done steps carry no line of their own: the done line's runs beside them.
  expect(keyedIn(root, 'done-s1-rail')).toBeUndefined()
  // Opened, the line beside the list still starts a cell below the done disc and runs to the fold's foot.
  expect(keyedIn(fold, 'done-fold-rail')!.props).toMatchObject({ position: 'absolute', top: 1, bottom: 0 })
})

// ---- No picture without a description ----

test('no picture on the desktop Office tab has an empty description, with the plan, its folds open and a failed agent', async ($, on) => {
  office(on)
  await busy($)
  await $.turn.complete({ reason: 'error', answer: 'It broke.', turnId: 't-p1', agentId: 'p1', isAborted: false } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__step', done: 2, total: 5, agentId: 'p2' } as never)
  await pressOnDesktop($, 'done-fold-btn')
  await pressOnDesktop($, 'later-toggle')
  const root = await desktop($)
  expect(walk(root, t => t.type === 'Svg').length).toBeGreaterThan(8)
  expect(undescribed(root)).toEqual([])
})

test('with no goal no picture on the desktop Office tab has an empty description either', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  await hire($, 'Fix the login bug', 'tester')
  expect(undescribed(await desktop($))).toEqual([])
})

// ---- Spacing: the host's named steps, never pictures ----

test('spaced with the host\'s "sm" step (the board\'s 8 and 10): under the heading, from the mark to the words, between a step\'s lines, under every step', async ($, on) => {
  office(on)
  await busy($)
  const root = await desktop($)
  const plan = keyedIn(root, 'plan')!
  expect(walk(plan, t => t.type === 'Svg' && !['done', 'now', 'next', 'attention', 'plan line'].includes(String(t.props.alt)) && t.props.height !== 4 && !/^(Tester|Builder|Researcher|Generalist)/.test(String(t.props.alt)))).toEqual([])
  expect(plan.props.gap).toBe('sm')
  expect(elementsOf(plan).map(c => c.props.key)).toEqual(['plan-head', 'plan-timeline'])
  for (const key of ['done-fold', 'step-s4', 'step-s5', 'step-s6']) {
    const row = keyedIn(root, key)!
    expect(row.props.columnGap, key).toBe('sm')
    const [column, body] = [keyedIn(row, `${key}-mark-col`), keyedIn(row, `${key}-body`)]
    expect(walk(column!, t => t.type === 'Svg').map(m => [m.props.width, m.props.height]), key).toEqual([[16, 20]])
    expect(body!.props, key).toMatchObject({ key: `${key}-body`, gap: 'sm', paddingBottom: 'sm' })
  }
  // The Later line is the last step's last line, as the board has "2 later".
  expect(elementsOf(keyedIn(root, 'step-s6-body')!).at(-1)!.props.key).toBe('later-fold')
})

test('the sections are the "md" step apart (the board\'s 16), and "Also at work" has its cards "sm" under its heading and "sm" apart', async ($, on) => {
  office(on)
  await busy($)
  await hire($, 'Look at the button spacing', 'designer')
  const root = await desktop($)
  const tab = walk(root, t => elementsOf(t).some(c => c.props.key === 'plan'))[0]!
  expect(tab.props.gap).toBe('md')
  expect(keyedIn(root, 'also-at-work')!.props.gap).toBe('sm')
  expect(keyedIn(root, 'floor-rows')!.props.gap).toBe('sm')
})

test('with no goal the desktop tab keeps a cell between sections, and uses no named step', async ($, on) => {
  office(on, {})
  await $.session.start(START)
  const root = await desktop($)
  expect(root.props.gap ?? walk(root, t => t.props.gap === 1).length).toBeTruthy()
  expect(walk(root, t => t.props.gap === 'md' || t.props.gap === 'sm')).toEqual([])
})

test('the terminal plan uses no named step: its spacing is whole cells, as before', async ($, on) => {
  office(on)
  await busy($)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...paneProps('clawd-hq', 'Office', { bodyColumns: 60 }) })
  const terminal = (await ui.drawn()) as unknown as Tree
  await ui.unmount()
  expect(walk(terminal, t => [t.props.gap, t.props.columnGap, t.props.paddingBottom].some(v => typeof v === 'string'))).toEqual([])
})

// ---- Cards ----

test('the plan\'s cards keep the floor\'s cell padding and gap, with the board\'s #454542 border', async ($, on) => {
  office(on)
  await busy($)
  const root = await desktop($)
  for (const id of ['p1', 'p2', 'p3']) {
    const card = keyedIn(root, `desk-${id}`)!
    expect(card.props, id).toMatchObject({ borderStyle: 'round', borderColor: '#454542', paddingX: 1, gap: 2 })
  }
})

test('a plan card\'s bar is 120 by 4 on the board\'s track, a cell from "Step N of M", and is not drawn at step 0', async ($, on) => {
  office(on)
  await busy($)
  await $.tool.call({ tool: 'mcp__clawd-hq__step', done: 0, total: 3, agentId: 'p1' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__step', done: 3, total: 5, agentId: 'p2' } as never)
  const root = await desktop($)
  expect(walk(keyedIn(root, 'desk-p1')!, t => t.type === 'Svg' && t.props.height === 4)).toEqual([])
  const steps = keyedIn(root, 'steps-p2')!
  const [bar, count] = elementsOf(steps)
  expect([bar!.type, bar!.props.width, bar!.props.height]).toEqual(['Svg', 120, 4])
  expect(String(bar!.props.source)).toContain('fill="#3a3a37"')
  expect(count!.type).toBe('Text')
  expect(steps.props.columnGap).toBe(1)
})
