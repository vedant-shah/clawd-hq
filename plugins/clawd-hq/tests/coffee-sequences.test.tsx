// The coffee break button through the sequences of a real session: specialists in the background, their notifications starting or joining
// Clawd's turns, a question box in the middle of one, a specialist sent back to work, and a desktop whose surface attaches late.
// Each test acts out the engine's events in order and asks one thing: is the button on the pane when the dust settles?
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE } from './host'
import { endTurn, flowHost, handBack, hire, measure, say, startTurn } from './flow'

const BUTTON = { key: 'coffee-break' }
const OVER = 480_000
const DESKTOP = { surface: 'desktop', clientId: 'desktop:default' } as never

async function isShown($: Engine, surface: 'terminal' | 'desktop' = 'desktop') {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const found = await ui.find(BUTTON)
  await ui.unmount()
  return found !== undefined
}

/** A background task's notification: dequeued into a new turn when the session is idle, or delivered into the running turn `into`. */
const notify = ($: Engine, into?: string) =>
  $.prompt.submit({ text: '<task-notification>a background agent finished</task-notification>', origin: { kind: 'task-notification' }, ...(into === undefined ? {} : { turnId: into }) } as never)

/** Clawd's turn waits at a question box until the returned function is called with the person's answer. */
function openBox(h: ReturnType<typeof flowHost>, $: Engine) {
  let answer: (value: unknown) => void = () => undefined
  h.box.open = new Promise(resolve => { answer = resolve })
  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Friday or Monday?' }] } as never)
  return async () => { answer({ result: { answers: { 'Friday or Monday?': 'Friday' } } }); await asking; h.box.open = undefined }
}

/** The person asks; Clawd starts specialists in the background and his turn ends while they work. */
async function startBackground($: Engine, h: ReturnType<typeof flowHost>, ids: string[]) {
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await $.session.attach(DESKTOP)
  await say($, 'Build both panels')
  await startTurn($, 'm1')
  for (const id of ids) await hire($, id, h)
  await endTurn($, 'm1', 'Both are on it.')
}

test('a: a background job comes back, its notification starts Clawd\'s turn, he asks a question and reports: the button shows', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1'])
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>a background agent finished</task-notification>')
  const answer = openBox(h, $)
  await h.clock.settle()
  expect(await isShown($)).toBe(false)
  await answer()
  await endTurn($, 'm2', 'The panel is built. Anything else?')
  await measure($, OVER)
  expect(await isShown($)).toBe(true)
})

test('b: two specialists in the background: the button waits for the second one\'s report', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1', 'w2'])
  await measure($, OVER)
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await endTurn($, 'm2', 'The first is built; the second is still going.')
  expect(await isShown($)).toBe(false)
  await handBack($, 'w2', 'w2-turn')
  await notify($)
  await startTurn($, 'm3', '<task-notification>w2 finished</task-notification>')
  await endTurn($, 'm3', 'Both are built.')
  expect(await isShown($)).toBe(true)
})

test('c: the notification\'s turn begins before the specialist\'s own end is heard: Clawd\'s report of it still counts', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1'])
  await measure($, OVER)
  await notify($)
  await startTurn($, 'm2', '<task-notification>a background agent finished</task-notification>')
  await handBack($, 'w1', 'w1-turn')
  await endTurn($, 'm2', 'The panel is built.')
  expect(await isShown($)).toBe(true)
})

test('d: a second specialist finishes while Clawd waits at the question box; its notification joins the running turn, and his one report covers both', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1', 'w2'])
  await measure($, OVER)
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  const answer = openBox(h, $)
  await h.clock.settle()
  await handBack($, 'w2', 'w2-turn')
  await notify($, 'm2')
  await answer()
  await endTurn($, 'm2', 'Both are built.')
  expect(await isShown($)).toBe(true)
})

test('d2: the same, with the joining notification heard before the specialist\'s own end', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1', 'w2'])
  await measure($, OVER)
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await notify($, 'm2')
  await handBack($, 'w2', 'w2-turn')
  await endTurn($, 'm2', 'Both are built.')
  expect(await isShown($)).toBe(true)
})

