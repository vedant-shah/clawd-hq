import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { STEP_MS } from '../hooks/demo'
import { tourSteps } from '../hooks/demo-script'
import type { TourIo } from '../hooks/demo-script'
import { HISTORY, PANE, PEOPLE, SETTINGS, SURFACES, host, paneProps } from './host'

const COUNT = 21

// ---- The script: what each step says and does, with a recording stand-in for the office ----

/** A tour io that only writes down what it was asked, one short line per call. */
function recorder() {
  const calls: string[] = []
  const log = (name: string) => async (...args: unknown[]) => { calls.push(`${name} ${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`.trim()) }
  const io: TourIo = {
    show: log('show'), showDone: log('showDone'), plan: log('plan'), fold: log('fold'), setBusy: log('setBusy'), say: log('say'), hire: log('hire'), work: log('work'),
    report: log('report'), think: log('think'), finish: log('finish'), clearFloor: log('clearFloor'),
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

test('the tour has twenty-one steps of about four and a half seconds: a little under a hundred seconds', async () => {
  const { captions } = await stepsOf()
  expect(captions).toHaveLength(COUNT)
  expect(captions.length * STEP_MS).toBeGreaterThanOrEqual(85_000)
  expect(captions.length * STEP_MS).toBeLessThanOrEqual(100_000)
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
  const order = [/gold crown/, /Simplified Technical English/, /five best/, /plan on the Office tab/, /next to now/, /bar/, /new instruction/, /ticks its step/, /contractor/, /leaves/, /fold away/, /pair-up/, /critique/, /council/, /never read each other/, /dissent/, /History tab keeps finished goals/, /one box/, /Quiet chat/, /People/, /back to normal/i]
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
  expect(step(4)).toMatch(/plan \[\]/) // the plan appears, every step next
  expect(step(5)).toMatch(/setBusy false/)
  expect(step(5)).toMatch(/hire build .*core-builder.*sonnet.*medium.*"step":"s2"/s) // a step goes next to now with its agent
  expect(step(5)).toMatch(/work build Skill .*frontend-patterns/)
  expect(step(6)).toMatch(/report build 3 5/)
  expect(step(7)).toMatch(/report build 4 5/)
  expect(step(8)).toMatch(/finish research[\s\S]*plan \["s1"\]/) // the agent finishes, the step is ticked
  expect(step(9)).toMatch(/hire design .*clawd-hq:contractor/)
  expect(step(10)).toMatch(/finish design/)
  expect(step(11)).toMatch(/fold done true/) // the done fold opens
  expect(step(12)).toMatch(/hire pairbuild .*PAIR|hire pairbuild .*goal/s)
  expect(step(14)).toMatch(/hire skeptic[\s\S]*hire pragmatist[\s\S]*hire critic[\s\S]*hire architect/)
  expect(step(15)).toMatch(/think critic/)
  expect(step(16)).toMatch(/say .*recommend.*dissent/s)
  expect(step(17)).toMatch(/fold goal true[\s\S]*showDone true[\s\S]*show history/) // History, a finished goal opened
  expect(step(18)).toMatch(/clearFloor/)
  expect(step(18)).toMatch(/showDone false[\s\S]*plan null[\s\S]*show office/)
  expect(step(19)).toMatch(/show settings/)
  expect(step(20)).toMatch(/show people/)
  expect(step(21)).toMatch(/show office/)
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
  const read = async ($: Engine, pane: typeof PANE | typeof PEOPLE | typeof HISTORY | typeof SETTINGS, surface: (typeof SURFACES)[number] = 'desktop') => {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...pane })
    const out = { texts: await textsOf(ui), keys: (await ui.findAll({})).map(n => String(n.props.key ?? '')), has: (key: string) => ui.find({ key }) }
    return { ...out, ui }
  }
  return { ...h, spawns, to, read }
}

test('hiring: a right-sized model badge and a knowledge skill appear on the new specialist\'s card', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(5)
  const { texts, ui } = await t.read($, PANE)
  expect(texts).toContain('Builder')
  expect(texts.some(x => /Sonnet 5\.5 · /.test(x))).toBe(true) // the plan's rows leave the effort level off
  expect(texts.some(x => /Haiku 4\.5 · /.test(x))).toBe(true)
  expect(texts).toContain('Using the frontend-patterns skill')
  await ui.unmount()
})

test('progress: bars with their own short notes; a new instruction sends the Builder on to its next step, with nobody stopped', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(6)
  let r = await t.read($, PANE)
  expect(r.texts.some(x => /3 of 5/.test(x))).toBe(true)
  expect(r.texts).toContain('Writing the test for the empty case')
  await r.ui.unmount()

  await t.to(7)
  r = await t.read($, PANE)
  expect(r.texts.some(x => /4 of 5/.test(x))).toBe(true)
  expect(r.texts.some(x => /New note for the Builder/.test(x))).toBe(true) // Clawd's bubble
  expect(r.texts).toContain('Builder') // nobody left
  expect(r.texts).toContain('Researcher')
  await r.ui.unmount()
})

