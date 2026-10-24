// Onboarding: the whole setup flow end to end on the test host, on the terminal and in the desktop app. Setup runs by itself the
// first time the office opens in a project with no saved setup: quiet scan → team → hire → workflow, then one small card.
// There are no questions and no offer. `/office-setup` runs the same flow on demand. Nothing is sent and the mod fetches nothing.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { DONE_HEAD, DONE_TAIL } from '../hooks/onboard-cards'
import { SOURCES_KEY, isSetupBusy } from '../hooks/onboard'
import { CLEAR, START, SURFACES } from './host'
import { CWD, frames, offerAgents, office, onboardHost, press, saveOf, settle } from './onboard-host'
import type { OnboardHost } from './onboard-host'

type Surface = (typeof SURFACES)[number]
const DESKTOP_START = { cwd: CWD, surface: null, isInteractive: false } as never
const DESKTOP = { surface: 'desktop', clientId: 'desktop:default' } as never
const HAND_PARKED = { laidOff: ['legal:review-contract'], isReviewed: false, stacks: [] }
const KEY = `onboard:${CWD}`
/** A saved place left long ago (the test clock starts at 1 second), so no other run can be working on it. */
const OLD = -1_000_000
const MINUTE = 60_000

/** A session as each surface starts it: the terminal draws at once, the desktop app attaches a moment later. */
async function open($: Engine, h: OnboardHost, surface: Surface) {
  await $.session.start(surface === 'terminal' ? START : DESKTOP_START)
  await offerAgents($)
  if (surface === 'desktop') await $.session.attach(DESKTOP)
  await frames(h)
}

const opusCalls = (h: OnboardHost) => h.calls.models.filter(m => m.model === 'opus')

