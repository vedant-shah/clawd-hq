// Onboarding, piece 8: the whole setup flow end to end on the test host, on the terminal and in the desktop app.
// Offer → Start / Later / Skip → the two questions → quiet scan → (role only when thin) → team → Hire → workflow →
// first job → done, and `/office-setup` again. Nothing is ever sent for the person and the mod makes no network call.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BOX_NOTE, FIRST_LINE, OFFER_LINE, ROLE_LINE, WAIT_NOTE, WORKFLOW_LINE } from '../hooks/onboard-cards'
import { SOURCES_KEY } from '../hooks/onboard'
import { TESTS_JOB } from '../hooks/first-job'
import { ROLES } from '../hooks/onboard-types'
import { CLEAR, PANE, START, SURFACES } from './host'
import { CWD, HOME, QUIET_Q, RUN_Q, frames, offerAgents, office, onboardHost, press, saveOf, settle } from './onboard-host'
import type { OnboardHost } from './onboard-host'

type Surface = (typeof SURFACES)[number]
const DESKTOP_START = { cwd: CWD, surface: null, isInteractive: false } as never
const DESKTOP = { surface: 'desktop', clientId: 'desktop:default' } as never
const HAND_PARKED = { laidOff: ['legal:review-contract'], isReviewed: false, stacks: [] }

/** A session as each surface starts it: the terminal draws at once, the desktop app attaches a moment later. */
async function open($: Engine, h: OnboardHost, surface: Surface) {
  await $.session.start(surface === 'terminal' ? START : DESKTOP_START)
  await offerAgents($)
  if (surface === 'desktop') await $.session.attach(DESKTOP)
  await frames(h)
}

const decisionsOf = (h: OnboardHost) => h.files.get(`${CWD}/.clawd-hq/decisions.md`) ?? ''

for (const surface of SURFACES) {
  test(`${surface}: the whole flow, offer to first job, with the question box; nothing is sent and nothing is fetched`, { timeoutMs: 30_000 }, async ($, on) => {
    const h = onboardHost(on, { [`payroll:${CWD}`]: HAND_PARKED })
    await open($, h, surface)
    // The offer, on Clawd's card.
    let tab = await office($, surface)
    expect(tab.joined).toContain(OFFER_LINE)
    expect(tab.labels).toEqual(['Start', 'Later', 'Skip'])
    // Start: the question box asks both, one at a time; Yes to running the chat (already on), No to quiet chat.
    await press($, h, surface, 'onboard-start')
    expect(h.calls.asked).toEqual([{ question: RUN_Q, labels: ['Yes (Recommended)', 'No'] }, { question: QUIET_Q, labels: ['Yes (Recommended)', 'No'] }])
    expect(h.saved.get('toggle:quietChat')).toBe(false)
    expect(h.saved.has('toggle:chiefOfStaff')).toBe(false) // Yes on a switch already on sets nothing
    expect(decisionsOf(h)).toContain('Yes (Recommended)')
    expect(decisionsOf(h)).toContain('→ No')
    // The scan ran quietly, then one Opus call picked the team; the card shows facts, never the model's words.
    expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
    expect(h.saved.get(`usage:${CWD}`)).toMatchObject({ files: 0 })
    expect(h.saved.get(SOURCES_KEY)).toMatchObject({ agents: ['plugin'], skills: ['plugin'] })
    tab = await office($, surface)
    expect(tab.joined).toContain('Software engineer')
    expect(tab.joined).toMatch(/Starting team \(4\) · Parked 1/)
    expect(tab.joined).toContain('ecc:planner')
    expect(tab.joined).not.toContain('MODEL WORDS')
    expect(tab.joined).not.toContain('legal:review-contract') // parked by hand: no candidate
    expect(tab.labels).toEqual(['Change', 'Yes', 'No', 'Hire this team', 'Adjust in People'])
    // Hire: the rest is parked on top of what was parked by hand, the skill is hired, the skill not installed is reported.
    await press($, h, surface, 'onboard-hire')
    const payroll = h.saved.get(`payroll:${CWD}`) as { laidOff: string[]; isReviewed: boolean }
    expect([...payroll.laidOff].sort()).toEqual(['ecc:go-reviewer', 'legal:review-contract'])
    expect(payroll.isReviewed).toBe(true)
    expect(h.calls.registered.map(r => r.skills)).toEqual([['ecc:tdd-workflow']])
    expect((h.saved.get(`team:${CWD}`) as { hires: unknown[] }).hires).toHaveLength(1)
    // The workflow card, from the instruction files through Haiku.
    tab = await office($, surface)
    expect(tab.joined).toContain(WORKFLOW_LINE)
    expect(tab.joined).toContain('1. Plan the change first.')
    expect(tab.joined).toMatch(/Hired clawd-hq:tdd-workflow\./)
    expect(tab.joined).toMatch(/Left out, not installed under that name: old-notes\./)
    expect(tab.labels).toEqual(['Use this', 'Skip'])
    await press($, h, surface, 'onboard-useWorkflow')
    expect(h.saved.get('profile')).toMatchObject({ role: 'Software engineer', workflow: ['Plan the change first.', 'Write the tests.', 'Build it.'] })
    // The first job: Use this fills the prompt box, and nothing is sent.
    tab = await office($, surface)
    expect(tab.joined).toContain(FIRST_LINE)
    expect(tab.joined).toContain(TESTS_JOB)
    await press($, h, surface, 'onboard-useFirst')
    expect(h.calls.fills).toEqual([TESTS_JOB])
    expect(h.calls.sent).toEqual([])
    expect(h.calls.fetches).toEqual([])
    expect(saveOf(h)?.step).toBe('done')
    tab = await office($, surface)
    expect(tab.setup).toEqual([])
    // Clawd sees who the person is beyond the newest decisions.
    const ctx = await $.prompt.context({ blocks: [] } as never)
    expect(JSON.stringify(ctx)).toContain('Their role: Software engineer')
  })
}

