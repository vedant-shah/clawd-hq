import { expect, test } from 'claude-code/testing'
import { hireTeam, installedSkills, parkList, rehire, skillHires } from '../hooks/hire'
import type { HireSpec, Pick as SeatPick, Team } from '../hooks/onboard-types'
import { teamKey } from '../hooks/onboard-types'

const pick = (seat: SeatPick['seat'], name: string, kind: SeatPick['kind'] = 'agent'): SeatPick => ({ seat, name, kind, receipt: 'used 3× here' })
const team: Team = {
  picks: [
    pick('Plan', 'ecc:planner'), pick('Make', 'ecc:tdd-guide'), pick('Check', 'code-reviewer'),
    pick('Check', 'marketing:seo-audit', 'skill'), pick('Specialist', 'copywriting', 'skill'),
  ],
  empty: ['Find out'],
  by: 'rules',
}
const installed = [
  { name: 'marketing:seo-audit', about: 'Audit a site for search.' },
  { name: 'copywriting', about: 'Write and improve page copy.' },
  { name: 'other:copywriting', about: 'A second copy skill.' },
]
const allTypes = ['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'ecc:planner', 'ecc:tdd-guide', 'ecc:architect', 'code-reviewer', 'ecc:security-reviewer', 'clawd-hq:seo-audit']

/** A fake io: a store in a map, every registration and payroll save kept. */
const fakeIo = (over: { breakdownSkills?: string[]; commands?: string[]; refuse?: string[]; throws?: string[] } = {}) => {
  const store = new Map<string, unknown>()
  const registered: HireSpec[] = []
  const paid: (readonly string[])[] = []
  return {
    store, registered, paid,
    cwd: '/work/proj',
    get: async <T,>(key: string) => store.get(key) as T | undefined,
    set: async (key: string, value: unknown) => { store.set(key, value) },
    breakdown: async () => (over.breakdownSkills ? { agents: [], skills: over.breakdownSkills.map(name => ({ name, source: 'plugin' })) } : undefined),
    commands: async () => (over.commands ?? []).map(name => ({ name, description: `About ${name}. More text.` })),
    allAgentTypes: () => allTypes,
    savePayroll: async (laidOff: readonly string[]) => { paid.push(laidOff) },
    registerHire: async (spec: HireSpec) => {
      if (over.throws?.includes(spec.name)) throw new Error('boom')
      registered.push(spec)
      return !over.refuse?.includes(spec.name)
    },
  }
}

test('parkList parks agent types not on the team, minus built-ins and our own hires', () => {
  expect(parkList(allTypes, team)).toEqual(['ecc:architect', 'ecc:security-reviewer'])
})

test('parkList parks nothing when the team holds every type', () => {
  expect(parkList(['a', 'b'], { picks: [pick('Plan', 'a'), pick('Make', 'b')], empty: [], by: 'rules' })).toEqual([])
})

test('a skill is never parked even if an agent type shares its name', () => {
  const t: Team = { picks: [pick('Plan', 'copywriting', 'skill')], empty: [], by: 'rules' }
  expect(parkList(['copywriting'], t)).toEqual(['copywriting'])
})

test('skillHires makes one hire per skill with seat, description and the skill preloaded', () => {
  const { hires, dropped } = skillHires(team, installed)
  expect(dropped).toEqual([])
  expect(hires.map(h => h.name)).toEqual(['seo-audit', 'copywriting'])
  expect(hires[0]?.skills).toEqual(['marketing:seo-audit'])
  expect(hires[0]?.description).toBe('Check: Audit a site for search.')
  expect(hires[0]?.prompt).toContain('preloaded')
  expect(hires[0]?.model).toBeUndefined()
})

test('a skill name not exactly in the installed list is dropped and reported', () => {
  const t: Team = { picks: [pick('Check', 'marketing:seo-audits', 'skill'), pick('Plan', 'copywriting', 'skill')], empty: [], by: 'rules' }
  const { hires, dropped } = skillHires(t, installed)
  expect(hires.map(h => h.name)).toEqual(['copywriting'])
  expect(dropped).toEqual(['marketing:seo-audits'])
})

test('without an installed list nothing can be checked and nothing is dropped', () => {
  const { hires, dropped } = skillHires(team, undefined)
  expect(hires).toHaveLength(2)
  expect(dropped).toEqual([])
})

test('two skills with the same short name: the later one gets its seat added', () => {
  const t: Team = { picks: [pick('Plan', 'copywriting', 'skill'), pick('Specialist', 'other:copywriting', 'skill')], empty: [], by: 'rules' }
  const { hires } = skillHires(t, installed)
  expect(hires.map(h => h.name)).toEqual(['copywriting', 'specialist-copywriting'])
})

test('a short name with odd characters is cleaned and cut to 64', () => {
  const t: Team = { picks: [pick('Plan', 'x:we ird!name', 'skill')], empty: [], by: 'rules' }
  const { hires } = skillHires(t, [{ name: 'x:we ird!name', about: '' }])
  expect(hires[0]?.name).toBe('we-ird-name')
  const long = `x:${'a'.repeat(90)}`
  const { hires: h2 } = skillHires({ ...t, picks: [pick('Plan', long, 'skill')] }, [{ name: long, about: '' }])
  expect(h2[0]?.name).toHaveLength(64)
})

test('installedSkills reads the engine list and tops up from commands when it was cut', async () => {
  const full = await installedSkills(fakeIo({ breakdownSkills: ['a', 'b'] }))
  expect(full?.map(s => s.name)).toEqual(['a', 'b'])
  const none = await installedSkills(fakeIo())
  expect(none).toBeUndefined()
  const fromCommands = await installedSkills(fakeIo({ commands: ['copywriting'] }))
  expect(fromCommands).toEqual([{ name: 'copywriting', about: 'About copywriting.' }])
})

test('hireTeam parks, registers, saves, and reports a dropped name', async () => {
  const io = fakeIo({ breakdownSkills: ['marketing:seo-audit'], commands: [] })
  const report = await hireTeam(io, team)
  expect(io.paid).toEqual([['ecc:architect', 'ecc:security-reviewer']])
  expect(io.registered.map(s => s.name)).toEqual(['seo-audit'])
  expect(report).toEqual({ parked: 2, hired: ['clawd-hq:seo-audit'], dropped: ['copywriting'], failed: [] })
  const saved = io.store.get(teamKey('/work/proj')) as { hires: HireSpec[] }
  expect(saved.hires.map(h => h.name)).toEqual(['seo-audit'])
})

test('a refused or throwing registration is reported as failed, the rest carry on', async () => {
  const io = fakeIo({ breakdownSkills: ['marketing:seo-audit', 'copywriting'], refuse: ['seo-audit'], throws: ['copywriting'] })
  const report = await hireTeam(io, team)
  expect(report.hired).toEqual([])
  expect(report.failed).toEqual(['clawd-hq:seo-audit', 'clawd-hq:copywriting'])
})

test('a broken payroll save does not stop the hires', async () => {
  const io = { ...fakeIo({ breakdownSkills: ['marketing:seo-audit', 'copywriting'] }), savePayroll: async () => { throw new Error('disk') } }
  const report = await hireTeam(io, team)
  expect(report.parked).toBe(0)
  expect(report.isParkFailed).toBe(true) // said, so the card can tell the person nothing was set aside
  expect(report.hired).toHaveLength(2)
})

test('rehire registers the saved hires again at session start', async () => {
  const first = fakeIo({ breakdownSkills: ['marketing:seo-audit', 'copywriting'] })
  await hireTeam(first, team)
  const next = fakeIo({ breakdownSkills: ['marketing:seo-audit', 'copywriting'] })
  next.store.set(teamKey('/work/proj'), first.store.get(teamKey('/work/proj')))
  const report = await rehire(next)
  expect(next.registered.map(s => s.name)).toEqual(['seo-audit', 'copywriting'])
  expect(report.hired).toEqual(['clawd-hq:seo-audit', 'clawd-hq:copywriting'])
})

test('rehire skips a skill that has since been uninstalled', async () => {
  const first = fakeIo({ breakdownSkills: ['marketing:seo-audit', 'copywriting'] })
  await hireTeam(first, team)
  const next = fakeIo({ breakdownSkills: ['copywriting'] })
  next.store.set(teamKey('/work/proj'), first.store.get(teamKey('/work/proj')))
  const report = await rehire(next)
  expect(next.registered.map(s => s.name)).toEqual(['copywriting'])
  expect(report.dropped).toEqual(['marketing:seo-audit'])
})

test('rehire with no saved team, or junk saved, does nothing', async () => {
  const io = fakeIo({ breakdownSkills: ['copywriting'] })
  expect(await rehire(io)).toEqual({ parked: 0, hired: [], dropped: [], failed: [] })
  io.store.set(teamKey('/work/proj'), { picks: [], hires: [{ name: 5 }, 'x', { name: 'ok', skills: ['copywriting'], description: 'd', prompt: 'p' }] })
  await rehire(io)
  expect(io.registered.map(s => s.name)).toEqual(['ok'])
})
