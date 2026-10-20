import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { avatarFor, compactIcon, tinyIcon } from '../hooks/avatars'
import { rasterCells, trim } from '../hooks/pixels'
import { PANE, SURFACES, host, mountLog } from './host'

const MIN = 60_000
const GOAL = 'Fix the login bug'
const brief = (role: string, goal: string | null = GOAL, effort = '') => `${effort}${goal === null ? '' : `PAIR-UP: ${goal}\n`}You are the ${role}.`
const hire = ($: Engine, name: string, prompt: string) => $.agent.spawn({ prompt, description: `${name} job`, subagentType: 'general-purpose', name } as never)
const stop = ($: Engine, id: string, n: number, reason = 'answer') => $.turn.complete({ reason, answer: 'ok', turnId: `r${n}`, agentId: id, isAborted: false } as never)

/** A host whose spawns get the ids p1, p2, ...; `prompts` is what the engine was about to send for each. */
function office(on: Parameters<typeof host>[0]) {
  const h = host(on, [])
  const prompts: string[] = []
  on('agent.spawn', (_$, e) => (prompts.push((e as { prompt: string }).prompt), { model: 'claude-opus-5-5', agentId: `p${prompts.length}` }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  return { ...h, prompts }
}

async function officeTexts($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const keys = (await ui.findAll({})).map(n => String(n.props.key ?? ''))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return { keys, texts }
}

test('specialists hired with the same PAIR-UP goal are one card: their names joined, the goal beside them, one status line', async ($, on) => {
  office(on)
  await hire($, 'author', brief('author'))
  await hire($, 'critic', brief('critic'))
  for (const surface of SURFACES) {
    const { keys, texts } = await officeTexts($, surface)
    expect(keys).toContain('pair-p1')
    expect(keys).not.toContain('desk-p1')
    expect(keys).not.toContain('desk-p2')
    expect(texts).toContain('Author & Critic')
    expect(texts.some(t => t.includes(GOAL))).toBe(true)
    expect(texts.filter(t => /^Working/.test(t))).toHaveLength(1)
    // The count above the floor still counts specialists.
    expect(texts).toContain('AT WORK · 2')
  }
})

test('three specialists read "A, B & C"', async ($, on) => {
  office(on)
  for (const name of ['author', 'critic', 'judge']) await hire($, name, brief(name))
  const { texts } = await officeTexts($, 'desktop')
  expect(texts).toContain('Author, Critic & Judge')
})

test('the PAIR-UP line comes off the brief the way the effort line does; a brief without it goes as it was', async ($, on) => {
  const { prompts } = office(on)
  await hire($, 'author', brief('author', GOAL, '[effort: high]\n'))
  await hire($, 'critic', brief('critic', null))
  expect(prompts[0]).toMatch(/^You are the author\./)
  expect(prompts[0]).not.toContain('PAIR-UP')
  expect(prompts[0]).not.toContain('[effort')
  expect(prompts[1]).toMatch(/^You are the critic\./)
})

test('hires without the line keep separate cards, even at the same time', async ($, on) => {
  office(on)
  await hire($, 'author', brief('author', null))
  await hire($, 'critic', brief('critic', null))
  const { keys } = await officeTexts($, 'terminal')
  expect(keys).toContain('desk-p1')
  expect(keys).toContain('desk-p2')
  expect(keys.some(k => k.startsWith('pair-'))).toBe(false)
})

test('the same goal, or a different one, outside the window or between other hires, does not join the pair-up', async ($, on) => {
  const { clock } = office(on)
  await hire($, 'author', brief('author'))
  await hire($, 'critic', brief('critic', 'Update the docs'))
  await clock.advance(11 * MIN)
  await hire($, 'judge', brief('judge'))
  const { keys } = await officeTexts($, 'terminal')
  // The terminal's picture carries the row's key too, so each shows twice there.
  expect([...new Set(keys.filter(k => k.startsWith('desk-')))]).toEqual(['desk-p1', 'desk-p2', 'desk-p3'])
  expect(keys.some(k => k.startsWith('pair-'))).toBe(false)
})

test('the pictures are the small ones, side by side: the tiny picture on the terminal, the list icon elsewhere', async ($, on) => {
  office(on)
  await hire($, 'author', brief('author'))
  await hire($, 'critic', brief('critic'))
  const terminal = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const rasters = (await terminal.findAll({ type: 'Raster' })).filter(r => String(r.props.key).startsWith('pair-avatar-'))
  expect(rasters.map(r => r.props.cells)).toEqual(['author', 'critic'].map(n => rasterCells(trim(tinyIcon(avatarFor(n))))))
  await terminal.unmount()
  const desktop = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  const svgs = (await desktop.findAll({ type: 'Svg' })).filter(s => ['Author', 'Critic'].includes(String(s.props.alt)))
  expect(svgs).toHaveLength(2)
  for (const svg of svgs) expect(svg.props.width).toBe(trim(compactIcon(avatarFor(String(svg.props.alt))))[0]!.length * 3)
  await desktop.unmount()
})

test('the card says Working while any member works, then leaves the floor and goes to the finished list as Done', async ($, on) => {
  const { clock } = office(on)
  await hire($, 'author', brief('author'))
  await hire($, 'critic', brief('critic'))
  await clock.advance(2 * MIN)
  await stop($, 'p1', 1)
  expect((await officeTexts($, 'terminal')).keys).toContain('pair-p1')
  expect((await officeTexts($, 'terminal')).texts.some(t => /^Working/.test(t))).toBe(true)
  await clock.advance(MIN)
  await stop($, 'p2', 2)
  for (const surface of SURFACES) {
    const { keys } = await officeTexts($, surface)
    expect(keys.some(k => k.startsWith('pair-'))).toBe(false)
    const log = await mountLog($, surface)
    const texts = (await log.findAll({ type: 'Text' })).map(t => String(t.text))
    expect(texts).toContain('Author & Critic')
    expect(texts.some(t => /Done · took 3m/.test(t))).toBe(true)
    expect(texts).toContain('FINISHED THIS SESSION · 1')
    // The members are not listed again on their own.
    const keysOfLog = (await log.findAll({})).map(n => String(n.props.key ?? ''))
    expect(keysOfLog).toContain('done-pair-p1')
    expect(keysOfLog).not.toContain('done-p1')
    expect(keysOfLog).not.toContain('done-p2')
    await log.unmount()
  }
})

test('the finished card says Failed when one member failed, and the others finishing well does not change it', async ($, on) => {
  const { clock } = office(on)
  await hire($, 'author', brief('author'))
  await hire($, 'critic', brief('critic'))
  await clock.advance(MIN)
  await stop($, 'p1', 1)
  await stop($, 'p2', 2, 'error')
  const log = await mountLog($, 'desktop')
  const texts = (await log.findAll({ type: 'Text' })).map(t => String(t.text))
  expect(texts.some(t => /^Failed after /.test(t))).toBe(true)
  expect(texts.some(t => /^Done/.test(t))).toBe(false)
  await log.unmount()
})

test('a paired specialist that is sent back to work brings its card back to the floor', async ($, on) => {
  office(on)
  await hire($, 'author', brief('author'))
  await hire($, 'critic', brief('critic'))
  await stop($, 'p1', 1)
  await stop($, 'p2', 2)
  expect((await officeTexts($, 'terminal')).keys.some(k => k.startsWith('pair-'))).toBe(false)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'p1' } as never)
  const { keys, texts } = await officeTexts($, 'terminal')
  expect(keys).toContain('pair-p1')
  expect(texts.some(t => /^Working/.test(t))).toBe(true)
})
