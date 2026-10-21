// Onboarding: the cards. Setup runs by itself, so there are only three: the quiet "looking around" line while it works,
// the small card afterwards that says what was set up (one dim Dismiss button), and the stopped card with what went wrong.
// The drawing is mounted in a pane of the test's own, on both surfaces the test kit mounts, from fake OnboardCard data.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { DONE_HEAD, DONE_TAIL, doneCard, failedCard, hireNote, scanCard, teamNames, QUIET } from '../hooks/onboard-cards'
import type { OnboardButton, OnboardCard, Team } from '../hooks/onboard-types'
import { onboardSection } from '../hooks/panel-onboard'
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

async function draw($: Engine, surface: (typeof SURFACES)[number], card: OnboardCard | undefined) {
  stage.card = card
  stage.pressed = []
  // The drawing is the test's own hook, so its elements belong to the plugin named `test`.
  return $.ui.mount({ plugin: 'test', surface, ...STAND_IN })
}
const textsOf = async (ui: Awaited<ReturnType<typeof draw>>) => (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
const buttonsOf = async (ui: Awaited<ReturnType<typeof draw>>) => ui.findAll({ type: 'Button' })

const pick = (seat: Team['picks'][number]['seat'], name: string, kind: 'agent' | 'skill' = 'agent') => ({ seat, name, kind, receipt: 'r' })

test('the team is told in plain role words, in the card\'s seat order, each role once', () => {
  const team: Team = {
    picks: [
      pick('Plan', 'ecc:planner'), pick('Make', 'clawd-hq:core-builder'), pick('Check', 'ecc:code-reviewer'),
      pick('Check', 'ecc:security-reviewer'), pick('Find out', 'clawd-hq:core-researcher'), pick('Specialist', 'ecc:tdd-workflow', 'skill'),
    ],
    empty: [], by: 'rules',
  }
  expect(teamNames(team)).toEqual(['Planner', 'Builder', 'Reviewer', 'Security Guard', 'Researcher', 'Tester'])
  expect(teamNames({ ...team, picks: [pick('Check', 'a:code-reviewer'), pick('Check', 'b:code-reviewer')] })).toEqual(['Reviewer'])
  expect(teamNames({ ...team, picks: [] })).toEqual([])
})

test('the after-card says what was set up, with the names, and offers one Dismiss', () => {
  const card = doneCard(['Planner', 'Builder', 'Reviewer'])
  expect(card.step).toBe('done')
  expect(card.lines).toEqual([`${DONE_HEAD}Planner, Builder, Reviewer.`, DONE_TAIL])
  expect(card.buttons).toEqual([{ action: 'dismiss', label: 'Dismiss' }])
  expect(DONE_HEAD).toBe('Set up your team for this project: ')
  expect(DONE_TAIL).toBe('Change it in People or Settings, or run /office-setup again.')
})

test('with no team names the after-card still says setup ran and how to run it again', () => {
  const card = doneCard([])
  expect(card.lines[0]).toMatch(/Set up this project/)
  expect(card.lines[1]).toBe(DONE_TAIL)
})

test('a note on the after-card is kept for the draw', () => {
  expect(doneCard(['Planner'], 'Claude Code would not add: tdd.').note).toBe('Claude Code would not add: tdd.')
  expect(doneCard(['Planner']).note).toBeUndefined()
})

test('a first stop says why and that it tries once more next session; a stop after that needs /office-setup; both have Dismiss', () => {
  const first = failedCard('the store refused the write', 1)
  expect(first.step).toBe('failed')
  expect(first.lines).toEqual(['Setup stopped: the store refused the write. It tries once more next session, or run /office-setup to try now.'])
  expect(first.buttons).toEqual([{ action: 'dismiss', label: 'Dismiss' }])
  const later = failedCard('the store refused the write', 2)
  expect(later.lines).toEqual(['Setup stopped: the store refused the write. Run /office-setup to try again.'])
  expect(later.buttons).toEqual([{ action: 'dismiss', label: 'Dismiss' }])
})

const REPORT = { parked: 0, hired: [], dropped: [], failed: [] }

test('what setup set aside and could not do is told in plain words, and nothing when all went well', () => {
  expect(hireNote(REPORT, 0)).toBeUndefined()
  expect(hireNote(REPORT, 12)).toBe('12 other helpers were set aside; bring them back in People.')
  expect(hireNote(REPORT, 1)).toBe('1 other helper was set aside; bring it back in People.')
  expect(hireNote({ ...REPORT, dropped: ['old-notes', 'x'] }, 0)).toBe('Left out, not installed under that name: old-notes, x.')
  expect(hireNote({ ...REPORT, failed: ['clawd-hq:tdd'] }, 0)).toBe('Claude Code would not add: clawd-hq:tdd.')
  expect(hireNote({ ...REPORT, isParkFailed: true }, 5)).toBe('Could not save the list of helpers set aside, so none were.')
  expect(hireNote({ ...REPORT, dropped: ['a'], failed: ['b'] }, 2)).toBe(
    '2 other helpers were set aside; bring them back in People. Left out, not installed under that name: a. Claude Code would not add: b.',
  )
})

test('the after-card draws its two lines and one dim Dismiss, and the press says dismiss', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, doneCard(['Planner', 'Builder']))
    const all = await textsOf(ui)
    expect(all).toContain(`${DONE_HEAD}Planner, Builder.`)
    expect(all).toContain(DONE_TAIL)
    const buttons = await buttonsOf(ui)
    expect(buttons.map(b => String(b.props.label))).toEqual(['Dismiss'])
    expect(buttons[0]?.props.dimColor).toBe(true)
    expect(buttons[0]?.props.plain).toBe(true)
    await ui.press({ key: 'onboard-dismiss' })
    expect(stage.pressed.map(b => b.action)).toEqual(['dismiss'])
    await ui.unmount()
  }
})

