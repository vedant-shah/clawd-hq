import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { assemble, avatarFor, clawdAvatar, tinyIcon } from '../hooks/avatars'
import type { Pose } from '../hooks/avatars'
import { AMBER, GREEN, RED } from '../hooks/office'
import { fade, overlay, rasterCells, svgOf, trim, trimLike } from '../hooks/pixels'
import { BRIEF_NOTE } from '../hooks/desk'
import { seedDecisions } from './decisions-file'
import { CLEAR, HOUR, PANE, PEOPLE, START, SURFACES, host, mountLog, planner } from './host'

test('a spawned architect gets a desk and shows as working', async ($, on) => {
  host(on, [{ id: 'a1', type: 'ecc:architect', description: 'Design scoring', status: 'running' }])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)

  await $.agent.spawn({ prompt: 'Design the scoring service', description: 'Design scoring', subagentType: 'ecc:architect' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/scoring.ts', agentId: 'a1' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /AT WORK · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Architect/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Design scoring/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Reading scoring\.ts$/ })).toBeDefined()
    // The host's tab carries the title; the pane itself draws none.
    expect(await ui.find({ type: 'Text', text: /CLAWD HQ/i })).toBeUndefined()
    await ui.unmount()
  }
})

test('an agent clocked out twice gets one toast', async ($, on) => {
  const { toasts } = host(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'p1' }))

  await $.agent.spawn({ prompt: 'Plan v0.2', description: 'Plan features', subagentType: 'ecc:planner' } as never)
  const end = { reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'p1', isAborted: false } as never
  await Promise.all([$.turn.complete(end), $.turn.complete(end)])
  expect(toasts.filter(t => t.includes('finished'))).toHaveLength(1)
})

/** Every moment of a picture's small motions, each cut to the size of the still one, as the panel draws them. */
const POSES: Pose[] = [{}, { isBlinking: true }, { isLifted: true }, { isBlinking: true, isLifted: true }]
const moments = <T,>(draw: (pose: Pose) => Array<Array<string | null>>, as: (g: Array<Array<string | null>>) => T, hasRoomToLift = false): T[] =>
  POSES.map(pose => as(trimLike(draw(pose), hasRoomToLift ? overlay(draw({}), draw({ isLifted: true })) : draw({}))))

test('avatars are pixel art on the terminal: Clawd and each specialist at work', async ($, on) => {
  host(on, [{ id: 'x1', type: 'ecc:code-reviewer', description: 'Review', status: 'running' }])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'x1' }))
  await $.agent.spawn({ prompt: 'Review it', description: 'Review', subagentType: 'ecc:code-reviewer' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const rasters = await ui.findAll({ type: 'Raster' })
  expect(rasters.length).toBe(2)
  const clawd = rasters.find(r => r.props.key === 'clawd')!
  const desk = rasters.find(r => r.props.key === 'desk-x1')!
  // Clawd's small drawing is 14 columns by 4 rows once trimmed: as tall as a specialist's picture, and wider.
  expect([clawd.props.columns, clawd.props.rows]).toEqual([14, 4])
  expect(moments(pose => clawdAvatar(pose).compact, rasterCells)).toContain(clawd.props.cells)
  // The reviewer is drawn with the code-reviewer's own colours, not another's: the tiny picture, since the terminal cannot scale.
  expect(moments(pose => tinyIcon(avatarFor('ecc:code-reviewer'), pose), rasterCells)).toContain(desk.props.cells)
  expect(moments(pose => tinyIcon(avatarFor('ecc:planner'), pose), rasterCells)).not.toContain(desk.props.cells)
  await ui.unmount()
})

