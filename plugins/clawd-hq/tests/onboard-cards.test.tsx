// Onboarding, piece 7: the cards. The drawing is mounted in a pane of the test's own (the real pane is wired in piece 8),
// on both surfaces the test kit mounts, from fake OnboardCard data.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { OFFER_COST_LINE, SKILLS_NOTE, onboardSection } from '../hooks/panel-onboard'
import type { OnboardButton, OnboardCard } from '../hooks/onboard-types'
import { ROLES } from '../hooks/onboard-types'
import { kitOf } from '../hooks/panel-kit'
import type { PanelTools } from '../hooks/panel-kit'
import { SURFACES, START, host, paneProps } from './host'

const PLUGIN = 'onboard-cards-pane'
const STAND_IN = paneProps(PLUGIN, 'Setup')

/** What the drawing is handed, and the buttons pressed on it. */
const stage = { card: undefined as OnboardCard | undefined, pressed: [] as OnboardButton[] }

/** The pane's drawing: the section for the staged card, with presses recorded on the stage. */
function drawStage(ui: PanelTools, surface: string) {
  const tools: PanelTools = {
    Box: ui.Box, Text: ui.Text, Button: ui.Button, Link: ui.Link, Markdown: ui.Markdown,
    Raster: surface === 'terminal' ? ui.Raster : undefined,
    Svg: surface === 'terminal' ? undefined : ui.Svg,
  }
  const kit = kitOf(tools)
  return <kit.Box flexDirection="column">{onboardSection(kit, stage.card, { choose: b => { stage.pressed = [...stage.pressed, b] } })}</kit.Box>
}

type On = Parameters<typeof host>[0]
/** The quiet host, with a pane of the test's own beneath the office's: the plugin passes an id it does not know down to it. */
function quiet(on: On) {
  const h = host(on, [])
  // A render hook's `$` can resolve the surface's elements; the test engine's type leaves that call out.
  on('ui.render', { component: 'Pane', requestId: PLUGIN } as never, (($: { ui: { resolve: (e: unknown) => unknown } }, e: { surface: string }) =>
    drawStage($.ui.resolve(e) as never, e.surface)) as never)
  return h
}

const LONG = 'used 12 times here in this project, named in CLAUDE.md, and listed in the README as the way to plan a change before it is made'
const TEAM = {
  picks: [
    { seat: 'Plan', name: 'ecc:planner', kind: 'agent', receipt: 'used 12× here' },
    { seat: 'Make', name: 'ecc:tdd-guide', kind: 'agent', receipt: LONG },
    { seat: 'Find out', name: 'deep-research', kind: 'skill', receipt: 'named in CLAUDE.md' },
  ],
  empty: ['Check', 'Specialist'],
  by: 'opus',
} as const

const btn = (action: OnboardButton['action'], label: string, isPrimary?: true): OnboardButton => (isPrimary ? { action, label, isPrimary } : { action, label })

const CARDS: Record<string, OnboardCard> = {
  offer: { step: 'offer', lines: ['Want me to set up your team?'], buttons: [btn('start', 'Start', true), btn('later', 'Later'), btn('skip', 'Skip')] },
  intro: { step: 'intro', lines: ['I am Clawd. I run your team and hand work to specialists.', 'First I will look around this folder.'], buttons: [btn('yes', 'Yes', true), btn('no', 'No')] },
  scan: { step: 'scan', lines: [], buttons: [] },
  fallback: { step: 'scan', lines: ['I could not tell what you do here. Which fits best?'], buttons: ROLES.map(r => btn('changeRole', r)) },
  team: {
    step: 'team', lines: [], role: 'Software engineer', team: TEAM as never, parked: 3, searchSeat: 'Check',
    buttons: [btn('changeRole', 'Change'), btn('hire', 'Hire this team', true), btn('adjust', 'Adjust in People'), btn('searchYes', 'Yes'), btn('searchNo', 'No')],
  },
  workflow: {
    step: 'workflow', lines: ['This is how you seem to work:'], workflow: ['Plan first', 'Write tests', 'Build it', 'Review', 'Commit', 'Sixth step is left out'],
    buttons: [btn('useWorkflow', 'Use this', true), btn('skipWorkflow', 'Skip')],
  },
  first: { step: 'first', lines: ['What is the first thing you want done here?'], suggestion: 'Add tests for the login flow', buttons: [btn('useFirst', 'Use this', true)] },
}

