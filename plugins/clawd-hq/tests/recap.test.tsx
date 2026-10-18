import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { RECAP_PROMPT } from '../hooks/recap'
import { CLEAR, PANE, START, SURFACES, host } from './host'

const MIN = 60_000
type On = Parameters<typeof host>[0]

/** A session whose side questions are answered by `reply`, and every question asked. */
function hostWithModel(on: On, reply: () => unknown = () => ({ isAnswered: true, text: 'Login bug fixed and tested. Next: review the pull request.', usage: {} })) {
  const h = host(on, [])
  const asked: string[] = []
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('model.fork', (_$, e) => (asked.push((e as { prompt: string }).prompt), { value: reply() }) as never)
  return { ...h, asked }
}

let n = 0
/** One whole turn of Clawd's: asked, then answered. */
async function turn($: Engine) {
  n += 1
  await $.turn.start({ text: `Request ${n}`, turnId: `m${n}` } as never)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `m${n}`, isAborted: false } as never)
}
const turns = async ($: Engine, count: number) => { for (let i = 0; i < count; i += 1) await turn($) }
/** The clock moved on in steps, so every frame of the office runs. */
async function wait(clock: { advance: (ms: number) => Promise<unknown> }, ms: number) {
  for (let left = ms; left > 0; left -= 10_000) await clock.advance(Math.min(left, 10_000))
}
const cardText = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const text = JSON.stringify(await ui.drawn())
  await ui.unmount()
  return text
}

test('after three turns and three quiet minutes, Clawd\'s card says where things stand, and the old button is gone', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start(START)
  await turns($, 3)
  await wait(clock, 2 * MIN)
  expect(asked).toEqual([])
  await wait(clock, MIN + 20_000)
  expect(asked).toEqual([RECAP_PROMPT])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    expect(await ui.find({ type: 'Text', text: /^WHERE WE LEFT OFF$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Login bug fixed and tested\.$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Next:$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Next: review the pull request\.$/ })).toBeDefined()
    expect(await ui.find({ key: 'resume' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the recap is made once per pause, goes when the next turn starts, and is made again after that turn', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start(START)
  await turns($, 3)
  await wait(clock, 4 * MIN)
  await wait(clock, 20 * MIN)
  expect(asked).toHaveLength(1)

  await $.turn.start({ text: 'Carry on', turnId: 'x1' } as never)
  expect(await cardText($)).not.toMatch(/WHERE WE LEFT OFF/)
  await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: 'x1', isAborted: false } as never)
  expect(await cardText($)).not.toMatch(/WHERE WE LEFT OFF/)
  await wait(clock, 4 * MIN)
  expect(asked).toHaveLength(2)
  expect(await cardText($)).toMatch(/WHERE WE LEFT OFF/)
})

test('fewer than three turns make no recap, however long the pause', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start(START)
  await turns($, 2)
  await wait(clock, 30 * MIN)
  expect(asked).toEqual([])
  expect(await cardText($)).not.toMatch(/WHERE WE LEFT OFF|resume/)
})

test('a /clear or a /resume takes the recap off the card and starts the count of turns again', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start(START)
  for (const end of [CLEAR, { reason: 'resume', sessionId: 's1' } as never]) {
    asked.length = 0
    await turns($, 3)
    await wait(clock, 4 * MIN)
    expect(asked).toHaveLength(1)
    expect(await cardText($)).toMatch(/WHERE WE LEFT OFF/)
    await $.session.end(end)
    expect(await cardText($)).not.toMatch(/WHERE WE LEFT OFF/)
    // One turn of the new conversation is not three.
    await turns($, 1)
    await wait(clock, 10 * MIN)
    expect(asked).toHaveLength(1)
    await turns($, 2)
    await wait(clock, 4 * MIN)
    expect(asked).toHaveLength(2)
    await $.turn.start({ text: 'On we go', turnId: `e${asked.length}` } as never)
    await $.turn.complete({ reason: 'answer', answer: 'ok', turnId: `e${asked.length}`, isAborted: false } as never)
  }
})

test('a recap that could not be made shows nothing and is not asked for again in the same pause', async ($, on) => {
  const { clock, asked } = hostWithModel(on, () => ({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} }))
  await $.session.start(START)
  await turns($, 3)
  await wait(clock, 30 * MIN)
  expect(asked).toHaveLength(1)
  expect(await cardText($)).not.toMatch(/WHERE WE LEFT OFF/)
})

test('a long reply over several lines is shown as one line of at most 280 characters', async ($, on) => {
  const { clock } = hostWithModel(on, () => ({ isAnswered: true, text: `Line one.\n\n${'More detail here. '.repeat(60)}`, usage: {} }))
  await $.session.start(START)
  await turns($, 3)
  await wait(clock, 4 * MIN)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...PANE })
  const line = (await ui.findAll({ type: 'Text' })).map(t => String(t.text)).find(t => t.startsWith('Line one.'))!
  await ui.unmount()
  expect(line.length).toBeLessThanOrEqual(280)
  expect(line).not.toMatch(/\n/)
})

test('a session nobody is looking at makes no recap', async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await turns($, 3)
  await wait(clock, 10 * MIN)
  expect(asked).toEqual([])
})

test('in the desktop app, which attaches after the session starts, the recap still comes when due', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  // The desktop app runs the session as the SDK does: it starts drawing nowhere, and the app attaches a moment later.
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  await $.session.attach({ surface: 'desktop', clientId: 'desktop:default' } as never)
  await turns($, 3)
  await wait(clock, 3 * MIN + 20_000)
  expect(asked).toEqual([RECAP_PROMPT])
  expect(await cardText($, 'desktop')).toMatch(/WHERE WE LEFT OFF/)
})

test('with the recap setting off, the model is never asked', { options: { recap: false } }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start(START)
  await turns($, 3)
  await wait(clock, 10 * MIN)
  expect(asked).toEqual([])
  expect(await cardText($)).not.toMatch(/WHERE WE LEFT OFF/)
})

test('the tour makes no recap, even when it leaves the office quiet', async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  await $.session.start(START)
  await turns($, 3)
  await $.command.run({ command: 'office-demo', args: '' } as never)
  await wait(clock, 60_000)
  expect(asked).toEqual([])
})

test('a specialist\'s turns are not Clawd\'s: they count towards no recap, keep him free for one, and leave one on the card', { timeoutMs: 15_000 }, async ($, on) => {
  const { clock, asked } = hostWithModel(on)
  const specialistStarts = (i: number) => $.turn.start({ text: `Brief ${i}`, turnId: `r${i}`, agentId: 'a1' } as never)
  await $.session.start(START)
  await turns($, 2)
  for (let i = 0; i < 3; i += 1) await specialistStarts(i)
  await wait(clock, 10 * MIN)
  expect(asked).toEqual([])
  await turns($, 1)
  await specialistStarts(9)
  await wait(clock, 4 * MIN)
  expect(asked).toHaveLength(1)
  await specialistStarts(10)
  expect(await cardText($)).toMatch(/WHERE WE LEFT OFF/)
})