test('avatars are SVGs on the desktop, in the avatars own colors', async ($, on) => {
  host(on, [{ id: 'x1', type: 'ecc:code-reviewer', description: 'Review', status: 'running' }])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'x1' }))
  await $.agent.spawn({ prompt: 'Review it', description: 'Review', subagentType: 'ecc:code-reviewer' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  // The header's gauge bars are images too (4px tall); the avatars are the rest.
  const svgs = (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.height !== 4)
  expect(svgs.length).toBe(2)
  const [clawd, desk] = svgs
  // Clawd is 23 by 16 sprite pixels at 4px: 92 by 64.
  expect([clawd!.props.width, clawd!.props.height]).toEqual([92, 64])
  expect(moments(pose => clawdAvatar(pose).full, g => svgOf(g, 4))).toContain(clawd!.props.source)
  // The reviewer is drawn from the code-reviewer's parts (a teal cardigan), not another's.
  expect(moments(pose => assemble(avatarFor('ecc:code-reviewer'), pose), g => svgOf(g, 3), true)).toContain(desk!.props.source)
  expect(String(desk!.props.source)).toContain('#2FA8A0')
  expect(moments(pose => assemble(avatarFor('ecc:planner'), pose), g => svgOf(g, 3), true)).not.toContain(desk!.props.source)
  await ui.unmount()
})

test('a specialist\'s questions stay in its report for Clawd: nothing is filed for the person, no desk opens and nothing pops up', async ($, on) => {
  const { opened, toasts, commands, tools } = host(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'r1' }))
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan storage', subagentType: 'ecc:planner' } as never)
  const report = 'Done.\nQUESTION: Store scores in DynamoDB or Postgres? | DynamoDB / Postgres | recommend: DynamoDB\nCEO-DECISION: Launch Friday or Monday? | Friday / Monday'
  await $.turn.complete({ reason: 'answer', answer: report, turnId: 't1', agentId: 'r1', isAborted: false } as never)

  expect(opened.some(o => /desk/i.test(o.id))).toBe(false)
  expect(toasts.some(t => /for the CEO|DynamoDB|Launch Friday/.test(t))).toBe(false)
  // No command opens a desk, and no tool files a question on one.
  expect(commands).toEqual(['office', 'office-demo', 'office-setup'])
  expect(tools).toEqual(['demo', 'offer_rule', 'step', 'find_helpers', 'hire_contractor', 'team_pick'])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const text = JSON.stringify(await ui.drawn())
    expect(text).not.toMatch(/needs? you|Waiting on you|DynamoDB|CEO Desk/)
    expect(await ui.find({ key: 'see-needs' })).toBeUndefined()
    await ui.unmount()
  }
})

test("Clawd's card says All clear in an empty office, has no button of its own, and shows the empty floor", async ($, on) => {
  const { clock } = host(on)
  on('turn.start', () => ({ turnId: 't1' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const status = await ui.find({ type: 'Text', text: /^All clear$/ })
    expect(status).toBeDefined()
    // A filled dot before the words, in the colour of the state.
    const dot = await ui.find({ type: 'Text', text: /^●$/ })
    expect(dot?.text).toBe('●')
    expect(dot?.props.color).toBe(GREEN)
    // The status sits on the top row, beside his name; what Clawd says comes after it, with no status line below the bubble.
    const lines = await ui.findAll({ type: 'Text' })
    const [titleAt, dotAt, statusAt, saidAt] = [
      lines.findIndex(t => /Chief of Staff/.test(String(t.text))),
      lines.findIndex(t => /^●$/.test(String(t.text))),
      lines.findIndex(t => /^All clear$/.test(String(t.text))),
      lines.findIndex(t => t.props.italic === true),
    ]
    expect(titleAt).toBeGreaterThan(-1)
    expect(titleAt).toBeLessThan(dotAt)
    expect(dotAt).toBeLessThan(statusAt)
    expect(statusAt).toBeLessThan(saidAt)
    expect((await ui.find({ key: 'clawd-head' }))?.props.flexDirection).toBe('row')
    // Room between his name, his words and the status where there is room to give; a terminal line is too dear.
    expect((await ui.find({ key: 'clawd-lines' }))?.props.gap).toBe(surface === 'terminal' ? 0 : 1)
    expect(await ui.find({ type: 'Text', text: /Chief of Staff/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No one at a desk yet\./ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Specialists appear here while they work\./ })).toBeDefined()
    // What the empty state leaves out: it needs a feature that is not built.
    expect(await ui.find({ type: 'Text', text: /SUGGESTED FOR YOU/i })).toBeUndefined()
    expect(await ui.find({ key: 'build-team' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Build my team/i })).toBeUndefined()
    await ui.unmount()
  }

  await $.turn.start({ text: 'Refactor the auth module', turnId: 't1' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', isAborted: false } as never)
  await clock.advance(2 * HOUR)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    // The old shortcuts are gone: no button to a desk, none to refill the last request.
    expect(await ui.find({ key: 'resume' })).toBeUndefined()
    expect(await ui.find({ key: 'see-needs' })).toBeUndefined()
    // Clawd's card has no button; the footer's Usage button is the only one in the pane.
    expect((await ui.findAll({ type: 'Button' })).map(b => b.props.key)).toEqual(['usage-toggle'])
    await ui.unmount()
  }
})

test('a reading above zero never reads 0%: the label agrees with the sliver of bar', async ($, on) => {
  host(on)
  await $.session.measure({ context: { window: 1_000_000, tokens: 3_000, percent: 0.3 }, rateLimits: [], changed: ['context'] } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect((await ui.find({ key: 'usage-toggle' }))?.props.label).toBe('Usage ▾')
    expect(await ui.find({ type: 'Text', text: /^1%$/ })).toBeDefined()
    await ui.press({ key: 'usage-toggle' })
    expect(await ui.find({ type: 'Text', text: /^3k \/ 1M \(1%\)$/ })).toBeDefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^━$/ })).toBeDefined()
    else expect((await ui.findAll({ type: 'Svg' })).some(svg => String(svg.props.source).includes('<rect width="4"'))).toBe(true)
    await ui.press({ key: 'usage-toggle' })
    await ui.unmount()
  }
})