// ---- The plan and the History tab, on both surfaces ----

const flat = (texts: string[]) => texts.join('\n')

test('beat 1: a plan appears on the Office tab, every step waiting as next', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(3)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    expect(flat(r.texts)).not.toContain('Export the scores') // not before its step
    await r.ui.unmount()
  }
  await t.to(4)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    const text = flat(r.texts)
    for (const words of ['Export the scores', 'Find how exports work now', 'Add the export button', 'Style the export button']) expect(text, `${surface} ${words}`).toContain(words)
    expect(text, surface).toMatch(/0 of 4/)
    expect(r.keys, surface).not.toContain('desk-demo-build') // nobody is at work yet
    await r.ui.unmount()
  }
})

test('beat 2: a step goes from next to now, with the agent under it', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(5)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    const text = flat(r.texts)
    expect(text, surface).toContain('Builder')
    expect(text, surface).toContain('Researcher')
    // Under its step, in the plan, not on the "Also at work" list; the step it works on is now, the last one still next.
    expect(text, surface).not.toContain('ALSO AT WORK')
    expect(text.indexOf('Add the export button'), surface).toBeLessThan(text.indexOf('Builder'))
    expect(text.indexOf('Builder'), surface).toBeLessThan(text.indexOf('Style the export button'))
    expect(r.keys, surface).toContain(surface === 'terminal' ? 'agent-demo-build-h-0' : 'desk-demo-build')
    await r.ui.unmount()
  }
})

test('beat 3: the step is ticked when its agent finishes', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(7)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    expect(flat(r.texts), surface).toMatch(/0 of 4/)
    await r.ui.unmount()
  }
  await t.to(8)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    expect(flat(r.texts), surface).toMatch(/1 of 4/)
    expect(r.keys.some(k => k.startsWith('done-s1')), surface).toBe(true)
    await r.ui.unmount()
  }
})

test('beat 4: the done fold is opened, and shows the earlier done steps', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(10)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    expect(flat(r.texts), surface).toMatch(/2 steps done/) // folded
    expect(flat(r.texts), surface).not.toContain('Find how exports work now')
    await r.ui.unmount()
  }
  await t.to(11)
  for (const surface of SURFACES) {
    const r = await t.read($, PANE, surface)
    expect(flat(r.texts), surface).toContain('Find how exports work now')
    expect(flat(r.texts), surface).toContain('Add the export button')
    await r.ui.unmount()
  }
})

test('beat 5: the History tab shows a finished goal, opened to its steps', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(16)
  for (const surface of SURFACES) {
    const r = await t.read($, HISTORY, surface)
    expect(flat(r.texts), surface).not.toContain('Find why the login fails')
    await r.ui.unmount()
  }
  await t.to(17)
  for (const surface of SURFACES) {
    const r = await t.read($, HISTORY, surface)
    const text = flat(r.texts)
    for (const words of ['Fix the login page', 'Find why the login fails', 'Fix the form check', 'Add a test for it', '1 retry']) expect(text, `${surface} ${words}`).toContain(words)
    await r.ui.unmount()
  }
})

test('the tour writes no plan file and no history line: the fake host\'s files are untouched from start to cleanup', async ($, on) => {
  const t = await tour(on)
  const before = JSON.stringify([...t.files.entries()])
  await $.command.run({ command: 'office-demo', args: '' } as never)
  for (let n = 1; n <= COUNT; n++) {
    await t.to(n)
    for (const surface of SURFACES) { const r = await t.read($, HISTORY, surface); await r.ui.unmount() }
  }
  await t.clock.advance(STEP_MS * 2)
  expect(JSON.stringify([...t.files.entries()])).toBe(before)
  expect(t.files.size).toBe(0)
})

test('a contractor wears its badge at work, then leaves', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(9)
  let r = await t.read($, PANE)
  expect(r.texts).toContain('Designer')
  expect(r.texts.some(x => /· 🪪 Contractor/.test(x))).toBe(true)
  await r.ui.unmount()

  await t.to(10)
  r = await t.read($, PANE)
  expect(r.texts).not.toContain('Designer')
  expect(r.texts.some(x => /Contractor/.test(x))).toBe(false)
  await r.ui.unmount()
})

test('a pair-up: the builder and the reviewer share one card, and a finished member is dimmed while the other works', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(12)
  let r = await t.read($, PANE)
  expect(r.keys).toContain('pair-demo-pairbuild')
  expect(r.keys).not.toContain('desk-demo-pairbuild')
  expect(r.texts).toContain('Builder & Reviewer')
  expect(r.texts.filter(x => /^Working/.test(x))).toHaveLength(1)
  await r.ui.unmount()

  await t.to(13)
  r = await t.read($, PANE)
  // With a plan in hand, "Also at work" lists those at work: the reviewer, still working, stands on its own card.
  expect(r.keys).toContain('desk-demo-pairreview')
  await r.ui.unmount()
})

