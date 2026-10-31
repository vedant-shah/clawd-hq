// The scout end to end on the test host: registered at session start, hidden from the chat, started when setup reaches the team step,
// and its final answer (or its failure) turning into the card. Nothing is sent for the person.
// The plugin starts the scout from its own timer, so in Claude Code none of the plugin's hooks run inside the scout (they are skipped
// as re-entry). This host cannot show that skip; what it shows is that nothing here needs a hook inside the scout: the picks are read
// from the scout's transcript.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { BRIEF_NOTE } from '../hooks/desk'
import { TEAM_END, TEAM_START } from '../hooks/scout-answer'
import { PANE, PEOPLE, START } from './host'
import { CWD, frames, office, onboardHost, settle } from './onboard-host'
import type { OnboardHost } from './onboard-host'

/** A session on the terminal, set up as the other flow tests do. */
async function open($: Engine, h: OnboardHost) {
  await $.session.start(START)
  for (const [agent, description] of [['ecc:planner', 'Plans work before anyone builds.'], ['ecc:code-reviewer', 'Reviews code for quality and security.']] as const) {
    await $.agent.offer({ agent, description } as never)
  }
  await frames(h)
}

/** Lets setup reach the scout, then one look at its transcript, and what follows. */
const more = async (h: OnboardHost) => { await settle(h, 300); await h.clock.advance(2_000); await settle(h, 300) }
/** The ids the plugin asked the engine to stop (TaskStop calls). */
const stopsOf = (h: OnboardHost) => h.calls.tools.filter(t => t.tool === 'TaskStop').map(t => String(t.input.task_id))
const teamOf = (h: OnboardHost) => h.saved.get(`team:${CWD}`) as { by: string; picks: Array<{ name: string; receipt: string }> }

/** The scout's transcript: it opened these files with Read, then ended with this answer. */
function scoutSaid(h: OnboardHost, reads: readonly string[], answer: string) {
  h.scout.mode = 'silent'
  h.scout.said = [
    { role: 'assistant', text: '', toolUses: [{ tool: 'Glob', input: { pattern: '**/*.ts' } }, ...reads.map(file_path => ({ tool: 'Read', input: { file_path } }))] },
    { role: 'assistant', text: answer, toolUses: [] },
  ]
}
const block = (...lines: string[]) => `I looked around.\n${TEAM_START}\n${lines.join('\n')}\n${TEAM_END}`
const GOOD_ANSWER = block(
  'Plan | planner | CLAUDE.md | CLAUDE.md asks for a plan before a big change.',
  'Check | ecc:code-reviewer | src/auth.ts | The shop API handles logins, so reviews matter.',
  `Make | ecc:tdd-workflow | ${CWD}/package.json | No tests yet, so tests come first.`,
)