test('Clawd\'s card says what he is doing with a coloured dot and no at-work count, and never counts questions or points at a desk', async ($, on) => {
  host(on, [planner])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('turn.start', () => ({ turnId: 't1' }))
  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan the scoring API', subagentType: 'ecc:planner' } as never)

  // Clawd is between turns with one specialist at work: he is free to talk.
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Free$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(GREEN)
    expect(await ui.find({ type: 'Text', text: /at work$/ })).toBeUndefined()
    expect(await ui.find({ key: 'see-needs' })).toBeUndefined()
    expect(await ui.find({ key: 'resume' })).toBeUndefined()
    expect(JSON.stringify(await ui.drawn())).not.toMatch(/needs? you|Waiting on you/)
    await ui.unmount()
  }

  // While a turn of his runs, the line says so.
  await $.turn.start({ text: 'Plan the scoring API', turnId: 't1' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(AMBER)
    await ui.unmount()
  }
})

test('a finished specialist moves to the finished list in Settings, not the Office; there is no break room and no send home', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, session } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  // A real session start, so the since-filter is exercised: the specialist finishes after it began.
  session.startedAt = clock.now()
  await $.session.start(START)
  await clock.advance(5_000)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Updated the setup guide', subagentType: 'ecc:doc-updater' } as never)
  await clock.advance(70_000)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)
  // (The frame clock runs after a session start: a long advance stays under the mock's wait limit.)
  await clock.advance(HOUR)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    // Office: Clawd and AT WORK only.
    expect(await ui.find({ type: 'Text', text: /DONE THIS SESSION/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Updated the setup guide/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /No one at a desk yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /break room/i })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /send home/i })).toBeUndefined()
    expect(await ui.find({ key: 'home' })).toBeUndefined()

    await ui.unmount()

    const log = await mountLog($, surface)
    expect(await log.find({ type: 'Text', text: /^Writer$/ })).toBeDefined()
    expect(await log.find({ type: 'Text', text: /Updated the setup guide/ })).toBeDefined()
    expect(await log.find({ type: 'Text', text: /1h 0m ago/ })).toBeDefined()
    expect(await log.find({ type: 'Text', text: /took \d+[sm]/ })).toBeDefined()
    expect(await log.find({ type: 'Text', text: /AT WORK/ })).toBeUndefined()
    expect(await log.find({ type: 'Text', text: /Nothing has finished yet/ })).toBeUndefined()
    await log.unmount()
  }
})

