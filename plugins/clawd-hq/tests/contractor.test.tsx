// Contractors: Clawd hires an off-team skill for one job. The agent is registered for the session only, never joins the team record,
// and on the second hire of the same skill the Office tab offers to make it staff.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { CONTRACTOR_TOOL } from '../hooks/constants'
import { PANE, SURFACES, START, host } from './host'
import { CWD, HOME, offerAgents, onboardHost, settle } from './onboard-host'
import type { OnboardHost } from './onboard-host'

const TEAM = {
  picks: [
    { seat: 'Plan', name: 'ecc:planner', kind: 'agent', receipt: 'used 3× here' },
    { seat: 'Make', name: 'ecc:tdd-workflow', kind: 'skill', receipt: 'used 3× here' },
  ],
  empty: [],
  by: 'rules',
  hires: [{ name: 'tdd-workflow', description: 'Make: Writes tests first.', prompt: 'p', skills: ['ecc:tdd-workflow'] }],
}
const PAYROLL = { laidOff: ['ecc:go-reviewer'], isReviewed: true, stacks: [] }
const DECK = 'pitch-deck'
const DECK_TYPE = 'clawd-hq:contractor-pitch-deck'
const OFFER = 'Designer has worked here twice. Make them staff?'

/** A project with a saved team, and a skill the engine lists that is not on it (its description is in its file). */
function office(on: Parameters<typeof onboardHost>[0], store: Record<string, unknown> = { [`team:${CWD}`]: TEAM, [`payroll:${CWD}`]: PAYROLL }) {
  const h = onboardHost(on, store)
  h.files.set(`${HOME}/.claude/skills/${DECK}/SKILL.md`, '---\nname: pitch-deck\ndescription: Builds investor pitch decks and slide stories.\n---\nBody.\n')
  const listed = [{ name: 'ecc:tdd-workflow', source: 'plugin', pluginName: 'ecc', tokens: 10 }, { name: DECK, source: 'user', tokens: 10 }]
  h.session.loaded = { ...h.session.loaded, skills: { totalSkills: 2, includedSkills: 2, tokens: 20, skillFrontmatter: listed } }
  return h
}

const hire = ($: Engine, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: CONTRACTOR_TOOL, ...input, ...(agentId ? { agentId } : {}) } as never) as Promise<{ result?: string; deny?: string }>
const deck = ($: Engine, role = 'Designer') => hire($, { skill: DECK, role })
const contractorSpecs = (h: OnboardHost) => h.agentSpecs.filter(s => s.name.startsWith('contractor-')) as Array<{ name: string; description: string; prompt: string; skills: string[]; tools?: unknown }>

/** The Office tab as drawn now: its texts and every button label. */
async function tab($: Engine, surface: (typeof SURFACES)[number]) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => ({ key: String(b.key), label: String(b.props.label) }))
  await ui.unmount()
  return { texts, buttons }
}
async function press($: Engine, h: OnboardHost, key: string) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  await ui.press({ key })
  await ui.unmount()
  await settle(h)
}

test('the tool is registered, in front of the search so Clawd needs none to find it', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  expect(h.tools).toContain('hire_contractor')
  expect(h.toolSpecs.find(t => t.name === 'hire_contractor')?.isDeferred).toBe(false)
})

test('a hire registers a one-job agent that preloads the skill, has every tool, and is named in the answer', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const answer = await deck($)
  const [spec] = contractorSpecs(h)
  expect(contractorSpecs(h)).toHaveLength(1)
  expect(spec).toMatchObject({ name: 'contractor-pitch-deck', skills: [DECK] })
  expect(spec?.description).toMatch(/^Designer: Builds investor pitch decks/)
  expect(spec?.tools).toBeUndefined()
  expect(spec?.prompt.length).toBeLessThan(400)
  expect(answer.result).toContain(DECK_TYPE)
  expect(answer.result).toContain('Designer')
})

test('a contractor never joins the team record, the hires kept for next session, or the parked list', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await deck($)
  await deck($)
  expect(h.saved.get(`team:${CWD}`)).toEqual(TEAM)
  expect(h.saved.get(`payroll:${CWD}`)).toEqual(PAYROLL)
})

test('only Clawd may hire one; a specialist is refused', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  const answer = await hire($, { skill: DECK, role: 'Designer' }, 'a1')
  expect(answer.deny).toMatch(/Clawd/)
  expect(contractorSpecs(h)).toEqual([])
})

test('the skill must be exactly an installed one, the role plain text, and a skill already on the team is hired as staff instead', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  expect((await hire($, { skill: 'no-such-skill', role: 'Designer' })).deny).toMatch(/not an installed skill.*find_helpers/s)
  expect((await hire($, { skill: DECK })).deny).toMatch(/role/)
  expect((await hire($, { role: 'Designer' })).deny).toMatch(/skill/)
  expect((await hire($, { skill: 'ecc:tdd-workflow', role: 'Tester' })).deny).toContain('clawd-hq:tdd-workflow')
  expect(contractorSpecs(h)).toEqual([])
  expect(h.saved.get(`contractors:${CWD}`)).toBeUndefined()
})

