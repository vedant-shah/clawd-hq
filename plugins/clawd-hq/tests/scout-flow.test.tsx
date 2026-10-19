// The scout end to end on the test host: registered at session start, hidden from the chat, started when setup reaches the team step,
// guarded while it reads, and its picks (or its failure) turning into the card. Nothing is sent for the person.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BRIEF_NOTE } from '../hooks/desk'
import { PANE, PEOPLE, START } from './host'
import { CWD, frames, office, onboardHost, press, realWait, settle } from './onboard-host'
import type { OnboardHost } from './onboard-host'

const TEAM = 'mcp__clawd-hq__team_pick'
type Call = { tool: string; input: Record<string, unknown>; answer: { deny?: string; result?: unknown } }

/** A session on the terminal, set up as the other flow tests do. */
async function open($: Engine, h: OnboardHost) {
  await $.session.start(START)
  for (const [agent, description] of [['ecc:planner', 'Plans work before anyone builds.'], ['ecc:code-reviewer', 'Reviews code for quality and security.']] as const) {
    await $.agent.offer({ agent, description } as never)
  }
  await frames(h)
}

/** Runs the scout's moves one by one and keeps what each call was answered with. */
function moves($: Engine, h: OnboardHost, steps: ReadonlyArray<[string, Record<string, unknown>]>) {
  const calls: Call[] = []
  h.scout.mode = 'script'
  h.scout.script = async id => {
    for (const [tool, input] of steps) calls.push({ tool, input, answer: (await $.tool.call({ tool, ...input, agentId: id } as never)) as Call['answer'] })
  }
  return calls
}
/** Lets the scout's script run (it starts a moment after its start returns, in real time) and everything that follows it. */
const more = async (h: OnboardHost) => { await settle(h, 300); await realWait(120); await settle(h, 300) }
/** The ids the plugin asked the engine to stop (TaskStop calls). */
const stopsOf = (h: OnboardHost) => h.calls.tools.filter(t => t.tool === 'TaskStop').map(t => String(t.input.task_id))
const toolsSeen =(h: OnboardHost) => h.calls.tools.map(t => `${t.tool}${t.agentId ? '@' + t.agentId : ''}`)

const GOOD_PICKS = [
  { seat: 'Plan', name: 'planner', reason: 'CLAUDE.md asks for a plan before a big change.', evidence: 'CLAUDE.md' },
  { seat: 'Check', name: 'ecc:code-reviewer', reason: 'The shop API handles logins, so reviews matter.', evidence: 'src/auth.ts' },
  { seat: 'Make', name: 'ecc:tdd-workflow', reason: 'No tests yet, so tests come first.', evidence: `${CWD}/package.json` },
]
const LOOK_AROUND: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['Glob', { pattern: '**/*.ts' }], ['Read', { file_path: 'package.json' }], ['Read', { file_path: 'CLAUDE.md' }], ['Glob', { pattern: '*', path: 'src' }],
]

test('at session start the scout is registered as a Sonnet agent that can only read, and the pick tool is registered for it', async ($, on) => {
  const h = onboardHost(on)
  await open($, h)
  expect(h.scout.registered).toHaveLength(1)
  expect(h.scout.registered[0]).toMatchObject({ name: 'scout', model: 'sonnet', omitClaudeMd: true, tools: ['Read', 'Glob', TEAM] })
  expect(h.tools).toContain('team_pick')
  expect(h.toolSpecs.find(t => t.name === 'team_pick')?.isDeferred).toBe(false)
  expect(h.calls.registered).toEqual([]) // hires are only for skills
})

test('the scout is hidden from the main chat: not offered, not on the books, not in People', async ($, on) => {
  const h = onboardHost(on)
  await open($, h)
  expect(await $.agent.offer({ agent: 'clawd-hq:scout', description: 'Clawd HQ\'s own scout.' } as never)).toEqual({ isOffered: false })
  expect(await $.agent.offer({ agent: 'ecc:planner', description: 'Plans.' } as never)).toEqual({ isOffered: true })
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  const text = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')
  await ui.unmount()
  expect(text).not.toMatch(/scout/i)
})