test('at session start the scout is registered as a Sonnet agent whose only tools read and search, and no pick tool is registered', async ($, on) => {
  const h = onboardHost(on)
  await open($, h)
  expect(h.scout.registered).toHaveLength(1)
  expect(h.scout.registered[0]).toMatchObject({ name: 'scout', model: 'sonnet', omitClaudeMd: true, tools: ['Read', 'Glob'], permissionMode: 'dontAsk' })
  expect(h.tools).not.toContain('team_pick')
  expect(h.calls.registered.every(r => (r.skills?.length ?? 0) > 0)).toBe(true) // hires are only for skills (setup runs by itself and hires the skill it picks)
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

test('Setup with a scout: it is started on its own type with the full list, and the team block in its answer makes the team; Opus is never called', async ($, on) => {
  const h = onboardHost(on)
  scoutSaid(h, ['package.json', 'CLAUDE.md'], GOOD_ANSWER)
  await open($, h)
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  const [spawn] = h.scout.spawned
  expect(spawn?.subagentType).toBe('clawd-hq:scout')
  expect(spawn?.prompt).toContain('ecc:code-reviewer · agent')
  expect(spawn?.prompt).toContain('The project folder is: /repo')
  expect(spawn?.prompt).not.toContain(BRIEF_NOTE) // no hire notes: it is not a hire
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(0)
  expect(teamOf(h).by).toBe('scout')
  expect(h.saved.get('debug:scout')).toEqual({ folder: CWD, note: 'The scout picked 3: ecc:planner, ecc:code-reviewer, ecc:tdd-workflow.' })
  // The reasons are kept with the team: the scout's own sentence only where it rests on a file the scout opened.
  const receipts = teamOf(h).picks.map(p => p.receipt).join('\n')
  expect(receipts).toContain('CLAUDE.md asks for a plan before a big change. (CLAUDE.md)')
  expect(receipts).toContain('No tests yet, so tests come first. (package.json)')
  expect(receipts).not.toContain('The shop API handles logins') // it cites a file the scout never opened: the facts are kept instead
  expect(receipts).toContain('Clawd HQ\'s own Researcher · nothing installed fits')
  expect(stopsOf(h)).toEqual([]) // it answered: nothing to stop
  // The card afterwards names the team in plain words.
  const tab = await office($, 'terminal')
  expect(tab.joined).toMatch(/Set up your team for this project: Planner, .*Reviewer.*Researcher/)
  expect(h.calls.sent).toEqual([])
})

test('the scout is not a hire: it never appears at a desk', async ($, on) => {
  const h = onboardHost(on)
  scoutSaid(h, ['package.json', 'CLAUDE.md'], GOOD_ANSWER)
  await open($, h)
  await more(h)
  await frames(h, 17) // the engine lists the scout, and the office checks that list
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ key: 'desk-sc1' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Text' })).map(t => String(t.text)).join('\n')).not.toMatch(/scout/i)
  await ui.unmount()
})

test('bad lines are dropped and good ones kept: one usable pick is enough for the scout\'s team', async ($, on) => {
  const h = onboardHost(on)
  scoutSaid(h, ['package.json'], block('Plan | ecc:nobody | README.md | Not installed.', 'not a pick at all', 'Make | ecc:tdd-workflow | package.json | No tests yet.'))
  await open($, h)
  await more(h)
  expect(teamOf(h).by).toBe('scout')
  expect(teamOf(h).picks.map(p => p.name)).toContain('ecc:tdd-workflow')
  expect(teamOf(h).picks.map(p => p.name)).not.toContain('ecc:nobody')
  expect(h.saved.get('debug:scout')).toEqual({ folder: CWD, note: 'The scout picked 1: ecc:tdd-workflow (1 dropped).' })
})

test('a scout whose answer holds no usable pick: Opus picks instead, and the note says why', async ($, on) => {
  const h = onboardHost(on)
  scoutSaid(h, ['package.json'], block('Plan | ecc:nobody | README.md | Not installed.'))
  await open($, h)
  await more(h)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
  expect(teamOf(h).by).toBe('opus')
  expect(h.saved.get('debug:scout')).toEqual({ folder: CWD, note: expect.stringMatching(/no usable pick \(1 dropped\)/) })
})

test('a scout that ends without a team list hands over to Opus at once, without waiting out the clock', async ($, on) => {
  const h = onboardHost(on)
  scoutSaid(h, [], 'The team_pick tool did not accept my picks.')
  await open($, h)
  h.scout.end()
  await more(h)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
  expect(teamOf(h).by).toBe('opus')
  expect(h.saved.get('debug:scout')).toEqual({ folder: CWD, note: expect.stringMatching(/ended without a team list/) })
  expect(stopsOf(h)).toEqual([])
})

test('a scout that says nothing for a minute and a half is given up on: it is stopped, and Opus picks', async ($, on) => {
  const h = onboardHost(on)
  h.scout.mode = 'silent'
  await open($, h)
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  expect(h.calls.models).toHaveLength(0) // still waiting, and the card says it is looking
  for (let i = 0; i < 44; i += 1) await h.clock.advance(2_000)
  await settle(h, 300)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(1)
  expect(teamOf(h).by).toBe('opus')
  expect(stopsOf(h)).toEqual(['sc1'])
  expect(h.saved.get('debug:scout')).toEqual({ folder: CWD, note: expect.stringMatching(/no team list within 90 seconds/) })
})

test('with no scout (the start is refused) and no Opus answer, the rules pick and the core four fill what is left', async ($, on) => {
  const h = onboardHost(on)
  h.models.opus = undefined
  await open($, h)
  await more(h)
  const team = teamOf(h)
  expect(team.by).toBe('rules')
  expect(team.picks.length).toBeGreaterThan(0)
  expect(h.saved.get('debug:scout')).toEqual({ folder: CWD, note: expect.stringMatching(/could not start/) })
})