test('the desktop app: no offer before its view attaches, then the offer without anything typed', async ($, on) => {
  const h = onboardHost(on)
  await $.session.start(DESKTOP_START)
  await frames(h, 20)
  expect(saveOf(h)).toBeUndefined()
  await $.session.attach(DESKTOP)
  await frames(h)
  expect(saveOf(h)?.step).toBe('offer')
  const tab = await office($, 'desktop')
  expect(tab.labels).toEqual(['Start', 'Later', 'Skip'])
})

for (const surface of SURFACES) {
  test(`${surface}: Later hides the offer for this session, and it is back the next`, async ($, on) => {
    const h = onboardHost(on)
    await open($, h, surface)
    await press($, h, surface, 'onboard-later')
    await frames(h, 20)
    expect((await office($, surface)).setup).toEqual([])
    expect(saveOf(h)).toMatchObject({ step: 'offer', later: true })
    expect(h.calls.boxes).toBe(0)
    await open($, h, surface)
    expect((await office($, surface)).labels).toEqual(['Start', 'Later', 'Skip'])
  })

  test(`${surface}: Skip ends setup with nothing scanned and no model call, and it is not offered again`, async ($, on) => {
    const h = onboardHost(on)
    await open($, h, surface)
    await press($, h, surface, 'onboard-skip')
    expect(saveOf(h)?.step).toBe('skipped')
    await open($, h, surface)
    expect((await office($, surface)).setup).toEqual([])
    expect(h.calls.models).toEqual([])
    expect(h.calls.boxes).toBe(0)
    expect(h.saved.has(`usage:${CWD}`)).toBe(false)
  })

  test(`${surface}: when the question box is refused, the card asks both questions with Yes and No`, async ($, on) => {
    const h = onboardHost(on)
    h.box.mode = surface === 'terminal' ? 'deny' : 'throw'
    await open($, h, surface)
    await press($, h, surface, 'onboard-start')
    let tab = await office($, surface)
    expect(tab.joined).toContain(RUN_Q)
    expect(tab.joined).toContain(BOX_NOTE)
    expect(tab.labels).toEqual(['Yes', 'No'])
    await press($, h, surface, 'onboard-no')
    tab = await office($, surface)
    expect(tab.joined).toContain(QUIET_Q)
    await press($, h, surface, 'onboard-yes')
    expect(h.saved.get('toggle:chiefOfStaff')).toBe(false)
    expect(h.saved.has('toggle:quietChat')).toBe(false)
    expect(decisionsOf(h)).toContain(`${RUN_Q} → No`)
    expect(saveOf(h)?.step).toBe('team')
  })

  test(`${surface}: /office-setup runs setup again from the questions, after it was done`, async ($, on) => {
    const h = onboardHost(on, { [`onboard:${CWD}`]: { step: 'done', pending: [], at: 1 } })
    await open($, h, surface)
    expect((await office($, surface)).setup).toEqual([])
    const r = await $.command.run({ command: 'office-setup', args: '' } as never)
    expect(JSON.stringify(r)).toMatch(/setup/i)
    await settle(h)
    expect(h.calls.boxes).toBe(2)
    expect(saveOf(h)?.step).toBe('team')
    expect((await office($, surface)).labels).toContain('Hire this team')
  })
}