for (const surface of SURFACES) {
  test(`${surface}: setup runs by itself, scan to workflow, and leaves one small card; nothing is asked, sent or fetched`, { timeoutMs: 30_000 }, async ($, on) => {
    const h = onboardHost(on, { [`payroll:${CWD}`]: HAND_PARKED })
    await open($, h, surface)
    // No question box, no fill of the prompt box, no toast about setup.
    expect(h.calls.tools.filter(t => t.tool === 'AskUserQuestion')).toEqual([])
    expect(h.calls.fills).toEqual([])
    expect(h.calls.sent).toEqual([])
    expect(h.calls.fetches).toEqual([])
    expect(h.toasts.filter(t => /setup/i.test(t))).toEqual([])
    // The switches are untouched: both are on by default.
    expect(h.saved.has('toggle:quietChat')).toBe(false)
    expect(h.saved.has('toggle:chiefOfStaff')).toBe(false)
    // The scan ran quietly, then one Opus call picked the team (no scout in this host).
    expect(opusCalls(h)).toHaveLength(1)
    expect(h.saved.get(`usage:${CWD}`)).toMatchObject({ files: 0 })
    expect(h.saved.get(SOURCES_KEY)).toMatchObject({ agents: ['plugin'], skills: ['plugin'] })
    // The hire: the rest is parked on top of what was parked by hand, the skill is hired, the skill not installed is left out.
    const payroll = h.saved.get(`payroll:${CWD}`) as { laidOff: string[]; isReviewed: boolean }
    expect([...payroll.laidOff].sort()).toEqual(['ecc:go-reviewer', 'legal:review-contract'])
    expect(payroll.isReviewed).toBe(true)
    expect(h.calls.registered.map(r => r.skills)).toEqual([['ecc:tdd-workflow']])
    expect((h.saved.get(`team:${CWD}`) as { hires: unknown[] }).hires).toHaveLength(1)
    // The workflow is kept in the profile without a card to confirm it.
    expect(h.saved.get('profile')).toMatchObject({ role: 'Software engineer', workflow: ['Plan the change first.', 'Write the tests.', 'Build it.'] })
    expect(saveOf(h)?.step).toBe('done')
    // One small card on the Office tab, with Dismiss and nothing else.
    const tab = await office($, surface)
    expect(tab.joined).toContain(DONE_HEAD)
    expect(tab.joined).toMatch(/Set up your team for this project: Planner, .*Reviewer/)
    expect(tab.joined).toContain(DONE_TAIL)
    expect(tab.joined).not.toContain('MODEL WORDS')
    expect(tab.labels).toEqual(['Dismiss'])
    // Clawd sees who the person is.
    const ctx = await $.prompt.context({ blocks: [] } as never)
    expect(JSON.stringify(ctx)).toContain('Their role: Software engineer')
  })

  test(`${surface}: Dismiss takes the card away, and it does not come back in the next session`, async ($, on) => {
    const h = onboardHost(on)
    await open($, h, surface)
    expect((await office($, surface)).labels).toEqual(['Dismiss'])
    await press($, h, surface, 'onboard-dismiss')
    expect((await office($, surface)).setup).toEqual([])
    expect(saveOf(h)?.step).toBe('done')
    await $.session.end(CLEAR)
    await open($, h, surface)
    expect((await office($, surface)).setup).toEqual([])
    expect(opusCalls(h)).toHaveLength(1) // setup is not run again
  })

  test(`${surface}: /office-setup runs the same flow again, after it was done`, async ($, on) => {
    const h = onboardHost(on, { [KEY]: { step: 'done', at: 1 } })
    await open($, h, surface)
    expect((await office($, surface)).setup).toEqual([])
    expect(opusCalls(h)).toHaveLength(0)
    const r = await $.command.run({ command: 'office-setup', args: '' } as never)
    expect(JSON.stringify(r)).toMatch(/setup/i)
    expect(JSON.stringify(r)).not.toMatch(/question/i)
    await settle(h)
    expect(opusCalls(h)).toHaveLength(1)
    expect(h.calls.tools.filter(t => t.tool === 'AskUserQuestion')).toEqual([])
    expect(saveOf(h)?.step).toBe('done')
    expect((await office($, surface)).labels).toEqual(['Dismiss'])
  })

  test(`${surface}: with Automatic setup off nothing runs by itself, and /office-setup still runs setup on demand`, { options: { autoSetup: false } }, async ($, on) => {
    const h = onboardHost(on)
    await open($, h, surface)
    await frames(h, 30)
    expect(saveOf(h)).toBeUndefined()
    expect(h.calls.models).toEqual([])
    expect((await office($, surface)).setup).toEqual([])
    await $.command.run({ command: 'office-setup', args: '' } as never)
    await settle(h)
    expect(opusCalls(h)).toHaveLength(1)
    expect(saveOf(h)?.step).toBe('done')
    expect((await office($, surface)).labels).toEqual(['Dismiss'])
  })

  for (const step of ['skipped', 'first']) {
    test(`${surface}: a project whose old setup was left at "${step}" is not set up again`, async ($, on) => {
      const h = onboardHost(on, { [KEY]: { step, pending: [], at: 1 } })
      await open($, h, surface)
      await frames(h, 20)
      expect(h.calls.models).toEqual([])
      expect((await office($, surface)).setup).toEqual([])
    })
  }

  test(`${surface}: an old offer or question left in a project counts as never set up, so setup runs`, async ($, on) => {
    const h = onboardHost(on, { [KEY]: { step: 'intro', pending: [{ field: 'quietChat', value: false }], at: OLD } })
    await open($, h, surface)
    expect(opusCalls(h)).toHaveLength(1)
    expect(saveOf(h)?.step).toBe('done')
    expect(h.saved.has('toggle:quietChat')).toBe(false) // the old unapplied answer is dropped
  })
}

test('the Automatic setup switch saved in the store (a press in Settings) wins: Off means nothing runs by itself', async ($, on) => {
  const h = onboardHost(on, { 'toggle:autoSetup': false })
  await open($, h, 'terminal')
  await frames(h, 20)
  expect(saveOf(h)).toBeUndefined()
  expect(h.calls.models).toEqual([])
})

test('the desktop app: nothing runs before its view attaches, then setup runs by itself', async ($, on) => {
  const h = onboardHost(on)
  await $.session.start(DESKTOP_START)
  await frames(h, 20)
  expect(saveOf(h)).toBeUndefined()
  expect(h.calls.models).toEqual([])
  await $.session.attach(DESKTOP)
  await frames(h)
  expect(saveOf(h)?.step).toBe('done')
})

test('setup runs once however many frames pass', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  await frames(h, 40)
  expect(opusCalls(h)).toHaveLength(1)
  expect(h.calls.registered).toHaveLength(1)
})

test('/office-setup is registered at session start', async ($, on) => {
  const h = onboardHost(on)
  await $.session.start(START)
  expect(h.commands).toContain('office-setup')
})

