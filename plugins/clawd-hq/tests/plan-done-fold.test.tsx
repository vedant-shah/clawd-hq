import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { START, SURFACES, host, paneProps } from './host'
import { cellWidth } from '../hooks/wrap-to'
import { ROOT, planFs } from './plan-disk'

// The done fold on both surfaces: the last finished step (the last ticked one in plan order; a tick carries no time) is its own done row,
// and only the ones before it are folded, as "N steps done".

const STEPS = ['Find how exports work now', 'Plan the change', 'Add the export button', 'Tests for the export', 'Review the change', 'Update the README', 'Ship it']
type Surface = (typeof SURFACES)[number]

const PLAN = `${ROOT}/.clawd-hq/plans/export-scores.md`
/** The plan file with the first `done` steps ticked; the first two steps carry a choice each. */
const planText = (done: number) => ['# Export scores as CSV', '',
  ...STEPS.flatMap((text, i) => [`- [${i < done ? 'x' : ' '}] ${text}  <!-- s${i + 1} -->`, ...(i < 2 ? [`  - Decided: choice ${i + 1}`] : [])]), '<!-- session: unknown -->', ''].join('\n')

/** A session with a goal of seven steps, the first `done` ticked. */
async function goal($: Engine, on: Parameters<typeof host>[0], done: number) {
  const h = host(on, [], {})
  h.files.set(PLAN, planText(done))
  planFs(on, h.files)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
}

/** The tab as drawn: its texts in order, the terminal's rows (`truncate-end`), the keys and the buttons' labels by key. */
async function view($: Engine, surface: Surface, columns = 60) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq', 'Office', { bodyColumns: columns }) })
  const all = await ui.findAll({ type: 'Text' })
  const texts = all.map(t => String(t.text))
  const rows = all.filter(t => t.props.wrap === 'truncate-end').map(t => String(t.text))
  const keys = (await ui.findAll({})).map(n => String(n.props.key ?? ''))
  const buttons = new Map((await ui.findAll({ type: 'Button' })).map(b => [String(b.props.key ?? ''), String(b.props.label ?? '')]))
  await ui.unmount()
  // A terminal row is one Text holding its parts, so its words are read from the rows there; on the desktop from every Text.
  const lines = surface === 'terminal' ? rows : texts
  return { texts, rows, lines, keys, buttons, text: texts.join('\n') }
}
/** The last done step is a timeline row with its own tick: its mark column on the desktop, a row that begins with ✓ and its words on the terminal. */
const hasTick = (v: Awaited<ReturnType<typeof view>>, surface: Surface, id: string, words: string) =>
  surface === 'desktop' ? v.keys.includes(`done-${id}-mark-col`) : v.rows.some(r => r.startsWith('✓') && r.includes(words))
async function press($: Engine, surface: Surface, key: string) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq', 'Office', { bodyColumns: 60 }) })
  await ui.press({ key })
  await ui.unmount()
}
/** Where each of `parts` first appears in the text: all found, in this order. */
const inOrder = (text: string, ...parts: string[]) => {
  const at = parts.map(p => text.indexOf(p))
  return at.every((n, i) => n >= 0 && (i === 0 || n > at[i - 1]!))
}

test('no step done: no done row and no fold', async ($, on) => {
  await goal($, on, 0)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text, surface).not.toMatch(/steps? done/)
    expect(v.buttons.has('done-fold-btn'), surface).toBe(false)
    expect(v.keys.some(k => /^done-s\d/.test(k)), surface).toBe(false)
  }
})

test('one step done: it is a done row of its own, with its tick, and there is no fold', async ($, on) => {
  await goal($, on, 1)
  for (const surface of SURFACES) {
    const v = await view($, surface)
    expect(v.text, surface).not.toMatch(/steps? done/)
    expect(v.buttons.has('done-fold-btn'), surface).toBe(false)
    expect(hasTick(v, surface, 's1', 'Find how exports work now'), surface).toBe(true)
    expect(inOrder(v.text, 'PLAN', 'Find how exports work now', 'Plan the change'), surface).toBe(true)
  }
})

test('two steps done: "1 step done" folds the first; the second is its own row, above the step now', async ($, on) => {
  await goal($, on, 2)
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.text, surface).toContain('1 step done')
    expect(closed.buttons.get('done-fold-btn'), surface).toBe('show')
    expect(closed.text, surface).not.toContain('Find how exports work now')
    expect(hasTick(closed, surface, 's2', 'Plan the change'), surface).toBe(true)
    expect(inOrder(closed.text, '1 step done', 'Plan the change', 'Add the export button'), surface).toBe(true)
    await press($, surface, 'done-fold-btn')
    const open = await view($, surface)
    expect(open.buttons.get('done-fold-btn'), surface).toBe('hide')
    expect(inOrder(open.text, '1 step done', 'Find how exports work now', 'Decided: choice 1', 'Plan the change', 'Add the export button'), surface).toBe(true)
    // The last finished step is drawn once, outside the fold, with its own choice under it.
    expect(open.lines.filter(t => t.includes('Plan the change')), surface).toHaveLength(1)
    expect(open.text, surface).toContain('Decided: choice 2')
    await press($, surface, 'done-fold-btn')
  }
})

test('five steps done: "4 steps done" folds the first four; the fifth is its own row; opened, the four come in order above it', async ($, on) => {
  await goal($, on, 5)
  for (const surface of SURFACES) {
    const closed = await view($, surface)
    expect(closed.text, surface).toContain('4 steps done')
    expect(closed.text, surface).toContain('5 of 7 done')
    for (const hidden of STEPS.slice(0, 4)) expect(closed.text, surface).not.toContain(hidden)
    expect(inOrder(closed.text, '4 steps done', 'Review the change', 'Update the README'), surface).toBe(true)
    await press($, surface, 'done-fold-btn')
    const open = await view($, surface)
    expect(inOrder(open.text, '4 steps done', ...STEPS.slice(0, 4), 'Review the change', 'Update the README'), surface).toBe(true)
    expect(open.lines.filter(t => t.includes('Review the change')), surface).toHaveLength(1)
    expect(hasTick(open, surface, 's5', 'Review the change'), surface).toBe(true)
    await press($, surface, 'done-fold-btn')
  }
})

test('on the desktop the line joins the fold line, the last done row and the step now', async ($, on) => {
  await goal($, on, 5)
  const v = await view($, 'desktop')
  for (const key of ['done-fold-rail', 'done-s5-rail', 'step-s6-rail']) expect(v.keys, key).toContain(key)
  expect(v.keys).not.toContain('step-s7-rail') // the last step has none
})

test('on the terminal at 40 columns every row from the fold line to the last step carries the rail or a mark, fold open and closed', async ($, on) => {
  await goal($, on, 5)
  for (const isOpen of [false, true]) {
    if (isOpen) await press($, 'terminal', 'done-fold-btn')
    const v = await view($, 'terminal', 40)
    const start = v.rows.findIndex(r => /4 steps done/.test(r))
    const end = v.rows.findIndex(r => /Ship it/.test(r))
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const inside = v.rows.slice(start, end + 1)
    for (const row of inside) {
      expect(cellWidth(row), row).toBeLessThanOrEqual(40)
      expect(row.startsWith('│') || /^[✓●○✗]/.test(row), row).toBe(true)
    }
    expect(inside.filter(r => /^✓/.test(r)), String(isOpen)).toHaveLength(2) // the fold line's tick and the last done step's
    expect(inside.some(r => /^✓ +Review the change/.test(r)), String(isOpen)).toBe(true)
  }
})