test('Start with a scout: it is started on its own type with the full list, looks around, and its picks and reasons make the card; Opus is never called', async ($, on) => {
  const h = onboardHost(on)
  const calls = moves($, h, [...LOOK_AROUND, [TEAM, { picks: GOOD_PICKS }]])
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  const [spawn] = h.scout.spawned
  expect(spawn?.subagentType).toBe('clawd-hq:scout')
  expect(spawn?.prompt).toContain('ecc:code-reviewer · agent')
  expect(spawn?.prompt).toContain('The project folder is: /repo')
  expect(spawn?.prompt).not.toContain(BRIEF_NOTE) // no hire notes: it is not a hire
  expect(calls.map(c => c.tool)).toEqual(['Glob', 'Read', 'Read', 'Glob', TEAM])
  expect(calls.map(c => c.answer.deny)).toEqual([undefined, undefined, undefined, undefined, undefined])
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(0)
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('scout')
  const tab = await office($, 'terminal')
  expect(tab.joined).toContain('CLAUDE.md asks for a plan before a big change. (CLAUDE.md)')
  expect(tab.joined).toContain('No tests yet, so tests come first. (package.json)')
  expect(tab.joined).not.toContain('The shop API handles logins') // it cites a file the scout never opened: the card shows the facts instead
  expect(tab.joined).toContain('Clawd HQ\'s own Researcher · nothing installed fits')
  expect(tab.joined).toContain('ecc:planner')
  expect(h.calls.sent).toEqual([])
})

test('the scout is not a hire: it never appears at a desk, and its reads are not counted as anyone\'s work', async ($, on) => {
  const h = onboardHost(on)
  moves($, h, [...LOOK_AROUND, [TEAM, { picks: GOOD_PICKS }]])
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  await frames(h, 17) // the engine lists the scout, and the office checks that list
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'desk-sc1' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')).not.toMatch(/scout/i)
  await ui.unmount()
})

test('the scout\'s reads are guarded: secrets, outside the folder, .. paths, links that lead out, Grep and every other tool are refused', async ($, on) => {
  const h = onboardHost(on)
  h.files.set(`${CWD}/.env`, 'KEY=1')
  h.files.set(`${CWD}/prod.env`, 'KEY=2')
  h.files.set(`${CWD}/notes.txt`, 'a link')
  h.links[`${CWD}/notes.txt`] = '/home/me/.ssh/id_rsa'
  const calls = moves($, h, [
    ['Read', { file_path: '.env' }], ['Read', { file_path: 'prod.env' }], ['Read', { file_path: '/etc/passwd' }], ['Read', { file_path: 'notes.txt' }], ['Read', { file_path: 'missing.md' }],
    ['Read', { file_path: 'src/../package.json' }], ['Glob', { pattern: '../**/*' }], ['Glob', { pattern: '*', path: 'src/..' }], ['Grep', { pattern: 'KEY' }],
    ['Bash', { command: 'cat .env' }], ['Write', { file_path: 'a.txt', content: 'x' }],
    ['Read', { file_path: 'package.json' }], ['Glob', { pattern: '*' }], [TEAM, { picks: GOOD_PICKS.slice(0, 1) }],
  ])
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  expect(calls.map(c => (c.answer.deny ? 'refused' : 'ran'))).toEqual([...Array(11).fill('refused'), 'ran', 'ran', 'ran'])
  expect(calls.slice(0, 11).every(c => /^Refused by Clawd HQ: /.test(c.answer.deny ?? ''))).toBe(true)
  // Only the calls that passed reached the tools.
  expect(h.calls.tools.filter(t => t.agentId === 'sc1').map(t => t.tool)).toEqual(['Read', 'Glob'])
})

