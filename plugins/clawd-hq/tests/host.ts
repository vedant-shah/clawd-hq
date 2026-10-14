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
  const opened: OpenArgs[] = []
  const panes: Array<{ id: string; title: string }> = []
  const toasts: string[] = []
  /** The host refusing to open or list panes: every id, or only the ids named. */
  const fail = { list: false, open: false, ids: new Set<string>() }
  /** The tab the host shows in front; unset, every pane reads as shown, as before. */
  const front = { id: undefined as string | undefined }
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
  /** The plugin's store, in memory and seeded from `store`. `isWriteFailing` is a store that refuses a write; `held` is a write that waits until it settles. */
  const saved = new Map<string, unknown>(Object.entries(store))
  const kv = { isWriteFailing: false, held: undefined as Promise<void> | undefined }
  on('store.get', (_$, e) => ({ value: saved.get((e as { key: string }).key) }) as never)
  on('store.set', async (_$, e) => {
    await kv.held
    if (kv.isWriteFailing) throw new Error('the store refused the write')
    saved.set((e as { key: string }).key, (e as { value: unknown }).value)
    return { value: undefined } as never
  })
  on('store.delete', (_$, e) => (saved.delete((e as { key: string }).key), { value: undefined }) as never)
  on('store.keys', () => ({ value: [...saved.keys()] }) as never)
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
    return { value: panes.map(p => ({ ...p, isShown: front.id === undefined || front.id === p.id, isFocused: false, isPlaced: true })) } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('prompt.context', ($, e) => ({ blocks: (e as { blocks: never[] }).blocks }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // The surfaces the session draws on, as the engine keeps them: the one it started with, then each client that attaches.
  const roster: string[] = []
  on('session.start', (_$, e) => {
    const { cwd, surface } = e as { cwd: string; surface: string | null }
    roster.splice(0, roster.length, ...(surface === null ? [] : [surface]))
    return { cwd }
  })
  on('session.attach', (_$, e) => {
    const { surface, clientId } = e as { surface: string; clientId: string }
    roster.push(surface)
    return { clientId }
  })
  on('session.surfaces', () => ({ value: [...roster] }) as never)
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('classic.SubagentStop', () => ({}))
  /** The names of the commands and tools the plugin registered. */
  const commands: string[] = []
  const tools: string[] = []
  on('command.register', (_$, e) => (commands.push((e as { name: string }).name), { value: undefined }) as never)
  /** The same registrations with the placement each asked for. */
  const toolSpecs: Array<{ name: string; isDeferred?: boolean }> = []
  on('tool.register', (_$, e) => {
    const spec = e as { name: string; isDeferred?: boolean }
    tools.push(spec.name)
    toolSpecs.push({ name: spec.name, isDeferred: spec.isDeferred })
    return { value: undefined } as never
  })
  // What the engine answers for the session's start; a test moves it as a new session would.
  const session = { startedAt: 0 }
  on('session.usage', () => ({ value: { startedAt: session.startedAt, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  // The main chat's model, as `/model` shows it: not the one other tests name, so the footer's model cannot match their text.
  on('session.model', () => ({ value: 'claude-sonnet-5-1' }) as never)
  /** The person closing a pane by hand. */
  const closePane = (id: string) => { const at = panes.findIndex(p => p.id === id); if (at >= 0) panes.splice(at, 1) }
  return { clock, opened, toasts, session, panes, closePane, fail, front, files, disk, saved, kv, commands, tools, toolSpecs }
}