test('the after-card has no Start, Later, Skip, Yes or No, and no hire, role or search buttons', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, doneCard(['Planner']))
    expect((await buttonsOf(ui)).map(b => String(b.props.label))).not.toEqual(expect.arrayContaining(['Start']))
    expect((await ui.findAll({ type: 'Button' })).length).toBe(1)
    await ui.unmount()
  }
})

test('while setup works the card shows that Clawd is looking around, with no buttons', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, scanCard())
    expect((await textsOf(ui)).some(t => /Looking around/.test(t))).toBe(true)
    expect(await buttonsOf(ui)).toEqual([])
    await ui.unmount()
  }
})

test('the stopped card draws the reason and Dismiss', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, failedCard('no model answered', 2))
    expect(await textsOf(ui)).toContain('Setup stopped: no model answered. Run /office-setup to try again.')
    expect((await buttonsOf(ui)).map(b => String(b.props.label))).toEqual(['Dismiss'])
    await ui.unmount()
  }
})

test('a note is shown plain and dim', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    const ui = await draw($, surface, doneCard(['Planner'], 'Cannot change that setting from here.'))
    expect((await ui.find({ type: 'Text', text: /^Cannot change that setting from here\.$/ }))?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('with no card, or the quiet one held once setup has nothing to show, nothing is drawn', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  for (const surface of SURFACES) {
    for (const card of [undefined, QUIET] as Array<OnboardCard | undefined>) {
      const ui = await draw($, surface, card)
      expect(await textsOf(ui)).toEqual([])
      expect(await buttonsOf(ui)).toEqual([])
      await ui.unmount()
    }
  }
})

/** The Text props of Claude Code 2.1.295 that the brief allows here; a desktop `bold` also carries a `weight` of the engine's own. */
const ALLOWED = new Set(['color', 'dimColor', 'bold', 'wrap', 'children', 'key'])

test('every card draws only the Text props the older desktop engine takes, and every long line wraps', async ($, on) => {
  quiet(on)
  await $.session.start(START)
  const odd: string[] = []
  const cards = { scan: scanCard(), done: doneCard(['Planner', 'Builder', 'Reviewer'], 'A note that is long enough to wrap onto a second line.'), failed: failedCard('a long reason that goes on and on', 1) }
  for (const surface of SURFACES) {
    for (const [name, card] of Object.entries(cards)) {
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
