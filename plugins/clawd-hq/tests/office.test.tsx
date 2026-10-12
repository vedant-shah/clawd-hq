import { expect, test } from 'claude-code/testing'
import { assemble, avatarFor, clawdAvatar } from '../hooks/avatars'
import { ACCENT, AMBER } from '../hooks/office'
import { rasterCells, svgOf, trim } from '../hooks/pixels'
import { CLEAR, DECISIONS, DESK, HOUR, LOG, PANE, PEOPLE, START, SURFACES, host, planner } from './host'

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

test('avatars are pixel art on the terminal: Clawd and each specialist at work', async ($, on) => {
  host(on, [{ id: 'x1', type: 'ecc:code-reviewer', description: 'Review', status: 'running' }])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'x1' }))
  await $.agent.spawn({ prompt: 'Review it', description: 'Review', subagentType: 'ecc:code-reviewer' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const rasters = await ui.findAll({ type: 'Raster' })
  expect(rasters.length).toBe(2)
  const clawd = rasters.find(r => r.props.key === 'clawd')!
  const desk = rasters.find(r => r.props.key === 'desk-x1')!
  // Clawd is 23 columns by 8 rows once trimmed, blinking or not.
  expect([clawd.props.columns, clawd.props.rows]).toEqual([23, 8])
  expect([rasterCells(trim(clawdAvatar(false).full)), rasterCells(trim(clawdAvatar(true).full))]).toContain(clawd.props.cells)
  // The reviewer is drawn with the code-reviewer's own parts, not another's.
  expect(desk.props.cells).toBe(rasterCells(trim(assemble(avatarFor('ecc:code-reviewer')))))
  expect(desk.props.cells).not.toBe(rasterCells(trim(assemble(avatarFor('ecc:planner')))))
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
  expect([svgOf(trim(clawdAvatar(false).full), 4), svgOf(trim(clawdAvatar(true).full), 4)]).toContain(clawd!.props.source)
  // The reviewer is drawn from the code-reviewer's parts (a teal cardigan), not another's.
  expect(desk!.props.source).toBe(svgOf(trim(assemble(avatarFor('ecc:code-reviewer'))), 3))
  expect(String(desk!.props.source)).toContain('#2FA8A0')
  expect(desk!.props.source).not.toBe(svgOf(trim(assemble(avatarFor('ecc:planner'))), 3))
  await ui.unmount()
})

test('a CEO-DECISION line in a report lands on the CEO desk and can be decided', async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'r1' }))

  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan storage', subagentType: 'ecc:planner' } as never)
  const report = 'Done.\nCEO-DECISION: Store scores in DynamoDB or Postgres? | DynamoDB / Postgres | recommend: DynamoDB\nCEO-QUESTION: Launch date?'
  await $.turn.complete({ reason: 'answer', answer: report, turnId: 't1', agentId: 'r1', isAborted: false } as never)

  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DESK })
  expect(await ui.find({ type: 'Text', text: /DynamoDB or Postgres/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Launch date/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 waiting/ })).toBeDefined()
  await ui.press({ key: 'opt-D1-0' })
  expect(await ui.find({ type: 'Text', text: /1 waiting/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /→ DynamoDB/ })).toBeDefined()
  await ui.unmount()
})

