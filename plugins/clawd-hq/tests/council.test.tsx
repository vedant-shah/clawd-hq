import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { councilIcon, councilTinyIcon } from '../hooks/council-avatar'
import { rasterCells, trim } from '../hooks/pixels'
import { PANE, SURFACES, host, mountLog, START } from './host'

const MIN = 60_000
const QUESTION ='Should we move to Postgres?'
const brief = (role: string, question: string | null = QUESTION, effort = '') => `${effort}${question === null ? '' : `COUNCIL: ${question}\n`}You are the ${role}.`
const hire = ($: Engine, name: string, prompt: string) => $.agent.spawn({ prompt, description: `${name} view`, subagentType: 'general-purpose', name } as never)
const stop = ($: Engine, id: string, n: number, answer = 'ok', reason = 'answer') => $.turn.complete({ reason, answer, turnId: `r${n}`, agentId: id, isAborted: false } as never)

/** A host whose spawns get the ids p1, p2, ...; `prompts` is what the engine was about to send; `fills` and `sent` are the prompt box and the prompts the plugin submitted. */
function office(on: Parameters<typeof host>[0], isFilled = true) {
  const h = host(on, [])
  const prompts: string[] = []
  const fills: Array<{ text: string; mode?: string }> = []
  const sent: Array<{ text: string; asUser?: boolean }> = []
  on('agent.spawn', (_$, e) => (prompts.push((e as { prompt: string }).prompt), { model: 'claude-opus-5-5', agentId: `p${prompts.length}` }) as never)
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('prompt.fill', (_$, e) => (fills.push({ text: (e as { text: string }).text, mode: (e as { mode?: string }).mode }), { isFilled }) as never)
  on('prompt.submit', (_$, e) => (sent.push({ text: (e as { text: string }).text, asUser: (e as { origin?: { asUser?: boolean } }).origin?.asUser }), { text: (e as { text: string }).text }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  return { ...h, prompts, fills, sent }
}

async function officeTexts($: Engine, surface: 'terminal' | 'desktop') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const keys = (await ui.findAll({})).map(n => String(n.props.key ?? ''))
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  await ui.unmount()
  return { keys, texts }
}

async function hireCouncil($: Engine, question: string | null = QUESTION) {
  for (const name of ['skeptic', 'pragmatist', 'critic']) await hire($, name, brief(name, question))
}

test('voices hired with the same COUNCIL question are one card titled Council, with the question and each voice and its status', async ($, on) => {
  office(on)
  await hireCouncil($)
  for (const surface of SURFACES) {
    const { keys, texts } = await officeTexts($, surface)
    expect(keys).toContain('council-p1')
    expect(keys.some(k => /^(desk|pair)-p/.test(k))).toBe(false)
    expect(texts).toContain('Council')
    expect(texts.some(t => t.includes(QUESTION))).toBe(true)
    for (const name of ['Skeptic', 'Pragmatist', 'Critic']) expect(texts.some(t => t.includes(name))).toBe(true)
    expect(texts.filter(t => /Working/.test(t)).length).toBeGreaterThanOrEqual(3)
    // The count above the floor still counts specialists.
    expect(texts).toContain('AT WORK · 3')
  }
})

test('the council card shows the council picture, not the voices\' own: the tiny one on the terminal, the list-sized one elsewhere', async ($, on) => {
  office(on)
  await hireCouncil($)
  const terminal = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const rasters = (await terminal.findAll({ type: 'Raster' })).filter(r => String(r.props.key).startsWith('council-avatar'))
  expect(rasters.map(r => r.props.cells)).toEqual([rasterCells(trim(councilTinyIcon()))])
  expect((await terminal.findAll({ type: 'Raster' })).some(r => String(r.props.key).startsWith('pair-avatar'))).toBe(false)
  await terminal.unmount()
  const desktop = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  const svgs = (await desktop.findAll({ type: 'Svg' })).filter(s => s.props.alt === 'Council')
  expect(svgs).toHaveLength(1)
  expect(svgs[0]!.props.width).toBe(trim(councilIcon())[0]!.length * 3)
  await desktop.unmount()
})

test('the COUNCIL line comes off each brief after the effort line; a brief without it goes as it was', async ($, on) => {
  const { prompts } = office(on)
  await hire($, 'skeptic', brief('skeptic', QUESTION, '[effort: high]\n'))
  await hire($, 'plain', brief('plain', null))
  expect(prompts[0]).toMatch(/^You are the skeptic\./)
  expect(prompts[0]).not.toContain('COUNCIL')
  expect(prompts[0]).not.toContain('[effort')
  expect(prompts[1]).toMatch(/^You are the plain\./)
})

test('a council and a pair-up with the same words do not share a card', async ($, on) => {
  office(on)
  await hire($, 'author', `PAIR-UP: ${QUESTION}\nYou are the author.`)
  await hire($, 'critic', `PAIR-UP: ${QUESTION}\nYou are the critic.`)
  await hire($, 'skeptic', brief('skeptic'))
  await hire($, 'pragmatist', brief('pragmatist'))
  const { keys } = await officeTexts($, 'desktop')
  expect(keys).toContain('pair-p1')
  expect(keys).toContain('council-p3')
})

test('while any voice works the card is on the floor; once all are done it is one finished card with each voice\'s first line, wrapped', async ($, on) => {
  const { clock } = office(on)
  await hireCouncil($)
  await clock.advance(2 * MIN)
  await stop($, 'p1', 1, 'Stay on MySQL for now.\nThe move costs a quarter.')
  await stop($, 'p2', 2, '## Verdict\n\n**Move**, but in stages.')
  // Two have finished, one still works: no report lines yet.
  const mid = await officeTexts($, 'terminal')
  expect(mid.keys).toContain('council-p1')
  expect(mid.texts.some(t => t.includes('Stay on MySQL'))).toBe(false)
  await stop($, 'p3', 3, 'Neither: fix the slow queries first.')
  for (const surface of SURFACES) {
    expect((await officeTexts($, surface)).keys.some(k => k.startsWith('council-'))).toBe(false)
    const log = await mountLog($, surface)
    const texts = (await log.findAll({ type: 'Text' })).map(t => String(t.text))
    const keys = (await log.findAll({})).map(n => String(n.props.key ?? ''))
    expect(texts).toContain('Council')
    expect(texts.some(t => t.includes(QUESTION))).toBe(true)
    expect(texts.some(t => t.includes('Stay on MySQL for now.'))).toBe(true)
    expect(texts.some(t => t.includes('The move costs a quarter'))).toBe(false)
    expect(texts.some(t => t.includes('Move, but in stages.'))).toBe(true)
    expect(texts.some(t => t.includes('Neither: fix the slow queries first.'))).toBe(true)
    expect(texts.some(t => /Done · took 2m/.test(t))).toBe(true)
    expect(keys).toContain('done-council-p1')
    expect(keys).not.toContain('done-p1')
    for (const n of await log.findAll({ type: 'Text' })) if (String(n.text).includes('Stay on MySQL')) expect(n.props.wrap).toBe('wrap')
    await log.unmount()
  }
})

test('a voice that failed shows no report line, and the card says Failed', async ($, on) => {
  const { clock } = office(on)
  await hireCouncil($)
  await clock.advance(MIN)
  await stop($, 'p1', 1, 'Stay.')
  await stop($, 'p2', 2, 'Go.')
  await stop($, 'p3', 3, 'It broke.', 'error')
  const log = await mountLog($, 'desktop')
  const texts = (await log.findAll({ type: 'Text' })).map(t => String(t.text))
  expect(texts.some(t => /^Failed after /.test(t))).toBe(true)
  expect(texts.some(t => t.includes('It broke.'))).toBe(false)
  await log.unmount()
})

// ---- Clawd's card: no button, a hint for the command ----

test('Clawd\'s card has no council button; a dim line under his words says to type /office-council <question>', async ($, on) => {
  office(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ key: 'clawd-council' })).toBeUndefined()
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.label)).not.toContain('Hold a council')
    const hint = await ui.find({ type: 'Text', text: 'Type /office-council <question> to hold a council.' })
    expect(hint?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

// ---- The /office-council command (not /council: the ECC plugin has one, and the engine refuses a second) ----

test('/office-council is registered at session start, and /council is not', async ($, on) => {
  const { commands } = office(on)
  await $.session.start(START)
  expect(commands).toContain('office-council')
  expect(commands).not.toContain('council')
})

test('/office-council <question> sends "Hold a council on: <question>" as the person\'s own words', async ($, on) => {
  const { sent, fills, clock } = office(on)
  await $.session.start(START)
  const r = (await $.command.run({ command: 'office-council', args: ` ${QUESTION} ` } as never)) as { text: string }
  // The engine refuses a send made inside the command's own hook: it goes just after, as a later event.
  expect(sent).toEqual([])
  await clock.advance(1)
  expect(sent.map(s => s.text)).toEqual([`Hold a council on: ${QUESTION}`])
  expect(sent[0]!.asUser).toBe(true)
  expect(fills).toEqual([])
  expect(r.text).toContain(QUESTION)
})

test('/office-council with no question fills the prompt box and sends nothing', async ($, on) => {
  const { sent, fills } = office(on)
  await $.session.start(START)
  const r = (await $.command.run({ command: 'office-council', args: '' } as never)) as { text: string }
  expect(sent).toEqual([])
  expect(fills.map(f => f.text)).toEqual(['Hold a council on: '])
  expect(r.text).toMatch(/question/i)
})