test('e: a hand-back that joins no turn of Clawd\'s is still not reported by the turn it came in', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1', 'w2'])
  await measure($, OVER)
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await handBack($, 'w2', 'w2-turn')
  await endTurn($, 'm2', 'The first is built.')
  expect(await isShown($)).toBe(false)
  await notify($)
  await startTurn($, 'm3', '<task-notification>w2 finished</task-notification>')
  await endTurn($, 'm3', 'The second is built too.')
  expect(await isShown($)).toBe(true)
})

test('f: Clawd sends the same specialist back to work, it finishes again, and his next report brings the button', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1'])
  await measure($, OVER)
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  // SendMessage to the finished specialist: the engine spawns it again under the same id, and it works.
  await $.agent.spawn({ prompt: 'Now the tests', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide', resume: { agentId: 'w1' } } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.ts', agentId: 'w1' } as never)
  await endTurn($, 'm2', 'Sent it back for tests.')
  expect(await isShown($)).toBe(false)
  await handBack($, 'w1', 'w1-turn-2')
  await notify($)
  await startTurn($, 'm3', '<task-notification>w1 finished again</task-notification>')
  await endTurn($, 'm3', 'The tests are in.')
  expect(await isShown($)).toBe(true)
})

test('g: the desktop attaches after the session started and the reading comes later: the button shows on the desktop and the terminal', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1'])
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await endTurn($, 'm2', 'The panel is built.')
  // The engine measures after the turn; here the first reading comes only now.
  expect(await isShown($)).toBe(false)
  await measure($, OVER)
  expect(await isShown($, 'desktop')).toBe(true)
  expect(await isShown($, 'terminal')).toBe(true)
})

test('h: a reading that names the percent and the window but no token count still counts', async ($, on) => {
  const h = flowHost(on)
  await startBackground($, h, ['w1'])
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await endTurn($, 'm2', 'The panel is built.')
  await $.session.measure({ context: { window: 1_000_000, percent: 48 }, rateLimits: [], changed: ['context'] } as never)
  expect(await isShown($)).toBe(true)
})

/** The desktop app refuses the plugin's compact call in its SDK session, so a press only fills `/compact` into the prompt box. */
const HEADLESS = 'clawd-hq: $.session.compact: not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on.'
const COMPACT_LINE = '/compact Keep my latest request and any open work.'
/** The person sends the `/compact` the button filled: the engine's own compaction, trigger `manual`. */
const sendCompact = ($: Engine) =>
  $.session.compact({ trigger: 'manual', instructions: 'Keep my latest request and any open work.', messages: [{ role: 'user', text: 'Build both panels', toolUses: [] }] } as never)

/** At a break past the mark, the button pressed on the desktop: the engine refuses the call, and `/compact` goes in the prompt box. */
async function pressOnDesktop($: Engine, h: ReturnType<typeof flowHost>) {
  await startBackground($, h, ['w1'])
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await endTurn($, 'm2', 'The panel is built.')
  await measure($, OVER)
  expect(await isShown($)).toBe(true)
  h.compact.error = HEADLESS
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'desktop', ...PANE })
  await ui.press(BUTTON)
  await ui.unmount()
  h.compact.error = undefined
  await $.prompt.submit({ text: COMPACT_LINE, origin: { kind: 'composer' } } as never)
}

// In the desktop's SDK session the /compact runs inside a turn of Clawd's, and the engine measures after that turn as after any other.
// That turn ends in an answer and edits nothing, and the reading can still be the chat from before: neither brings the button back.
test('i: the person sends the filled /compact, it runs inside a turn, and the measure after it is the old one: the button is gone at once', async ($, on) => {
  const h = flowHost(on)
  await pressOnDesktop($, h)
  await startTurn($, 'm3', COMPACT_LINE)
  await sendCompact($)
  await endTurn($, 'm3', '')
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
})

test('i2: the same, with the turn begun only after the compaction stood', async ($, on) => {
  const h = flowHost(on)
  await pressOnDesktop($, h)
  await sendCompact($)
  await startTurn($, 'm3', COMPACT_LINE)
  await endTurn($, 'm3', '')
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
})

