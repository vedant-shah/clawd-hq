// The steps of a piece of work as the engine raises them, for tests of the coffee break button: the person speaks, Clawd's turn runs,
// a specialist is hired and hands its work back, and Clawd's next turn reports it.
import type { Engine } from 'claude-code/testing'
import { host } from './host'

type On = Parameters<typeof host>[0]

export const BUILD = { prompt: 'Build the panel', description: 'Build redesigned panel', subagentType: 'ecc:tdd-guide' } as never
export const WINDOW = 1_000_000

/** The quiet host with the core answers a piece of work needs: a hire gets the id the test names, a turn starts, a prompt goes through. */
export function flowHost(on: On, agents: unknown[] = []) {
  const h = host(on, agents)
  const hiring = { next: 'w1' }
  /** The question box: a promise set here is the box left open until the person answers. */
  const box = { open: undefined as Promise<unknown> | undefined }
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: hiring.next }))
  on('tool.call', (_$, e) => ((e as { tool: string }).tool === 'AskUserQuestion' && box.open !== undefined ? box.open : { result: 'ok' }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('prompt.submit', (_$, e) => ({ text: (e as { text: string }).text, context: (e as { context?: string[] }).context }) as never)
  return { ...h, hiring, box }
}

/** The context as the engine measures it after a reply. */
export const measure = ($: Engine, tokens: number | undefined) =>
  $.session.measure({ context: { window: WINDOW, tokens, percent: tokens === undefined ? undefined : Math.round((tokens / WINDOW) * 100) }, rateLimits: [], changed: ['context'] } as never)

/** The person sends a message (`kind`: where it came from). */
export const say = ($: Engine, text: string, kind: string = 'composer') => $.prompt.submit({ text, origin: { kind } } as never)

export const startTurn = ($: Engine, id: string, text = 'Work on it') => $.turn.start({ text, turnId: id } as never)
export const endTurn = ($: Engine, id: string, answer: string) => $.turn.complete({ reason: 'answer', answer, turnId: id, isAborted: false } as never)

/** A specialist is hired in Clawd's running turn. */
export const hire = ($: Engine, id: string, on: { hiring: { next: string } }) => { on.hiring.next = id; return $.agent.spawn(BUILD) }

/** A specialist hands its work back. */
export const handBack = ($: Engine, id: string, turn: string) =>
  $.turn.complete({ reason: 'answer', answer: 'Built it.', turnId: turn, agentId: id, isAborted: false } as never)

/**
 * A job from the person's message to Clawd's report of it: the person asks, Clawd hires and says he is on it, the specialist hands back,
 * and Clawd's next turn reports. Each step is a function so a test can stop part way.
 */
export function job($: Engine, h: { hiring: { next: string } }, id = 'w1') {
  return {
    ask: async () => { await say($, 'Build the panel'); await startTurn($, 'm1'); await hire($, id, h); await endTurn($, 'm1', 'On it.') },
    handBack: () => handBack($, id, 'w-turn'),
    report: async (answer = 'The panel is built.') => { await startTurn($, 'm2', 'The specialist finished'); await endTurn($, 'm2', answer) },
  }
}