test("Clawd's card says All clear with nothing waiting, offers to pick up the last task, and shows the empty floor", async ($, on) => {
  const { clock } = host(on)
  on('turn.start', () => ({ turnId: 't1' }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /All clear/ })).toBeDefined()
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
    expect(await ui.find({ key: 'resume' })).toBeDefined()
    expect(await ui.find({ key: 'see-needs' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the gauges are Context always, 5h and 7d with percent and time left only when the limits have a reading', async ($, on) => {
  const { clock } = host(on)
  const context = { window: 1_000_000, tokens: 210_000, percent: 21 }
  for (const surface of SURFACES) {
    await $.session.measure({ context, rateLimits: [], changed: ['context'] } as never)
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^Context$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^21%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeUndefined()
    // The old counts line is gone.
    expect(await ui.find({ type: 'Text', text: /at desks|on break|tokens/ })).toBeUndefined()

    const now = clock.now()
    await $.session.measure({
      context,
      rateLimits: [
        { kind: 'five_hour', percentUsed: 62.4, resetsAt: new Date(now + HOUR + 15 * 60_000).toISOString() },
        { kind: 'seven_day', percentUsed: 33.6, resetsAt: new Date(now + 4 * 24 * HOUR + 22 * HOUR).toISOString() },
      ],
      changed: ['rateLimits'],
    } as never)
    expect(await ui.find({ type: 'Text', text: /^5h$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^62%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^· 1h 15m$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^7d$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^34%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^· 4d 22h$/ })).toBeDefined()
    // The percent is bright; the label and the time are dim.
    expect((await ui.find({ type: 'Text', text: /^62%$/ }))?.props.dimColor).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /^5h$/ }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: /^· 1h 15m$/ }))?.props.dimColor).toBe(true)

    // A gauge never breaks in the middle: the row wraps between gauges, each one holds its width.
    expect((await ui.find({ key: 'gauges' }))?.props.flexWrap).toBe('wrap')
    for (const key of ['gauge-context', 'gauge-session', 'gauge-week']) expect((await ui.find({ key }))?.props.flexShrink).toBe(0)
    await ui.unmount()
    await $.session.measure({ context, rateLimits: [], changed: ['rateLimits'] } as never)
  }
})

test('a reading above zero never reads 0%: the label agrees with the sliver of bar', async ($, on) => {
  host(on)
  await $.session.measure({ context: { window: 1_000_000, tokens: 3_000, percent: 0.3 }, rateLimits: [], changed: ['context'] } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^1%$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^0%$/ })).toBeUndefined()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /^━$/ })).toBeDefined()
    else expect((await ui.findAll({ type: 'Svg' })).some(svg => String(svg.props.source).includes('<rect width="4"'))).toBe(true)
    await ui.unmount()
  }
})