test('i3: once a reading of the compacted chat comes in, the button can come back when the chat grows past the mark again', async ($, on) => {
  const h = flowHost(on)
  await pressOnDesktop($, h)
  await startTurn($, 'm3', COMPACT_LINE)
  await sendCompact($)
  await endTurn($, 'm3', '')
  await measure($, OVER)
  await say($, 'Now the tests')
  await startTurn($, 'm4', 'Now the tests')
  await endTurn($, 'm4', 'Here is how they look.')
  await measure($, 40_000)
  expect(await isShown($)).toBe(false)
  await say($, 'And the docs')
  await startTurn($, 'm5', 'And the docs')
  await endTurn($, 'm5', 'Done, boss.')
  await measure($, OVER)
  expect(await isShown($)).toBe(true)
})

test('i4: a compaction that leaves the chat at a new size still over the mark (a low compaction point) lets the button back', async ($, on) => {
  const h = flowHost(on)
  await pressOnDesktop($, h)
  await startTurn($, 'm3', COMPACT_LINE)
  await sendCompact($)
  await endTurn($, 'm3', '')
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
  await measure($, 350_000) // the compacted chat, smaller but still over the mark
  expect(await isShown($)).toBe(true)
})

test('i5: after a compaction, /resume to a chat already over the mark: the wait was the last chat\'s, and the button shows', async ($, on) => {
  const h = flowHost(on)
  await pressOnDesktop($, h)
  await startTurn($, 'm3', COMPACT_LINE)
  await sendCompact($)
  await endTurn($, 'm3', '')
  await measure($, OVER)
  expect(await isShown($)).toBe(false)
  await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's2' } } as never)
  await say($, 'Where were we?')
  await startTurn($, 'm4', 'Where were we?')
  await endTurn($, 'm4', 'The panel is built; the tests are next.')
  await measure($, OVER) // the resumed chat happens to be as large as the one before
  expect(await isShown($)).toBe(true)
})

test('i6: the readings after the compaction never shrink (a little over the old size): the next real turn ends the wait', async ($, on) => {
  const h = flowHost(on)
  const ABOUT = Math.round(OVER * 1.02)
  await pressOnDesktop($, h)
  await sendCompact($)
  await startTurn($, 'm3', COMPACT_LINE)
  await endTurn($, 'm3', '')
  await measure($, ABOUT)
  expect(await isShown($)).toBe(false)
  await say($, 'Now the tests')
  await startTurn($, 'm4', 'Now the tests')
  await endTurn($, 'm4', 'Here is how they look.')
  await measure($, ABOUT + 1_000)
  expect(await isShown($)).toBe(true)
})

test('record: each main-chat turn end and the measure after it leave one small record of why the button shows or not, over the last', async ($, on) => {
  const h = flowHost(on)
  h.session.threshold = 950_000
  await startBackground($, h, ['w1'])
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await endTurn($, 'm2', 'The panel is built. Anything else, boss?')
  await h.clock.settle()
  // The turn's own record is written before the engine measures, so it knows the reading of the turn before.
  expect(h.saved.get('debug:coffee')).toMatchObject({ by: 'turn', isCheckpoint: true, isBusy: false, turns: 2, handedBackAt: 1, autoCompactAt: 950_000, shown: false, spokeBy: 'composer' })
  await measure($, OVER)
  await h.clock.settle()
  const record = h.saved.get('debug:coffee') as Record<string, unknown>
  expect(record).toMatchObject({ by: 'measure', contextTokens: OVER, threshold: 300_000, atWorkCount: 0, demo: false, shown: true })
  expect(Object.keys(record).sort()).toEqual(['at', 'atWorkCount', 'autoCompactAt', 'by', 'carriedAt', 'contextTokens', 'demo', 'handedBackAt', 'isBusy', 'isCheckpoint', 'isReadingOld', 'shown', 'spokeBy', 'threshold', 'turns'])
  // Only the latest is kept: one key, and nothing of what was said.
  expect([...h.saved.keys()].filter(key => key.startsWith('debug:coffee'))).toEqual(['debug:coffee'])
  expect(JSON.stringify(record)).not.toMatch(/panel is built|Anything else|Build both/)
})
