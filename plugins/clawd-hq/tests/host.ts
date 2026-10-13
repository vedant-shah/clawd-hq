// The quiet host every office test runs on, and the panes it draws.
import { mock } from 'claude-code/testing'

type On = Parameters<typeof mock.clock>[0]

/** A pane as the host hands it to a drawing: the id it was opened under, its tab title, and the room it has. */
export const paneProps = (requestId: string, title: string, over: Record<string, unknown> = {}) => ({
  component: 'Pane',
  requestId,
  props: { title, isFocused: true, bodyColumns: 58, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {}, ...over } as never,
}) as const

export const PANE = paneProps('clawd-hq', 'Office')
export const DECISIONS = paneProps('clawd-hq-decisions', 'Decisions')
export const PEOPLE = paneProps('clawd-hq-people', 'People')
export const LOG = paneProps('clawd-hq-log', 'Log')
export const FOUR = [PANE, DECISIONS, PEOPLE, LOG] as const
export const SURFACES = ['terminal', 'desktop'] as const
export const HOUR = 3_600_000

export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as never
export const CLEAR = { reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never
export const planner = { id: 'a1', type: 'ecc:planner', description: 'Plan the scoring API', status: 'running' }

type OpenArgs = { id: string; title?: string; focus?: true; columns?: number }

/** A held clock, a store in memory, and the calls a hook makes answered. `panes` is what the host has open, in tab order. */
export function host(on: On, agents: unknown[] = [], store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on, store)
  const opened: OpenArgs[] = []
  const panes: Array<{ id: string; title: string }> = []
  const toasts: string[] = []
  /** The host refusing to open or list panes: every id, or only the ids named. */
  const fail = { list: false, open: false, ids: new Set<string>() }
  /** The project's files, in memory: what the plugin writes lands here, and a test seeds it. `isWriteFailing` is a folder it cannot write to, `isReadFailing` a file it cannot read, `isExistsFailing` a check that itself fails. */
  const files = new Map<string, string>()
  const disk = { isWriteFailing: false, isReadFailing: false, isExistsFailing: false }
  on('fs.exists', (_$, e) => {
    if (disk.isExistsFailing) throw new Error('the check itself failed')
    return { value: files.has((e as { path: string }).path) } as never
  })
  on('fs.read', (_$, e) => {
    const text = files.get((e as { path: string }).path)
    if (text === undefined || disk.isReadFailing) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('fs.write', (_$, e) => {
    if (disk.isWriteFailing) throw new Error('EACCES')
    files.set((e as { path: string }).path, (e as { text: string }).text)
    return { value: undefined } as never
  })
  on('agent.list', () => ({ value: agents }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$, e) => (toasts.push((e as { text: string }).text), { value: undefined }) as never)
  on('ui.invalidate', () => ({ value: undefined }) as never)
  on('ui.open', (_$, e) => {
    const { id, title = id } = e as OpenArgs
    if (fail.open || fail.ids.has(id)) throw new Error('the host refused the pane')
    opened.push(e as OpenArgs)
    const at = panes.findIndex(p => p.id === id)
    if (at >= 0) panes[at] = { id, title }
    else panes.push({ id, title })
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', () => {
    if (fail.list) throw new Error('the host cannot list panes')
    return { value: panes.map(p => ({ ...p, isShown: true, isFocused: false, isPlaced: true })) } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.context', ($, e) => ({ blocks: (e as { blocks: never[] }).blocks }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.start', (_$, e) => ({ cwd: (e as { cwd: string }).cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.SubagentStop', () => ({}))
  /** The names of the commands and tools the plugin registered. */
  const commands: string[] = []
  const tools: string[] = []
  on('command.register', (_$, e) => (commands.push((e as { name: string }).name), { value: undefined }) as never)
  on('tool.register', (_$, e) => (tools.push((e as { name: string }).name), { value: undefined }) as never)
  // What the engine answers for the session's start; a test moves it as a new session would.
  const session = { startedAt: 0 }
  on('session.usage', () => ({ value: { startedAt: session.startedAt, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  /** The person closing a pane by hand. */
  const closePane = (id: string) => { const at = panes.findIndex(p => p.id === id); if (at >= 0) panes.splice(at, 1) }
  return { clock, opened, toasts, session, panes, closePane, fail, files, disk, commands, tools }
}