test('a council: one Council card with its own picture, four voices, each with a status', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(14)
  let r = await t.read($, PANE)
  expect(r.keys).toContain('council-demo-skeptic')
  expect(r.texts).toContain('Council')
  for (const voice of ['Skeptic', 'Pragmatist', 'Critic', 'Architect']) expect(r.texts).toContain(voice)
  expect(r.texts.filter(x => x === ' · Working')).toHaveLength(4)
  expect(r.keys.some(k => k.startsWith('pair-'))).toBe(false) // the pair-up is over
  await r.ui.unmount()

  await t.to(15)
  r = await t.read($, PANE)
  // With a plan in hand, "Also at work" lists those still at work: the three that answered have left it.
  expect(r.texts).toContain('ALSO AT WORK · 1') // the Critic, still reading, alone
  expect(r.texts).toContain('Critic')
  expect(r.texts).not.toContain('Skeptic')
  await r.ui.unmount()
})

test('the summing up: a recommendation marked as Clawd\'s, the lone dissent kept, and you decide', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(16)
  const r = await t.read($, PANE)
  const bubble = r.texts.find(x => /recommend/i.test(x))
  expect(bubble).toMatch(/dissent/i)
  expect(bubble).toMatch(/your call|you decide/i)
  expect(r.keys.some(k => k.startsWith('council-'))).toBe(false) // every voice has answered
  await r.ui.unmount()
})

test('finished work: on the History tab each member of the pair-up and the council is a line of its own, with no picture and no report', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(17)
  const r = await t.read($, HISTORY) // the History tab, its Other work open
  const lines = r.keys.filter(k => k.startsWith('history-run-demo-'))
  for (const one of ['skeptic', 'pragmatist', 'critic', 'architect', 'pairbuild']) expect(lines.some(k => k.startsWith(`history-run-demo-${one}@`)), one).toBe(true)
  expect(r.keys.some(k => k.startsWith('done-'))).toBe(false)
  expect(r.texts.some(x => /^Dissent: |^Decided: /.test(x))).toBe(false)
  await r.ui.unmount()
})

test('questions come in one batch; the floor is clear for the quiet steps', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(18)
  const r = await t.read($, PANE)
  expect(r.texts.some(x => /one go|one box|one batch/i.test(x))).toBe(true)
  expect(r.texts).toContain('No one at a desk yet.')
  await r.ui.unmount()
})

test('quiet mode: the Settings tab shows its Quiet chat switch, on its own page of switches', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(19)
  const r = await t.read($, SETTINGS)
  expect(r.texts).toContain('Quiet chat')
  expect(r.keys).toContain('config-quietChat') // the page of switches
  await r.ui.unmount()
})

test('People shows the stand-in team with short descriptions and token totals, not the real team', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(20)
  const r = await t.read($, PEOPLE)
  expect(r.texts).toContain('TEAM · 5')
  expect(r.texts.filter(x => /^\d+(\.\d)?[KM] tokens$/.test(x)).length).toBeGreaterThanOrEqual(4)
  expect(new Set(r.keys.filter(k => k.startsWith('person-ecc:')))).toHaveProperty('size', 5)
  await r.ui.unmount()
})

test('People on the tour shows each stand-in\'s token line, though this project has used no tokens', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(20)
  const r = await t.read($, PEOPLE)
  expect(r.texts.filter(x => / tokens$/.test(x)).sort()).toEqual(['177K tokens', '268K tokens', '412K tokens', '530K tokens', '96K tokens'])
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

test('afterwards the office is as it was found: no stand-ins, no caption, Clawd as he was, the real team back in People', async ($, on) => {
  const t = await tour(on)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await t.to(COUNT)
  await t.to(COUNT + 1) // the clean-up comes a second and a half after the last step
  await t.clock.advance(STEP_MS)

  for (const pane of [PANE, PEOPLE, HISTORY, SETTINGS]) {
    const r = await t.read($, pane)
    expect(r.texts.some(x => x.includes('🎬'))).toBe(false)
    expect(r.keys.some(k => /demo/.test(k))).toBe(false)
    await r.ui.unmount()
  }
  const office = await t.read($, PANE)
  expect(office.texts).toContain('No one at a desk yet.')
  expect(office.texts.some(x => /recommend/i.test(x))).toBe(false)
  await office.ui.unmount()

  // History's Other work is closed again, and with the stand-ins gone it has nothing to show.
  const history = await t.read($, paneProps('clawd-hq-history', 'History'))
  expect(history.keys).not.toContain('history-other-rows')
  expect(history.keys).not.toContain('history-other')
  await history.ui.unmount()

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
