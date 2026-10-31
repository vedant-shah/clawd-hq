import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { STEP_MS } from '../hooks/demo'
import { tourSteps } from '../hooks/demo-script'
import type { TourIo } from '../hooks/demo-script'
import { PANE, PEOPLE, SETTINGS, host, paneProps } from './host'

const COUNT = 20

// ---- The script: what each step says and does, with a recording stand-in for the office ----

/** A tour io that only writes down what it was asked, one short line per call. */
function recorder() {
  const calls: string[] = []
  const log = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.trim()) }
  const io: TourIo = {
    show: log('show'), showLog: log('showLog'), setBusy: log('setBusy'), say: log('say'), hire: log('hire'), work: log('work'),
    report: log('report'), think: log('think'), finish: log('finish'), clearFloor: log('clearFloor'), goQuiet: log('goQuiet'), recap: log('recap'),
  }
  return { io, calls }
}

async function stepsOf() {
  const { io, calls } = recorder()
  const steps = tourSteps(io)
  const ran: string[][] = []
  for (const [, run] of steps) {
    calls.length = 0
    await run()
    ran.push([...calls])
  }
  return { captions: steps.map(([caption]) => caption), ran }
}

test('the tour has twenty steps of about four and a half seconds: about ninety seconds', async () => {
  const { captions } = await stepsOf()
  expect(captions).toHaveLength(COUNT)
  expect(captions.length * STEP_MS).toBeGreaterThanOrEqual(85_000)
  expect(captions.length * STEP_MS).toBeLessThanOrEqual(95_000)
})

test('every caption is plain and short: one idea, under twenty-five words, no jargon', async () => {
  const { captions } = await stepsOf()
  for (const caption of captions) {
    expect(caption.trim()).not.toBe('')
    expect(caption.split(/\s+/).length).toBeLessThanOrEqual(25)
  }
  expect(captions.join(' ')).not.toMatch(/\b(subagent|API|JSON|tokenizer|SendMessage)\b/)
})

test('the captions tell the features in story order', async () => {
  const { captions } = await stepsOf()
  const at = (word: RegExp) => captions.findIndex(c => word.test(c))
  const order = [/gold crown/, /Simplified Technical English/, /five best/, /smallest model/, /bar/, /new instruction/, /bar fills again/, /contractor/, /leaves/, /pair-up/, /critique/, /council/, /never read each other/, /dissent/, /one card each/, /one box/, /Quiet chat/, /Where we left off/, /People/, /back to normal/i]
  const found = order.map(at)
  expect(found.every(i => i >= 0)).toBe(true)
  expect(found).toEqual([...found].sort((a, b) => a - b))
  expect(captions[at(/dissent/)]).toMatch(/You decide/)
  expect(captions[at(/one box/)]).toContain('Your answer settles the job at hand only.')
})

test('each step does what its caption says', async () => {
  const { ran } = await stepsOf()
  const step = (n: number) => ran[n - 1]!.join('\n')
  expect(step(1)).toMatch(/show office/)
  expect(step(3)).toMatch(/setBusy true/)
  expect(step(4)).toMatch(/setBusy false/)
  expect(step(4)).toMatch(/hire build .*core-builder.*sonnet.*medium/s)
  expect(step(4)).toMatch(/work build Skill .*frontend-patterns/)
  expect(step(5)).toMatch(/report build 3 5/)
  expect(step(6)).toMatch(/report build 1 5/) // the bar dips
  expect(step(7)).toMatch(/report build 4 5/) // and fills again
  expect(step(8)).toMatch(/hire design .*clawd-hq:contractor/)
  expect(step(9)).toMatch(/finish design/)
  expect(step(10)).toMatch(/hire pairbuild .*PAIR|hire pairbuild .*goal/s)
  expect(step(12)).toMatch(/hire skeptic[\s\S]*hire pragmatist[\s\S]*hire critic[\s\S]*hire architect/)
  expect(step(13)).toMatch(/think critic/)
  expect(step(14)).toMatch(/say .*recommend.*dissent/s)
  expect(step(15)).toMatch(/showLog true[\s\S]*show settings/)
  expect(step(16)).toMatch(/clearFloor/)
  expect(step(17)).toMatch(/showLog false[\s\S]*show settings|show settings/)
  expect(step(18)).toMatch(/goQuiet[\s\S]*recap/)
  expect(step(19)).toMatch(/show people/)
  expect(step(20)).toMatch(/show office/)
})

// ---- The real panel: each feature's card appears in its step, drawn by the product's own code ----