test('a scout the plugin has not marked yet, which the engine lists by its type, is guarded from its first call and never hired', async ($, on) => {
  const h = onboardHost(on)
  h.files.set(`${CWD}/.env`, 'KEY=1')
  await open($, h)
  h.agentList.push({ id: 'sc9', type: 'clawd-hq:scout', description: 'Look around the project', status: 'running' })
  const call = (input: Record<string, unknown>) => $.tool.call({ tool: 'Read', ...input, agentId: 'sc9' } as never) as Promise<{ deny?: string }>
  expect((await call({ file_path: '.env' })).deny).toMatch(/^Refused by Clawd HQ/)
  expect((await call({ file_path: 'package.json' })).deny).toBeUndefined()
  await frames(h, 17)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'desk-sc9' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')).not.toMatch(/scout/i)
  await ui.unmount()
})

test('the pick tool is for the scout alone: the main chat and other agents are told so', async ($, on) => {
  const h = onboardHost(on)
  await open($, h)
  const main = (await $.tool.call({ tool: TEAM, picks: GOOD_PICKS } as never)) as { deny?: string; result?: string }
  const other = (await $.tool.call({ tool: TEAM, picks: GOOD_PICKS, agentId: 'a7' } as never)) as { deny?: string; result?: string }
  for (const r of [main, other]) expect(r.deny ?? r.result).toMatch(/only the Clawd HQ scout/i)
})

test('a scout that sends names nobody has is told and may try again; the second try is taken', async ($, on) => {
  const h = onboardHost(on)
  const calls = moves($, h, [['Read', { file_path: 'package.json' }], [TEAM, { picks: [{ seat: 'Plan', name: 'ecc:nobody' }] }], [TEAM, { picks: GOOD_PICKS.slice(2) }]])
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  expect(calls[1]?.answer.deny).toMatch(/ecc:nobody.*not on the candidate list/)
  expect(calls[2]?.answer.deny).toBeUndefined()
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('scout')
  expect(stopsOf(h)).toEqual([]) // it sent its picks: nothing to stop
})

test('a scout that sends nothing usable three times is finished, and Opus picks instead', async ($, on) => {
  const h = onboardHost(on)
  const bad = [TEAM, { picks: [{ seat: 'Plan', name: 'ecc:nobody' }] }] as [string, Record<string, unknown>]
  moves($, h, [bad, bad, bad])
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('opus')
  expect(stopsOf(h)).toEqual(['sc1']) // the scout is stopped, not left to run on
})

test('a scout that says nothing for a minute and a half is given up on: Opus picks, and the scout is refused from then on', async ($, on) => {
  const h = onboardHost(on)
  h.scout.mode = 'silent'
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  expect(h.calls.models).toHaveLength(0) // still waiting, and the card says it is looking
  await h.clock.advance(89_000)
  await more(h)
  expect(h.calls.models).toHaveLength(0)
  await h.clock.advance(1_500)
  await more(h)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('opus')
  expect(stopsOf(h)).toEqual(['sc1'])
  const late = (await $.tool.call({ tool: 'Read', file_path: 'package.json', agentId: 'sc1' } as never)) as { deny?: string }
  expect(late.deny).toMatch(/^Refused by Clawd HQ/)
})

test('a scout that ends without sending anything hands over to Opus at once, without waiting out the clock', async ($, on) => {
  const h = onboardHost(on)
  h.scout.mode = 'silent'
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  await $.turn.complete({ reason: 'answer', answer: 'I could not finish.', turnId: 'sc-turn', agentId: 'sc1', isAborted: false } as never)
  await more(h)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
  expect((h.saved.get(`team:${CWD}`) as { by: string }).by).toBe('opus')
})

test('with no scout (the start is refused) and no Opus answer, the rules pick and the core four fill what is left', async ($, on) => {
  const h = onboardHost(on)
  h.models.opus = undefined
  await open($, h)
  await press($, h, 'terminal', 'onboard-start')
  await more(h)
  const team = h.saved.get(`team:${CWD}`) as { by: string; picks: Array<{ name: string }> }
  expect(team.by).toBe('rules')
  expect(team.picks.length).toBeGreaterThan(0)
  expect(toolsSeen(h).filter(t => t.includes('@sc1'))).toEqual([])
})