async function draw($: Engine, surface: (typeof SURFACES)[number], card: OnboardCard | undefined) {
  stage.card = card
  stage.pressed = []
  // The drawing is the test's own hook, so its elements belong to the plugin named `test`.
  return $.ui.mount({ plugin: 'test', surface, ...STAND_IN })
}
const textsOf = async (ui: Awaited<ReturnType<typeof draw>>) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
const labelsOf = async (ui: Awaited<ReturnType<typeof draw>>) => (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label))

test('the start card offers Start, Later and Skip, and says what setup costs', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.offer)
    const all = await textsOf(ui)
    expect(all).toContain('Want me to set up your team?')
    expect(all).toContain(OFFER_COST_LINE)
    expect(OFFER_COST_LINE).toMatch(/Opus/)
    expect(OFFER_COST_LINE).toMatch(/\$0\.20/)
    expect(await labelsOf(ui)).toEqual(['Start', 'Later', 'Skip'])
    await ui.press({ key: 'onboard-later' })
    expect(stage.pressed.map(b => b.action)).toEqual(['later'])
    await ui.unmount()
  }
})

test('the intro shows Clawd\'s words with Yes and No', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.intro)
    const all = await textsOf(ui)
    expect(all).toContain('I am Clawd. I run your team and hand work to specialists.')
    expect(all).toContain('First I will look around this folder.')
    expect(all).not.toContain(OFFER_COST_LINE)
    expect(await labelsOf(ui)).toEqual(['Yes', 'No'])
    await ui.unmount()
  }
})

test('the scan shows that Clawd is looking around, with no buttons', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.scan)
    expect((await textsOf(ui)).some(t => /Looking around/.test(t))).toBe(true)
    expect(await labelsOf(ui)).toEqual([])
    await ui.unmount()
  }
})

test('when the evidence is thin, every role is a button and the press says which', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.fallback)
    expect(await labelsOf(ui)).toEqual([...ROLES])
    await ui.press({ key: 'onboard-changeRole-2' })
    expect(stage.pressed.map(b => b.label)).toEqual([ROLES[2]])
    await ui.unmount()
  }
})

test('the team card says the role with Change, lists each seat in order with its receipt, and counts the team and the parked', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.team)
    const all = await textsOf(ui)
    const joined = all.join('\n')
    expect(joined).toMatch(/Looks like you're a/)
    expect(joined).toMatch(/Software engineer/)
    expect(joined).toMatch(/Starting team \(3\) · Parked 3/)
    // Seats come in the card's order, and a receipt is never cut.
    const at = (s: string) => joined.indexOf(s)
    expect(at('ecc:planner')).toBeGreaterThan(-1)
    expect(at('ecc:planner')).toBeLessThan(at('ecc:tdd-guide'))
    expect(at('ecc:tdd-guide')).toBeLessThan(at('deep-research'))
    expect(all).toContain('used 12× here')
    expect(all).toContain(LONG)
    expect(all).toContain(SKILLS_NOTE)
    expect(SKILLS_NOTE).toMatch(/Skills/)
    expect(SKILLS_NOTE).toMatch(/agents/)
    expect(await labelsOf(ui)).toEqual(['Change', 'Yes', 'No', 'Hire this team', 'Adjust in People'])
    await ui.press({ key: 'onboard-hire' })
    await ui.press({ key: 'onboard-adjust' })
    await ui.press({ key: 'onboard-changeRole' })
    expect(stage.pressed.map(b => b.action)).toEqual(['hire', 'adjust', 'changeRole'])
    await ui.unmount()
  }
})