test('thin evidence: no role is asked; the team is picked for the best guess, and the card has only Dismiss', async ($, on) => {
  const h = onboardHost(on)
  for (const path of [...h.files.keys()]) if (path.startsWith(`${CWD}/`)) h.files.delete(path)
  await open($, h, 'terminal')
  const tab = await office($, 'terminal')
  expect(tab.labels).toEqual(['Dismiss'])
  expect(tab.joined).not.toMatch(/Which fits best/)
  // A thin guess picks the team but is not written down as who the person is: not in the setup record, not in the profile.
  expect(opusCalls(h)).toHaveLength(1)
  expect(saveOf(h)?.step).toBe('done')
  expect(saveOf(h)?.role).toBeUndefined()
  expect((h.saved.get('profile') as { role?: string } | undefined)?.role).toBeUndefined()
})

test('a thin guess does not replace the role an earlier setup saved in the profile', async ($, on) => {
  const h = onboardHost(on, { profile: { role: 'Writer or researcher', at: 1 } })
  for (const path of [...h.files.keys()]) if (path.startsWith(`${CWD}/`)) h.files.delete(path)
  await open($, h, 'terminal')
  expect(h.saved.get('profile')).toMatchObject({ role: 'Writer or researcher' })
})

test('Opus gives no answer: the rules pick, and the card still shows a team', async ($, on) => {
  const h = onboardHost(on)
  h.models.opus = undefined
  await open($, h, 'terminal')
  // The only model calls for the team are Opus's; the other call is the workflow read.
  expect(h.calls.models.filter(m => !m.prompt.includes('<instructions>')).map(m => m.model)).toEqual(['opus'])
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('rules')
  expect((await office($, 'terminal')).joined).toContain(DONE_HEAD)
})

test('a seat nothing installed fits is filled by Clawd HQ\'s own helper, and nothing is searched for, filled or fetched', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  const tab = await office($, 'terminal')
  expect(tab.joined).toContain('Researcher')
  expect(tab.joined).not.toContain('skills.sh')
  expect((h.saved.get(`team:${CWD}`) as { picks: Array<{ name: string }> }).picks.map(p => p.name)).toContain('clawd-hq:core-researcher')
  expect(h.calls.fills).toEqual([])
  expect(h.calls.fetches).toEqual([])
})

/** A team an earlier run picked and saved. */
const SAVED_TEAM = {
  picks: [
    { seat: 'Plan', name: 'ecc:planner', kind: 'agent', receipt: 'used 3× here' },
    { seat: 'Make', name: 'ecc:tdd-workflow', kind: 'skill', receipt: 'named in CLAUDE.md' },
    { seat: 'Check', name: 'ecc:code-reviewer', kind: 'agent', receipt: 'used 2× here' },
    { seat: 'Find out', name: 'clawd-hq:core-researcher', kind: 'agent', receipt: "Clawd HQ's own Researcher · nothing installed fits" },
  ],
  empty: ['Specialist'],
  by: 'opus',
}

test('setup left at the team step resumes in the next session: the saved team is hired, with no second Opus call', async ($, on) => {
  const h = onboardHost(on, { [KEY]: { step: 'team', role: 'Software engineer', at: OLD }, [`team:${CWD}`]: SAVED_TEAM })
  await open($, h, 'terminal')
  expect(opusCalls(h)).toHaveLength(0)
  expect(saveOf(h)?.step).toBe('done')
  expect(h.calls.registered).toHaveLength(1)
  expect((await office($, 'terminal')).labels).toEqual(['Dismiss'])
})

test('setup left at the scan step starts over in the next session', async ($, on) => {
  const h = onboardHost(on, { [KEY]: { step: 'scan', at: OLD } })
  await open($, h, 'terminal')
  expect(opusCalls(h)).toHaveLength(1)
  expect(saveOf(h)?.step).toBe('done')
})

test('setup left at the workflow step finishes with the saved team', async ($, on) => {
  const h = onboardHost(on, { [KEY]: { step: 'workflow', role: 'Software engineer', at: OLD }, [`team:${CWD}`]: SAVED_TEAM })
  await open($, h, 'terminal')
  expect(opusCalls(h)).toHaveLength(0)
  expect(saveOf(h)?.step).toBe('done')
  expect((await office($, 'terminal')).joined).toContain('Set up your team for this project: Planner, Tester, Reviewer, Researcher.')
})

