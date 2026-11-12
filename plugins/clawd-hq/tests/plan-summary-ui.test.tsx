import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { START, SURFACES, host, paneProps } from './host'
import { cellWidth } from '../hooks/wrap-to'
import { planFs } from './plan-disk'

// The summary through the plan tool, and as each surface draws it: dim under the title, wrapped on the desktop, one row cut with "…" on the
// terminal; no summary, no row.

const PLAN = 'mcp__clawd-hq__plan'
const LONG = 'Teachers can download every score of every class as one CSV file that opens cleanly in Excel and in Google Sheets.'
type Surface = (typeof SURFACES)[number]

async function office($: Engine, on: Parameters<typeof host>[0]) {
  const h = host(on, [], {})
  planFs(on, h.files)
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.session.start(START)
  return h
}
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call({ tool: PLAN, ...input } as never) as Promise<{ result?: string; deny?: string }>
const start = ($: Engine, summary?: string) => call($, { op: 'start', goal: 'Export scores as CSV', steps: ['Find it', 'Build it'], ...(summary === undefined ? {} : { summary }) })

async function drawn($: Engine, surface: Surface, columns = 60) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq', 'Office', { bodyColumns: columns }) })
  const texts = await ui.findAll({ type: 'Text' })
  const summary = await ui.find({ key: 'plan-summary' })
  await ui.unmount()
  return { nodes: texts, texts: texts.map(t => String(t.text)), rows: texts.filter(t => t.props.wrap === 'truncate-end').map(t => String(t.text)), summary }
}

test('start with a summary saves it in the file under the title and answers with it after the title line', async ($, on) => {
  const h = await office($, on)
  const answer = await start($, 'Teachers can download every score.')
  expect(answer.result!.split('\n').slice(0, 2)).toEqual(['Plan: Export scores as CSV (0 of 2 done)', 'Summary: Teachers can download every score.'])
  const [text] = [...h.files.values()].filter(one => one.startsWith('# Export'))
  expect(text!.split('\n').slice(0, 2)).toEqual(['# Export scores as CSV', '> Teachers can download every score.'])
})

test('the summary op sets, replaces and clears it, and the answer follows', async ($, on) => {
  await office($, on)
  await start($)
  expect((await call($, { op: 'summary', text: 'One sentence.' })).result!.split('\n')[1]).toBe('Summary: One sentence.')
  expect((await call($, { op: 'summary', text: 'Another.' })).result!.split('\n')[1]).toBe('Summary: Another.')
  expect((await call($, { op: 'summary', text: '' })).result!.split('\n')[1]).toMatch(/^s1 /)
})

test('on the desktop the summary is dim under the title row, wrapping, "sm" from the list', async ($, on) => {
  await office($, on)
  await start($, LONG)
  const v = await drawn($, 'desktop', 40)
  expect(v.nodes.find(t => String(t.text) === LONG)?.props).toMatchObject({ dimColor: true, wrap: 'wrap' })
  expect(v.texts.indexOf(LONG)).toBeGreaterThan(v.texts.findIndex(t => t.includes('0 of 2 done')))
  expect(v.texts.indexOf(LONG)).toBeLessThan(v.texts.indexOf('Find it'))
})

test('on the terminal at 40 columns the summary is one dim row, cut with "…", under the title and above the rail', async ($, on) => {
  await office($, on)
  await start($, LONG)
  const v = await drawn($, 'terminal', 40)
  const at = v.rows.findIndex(r => r.startsWith('Teachers can'))
  expect(at).toBeGreaterThan(v.rows.findIndex(r => r.startsWith('PLAN')))
  expect(v.rows[at]!.endsWith('…')).toBe(true)
  expect(cellWidth(v.rows[at]!)).toBeLessThanOrEqual(40)
  expect(v.rows.filter(r => r.includes('Teachers') || r.includes('Google'))).toHaveLength(1)
  expect(v.summary).toBeDefined()
  // The rail rules are unchanged: every row from the first mark to the last step carries the rail or a mark.
  const [first, last] = [v.rows.findIndex(r => /^[✓●○✗]/.test(r)), v.rows.findIndex(r => r.includes('Build it'))]
  for (const row of v.rows.slice(first, last + 1)) expect(row.startsWith('│') || /^[✓●○✗]/.test(row), row).toBe(true)
})

test('a short summary on the terminal is shown whole, with no "…"', async ($, on) => {
  await office($, on)
  await start($, 'Scores as CSV.')
  expect((await drawn($, 'terminal', 40)).rows).toContain('Scores as CSV.')
})

test('no summary, no extra row, on either surface', async ($, on) => {
  await office($, on)
  await start($)
  // The desktop: the title row's count is followed straight by the first step. The terminal: the title row by the first step's row.
  const desktop = await drawn($, 'desktop')
  expect(desktop.texts[desktop.texts.indexOf('0 of 2 done') + 1]).toBe('Find it')
  const terminal = await drawn($, 'terminal')
  expect(terminal.summary).toBeUndefined()
  expect(terminal.rows[terminal.rows.findIndex(r => r.startsWith('PLAN')) + 1]).toMatch(/^○ +Find it/)
})
