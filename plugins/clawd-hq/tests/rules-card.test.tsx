import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { MAX_RULE } from '../hooks/rule-offers'
import { PANE, START, SURFACES, host } from './host'

// The "Add to CLAUDE.md" card, end to end: Clawd offers a lasting rule with the offer_rule tool; pressing the button writes the
// exact line shown into the project's CLAUDE.md, straight from the plugin, with no model in between.

const TOOL = 'mcp__clawd-hq__offer_rule'
const FILE = '/repo/CLAUDE.md'
const OLD_DECISIONS = '/repo/.clawd-hq/decisions.md'
type Surface = (typeof SURFACES)[number]

const offer = ($: Engine, rule: unknown, agentId?: string) =>
  $.tool.call({ tool: TOOL, rule, ...(agentId ? { agentId } : {}) } as never) as Promise<{ result?: string; deny?: string }>

async function seen($: Engine, surface: Surface) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const words = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => String(b.text))
  await ui.unmount()
  return { words, buttons, text: words.join('\n') }
}

async function press($: Engine, text: string, surface: Surface = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const one = await ui.find({ type: 'Button', text })
  if (!one?.key) throw new Error(`no ${text} button`)
  await ui.press({ key: one.key })
  await ui.unmount()
}

async function started(on: Parameters<typeof host>[0]) {
  const h = host(on)
  const models: unknown[] = []
  on('model.complete', (_$, e) => (models.push(e), { value: { isAnswered: false } }) as never)
  on('model.fork', (_$, e) => (models.push(e), { value: { isAnswered: false } }) as never)
  return { ...h, models }
}

test('the offer_rule tool is registered at session start', async ($, on) => {
  const { tools } = await started(on)
  await $.session.start(START)
  expect(tools).toContain('offer_rule')
})

test('with no offer the section is not drawn at all', async ($, on) => {
  await started(on)
  await $.session.start(START)
  for (const surface of SURFACES) expect((await seen($, surface)).text).not.toMatch(/LASTING RULE|Add to CLAUDE\.md/)
})

test('Clawd\'s call puts the rule, in full, on a card with an Add to CLAUDE.md button and a Dismiss button, on both surfaces', async ($, on) => {
  await started(on)
  await $.session.start(START)
  const long = `Always run the whole test suite before a commit, and ${'say which checks were skipped '.repeat(8)}`.trim()
  expect(long.length).toBeLessThanOrEqual(MAX_RULE)
  const answer = await offer($, long)
  expect(answer.deny).toBeUndefined()
  expect(answer.result).toMatch(/Office tab/)
  for (const surface of SURFACES) {
    const { text, buttons } = await seen($, surface)
    expect(text).toMatch(/LASTING RULE\?/)
    expect(text).toContain(long)
    expect(text).not.toMatch(/…/)
    expect(buttons).toEqual(expect.arrayContaining(['Add to CLAUDE.md', 'Dismiss']))
  }
})

test('the card sits above the floor, after "You should know"', async ($, on) => {
  await started(on)
  await $.session.start(START)
  await offer($, 'Never push without asking')
  const { text } = await seen($, 'terminal')
  expect(text.indexOf('LASTING RULE?')).toBeGreaterThan(-1)
  expect(text.indexOf('LASTING RULE?')).toBeLessThan(text.indexOf('THE FLOOR'))
})

test('a specialist\'s call is refused with a reason, and nothing is offered', async ($, on) => {
  await started(on)
  await $.session.start(START)
  const answer = await offer($, 'Always use tabs', 'a1')
  expect(answer.deny).toBe('Put it in your report for Clawd.')
  for (const surface of SURFACES) expect((await seen($, surface)).text).not.toMatch(/LASTING RULE|tabs/)
})

test('an empty rule or one over 300 characters is refused with the reason, never cut and never offered', async ($, on) => {
  await started(on)
  await $.session.start(START)
  expect((await offer($, '   ')).deny).toMatch(/empty|nothing/i)
  const over = await offer($, 'x'.repeat(MAX_RULE + 1))
  expect(over.deny).toContain(String(MAX_RULE))
  expect((await seen($, 'terminal')).text).not.toMatch(/LASTING RULE/)
})

test('the same rule offered again is one card; hidden marks and line breaks in it are gone', async ($, on) => {
  await started(on)
  await $.session.start(START)
  await offer($, 'Never use tabs')
  await offer($, '- Never use\n tabs​')
  const { words, buttons } = await seen($, 'terminal')
  expect(words.filter(w => w === '- Never use tabs')).toHaveLength(1) // the card shows the exact line the button writes
  expect(buttons.filter(b => b === 'Add to CLAUDE.md')).toHaveLength(1)
})