const textsOf = (ui: { findAll(query: { type: string }): Promise<Array<{ text?: unknown }>> }) =>
  ui.findAll({ type: 'Text' }).then(all => all.map(t => String(t.text)))

/** Plays the tour on a held clock; `to(n)` runs until step n has begun. */
async function tour(on: Parameters<typeof host>[0]) {
  const h = host(on, [])
  const spawns: unknown[] = []
  on('agent.spawn', (_$, e) => (spawns.push(e), { model: 'claude-opus-5-5', agentId: 'x1' }) as never)
  let elapsed = 0
  const to = async (n: number) => {
    const at = (n - 1) * STEP_MS + 100
    await h.clock.advance(at - elapsed)
    elapsed = at
  }
  const read = async ($: Engine, pane: typeof PANE | typeof PEOPLE | typeof SETTINGS) => {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...pane })
    const out = { texts: await textsOf(ui), keys: (await ui.findAll({})).map(n => String(n.props.key ?? '')), has: (key: string) => ui.find({ key }) }
    return { ...out, ui }
  }
  return { ...h, spawns, to, read }
}

test('hiring: a right-sized model badge and a knowledge skill appear on the new specialist\'s card', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(4)
  const { texts, ui } = await t.read($, PANE)
  expect(texts).toContain('Builder')
  expect(texts.some(x => /Sonnet 5\.5 · medium/.test(x))).toBe(true)
  expect(texts.some(x => /Haiku 4\.5 · low/.test(x))).toBe(true)
  expect(texts).toContain('Using the frontend-patterns skill')
  await ui.unmount()
})

test('progress: bars with their own short notes; a new instruction dips the Builder\'s bar and it fills again, with nobody stopped', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(5)
  let r = await t.read($, PANE)
  expect(r.texts).toContain('Step 3 of 5')
  expect(r.texts).toContain('Writing the test for the empty case')
  await r.ui.unmount()

  await t.to(6)
  r = await t.read($, PANE)
  expect(r.texts).toContain('Step 1 of 5')
  expect(r.texts).toContain('Taking in the new instruction')
  expect(r.texts.some(x => /New note for the Builder/.test(x))).toBe(true) // Clawd's bubble
  expect(r.texts).toContain('AT WORK · 2') // nobody left
  await r.ui.unmount()

  await t.to(7)
  r = await t.read($, PANE)
  expect(r.texts).toContain('Step 4 of 5')
  await r.ui.unmount()
})

test('a contractor wears its badge at work, then leaves', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(8)
  let r = await t.read($, PANE)
  expect(r.texts).toContain('Designer')
  expect(r.texts.some(x => /· 🪪 Contractor/.test(x))).toBe(true)
  await r.ui.unmount()

  await t.to(9)
  r = await t.read($, PANE)
  expect(r.texts).not.toContain('Designer')
  expect(r.texts.some(x => /Contractor/.test(x))).toBe(false)
  await r.ui.unmount()
})

test('a pair-up: the builder and the reviewer share one card, and a finished member is dimmed while the other works', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(10)
  let r = await t.read($, PANE)
  expect(r.keys).toContain('pair-demo-pairbuild')
  expect(r.keys).not.toContain('desk-demo-pairbuild')
  expect(r.texts).toContain('Builder & Reviewer')
  expect(r.texts.filter(x => /^Working/.test(x))).toHaveLength(1)
  await r.ui.unmount()

  await t.to(11)
  r = await t.read($, PANE)
  expect(r.keys).toContain('pair-demo-pairbuild') // the reviewer still works
  await r.ui.unmount()
})

test('a council: one Council card with its own picture, four voices, each with a status', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(12)
  let r = await t.read($, PANE)
  expect(r.keys).toContain('council-demo-skeptic')
  expect(r.keys).toContain('council-avatar')
  expect(r.texts).toContain('Council')
  for (const voice of ['Skeptic', 'Pragmatist', 'Critic', 'Architect']) expect(r.texts).toContain(voice)
  expect(r.texts.filter(x => x === ' · Working')).toHaveLength(4)
  expect(r.keys.some(k => k.startsWith('pair-'))).toBe(false) // the pair-up is over
  await r.ui.unmount()

  await t.to(13)
  r = await t.read($, PANE)
  expect(r.texts.filter(x => x === ' · Done')).toHaveLength(3)
  expect(r.texts.filter(x => x === ' · Thinking')).toHaveLength(1)
  await r.ui.unmount()
})

test('the summing up: a recommendation marked as Clawd\'s, the lone dissent kept, and you decide', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(14)
  const r = await t.read($, PANE)
  const bubble = r.texts.find(x => /recommend/i.test(x))
  expect(bubble).toMatch(/dissent/i)
  expect(bubble).toMatch(/your call|you decide/i)
  expect(r.keys.some(k => k.startsWith('council-'))).toBe(false) // every voice has answered
  await r.ui.unmount()
})