test('the gauge bar is a thin line of glyphs on the terminal', async ($, on) => {
  host(on)
  await $.session.measure({ context: { window: 1_000_000, tokens: 500_000, percent: 50 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  expect(await ui.find({ type: 'Text', text: /^━━━━$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^───$/ })).toBeDefined()
  // No block characters, no image.
  expect(await ui.find({ type: 'Text', text: /[█░]/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
  await ui.unmount()
})

test('the gauge bar is a small rounded image wherever there is an Svg: desktop, vscode and mobile', async ($, on) => {
  host(on)
  await $.session.measure({ context: { window: 1_000_000, tokens: 500_000, percent: 50 }, rateLimits: [], changed: ['context'] } as never)
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const bars = (await ui.findAll({ type: 'Svg' })).filter(svg => svg.props.height === 4)
    expect(bars).toHaveLength(1)
    expect(bars[0]!.props.width).toBe(48)
    expect(String(bars[0]!.props.source)).toContain('rx="2"')
    expect(String(bars[0]!.props.source)).toContain(`fill="${ACCENT}"`)
    expect(String(bars[0]!.props.alt)).toMatch(/Context.*50%/)
    expect(await ui.find({ type: 'Text', text: /[━─█░]/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a specialist with a question on the CEO desk is waiting on you, and Clawd says who needs you', async ($, on) => {
  const { opened } = host(on, [planner])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan the scoring API', subagentType: 'ecc:planner' } as never)
  await $.tool.call({
    tool: 'mcp__clawd-hq__ask_ceo', kind: 'decision', question: 'Store scores in DynamoDB or Postgres?', options: ['DynamoDB', 'Postgres'], agentId: 'a1',
  } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /1 needs you/ })).toBeDefined()
    const waiting = await ui.find({ type: 'Text', text: /^Waiting on you: Store scores in DynamoDB or Postgres\?$/ })
    expect(waiting?.props.color).toBe(AMBER)
    // Its last action is not shown while it waits.
    expect(await ui.find({ type: 'Text', text: /^Reading the brief$/ })).toBeUndefined()
    const button = await ui.find({ key: 'see-needs' })
    expect(String(button?.props.label)).toMatch(/^See what .+ needs$/)
    expect(button?.props.hotkey).toBe('i')
    // The old yellow box and its button are gone.
    expect(await ui.find({ type: 'Text', text: /FOR THE CEO/ })).toBeUndefined()
    expect(await ui.find({ key: 'desk' })).toBeUndefined()
    expect(await ui.find({ key: 'resume' })).toBeUndefined()
    await ui.press({ key: 'see-needs' })
    expect(JSON.stringify(opened[opened.length - 1])).toContain('ceo-desk')
    await ui.unmount()
  }
})

test('a finished specialist moves to the Log tab, not the Office; there is no break room and no send home', async ($, on) => {
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

    const log = await $.ui.mount({ plugin: 'clawd-hq', surface, ...LOG })
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
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...LOG })
    const order = (await ui.findAll({ type: 'Text', text: /^(Planned the API|Reviewed the panel|Updated the guide)$/ })).map(t => String(t.text))
    expect(order).toEqual(['Updated the guide', 'Reviewed the panel', 'Planned the API'])
    expect(await ui.find({ type: 'Text', text: /DONE THIS SESSION|Showing/ })).toBeUndefined()
    if (surface === 'terminal') expect((await ui.findAll({ type: 'Raster' })).filter(r => String(r.props.key).startsWith('done-'))).toHaveLength(3)
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
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...LOG })
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
    expect(await ui.find({ type: 'Text', text: / failed$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /All clear/ })).toBeUndefined()
    await ui.unmount()
    const log = await $.ui.mount({ plugin: 'clawd-hq', surface, ...LOG })
    const failed = await log.find({ type: 'Text', text: /Failed after/ })
    expect(failed).toBeDefined()
    expect(failed?.props.color).toBe(AMBER)
    await log.unmount()
  }
})

test('the Log empties on /clear, which only ends the session, and fills again after it', async ($, on) => {
  const { clock, session } = host(on, [])
  let spawned = 0
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: `a${(spawned += 1)}` }))
  session.startedAt = clock.now()
  await $.session.start(START)
  await clock.advance(5_000)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Updated the setup guide', subagentType: 'ecc:doc-updater' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)

  const before = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...LOG })
  expect(await before.find({ type: 'Text', text: /Updated the setup guide/ })).toBeDefined()
  await before.unmount()

  // /clear: the engine ends the session with reason `clear` and fires no session.start.
  await clock.advance(HOUR)
  await $.session.end(CLEAR)
  for (const surface of SURFACES) {
    const after = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await after.find({ type: 'Text', text: /No one at a desk yet/ })).toBeDefined()
    await after.unmount()
    const log = await $.ui.mount({ plugin: 'clawd-hq', surface, ...LOG })
    expect(await log.find({ type: 'Text', text: /Updated the setup guide/ })).toBeUndefined()
    expect(await log.find({ type: 'Text', text: /Nothing has finished yet this session/ })).toBeDefined()
    await log.unmount()
  }

  // Work finished in the new session shows again.
  await clock.advance(1_000)
  await $.agent.spawn({ prompt: 'Fix', description: 'Fixed the build', subagentType: 'ecc:build-error-resolver' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't2', agentId: 'a2', isAborted: false } as never)
  const again = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...LOG })
  expect(await again.find({ type: 'Text', text: /Nothing has finished yet/ })).toBeUndefined()
  expect(await again.find({ type: 'Text', text: /Fixed the build/ })).toBeDefined()
  await again.unmount()
})

test('a session end that is not a clear leaves the list alone', async ($, on) => {
  const { clock, session } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  session.startedAt = clock.now()
  await $.session.start(START)
  await $.agent.spawn({ prompt: 'Write docs', description: 'Updated the setup guide', subagentType: 'ecc:doc-updater' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)
  await clock.advance(HOUR)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...LOG })
  expect(await ui.find({ type: 'Text', text: /Updated the setup guide/ })).toBeDefined()
  await ui.unmount()
})