test('the skill hires are registered again at every session start', async ($, on) => {
  const h = onboardHost(on)
  await open($, h, 'terminal')
  expect(h.calls.registered).toHaveLength(1)
  await $.session.start(START)
  await settle(h)
  expect(h.calls.registered).toHaveLength(2)
  expect(h.calls.registered[1]).toMatchObject({ name: 'tdd-workflow', skills: ['ecc:tdd-workflow'] })
})

test('a project with no instruction files to read keeps the steps saved by an earlier setup in another project', async ($, on) => {
  const h = onboardHost(on, { profile: { role: 'Writer or researcher', workflow: ['Draft first.'], at: 1 } })
  h.files.delete(`${CWD}/CLAUDE.md`)
  await open($, h, 'terminal')
  expect(h.saved.get('profile')).toMatchObject({ role: 'Software engineer', workflow: ['Draft first.'] })
  expect(saveOf(h)?.step).toBe('done')
})

test('a step that fails shows a stopped card with how to try again, and /office-setup tries again', async ($, on) => {
  const h = onboardHost(on)
  h.kv.isWriteFailing = true // the store refuses
  await open($, h, 'terminal')
  let tab = await office($, 'terminal')
  expect(tab.joined).toMatch(/Setup stopped: .*next session.*\/office-setup/)
  expect(tab.labels).toEqual(['Dismiss'])
  h.kv.isWriteFailing = false
  await $.command.run({ command: 'office-setup', args: '' } as never)
  await settle(h)
  tab = await office($, 'terminal')
  expect(tab.joined).toContain(DONE_HEAD)
  expect(saveOf(h)?.step).toBe('done')
})

test('the headless run, with nothing drawn, saves nothing', async ($, on) => {
  const h = onboardHost(on)
  await $.session.start({ cwd: CWD, surface: null, isInteractive: false } as never)
  await frames(h, 30)
  expect(saveOf(h)).toBeUndefined()
  expect(h.calls.models).toEqual([])
})

test('the payroll waits while setup is not done and can still go on by itself, and only then', () => {
  expect(isSetupBusy(undefined, true)).toBe(true)
  expect(isSetupBusy({ step: 'scan', at: 1 }, true)).toBe(true)
  expect(isSetupBusy({ step: 'workflow', at: 1 }, true)).toBe(true)
  expect(isSetupBusy({ step: 'team', at: 1, failures: 1 }, true)).toBe(true) // one more try is coming
  expect(isSetupBusy({ step: 'done', at: 1 }, true)).toBe(false)
  // Nothing goes on by itself with the switch off, or after the retry failed: no reason to wait.
  expect(isSetupBusy(undefined, false)).toBe(false)
  expect(isSetupBusy({ step: 'team', at: 1 }, false)).toBe(false)
  expect(isSetupBusy({ step: 'team', at: 1, failures: 2 }, true)).toBe(false)
})

// ---- The off switch, a run that may still be working, and a retry that failed ----

for (const step of ['scan', 'team', 'workflow']) {
  test(`with Automatic setup off a part-way record (${step}) is never resumed by itself, and /office-setup still runs it`, { options: { autoSetup: false } }, async ($, on) => {
    const record = { step, role: 'Software engineer', at: OLD }
    const h = onboardHost(on, { [KEY]: record, [`team:${CWD}`]: SAVED_TEAM })
    await open($, h, 'terminal')
    await frames(h, 30)
    expect(h.calls.models).toEqual([])
    expect(h.calls.registered).toEqual([])
    expect(saveOf(h)).toEqual(record)
    expect((await office($, 'terminal')).setup).toEqual([])
    await $.command.run({ command: 'office-setup', args: '' } as never)
    await settle(h)
    expect(saveOf(h)?.step).toBe('done')
    expect((await office($, 'terminal')).labels).toEqual(['Dismiss'])
  })
}

test('a part-way record saved under two minutes ago is left alone (another run is likely working), and is picked up once it is older', async ($, on) => {
  const h = onboardHost(on, { [KEY]: { step: 'scan', at: 500 } })
  await open($, h, 'terminal')
  expect(h.calls.models).toEqual([])
  expect(saveOf(h)?.at).toBe(500)
  await h.clock.advance(MINUTE) // about a minute and a half old: still within the window
  await frames(h, 9)
  expect(h.calls.models).toEqual([])
  await h.clock.advance(MINUTE) // now past two minutes
  await frames(h, 9)
  expect(opusCalls(h)).toHaveLength(1)
  expect(saveOf(h)?.step).toBe('done')
})