test('/office-setup is registered at session start', async ($, on) => {
  const h = onboardHost(on)
  await $.session.start(START)
  expect(h.commands).toContain('office-setup')
})

test('answers given while Clawd is busy wait for his turn to end, then apply', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await $.turn.start({ text: 'Fix it', turnId: 'm1' } as never)
  await press($, h, 'terminal', 'onboard-start')
  expect(h.saved.has('toggle:quietChat')).toBe(false)
  expect(saveOf(h)?.pending).toEqual([{ field: 'chiefOfStaff', value: true }, { field: 'quietChat', value: false }])
  expect((await office($, 'terminal')).joined).toContain(WAIT_NOTE)
  await $.turn.complete({ reason: 'answer', answer: 'Done.', turnId: 'm1', isAborted: false } as never)
  await settle(h)
  expect(h.saved.get('toggle:quietChat')).toBe(false)
  expect(saveOf(h)?.pending).toEqual([])
  expect((await office($, 'terminal')).joined).not.toContain(WAIT_NOTE)
})

test('thin evidence: the role is asked with a button per role, then the team is picked for it', async ($, on) => {
  const h = onboardHost(on)
  for (const path of [...h.files.keys()]) if (path.startsWith(`${CWD}/`)) h.files.delete(path)
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  let tab = await office($, 'terminal')
  expect(tab.joined).toContain(ROLE_LINE)
  expect(tab.labels).toEqual([...ROLES])
  expect(h.calls.models).toEqual([])
  await press($, h, 'terminal', 'onboard-changeRole-5')
  tab = await office($, 'terminal')
  expect(tab.joined).toContain(ROLES[5])
  expect(tab.labels).toContain('Hire this team')
  expect(saveOf(h)?.role).toBe(ROLES[5])
})

test('Change on the team card picks another role without a second Opus call', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  await press($, h, 'terminal', 'onboard-changeRole')
  expect((await office($, 'terminal')).labels).toEqual([...ROLES])
  await press($, h, 'terminal', 'onboard-changeRole-1')
  const tab = await office($, 'terminal')
  expect(tab.joined).toContain(ROLES[1])
  expect(tab.labels).toContain('Hire this team')
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
})

test('an empty seat: Yes puts a skills.sh search in the prompt box, never sent and never fetched by the mod', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  expect((await office($, 'terminal')).joined).toContain('Search skills.sh for a Find out helper?')
  await press($, h, 'terminal', 'onboard-searchYes')
  expect(h.calls.fills).toHaveLength(1)
  expect(h.calls.fills[0]).toMatch(/skills\.sh.*Find out.*do not install/)
  expect(h.calls.sent).toEqual([])
  expect(h.calls.fetches).toEqual([])
  const tab = await office($, 'terminal')
  expect(tab.joined).not.toContain('Search skills.sh for a')
  expect(tab.labels).toEqual(['Change', 'Hire this team', 'Adjust in People'])
})

test('Opus gives no answer: Haiku picks the team; neither does: the rules do, and the card still shows a team', async ($, on) => {
  const h = onboardHost(on)
  h.models.opus = undefined
  h.models.haiku = JSON.stringify({ picks: [{ seat: 'Plan', name: 'ecc:planner' }] })
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  expect(h.calls.models.map(m => m.model)).toEqual(['opus', 'haiku'])
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('haiku')
  h.models.haiku = undefined
  await $.command.run({ command: 'office-setup', args: '' } as never)
  await settle(h)
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('rules')
  expect((await office($, 'terminal')).labels).toContain('Hire this team')
})