test('the engine refusing to register the agent is told to Clawd, and the hire is not counted', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  h.fail.register = true
  const answer = await deck($)
  expect(answer.deny).toMatch(/could not|not register/i)
  expect(h.saved.get(`contractors:${CWD}`)).toBeUndefined()
})

test('hires are counted per project and per skill, and the first one offers nothing', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await deck($)
  expect(h.saved.get(`contractors:${CWD}`)).toEqual({ [DECK]: 1 })
  for (const surface of SURFACES) expect((await tab($, surface)).texts.some(t => /worked here/.test(t))).toBe(false)
  await deck($)
  expect(h.saved.get(`contractors:${CWD}`)).toEqual({ [DECK]: 2 })
})

test('an earlier session\'s count carries over, so the offer comes on the hire that makes it two', async ($, on) => {
  office(on, { [`team:${CWD}`]: TEAM, [`contractors:${CWD}`]: { [DECK]: 1 } })
  await $.session.start(START)
  await deck($)
  expect((await tab($, 'terminal')).texts).toContain(OFFER)
})

for (const surface of SURFACES) {
  test(`${surface}: the second hire of a skill puts one card on the Office tab with Make staff and Not now`, async ($, on) => {
    office(on)
    await $.session.start(START)
    await deck($)
    await deck($)
    const { texts, buttons } = await tab($, surface)
    expect(texts.filter(t => t === OFFER)).toHaveLength(1)
    expect(buttons.filter(b => /Make staff|Not now/.test(b.label)).map(b => b.label)).toEqual(['Make staff', 'Not now'])
    // Wrapped text, never cut with a mark.
    expect(texts.some(t => t.includes('…'))).toBe(false)
  })
}

test('Make staff adds the skill to the saved team with its hire, registers it, and leaves the rest of the team and the parked list alone', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await deck($)
  await deck($)
  await press($, h, `contractor-staff-${DECK}`)
  const team = h.saved.get(`team:${CWD}`) as { picks: Array<{ seat: string; name: string; kind: string }>; hires: Array<{ name: string; skills: string[] }> }
  expect(team.picks.map(p => p.name)).toEqual(['ecc:planner', 'ecc:tdd-workflow', DECK])
  expect(team.picks[2]).toMatchObject({ seat: 'Specialist', kind: 'skill' })
  expect(team.hires.map(x => x.name)).toEqual(['tdd-workflow', 'pitch-deck'])
  expect(team.hires[1]?.skills).toEqual([DECK])
  expect(h.agentSpecs.filter(s => s.name === 'pitch-deck').map(s => s.skills)).toEqual([[DECK]])
  expect(h.saved.get(`payroll:${CWD}`)).toEqual(PAYROLL)
  const { texts } = await tab($, 'terminal')
  expect(texts).not.toContain(OFFER)
  expect(h.toasts.some(t => /Designer.*staff/.test(t))).toBe(true)
})

test('Not now takes the card away and it does not come back in this session', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await deck($)
  await deck($)
  await press($, h, `contractor-later-${DECK}`)
  expect((await tab($, 'terminal')).texts).not.toContain(OFFER)
  await deck($)
  expect((await tab($, 'terminal')).texts).not.toContain(OFFER)
  expect(h.saved.get(`team:${CWD}`)).toEqual(TEAM)
})

test('a failing save of the team keeps the card and says so', async ($, on) => {
  const h = office(on)
  await $.session.start(START)
  await deck($)
  await deck($)
  h.kv.failKeys.add(`team:${CWD}`)
  await press($, h, `contractor-staff-${DECK}`)
  expect((await tab($, 'terminal')).texts).toContain(OFFER)
  expect(h.toasts.some(t => /could not/i.test(t))).toBe(true)
})

test('a contractor at work reads as its role with a visitor badge, whether or not Clawd gave it a name', async ($, on) => {
  host(on, [
    { id: 'c1', type: DECK_TYPE, description: 'Lay out the deck', status: 'running' },
    { id: 'c2', type: DECK_TYPE, description: 'Lay out the appendix', status: 'running', name: 'editor' },
  ])
  const ids = ['c1', 'c2']
  on('agent.offer', () => ({ isOffered: true }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: ids.shift() }))
  await $.agent.offer({ agent: DECK_TYPE, description: 'Designer: Builds investor pitch decks and slide stories.' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Lay out the deck', subagentType: DECK_TYPE } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Lay out the appendix', subagentType: DECK_TYPE, name: 'editor' } as never)
  for (const surface of SURFACES) {
    const { texts } = await tab($, surface)
    expect(texts).toContain('Designer')
    expect(texts).toContain('Editor')
    expect(texts.filter(t => t === ' · 🪪 Contractor')).toHaveLength(2)
  }
})

test('a contractor type does not turn up in the search beside its skill', async ($, on) => {
  office(on)
  await $.session.start(START)
  await offerAgents($)
  await deck($)
  await $.agent.offer({ agent: DECK_TYPE, description: 'Designer: Builds investor pitch decks and slide stories.' } as never)
  const found = JSON.parse(((await $.tool.call({ tool: 'mcp__clawd-hq__find_helpers', job: 'investor pitch deck' } as never)) as { result: string }).result) as { matches: Array<{ name: string }> }
  expect(found.matches.map(m => m.name)).toEqual([DECK])
})