test('an automatic run does not overlap an explicit /office-setup that is already working', async ($, on) => {
  const h = onboardHost(on)
  h.scout.mode = 'silent'
  await open($, h, 'terminal') // the automatic run is waiting on the scout
  await $.command.run({ command: 'office-setup', args: '' } as never)
  await settle(h)
  expect(h.scout.spawned).toHaveLength(1)
})

/** The team's own key refuses a write, so the step after the scan fails; the setup record itself saves fine. */
const failTeam = (h: OnboardHost) => h.kv.failKeys.add(`team:${CWD}`)

test('a failed run counts one failure and says it tries once more next session; the retry that fails says only /office-setup helps', async ($, on) => {
  const h = onboardHost(on)
  failTeam(h)
  await open($, h, 'terminal')
  expect(saveOf(h)).toMatchObject({ failures: 1 })
  expect((await office($, 'terminal')).joined).toMatch(/Setup stopped: .*once more next session.*\/office-setup/)
  // The next session retries once by itself (the record is old by then) and it fails again.
  h.saved.set(KEY, { ...saveOf(h), at: OLD })
  await $.session.end(CLEAR)
  await open($, h, 'terminal')
  expect(saveOf(h)).toMatchObject({ failures: 2 })
  const tab = await office($, 'terminal')
  expect(tab.joined).toMatch(/Setup stopped: .*Run \/office-setup to try again\./)
  expect(tab.joined).not.toMatch(/next session/)
})

test('after the retry failed nothing starts by itself again, in any later session', async ($, on) => {
  const h = onboardHost(on, { [KEY]: { step: 'scan', at: OLD, failures: 2 } })
  await open($, h, 'terminal')
  await frames(h, 30)
  expect(h.calls.models).toEqual([])
  expect((await office($, 'terminal')).setup).toEqual([])
  expect(saveOf(h)).toMatchObject({ failures: 2 })
})

test('/office-setup runs after the retry failed, and a run that finishes clears the failures', async ($, on) => {
  const h = onboardHost(on, { [KEY]: { step: 'scan', at: OLD, failures: 2 } })
  await open($, h, 'terminal')
  await $.command.run({ command: 'office-setup', args: '' } as never)
  await settle(h)
  expect(saveOf(h)?.step).toBe('done')
  expect(saveOf(h)?.failures).toBeUndefined()
})

// ---- What the card says it set aside ----

test('the card says how many helpers were set aside, which skills were left out, and nothing else when all went well', async ($, on) => {
  const h = onboardHost(on, { [`payroll:${CWD}`]: HAND_PARKED })
  await open($, h, 'terminal')
  const { joined } = await office($, 'terminal')
  expect(joined).toContain('1 other helper was set aside; bring it back in People.')
  expect(joined).toContain('Left out, not installed under that name: old-notes.')
  expect(joined).not.toMatch(/Could not save|would not add/)
})

test('a payroll that cannot be saved is said on the card, not swallowed, and nothing is claimed set aside', async ($, on) => {
  const h = onboardHost(on)
  h.kv.failKeys.add(`payroll:${CWD}`)
  await open($, h, 'terminal')
  const { joined } = await office($, 'terminal')
  expect(joined).toMatch(/Could not save the list of helpers set aside/)
  expect(joined).not.toMatch(/set aside; bring/)
  expect(saveOf(h)?.step).toBe('done')
})

const MANY = Array.from({ length: 20 }, (_, i) => `ecc:go-agent-${i}`)

test('the payroll review waits while setup is still looking for its team', async ($, on) => {
  const h = onboardHost(on)
  h.scout.mode = 'silent' // the scout takes its time, so setup is still on the team step
  await $.session.start(START)
  for (const agent of MANY) await $.agent.offer({ agent, description: 'Go work.' } as never)
  await frames(h, 60)
  expect(saveOf(h)?.step).not.toBe('done')
  expect(h.saved.get(`payroll:${CWD}`)).toBeUndefined()
})

test('with Automatic setup off and no setup saved, the payroll review is not held back', { options: { autoSetup: false } }, async ($, on) => {
  const h = onboardHost(on)
  await $.session.start(START)
  for (const agent of MANY) await $.agent.offer({ agent, description: 'Go work.' } as never)
  await frames(h, 60)
  expect((h.saved.get(`payroll:${CWD}`) as { isReviewed: boolean } | undefined)?.isReviewed).toBe(true)
})