test('finished work: the pair-up and the council are one card each, with what each member reported', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(15)
  const r = await t.read($, SETTINGS)
  expect(r.keys).toContain('done-council-demo-skeptic')
  expect(r.keys).toContain('done-pair-demo-pairbuild')
  expect(r.texts.filter(x => /^Council$/.test(x))).toHaveLength(1)
  for (const voice of ['Skeptic', 'Pragmatist', 'Critic', 'Architect']) expect(r.texts).toContain(voice)
  expect(r.texts.some(x => /^Dissent: /.test(x))).toBe(true) // the Critic's first line
  expect(r.texts.some(x => /^Decided: /.test(x))).toBe(true) // the pair-up's choice
  await r.ui.unmount()
})

test('questions come in one batch; the floor is clear for the quiet steps', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(16)
  const r = await t.read($, PANE)
  expect(r.texts.some(x => /one go|one box|one batch/i.test(x))).toBe(true)
  expect(r.texts).toContain('No one at a desk yet.')
  await r.ui.unmount()
})

test('quiet mode: the Settings tab shows its Quiet chat switch, on its own page of switches', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(17)
  const r = await t.read($, SETTINGS)
  expect(r.texts).toContain('Quiet chat')
  expect(r.keys).toContain('settings-log') // switches, not the finished list
  await r.ui.unmount()
})

test('the recap has its own section on Clawd\'s card: where we left off, and the next step', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(18)
  const r = await t.read($, PANE)
  expect(r.texts).toContain('WHERE WE LEFT OFF')
  expect(r.texts).toContain('Next:')
  await r.ui.unmount()
})

test('People shows the stand-in team with short descriptions and token totals, not the real team', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(19)
  const r = await t.read($, PEOPLE)
  expect(r.texts).toContain('TEAM · 5')
  expect(r.texts.filter(x => /^\d+(\.\d)?[KM] tokens$/.test(x)).length).toBeGreaterThanOrEqual(4)
  expect(new Set(r.keys.filter(k => k.startsWith('person-ecc:')))).toHaveProperty('size', 5)
  await r.ui.unmount()
})

// ---- Nothing real: no spawn, no toast, no saved change; and the office is as it was ----

test('nothing real is spawned, saved or announced, and every card has the caption on top', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  const before = JSON.stringify([...t.saved.entries()])
  for (let n = 1; n <= COUNT; n++) {
    await t.to(n)
    const r = await t.read($, PANE)
    expect(r.texts.some(x => new RegExp(`^🎬 ${n}/${COUNT} · `).test(x))).toBe(true)
    await r.ui.unmount()
  }
  expect(t.spawns).toEqual([])
  expect(t.toasts).toEqual([])
  expect(JSON.stringify([...t.saved.entries()])).toBe(before)
})

test('afterwards the office is as it was found: no stand-ins, no caption, no recap, Clawd as he was, the real team back in People', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(COUNT)
  await t.to(COUNT + 1) // the clean-up comes a second and a half after the last step
  await t.clock.advance(STEP_MS)

  for (const pane of [PANE, PEOPLE, SETTINGS]) {
    const r = await t.read($, pane)
    expect(r.texts.some(x => x.includes('🎬'))).toBe(false)
    expect(r.keys.some(k => /demo/.test(k))).toBe(false)
    await r.ui.unmount()
  }
  const office = await t.read($, PANE)
  expect(office.texts).toContain('No one at a desk yet.')
  expect(office.texts).not.toContain('WHERE WE LEFT OFF')
  expect(office.texts.some(x => /recommend/i.test(x))).toBe(false)
  await office.ui.unmount()

  const settings = await t.read($, paneProps('clawd-hq-settings', 'Settings'))
  expect(settings.keys).toContain('settings-log') // the finished list is closed again
  expect((await settings.has('settings-log'))?.props.label).toBe('Finished this session · 0 ›')
  await settings.ui.unmount()

  const people = await t.read($, PEOPLE)
  expect(people.keys.some(k => k.startsWith('person-'))).toBe(false)
  await people.ui.unmount()
})

test('a second tour started during the first replaces it and still leaves the office clean', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.clock.advance(3 * STEP_MS)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.clock.advance(COUNT * STEP_MS + 2_000)
  const r = await t.read($, PANE)
  expect(r.texts.some(x => x.includes('🎬'))).toBe(false)
  expect(r.texts).toContain('No one at a desk yet.')
  await r.ui.unmount()
})
