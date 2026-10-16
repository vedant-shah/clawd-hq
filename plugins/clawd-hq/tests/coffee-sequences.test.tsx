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
// The runner has a real timer, though its types do not list one.
declare const setTimeout: (run: () => void, ms: number) => unknown
const pause = (ms = 25) => new Promise<void>(resolve => setTimeout(resolve, ms))

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
  await pause()
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
  await pause()
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

test('record: each main-chat turn end and the measure after it leave one small record of why the button shows or not, over the last', async ($, on) => {
  const h = flowHost(on)
  h.session.threshold = 950_000
  await startBackground($, h, ['w1'])
  await handBack($, 'w1', 'w1-turn')
  await notify($)
  await startTurn($, 'm2', '<task-notification>w1 finished</task-notification>')
  await endTurn($, 'm2', 'The panel is built. Anything else, boss?')
  await pause()
  // The turn's own record is written before the engine measures, so it knows the reading of the turn before.
  expect(h.saved.get('debug:coffee')).toMatchObject({ by: 'turn', isCheckpoint: true, isBusy: false, turns: 2, handedBackAt: 1, autoCompactAt: 950_000, shown: false, spokeBy: 'composer' })
  await measure($, OVER)
  await pause()
  const record = h.saved.get('debug:coffee') as Record<string, unknown>
  expect(record).toMatchObject({ by: 'measure', contextTokens: OVER, threshold: 300_000, atWorkCount: 0, demo: false, shown: true })
  expect(Object.keys(record).sort()).toEqual(['at', 'atWorkCount', 'autoCompactAt', 'by', 'carriedAt', 'contextTokens', 'demo', 'handedBackAt', 'isBusy', 'isCheckpoint', 'shown', 'spokeBy', 'threshold', 'turns'])
  // Only the latest is kept: one key, and nothing of what was said.
  expect([...h.saved.keys()].filter(key => key.startsWith('debug:coffee'))).toEqual(['debug:coffee'])
  expect(JSON.stringify(record)).not.toMatch(/panel is built|Anything else|Build both/)
})