test('the Log lists work newest first, and each row has a dimmed compact avatar', async ($, on) => {
  const { clock } = host(on, [])
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `l${(n += 1)}` }))
  for (const [type, what] of [['ecc:planner', 'Planned the API'], ['ecc:code-reviewer', 'Reviewed the panel'], ['ecc:doc-updater', 'Updated the guide']] as const) {
    await $.agent.spawn({ prompt: what, description: what, subagentType: type } as never)
    await clock.advance(60_000)
    await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `t${n}`, agentId: `l${n}`, isAborted: false } as never)
    await clock.advance(60_000)
  }
  for (const surface of SURFACES) {
    const ui = await mountLog($, surface)
    const order = (await ui.findAll({ type: 'Text', text: /^(Planned the API|Reviewed the panel|Updated the guide)$/ })).map(t => String(t.text))
    expect(order).toEqual(['Updated the guide', 'Reviewed the panel', 'Planned the API'])
    expect(await ui.find({ type: 'Text', text: /DONE THIS SESSION|Showing/ })).toBeUndefined()
    if (surface === 'terminal') {
      const done = (await ui.findAll({ type: 'Raster' })).filter(r => String(r.props.key).startsWith('done-'))
      expect(done).toHaveLength(3)
      // A finished row draws the tiny picture too, dimmed.
      expect(done.find(r => r.props.key === 'done-l1')!.props.cells).toBe(rasterCells(fade(trim(tinyIcon(avatarFor('ecc:planner'))), 0.7)))
    }
    else expect((await ui.findAll({ type: 'Svg' })).filter(svg => String(svg.props.source).includes('opacity="0.7"'))).toHaveLength(3)
    await ui.unmount()
  }
})

test('the Log shows 40 rows at most and says how many of how many', async ($, on) => {
  const { clock } = host(on, [])
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `m${(n += 1)}` }))
  for (let i = 1; i <= 45; i++) {
    await $.agent.spawn({ prompt: 'Work', description: `Job number ${i}`, subagentType: 'ecc:doc-updater' } as never)
    await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `t${i}`, agentId: `m${i}`, isAborted: false } as never)
    await clock.advance(1_000)
  }
  const ui = await mountLog($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /Showing 40 of 45/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^Job number \d+$/ })).toHaveLength(40)
  expect(await ui.find({ type: 'Text', text: /^Job number 45$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Job number 5$/ })).toBeUndefined()
  await ui.unmount()
})

test('a specialist that failed shows as Failed in amber in the Log, and Clawd says so on the Office', async ($, on) => {
  host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'f1' }))
  await $.agent.spawn({ prompt: 'Fix it', description: 'Fix the build', subagentType: 'ecc:build-error-resolver' } as never)
  await $.turn.complete({ reason: 'error', answer: '', turnId: 't1', agentId: 'f1', isAborted: false } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^.+ failed$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(RED)
    expect(await ui.find({ type: 'Text', text: /All clear/ })).toBeUndefined()
    await ui.unmount()
    const log = await mountLog($, surface)
    const failed = await log.find({ type: 'Text', text: /Failed after/ })
    expect(failed).toBeDefined()
    expect(failed?.props.color).toBe(AMBER)
    await log.unmount()
  }
})

