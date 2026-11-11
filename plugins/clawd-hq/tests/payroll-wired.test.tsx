// Payroll through the plugin's own wiring (hooks/register-session.ts, hooks/register-io.ts): the routine check lays off another project's skill hire in an existing
// folder, and keeps this folder's own saved hire, the shipped helpers and the contractor. Nothing here is offered by the engine in
// this session: the types are only on the machine-wide record, as a hire made in another project is.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { START, host } from './host'

const MINE = 'clawd-hq:copywriting'
const STALE = 'clawd-hq:tdd-workflow'
const ALWAYS_ON = ['clawd-hq:core-builder', 'clawd-hq:contractor']
const hire = { name: 'copywriting', description: 'Specialist: Write copy.', prompt: 'Follow the skill.', skills: ['copywriting'] }
const team = { picks: [{ seat: 'Specialist', name: 'copywriting', kind: 'skill', receipt: 'x' }], empty: [], hires: [hire], by: 'rules' }
const roster = Object.fromEntries([STALE, MINE, ...ALWAYS_ON, 'ecc:planner'].map(type => [type, { jobs: 1 }]))

test('the routine check lays off a hire made in another project and keeps this folder\'s own, through the wired io', async ($, on) => {
  const h = host(on, [], {
    roster,
    'payroll:/repo': { laidOff: [], isReviewed: true, stacks: [], kept: [STALE, MINE, ...ALWAYS_ON, 'ecc:planner'] },
    'team:/repo': team,
    'onboard:/repo': { step: 'skipped', pending: [], at: 1 },
  })
  on('agent.offer', () => ({ isOffered: true }) as never)
  await $.session.start(START)
  // One offer of a type already on the team loads the machine-wide record, as in any session.
  await $.agent.offer({ agent: 'ecc:planner', description: 'Plans work.' } as never)
  await h.clock.advance(25 * 400 + 100)
  expect((h.saved.get('payroll:/repo') as { laidOff: string[] }).laidOff).toEqual([STALE])
})

const LAID_OFF = 'ecc:planner'
const offerPlanner = ($: Engine) => $.agent.offer({ agent: LAID_OFF, description: 'Plans work.' } as never) as Promise<{ isOffered?: boolean }>
const laidOffStore = { 'payroll:/repo': { laidOff: [LAID_OFF], isReviewed: true, stacks: [] }, 'onboard:/repo': { step: 'skipped', pending: [], at: 1 } }

test('with Clawd running the chat, a laid-off agent is kept off the list', async ($, on) => {
  host(on, [], laidOffStore)
  await $.session.start(START)
  expect((await offerPlanner($)).isOffered).toBe(false)
})

test('with Clawd not running the chat, a laid-off agent is listed as usual', { options: { chiefOfStaff: false } }, async ($, on) => {
  host(on, [], laidOffStore)
  on('agent.offer', () => ({ isOffered: true }) as never)
  await $.session.start(START)
  expect((await offerPlanner($)).isOffered).toBe(true)
})