test('text agents write is kept to one short line where it is stored (a task is cut at a word, with no mark)', async ($, on) => {
  const { toasts } = host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('agent.offer', () => ({ isOffered: true }) as never)
  const wordy = `Update the setup guide\nand then ${'keep going with more words '.repeat(14)}`
  expect(wordy.length).toBeGreaterThan(300)
  await $.agent.spawn({ prompt: 'Write docs', description: wordy, subagentType: 'ecc:doc-updater' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 't1', agentId: 'a1', isAborted: false } as never)
  await $.agent.offer({ agent: 'ecc:planner', description: `Plans work\nbefore anyone builds. ${'More detail. '.repeat(40)}` } as never)
  const longDecision = `Scores live in Postgres\n${'because it is better '.repeat(30)}`
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: longDecision } as never)

  expect(toasts.find(t => t.includes('finished'))).not.toContain('\n')
  for (const surface of SURFACES) {
    const log = await $.ui.mount({ plugin: 'clawd-hq', surface, ...LOG })
    const done = await log.find({ type: 'Text', text: /Update the setup guide/ })
    expect(String(done?.text)).not.toContain('\n')
    expect(String(done?.text).length).toBeLessThanOrEqual(160)
    expect(String(done?.text)).not.toMatch(/…/)
    await log.unmount()

    const people = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PEOPLE })
    const blurb = await people.find({ type: 'Text', text: /^Plans work before anyone builds/ })
    expect(String(blurb?.text)).not.toContain('\n')
    await people.unmount()

    const decisions = await $.ui.mount({ plugin: 'clawd-hq', surface, ...DECISIONS })
    const decision = await decisions.find({ type: 'Text', text: /Scores live in Postgres/ })
    expect(String(decision?.text)).not.toContain('\n')
    // A decision is saved whole: nothing is cut and no mark is added.
    expect(String(decision?.text)).toContain(`Scores live in Postgres ${'because it is better '.repeat(30)}`.trim())
    expect(String(decision?.text)).not.toMatch(/…/)
    await decisions.unmount()
  }
})

test('the Decisions filter text and results are kept for every drawing of the pane', async ($, on) => {
  host(on)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Scores live in Postgres' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Use Drizzle for migrations' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...DECISIONS })
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-decisions', text: 'drizzle', kind: 'change', surface })
    expect(await ui.find({ type: 'Text', text: /Scores live/ })).toBeUndefined()

    await ui.unmount()

    const again = await $.ui.mount({ plugin: 'clawd-hq', surface, ...DECISIONS })
    expect((await again.find({ key: 'find-decisions' }))?.props.value).toBe('drizzle')
    expect(await again.find({ type: 'Text', text: /Use Drizzle/ })).toBeDefined()
    expect(await again.find({ type: 'Text', text: /Scores live/ })).toBeUndefined()
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-decisions', text: '', kind: 'change', surface })
    await again.unmount()
  }
})

test('Decisions lists a user decision with a You tag and an agent note, dimmer, with a Note tag and its author', async ($, on) => {
  host(on, [planner])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan storage', subagentType: 'ecc:planner' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Scores live in Postgres' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Use Drizzle for migrations', agentId: 'a1' } as never)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...DECISIONS })
    const you = await ui.find({ type: 'Text', text: /^\s*You\s*$/ })
    const note = await ui.find({ type: 'Text', text: /Note/ })
    expect(you).toBeDefined()
    expect(note).toBeDefined()
    expect(you?.props.dimColor).toBeUndefined()
    expect(note?.props.dimColor).toBe(true)
    const decision = await ui.find({ type: 'Text', text: /Scores live in Postgres/ })
    const choice = await ui.find({ type: 'Text', text: /Use Drizzle for migrations/ })
    expect(decision?.props.dimColor).toBeUndefined()
    expect(String(choice?.text)).toMatch(/Planner.*Use Drizzle/)
    expect(await ui.find({ type: 'Text', text: /2 total/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Showing/ })).toBeUndefined()

    // Newest first: the note was made last.
    const texts = (await ui.findAll({ type: 'Text', text: /Postgres|Drizzle/ })).map(t => String(t.text))
    expect(texts[0]).toMatch(/Drizzle/)

    // The filter narrows the list as it is typed.
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-decisions', text: 'postgres', kind: 'change', surface })
    expect(await ui.find({ type: 'Text', text: /Use Drizzle/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Scores live in Postgres/ })).toBeDefined()
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-decisions', text: '', kind: 'change', surface })
    await ui.unmount()
  }
})