test('pressing Add to CLAUDE.md writes the exact line into the project\'s CLAUDE.md, takes the card away, and says so for a moment', async ($, on) => {
  const h = await started(on)
  h.files.set(FILE, '# Notes\n- Keep it small\n')
  await $.session.start(START)
  await offer($, 'Never push without asking')
  await press($, 'Add to CLAUDE.md')
  expect(h.files.get(FILE)).toBe('# Notes\n- Keep it small\n- Never push without asking\n')
  expect(h.models).toHaveLength(0) // no model sits in between
  for (const surface of SURFACES) {
    const { text, buttons } = await seen($, surface)
    expect(text).toContain('Added to CLAUDE.md')
    expect(buttons).not.toContain('Dismiss')
  }
  await h.clock.advance(10_000)
  expect((await seen($, 'terminal')).text).not.toMatch(/Added to CLAUDE\.md|LASTING RULE/)
})

test('a project with no CLAUDE.md gets one with the rule in it', async ($, on) => {
  const h = await started(on)
  await $.session.start(START)
  await offer($, 'Use Drizzle for migrations')
  await press($, 'Add to CLAUDE.md', 'desktop')
  expect(h.files.get(FILE)).toBe('- Use Drizzle for migrations\n')
})

test('a rule already in CLAUDE.md is not added a second time; the card still goes', async ($, on) => {
  const h = await started(on)
  h.files.set(FILE, '- Never push without asking\n')
  await $.session.start(START)
  await offer($, 'Never push without asking')
  await press($, 'Add to CLAUDE.md')
  expect(h.files.get(FILE)).toBe('- Never push without asking\n')
  const { text } = await seen($, 'terminal')
  expect(text).toContain('Already in CLAUDE.md')
  expect(text).not.toMatch(/LASTING RULE/)
})

test('a write that fails keeps the card and shows why; the file is as it was', async ($, on) => {
  const h = await started(on)
  h.files.set(FILE, '# Notes\n')
  await $.session.start(START)
  await offer($, 'Never push without asking')
  h.disk.isWriteFailing = true
  await press($, 'Add to CLAUDE.md')
  for (const surface of SURFACES) {
    const { text, buttons } = await seen($, surface)
    expect(text).toContain('Never push without asking')
    expect(text).toMatch(/Could not add it to CLAUDE\.md: \S/) // the reason is the host's own words, whatever they are
    expect(buttons).toEqual(expect.arrayContaining(['Add to CLAUDE.md', 'Dismiss']))
  }
  expect(h.files.get(FILE)).toBe('# Notes\n')
  // Pressed again once the folder works, it goes through.
  h.disk.isWriteFailing = false
  await press($, 'Add to CLAUDE.md')
  expect(h.files.get(FILE)).toBe('# Notes\n- Never push without asking\n')
  expect((await seen($, 'terminal')).text).not.toMatch(/Could not add/)
})

test('a CLAUDE.md that cannot be read is not overwritten', async ($, on) => {
  const h = await started(on)
  h.files.set(FILE, 'Precious\n')
  await $.session.start(START)
  await offer($, 'Rule one')
  h.disk.isReadFailing = true
  await press($, 'Add to CLAUDE.md')
  h.disk.isReadFailing = false
  expect(h.files.get(FILE)).toBe('Precious\n')
  expect((await seen($, 'terminal')).text).toMatch(/Could not add/)
})

test('Dismiss takes the card away and writes nothing', async ($, on) => {
  const h = await started(on)
  await $.session.start(START)
  await offer($, 'Never push without asking')
  await press($, 'Dismiss')
  expect(h.files.has(FILE)).toBe(false)
  expect((await seen($, 'terminal')).text).not.toMatch(/LASTING RULE|Never push/)
})

test('two cards are pressed one by one: each press writes its own line, and neither line is lost', async ($, on) => {
  const h = await started(on)
  await $.session.start(START)
  await offer($, 'Rule A')
  await offer($, 'Rule B')
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const adds = await ui.findAll({ type: 'Button', text: 'Add to CLAUDE.md' })
  expect(adds).toHaveLength(2)
  await Promise.all(adds.map(one => ui.press({ key: one.key! })))
  await ui.unmount()
  expect(h.files.get(FILE)!.split('\n').sort()).toEqual(['', '- Rule A', '- Rule B'])
})

test('the old decisions file is never read, written or removed by the card', async ($, on) => {
  const h = await started(on)
  const old = '# Clawd HQ decisions\n\n- M1 · 2026-10-10 14:03 · decision · CEO · desk · Keep it simple\n'
  h.files.set(OLD_DECISIONS, old)
  await $.session.start(START)
  await offer($, 'Never push without asking')
  await press($, 'Add to CLAUDE.md')
  expect(h.files.get(OLD_DECISIONS)).toBe(old)
})

test('offers last for the session only: nothing is kept in the store', async ($, on) => {
  const h = await started(on)
  await $.session.start(START)
  await offer($, 'Never push without asking')
  expect([...h.saved.keys()].filter(k => /rule/i.test(k))).toEqual([])
})