test('setup left part way resumes at its step in the next session, with no second Opus call', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  expect(saveOf(h)?.step).toBe('team')
  await $.session.end(CLEAR)
  await open($, h, 'terminal')
  expect((await office($, 'terminal')).labels).toContain('Hire this team')
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
})

test('the skill hires are registered again at every session start', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  await press($, h, 'terminal', 'onboard-hire')
  expect(h.calls.registered).toHaveLength(1)
  await $.session.start(START)
  await settle(h)
  expect(h.calls.registered).toHaveLength(2)
  expect(h.calls.registered[1]).toMatchObject({ name: 'tdd-workflow', skills: ['ecc:tdd-workflow'] })
})

for (const saved of [undefined, { step: 'offer', later: true, pending: [], at: 1 }, { step: 'team', pending: [], at: 1, role: 'Software engineer' }]) {
  test(`the payroll review waits while setup is not done or skipped (${saved?.step ?? 'never offered'})`, async ($, on) => {
    const h = onboardHost(on, saved === undefined ? {} : { [`onboard:${CWD}`]: saved })
    await $.session.start(START)
    for (let i = 0; i < 20; i += 1) await $.agent.offer({ agent: `ecc:go-agent-${i}`, description: 'Go work.' } as never)
    await frames(h, 60)
    expect(h.toasts.some(t => /Payroll review/.test(t))).toBe(false)
  })
}

test('the box answers the first question: the card then shows the second, and its Yes answers that one', async ($, on) => {
  const h = onboardHost(on)
  h.box.answers = { [RUN_Q]: 'No' } // the second question gets no answer from the box
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  const tab = await office($, 'terminal')
  expect(tab.joined).toContain(QUIET_Q)
  expect(tab.joined).not.toContain(RUN_Q)
  await press($, h, 'terminal', 'onboard-yes')
  expect(h.saved.get('toggle:chiefOfStaff')).toBe(false)
  expect(h.saved.has('toggle:quietChat')).toBe(false)
  expect(decisionsOf(h)).toContain(`${QUIET_Q} → Yes`)
  expect(saveOf(h)?.step).toBe('team')
})

test('a second press of Hire, after the first, parks and hires nothing more', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  await ui.press({ key: 'onboard-hire' })
  await ui.press({ key: 'onboard-hire' }).catch(() => undefined) // the button may be gone already
  await ui.unmount()
  await settle(h)
  expect(h.calls.registered).toHaveLength(1)
})

test('a step that fails puts the offer back with what went wrong, and Start tries again', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  h.kv.isWriteFailing = true // the store refuses: the questions cannot be saved
  await press($, h, 'terminal', 'onboard-start')
  let tab = await office($, 'terminal')
  expect(tab.joined).toMatch(/Setup stopped: .*Start tries again\./)
  expect(tab.labels).toEqual(['Start', 'Later', 'Skip'])
  h.kv.isWriteFailing = false
  await press($, h, 'terminal', 'onboard-start')
  tab = await office($, 'terminal')
  expect(tab.labels).toContain('Hire this team')
})

test('a skipped workflow card keeps the steps saved by an earlier setup in another project', async ($, on) => {
  const h = onboardHost(on, { profile: { role: 'Writer or researcher', workflow: ['Draft first.'], at: 1 } })
  await open($, h, 'terminal')
  await press($, h, 'terminal', 'onboard-start')
  await press($, h, 'terminal', 'onboard-hire')
  await press($, h, 'terminal', 'onboard-skipWorkflow')
  expect(h.saved.get('profile')).toMatchObject({ role: 'Software engineer', workflow: ['Draft first.'] })
})

test('the offer is not shown with nothing drawn (a headless run), and nothing is saved', async ($, on) => {
  const h = onboardHost(on)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false } as never)
  await frames(h, 30)
  expect(saveOf(h)).toBeUndefined()
  expect(HOME).toBe('/home/me')
})