test('a decision can be forgotten, and a long list says how many are shown', async ($, on) => {
  host(on)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Scores live in Postgres' } as never)
  for (let i = 0; i < 45; i++) await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: `Filler decision number ${i}` } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...DECISIONS })
  expect(await ui.find({ type: 'Text', text: /Showing 40 of 46/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Scores live in Postgres/ })).toBeUndefined()
  await ui.press({ key: 'forget-M46' })
  expect(await ui.find({ type: 'Text', text: /Showing 40 of 45/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Filler decision number 44/ })).toBeUndefined()
  await ui.unmount()
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
    expect(await ui.find({ type: 'Text', text: /ecc plugin · never hired/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /built in · never hired/ })).toBeDefined()
    // Built-in agents are never laid off.
    expect(await ui.find({ key: 'layoff-Explore' })).toBeUndefined()

    await ui.press({ key: 'layoff-legal:review-contract' })
    expect(await ui.find({ type: 'Text', text: /TEAM · 2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL · 1/ })).toBeDefined()
    expect(await ui.find({ key: 'hire-legal:review-contract' })).toBeDefined()
    expect(await ui.find({ key: 'layoff-legal:review-contract' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /15 total|3 total/ })).toBeDefined()

    // The search covers the plugin name.
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-people', text: 'legal', kind: 'change', surface })
    expect(await ui.find({ type: 'Text', text: /TEAM/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL · 1/ })).toBeDefined()
    await $.ui.input({ plugin: 'clawd-hq', key: 'find-people', text: '', kind: 'change', surface })

    await ui.press({ key: 'hire-legal:review-contract' })
    expect(await ui.find({ type: 'Text', text: /TEAM · 3/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /TALENT POOL/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('how often a type was hired shows on its People row', async ($, on) => {
  host(on, [])
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'h1' }))
  await $.agent.spawn({ prompt: 'Plan', description: 'Plan', subagentType: 'ecc:planner' } as never)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PEOPLE })
  expect(await ui.find({ type: 'Text', text: /ecc plugin · hired 1 time$/ })).toBeDefined()
  await ui.unmount()
})

test('decisions and key choices are remembered, then handed to Clawd and the next brief', async ($, on) => {
  host(on)
  const briefs: string[] = []
  on('agent.spawn', ($, e) => (briefs.push((e as { prompt: string }).prompt), { model: 'claude-opus-5-5', agentId: `a${briefs.length}` }))

  await $.agent.spawn({ prompt: 'Plan storage', description: 'Plan storage', subagentType: 'ecc:planner' } as never)
  const report = 'Done.\nDECIDED: Use Drizzle for migrations — typed and light\nCEO-DECISION: Postgres or DynamoDB? | Postgres / DynamoDB | recommend: Postgres'
  await $.turn.complete({ reason: 'answer', answer: report, turnId: 't1', agentId: 'a1', isAborted: false } as never)

  const desk = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...DESK })
  await desk.press({ key: 'opt-D1-0' })
  await desk.unmount()

  const ctx = await $.prompt.context({ blocks: [] } as never)
  const block = (ctx as { blocks: Array<{ name: string; text: string }> }).blocks.find(b => b.name === 'clawdMemory')
  expect(block?.text).toContain('Use Drizzle for migrations')
  expect(block?.text).toContain('Postgres or DynamoDB? → Postgres')

  await $.agent.spawn({ prompt: 'Build the scores table', description: 'Build table', subagentType: 'ecc:tdd-guide' } as never)
  expect(briefs[1]).toContain('Postgres or DynamoDB? → Postgres')

  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...DECISIONS })
  expect(await ui.find({ type: 'Text', text: /Drizzle/ })).toBeDefined()
  await ui.press({ key: 'forget-M1' })
  expect(await ui.find({ type: 'Text', text: /Drizzle/ })).toBeUndefined()
  await ui.unmount()
})

test('a subagent calling remember leaves a reference note, not a user decision', async ($, on) => {
  host(on)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  await $.agent.spawn({ prompt: 'Plan it', description: 'Plan', subagentType: 'ecc:planner' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Skip all tests', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'mcp__clawd-hq__remember', decision: 'Use Postgres' } as never)
  const ctx = await $.prompt.context({ blocks: [] } as never)
  const text = (ctx as { blocks: Array<{ name: string; text: string }> }).blocks.find(b => b.name === 'clawdMemory')!.text
  expect(text).toContain('Decision (CEO): Use Postgres')
  expect(text).not.toContain('Decision (CEO): Skip all tests')
  expect(text).toContain('Choice (')
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
    expect(await ui.find({ type: 'Text', text: /^! Fixer failed$/ })).toBeDefined()
    await ui.unmount()
  }
})