test('an empty seat is offered a skills.sh search only when the card names one', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  const without: OnboardCard = { ...CARDS.team!, searchSeat: undefined, buttons: CARDS.team!.buttons.filter(b => !b.action.startsWith('search')) }
  for (const surface of SURFACES) {
    let ui = await draw($, surface, CARDS.team)
    expect((await textsOf(ui)).join('\n')).toMatch(/Search skills\.sh for a Check helper\?/)
    expect((await textsOf(ui)).join('\n')).toMatch(/Specialist/)
    await ui.press({ key: 'onboard-searchYes' })
    expect(stage.pressed.map(b => b.action)).toEqual(['searchYes'])
    await ui.unmount()
    ui = await draw($, surface, without)
    expect((await textsOf(ui)).join('\n')).not.toMatch(/skills\.sh/)
    expect(await labelsOf(ui)).toEqual(['Change', 'Hire this team', 'Adjust in People'])
    await ui.unmount()
  }
})

test('a team with no picks and no parked count still draws, without a Parked part', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  const bare: OnboardCard = { step: 'team', lines: [], role: 'Web developer', team: { picks: [], empty: ['Plan'], by: 'rules' }, buttons: [btn('adjust', 'Adjust in People')] }
  for (const surface of SURFACES) {
    const ui = await draw($, surface, bare)
    const joined = (await textsOf(ui)).join('\n')
    expect(joined).toMatch(/Starting team \(0\)/)
    expect(joined).not.toMatch(/Parked/)
    await ui.unmount()
  }
})

test('the workflow card shows at most five numbered steps with Use this and Skip', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.workflow)
    const all = await textsOf(ui)
    expect(all).toEqual(expect.arrayContaining(['1. Plan first', '2. Write tests', '3. Build it', '4. Review', '5. Commit']))
    expect(all.some(t => /Sixth step/.test(t))).toBe(false)
    expect(await labelsOf(ui)).toEqual(['Use this', 'Skip'])
    await ui.press({ key: 'onboard-useWorkflow' })
    expect(stage.pressed.map(b => b.action)).toEqual(['useWorkflow'])
    await ui.unmount()
  }
})

test('the first-job card shows the question, the suggestion and Use this', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, CARDS.first)
    const all = await textsOf(ui)
    expect(all).toContain('What is the first thing you want done here?')
    expect(all).toContain('Add tests for the login flow')
    expect(await labelsOf(ui)).toEqual(['Use this'])
    await ui.unmount()
  }
})

test('a note is shown plain and dim', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, { ...CARDS.offer!, note: 'Cannot change that setting from here.' })
    expect((await ui.find({ type: 'Text', text: /^Cannot change that setting from here\.$/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('with no card, or a finished one, nothing is drawn', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    for (const card of [undefined, { step: 'done', lines: ['x'], buttons: [] }, { step: 'skipped', lines: ['x'], buttons: [] }] as Array<OnboardCard | undefined>) {
      const ui = await draw($, surface, card)
      expect(await textsOf(ui)).toEqual([])
      expect(await labelsOf(ui)).toEqual([])
      await ui.unmount()
    }
  }
})

/** The Text props of Claude Code 2.1.295 that the brief allows here; a desktop `bold` also carries a `weight` of the engine's own. */
const ALLOWED = new Set(['color', 'dimColor', 'bold', 'wrap', 'children', 'key'])

test('every step draws only the Text props the older desktop engine takes, and every long line wraps', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  const odd: string[] = []
  for (const surface of SURFACES) {
    for (const [name, card] of Object.entries(CARDS)) {
      const ui = await draw($, surface, card)
      for (const t of await ui.findAll({ type: 'Text' })) {
        for (const p of Object.keys(t.props)) if (!ALLOWED.has(p) && !(p === 'weight' && t.props.bold === true)) odd.push(`${name}/${surface}: ${p}`)
        if (String(t.text).length > 24 && t.props.wrap !== 'wrap') odd.push(`${name}/${surface}: long text without wrap: ${String(t.text).slice(0, 20)}`)
      }
      await ui.unmount()
    }
  }
  expect([...new Set(odd)]).toEqual([])
})