test('the Log empties on /clear, which only ends the session, and fills again after it', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, session } = host(on, [])
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${(spawned += 1)}` }))
  session.startedAt = clock.now()
  await $.session.start(START)
  await clock.advance(5_000)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Updated the setup guide', subagentType: 'ecc:doc-updater' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)

  const before = await mountLog($, 'terminal')
  expect(await before.find({ type: 'Text', text: /Updated the setup guide/ })).toBeDefined()
  await before.unmount()

  // /clear: the engine ends the session with reason `clear` and fires no session.start.
  await clock.advance(HOUR)
  await $.session.end(CLEAR)
  for (const surface of SURFACES) {
    const after = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await after.find({ type: 'Text', text: /No one at a desk yet/ })).toBeDefined()
    await after.unmount()
    const log = await mountLog($, surface)
    expect(await log.find({ type: 'Text', text: /Updated the setup guide/ })).toBeUndefined()
    expect(await log.find({ type: 'Text', text: /Nothing has finished yet this session/ })).toBeDefined()
    await log.unmount()
  }

  // Work finished in the new session shows again.
  await clock.advance(1_000)
  await $.agent.spawn({ prompt: 'Fix', description: 'Fixed the build', subagentType: 'ecc:build-error-resolver' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't2', agentId: 'a2', isAborted: false } as never)
  const again = await mountLog($, 'desktop')
  expect(await again.find({ type: 'Text', text: /Nothing has finished yet/ })).toBeUndefined()
  expect(await again.find({ type: 'Text', text: /Fixed the build/ })).toBeDefined()
  await again.unmount()
})

test('a session end that is not a clear leaves the list alone', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, session } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  session.startedAt = clock.now()
  await $.session.start(START)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Updated the setup guide', subagentType: 'ecc:doc-updater' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)
  await clock.advance(HOUR)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
  const ui = await mountLog($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /Updated the setup guide/ })).toBeDefined()
  await ui.unmount()
})

test('text agents write is kept to one short line where it is stored (a task is cut at a word, with no mark)', async ($, on) => {
  const { toasts } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('agent.offer', () => ({ isOffered: true }) as never)
  await $.session.start(START)
  const wordy = `Update the setup guide\nand then ${'keep going with more words '.repeat(14)}`
  expect(wordy.length).toBeGreaterThan(300)
  await $.agent.spawn({ prompt: 'Write docs', description: wordy, subagentType: 'ecc:doc-updater' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)
  await $.agent.offer({ agent: 'ecc:planner', description: `Plans work\nbefore anyone builds. ${'More detail. '.repeat(40)}` } as never)

  expect(toasts.find(t => t.includes('finished'))).not.toContain('\n')
  for (const surface of SURFACES) {
    const log = await mountLog($, surface)
    const done = await log.find({ type: 'Text', text: /Update the setup guide/ })
    expect(String(done?.text)).not.toContain('\n')
    expect(String(done?.text).length).toBeLessThanOrEqual(160)
    expect(String(done?.text)).not.toMatch(/…/)
    await log.unmount()

    const people = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PEOPLE })
    const blurb = await people.find({ type: 'Text', text: /^Plans work before anyone builds/ })
    expect(String(blurb?.text)).not.toContain('\n')
    await people.unmount()
  }
})

test('People lists a team member and a laid-off one in their sections, and lay off and hire move them', async ($, on) => {
  host(on)
  on('agent.offer', () => ({ isOffered: true }) as never)
  await $.agent.offer({ agent: 'ecc:planner', description: 'Plans work before anyone builds' } as never)
  await $.agent.offer({ agent: 'legal:review-contract', description: 'Reads contracts closely' } as never)
  await $.agent.offer({ agent: 'Explore', description: 'Maps a codebase' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PEOPLE })
    expect(await ui.find({ type: 'Text', text: /TEAM · 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL/ })).toBeUndefined()
    // A row is the name and one line of what they do: no "Hired" mark, no plugin or hire-count line, no total.
    expect(await ui.find({ type: 'Text', text: /^Plans work before anyone builds$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Hired|never hired|plugin ·|total/ })).toBeUndefined()
    expect(await ui.find({ key: 'layoff-ecc:planner' })).toBeDefined()
    // On the terminal a person's row draws the tiny picture.
    if (surface === 'terminal') {
      const person = (await ui.findAll({ type: 'Raster' })).find(r => r.props.key === 'person-ecc:planner')!
      expect(person.props.cells).toBe(rasterCells(trim(tinyIcon(avatarFor('ecc:planner')))))
    }
    // Built-in agents are never laid off.
    expect(await ui.find({ key: 'layoff-Explore' })).toBeUndefined()

    await ui.press({ key: 'layoff-legal:review-contract' })
    // A laid-off helper leaves the screen: the pool is hidden until a search, with one line saying how many wait.
    expect(await ui.find({ type: 'Text', text: /TEAM · 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL/ })).toBeUndefined()
    expect(await ui.find({ key: 'hire-legal:review-contract' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^1 more installed\. Search to find and hire one\.$/ })).toBeDefined()

    // The search covers the plugin name, and shows the matching pool rows with a Hire button.
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-people', text: 'legal', kind: 'change', surface })
    expect(await ui.find({ type: 'Text', text: /TEAM/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL · 1/ })).toBeDefined()
    expect(await ui.find({ key: 'hire-legal:review-contract' })).toBeDefined()
    expect(await ui.find({ key: 'layoff-legal:review-contract' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /more installed/ })).toBeUndefined()
    // A search also finds team members.
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-people', text: 'planner', kind: 'change', surface })
    expect(await ui.find({ type: 'Text', text: /TEAM · 1/ })).toBeDefined()
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-people', text: 'legal', kind: 'change', surface })

    await ui.press({ key: 'hire-legal:review-contract' })
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-people', text: '', kind: 'change', surface })
    expect(await ui.find({ type: 'Text', text: /TEAM · 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a People row no longer shows the plugin or how often a type was hired', async ($, on) => {
  host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'h1' }))
  await $.agent.spawn({ prompt: 'Plan', description: 'Plan', subagentType: 'ecc:planner' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  expect(await ui.find({ type: 'Text', text: /hired 1 time|plugin ·/ })).toBeUndefined()
  await ui.unmount()
})

test('a People row tells what someone does in the first sentence of the blurb only, never cut with a mark', async ($, on) => {
  host(on, [])
  on('agent.offer', () => ({ isOffered: true }) as never)
  await $.agent.offer({ agent: 'ecc:planner', description: 'Plans work before anyone builds. Checks each step against the brief.' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  const line = await ui.find({ type: 'Text', text: /^Plans work before anyone builds\.$/ })
  expect(line?.props.wrap).toBe('wrap')
  expect(await ui.find({ type: 'Text', text: /Checks each step/ })).toBeUndefined()
  await ui.unmount()
})

test('no decision rides along any more: Clawd\'s context has no memory block, and a brief is the prompt and the office note only', async ($, on) => {
  const { files } = host(on, [], { profile: { role: 'Tool or plugin builder', workflow: ['Ask about anything unclear'] } })
  seedDecisions(files, [{ text: 'Scores live in Postgres' }])
  const briefs: string[] = []
  on('agent.spawn', (_$, e) => (briefs.push((e as { prompt: string }).prompt), { model: 'claude-opus-5-5', agentId: `a${briefs.length}` }))
  await $.session.start(START)

  // Clawd's context keeps who the person is (from setup) and nothing about decisions.
  const ctx = (await $.prompt.context({ blocks: [] } as never)) as { blocks: Array<{ name: string; text: string }> }
  expect(ctx.blocks.map(b => b.name)).toEqual(['clawdProfile'])
  expect(JSON.stringify(ctx)).not.toMatch(/Postgres|decision|remember|memory/i)

  // A specialist's brief is what Clawd wrote and the office note.
  await $.agent.spawn({ prompt: 'Build the scores table', description: 'Build table', subagentType: 'ecc:tdd-guide' } as never)
  expect(briefs[0]).toBe(`Build the scores table${BRIEF_NOTE}`)
  expect(briefs[0]).not.toMatch(/Postgres|Settled for this project/)
})



test('the toasts and Clawd say the role, never a made-up name', async ($, on) => {
  const { toasts } = host(on, [])
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `n${(n += 1)}` }))
  await $.agent.spawn({ prompt: 'p', description: 'Check the build', subagentType: 'ecc:tdd-guide' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'n1', isAborted: false } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Fix the build', subagentType: 'ecc:build-error-resolver' } as never)
  await $.turn.complete({ reason: 'error', answer: '', turnId: 't2', agentId: 'n2', isAborted: false } as never)
  expect(toasts.find(t => t.includes('finished'))).toMatch(/^\S+ Tester finished: Check the build \(/)
  expect(toasts.find(t => t.includes('could not finish'))).toBe('🤕 Fixer could not finish: Fix the build')
    for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Fixer failed$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('many agent types offered at the same moment are all recorded, and none is skipped', async ($, on) => {
  host(on, [])
  on('agent.offer', () => ({ isOffered: true }) as never)
  const types = Array.from({ length: 60 }, (_, i) => `acme:agent-${i}`)
  // As at session start: the engine offers every type at once, not one after another.
  const offered = await Promise.all(types.map(agent => $.agent.offer({ agent, description: `Does job ${agent}` } as never)))
  expect(offered.every(o => (o as { isOffered?: boolean }).isOffered === true)).toBe(true)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  // Every one is on the books (the list itself shows only so many rows).
  expect(text).not.toContain('total')
  expect(text).toContain('TEAM · 60')
})

test('a hire made while agent types are still being recorded is counted, and no offer is lost', async ($, on) => {
  host(on, [])
  on('agent.offer', () => ({ isOffered: true }) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'h1' }))
  const types = Array.from({ length: 40 }, (_, i) => `acme:agent-${i}`)
  // The offers and a hire of one of those types land together.
  await Promise.all([
    ...types.map(agent => $.agent.offer({ agent, description: `Does job ${agent}` } as never)),
    $.agent.spawn({ prompt: 'p', description: 'Do the job', subagentType: 'acme:agent-0' } as never),
  ])
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  expect(text).toContain('TEAM · 40')
  expect(text).not.toContain('hired 1 time')
})

// ---- The payroll review: in the People tab, where the payroll is ----

const MANY = [
  ...['go-reviewer', 'rust-reviewer', 'python-reviewer', 'kotlin-reviewer', 'swift-reviewer', 'cpp-reviewer', 'healthcare-reviewer'].map(n => `ecc:${n}`),
  ...['planner', 'architect', 'tdd-guide', 'code-reviewer', 'doc-updater', 'e2e-runner', 'refactor-cleaner', 'security-reviewer'].map(n => `ecc:${n}`),
]

/** A project with many agent types on offer, and the clock run until the review is made. */
async function untilReview($: Engine, on: Parameters<typeof host>[0], types = MANY) {
  // The review waits until setup is done or skipped (tests/onboard-flow.test.tsx covers the wait).
  const h = host(on, [], { 'onboard:/repo': { step: 'skipped', pending: [], at: 1 } })
  on('agent.offer', () => ({ isOffered: true }) as never)
  on('fs.list', () => ({ value: [{ name: 'package.json', kind: 'file' }] }) as never)
  await $.session.start(START)
  for (const agent of types) await $.agent.offer({ agent, description: `Does ${agent}` } as never)
  await h.clock.advance(25 * 400 + 100)
  return h
}
const reviewShown = async ($: Engine) => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  const isShown = (await ui.find({ key: 'payroll-review' })) !== undefined
  await ui.unmount()
  return isShown
}

test('the payroll review waits in the People tab with both answers, and the person hears of it once', async ($, on) => {
  const { toasts, clock, opened } = await untilReview($, on)
  expect(toasts.filter(t => /Payroll review/.test(t))).toEqual(['📋 Payroll review: 7 agent types this project does not use. See the People tab.'])
  expect(opened.some(o => /desk/i.test(o.id))).toBe(false)
  await clock.advance(60 * 400)
  expect(toasts.filter(t => /Payroll review/.test(t))).toHaveLength(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PEOPLE })
    expect(await ui.find({ type: 'Text', text: /^Payroll review: lay off 7 of 1[56] agent types this project does not use\?$/ })).toBeDefined()
    expect(String((await ui.find({ key: 'payroll-layoff' }))?.props.label)).toBe('Lay off 7')
    expect(await ui.find({ key: 'payroll-keep' })).toBeDefined()
    await ui.unmount()
    // The review is the People tab's alone.
    const office = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(JSON.stringify(await office.drawn())).not.toMatch(/Payroll review/)
    await office.unmount()
  }
})

test('answering the payroll review lays the unused types off, or keeps everyone, and the review goes away', async ($, on) => {
  const { toasts } = await untilReview($, on)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  await ui.press({ key: 'payroll-layoff' })
  expect(await ui.find({ key: 'payroll-review' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^7 more installed\. Search to find and hire one\.$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /TALENT POOL/ })).toBeUndefined()
  expect(toasts.some(t => /7 agent types laid off/.test(t))).toBe(true)
  await ui.unmount()
})

test('keeping everyone also ends the review', async ($, on) => {
  const { toasts } = await untilReview($, on)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  await ui.press({ key: 'payroll-keep' })
  expect(await ui.find({ key: 'payroll-review' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /TALENT POOL/ })).toBeUndefined()
  expect(toasts.some(t => /Everyone stays on the payroll/.test(t))).toBe(true)
  await ui.unmount()
})

test('laying one type off by hand settles the payroll, so the review goes away', async ($, on) => {
  await untilReview($, on)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  expect(await ui.find({ key: 'payroll-review' })).toBeDefined()
  await ui.press({ key: 'layoff-ecc:planner' })
  expect(await ui.find({ key: 'payroll-review' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^1 more installed\./ })).toBeDefined()
  await ui.unmount()
})

test('a small team gets no payroll review; the review is made once the team grows past 15 types', async ($, on) => {
  // Fewer than 15 agent types: nothing to review.
  const { toasts, clock } = await untilReview($, on, MANY.slice(0, 10))
  expect(await reviewShown($)).toBe(false)
  expect(toasts.some(t => /Payroll review/.test(t))).toBe(false)
  // Six more types join: the team is large enough now, and seven of its types are of no use here.
  for (const n of [1, 2, 3, 4, 5, 6]) await $.agent.offer({ agent: `ecc:planner-${n}`, description: 'Plans' } as never)
  await clock.advance(25 * 400)
  expect(await reviewShown($)).toBe(true)
  expect(toasts.filter(t => /Payroll review/.test(t))).toHaveLength(1)
})

test('a team with nothing to lay off is marked reviewed with no card and no pop-up', async ($, on) => {
  const useful = Array.from({ length: 16 }, (_, i) => `ecc:planner-${i}`)
  const { toasts, clock } = await untilReview($, on, useful)
  expect(await reviewShown($)).toBe(false)
  expect(toasts.some(t => /Payroll review/.test(t))).toBe(false)
  // Types that could be laid off arrive later: the payroll is already reviewed, so nothing is proposed.
  for (const agent of MANY.slice(0, 7)) await $.agent.offer({ agent, description: 'x' } as never)
  await clock.advance(50 * 400)
  expect(await reviewShown($)).toBe(false)
})

test('once the payroll is settled a new session brings back no review; an unsettled one is made again', async ($, on) => {
  const { toasts, clock } = await untilReview($, on)
  // A new session with the review still open: the old card goes, and the review is made again for this session.
  await $.session.start(START)
  expect(await reviewShown($)).toBe(false)
  await clock.advance(25 * 400 + 100)
  expect(await reviewShown($)).toBe(true)
  expect(toasts.filter(t => /Payroll review/.test(t))).toHaveLength(2)

  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  await ui.press({ key: 'payroll-keep' })
  await ui.unmount()
  await $.session.start(START)
  await clock.advance(60 * 400)
  expect(await reviewShown($)).toBe(false)
  expect(toasts.filter(t => /Payroll review/.test(t))).toHaveLength(2)
})

test('a specialist\'s turn starting is not Clawd\'s: his card stays free to talk, with its green dot', async ($, on) => {
  host(on, [planner])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan the scoring API', subagentType: 'ecc:planner' } as never)
  await $.turn.start({ text: 'Plan it', turnId: 'r1', agentId: 'a1' } as never)
  await $.turn.start({ text: '', turnId: 'r2', agentId: 'a1' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Free$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^●$/ }))?.props.color).toBe(GREEN)
    expect(await ui.find({ type: 'Text', text: /^Working$/ })).toBeUndefined()
    await ui.unmount()
  }
})
