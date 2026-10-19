// The quiet host every office test runs on, and the panes it draws.
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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
export const SETTINGS = paneProps('clawd-hq-settings', 'Settings')
/** Every office pane, in tab order. */
export const ALL_PANES = [PANE, DECISIONS, PEOPLE, SETTINGS] as const

/** The Settings pane showing the finished-work list: the link to it is pressed when the pane is showing the switches. */
export async function mountLog($: Engine, surface: 'terminal' | 'desktop', over: Record<string, unknown> = {}) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...paneProps('clawd-hq-settings', 'Settings', over) })
  if ((await ui.find({ key: 'settings-log' })) !== undefined) await ui.press({ key: 'settings-log' })
  return ui
}
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
  /** The host refusing to open or list panes: every id, or only the ids named. `tools`: refusing every tool the plugin registers. */
  const fail = { list: false, open: false, ids: new Set<string>(), tools: false }
  /** The tab the host shows in front; unset, every pane reads as shown, as before. */
  const front = { id: undefined as string | undefined }
  /** A `focus` request the surface refuses (a reply running, text in the prompt box): the pane opens, but the shown tab stays. Only once a test has set `front`. */
  const focus = { isRefused: false }
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
    if ((e as OpenArgs).focus === true && front.id !== undefined && !focus.isRefused) front.id = id
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
  /** The agent types the plugin defined, as it gave them: its setup scout at session start, and the skill hires setup makes. */
  const agentSpecs: Array<{ name: string; skills?: readonly string[] }> = []
  on('agent.register', (_$, e) => (agentSpecs.push(e as never), { value: { agent: `clawd-hq:${(e as { name: string }).name}` } }) as never)
  /** The same registrations with the placement each asked for. */
  const toolSpecs: Array<{ name: string; isDeferred?: boolean }> = []
  on('tool.register', (_$, e) => {
    const spec = e as { name: string; isDeferred?: boolean }
    // A refusal, not a throw: a hook that throws is skipped and the call goes on.
    if (fail.tools) return { deny: 'already registered' } as never
    tools.push(spec.name)
    toolSpecs.push({ name: spec.name, isDeferred: spec.isDeferred })
    return { value: undefined } as never
  })
  // What the engine answers for the session's start; a test moves it as a new session would.
  // `threshold` is where Claude Code compacts by itself: told only to a call that asks for the breakdown, as the engine does; unset, auto-compact is off.
  // `loaded` is the agents and skills the breakdown lists (setup reads them); unset, it lists none, as before.
  const session = { startedAt: 0, threshold: undefined as number | undefined, loaded: {} as Record<string, unknown> }
  on('session.usage', (_$, e) => {
    const isBreakdown = (e as { breakdown?: string }).breakdown !== undefined
    const breakdown = isBreakdown ? { breakdown: { autoCompactThreshold: session.threshold, isAutoCompactEnabled: session.threshold !== undefined, ...session.loaded } } : {}
    return { value: { startedAt: session.startedAt, context: { window: 1_000_000, ...breakdown }, rateLimits: [] } } as never
  })
  // A compaction asked for by the plugin: what it was asked, and how it ends. `skip`: a hook's veto; `error`: a call that rejects; `hold`: one that waits.
  const compacts: Array<{ instructions?: string }> = []
  const compact = { skip: undefined as string | undefined, error: undefined as string | undefined, hold: undefined as Promise<void> | undefined }
  on('session.compact', async (_$, e) => {
    compacts.push({ instructions: (e as { instructions?: string }).instructions })
    await compact.hold
    if (compact.error !== undefined) throw new Error(compact.error)
    return (compact.skip === undefined ? { messages: [{ role: 'user', text: 'A summary of the chat so far.', toolUses: [] }] } : { skip: compact.skip }) as never
  })
  // The main chat's model, as `/model` shows it: not the one other tests name, so the footer's model cannot match their text.
  on('session.model', () => ({ value: 'claude-sonnet-5-1' }) as never)
  /** The person closing a pane by hand. */
  const closePane = (id: string) => { const at = panes.findIndex(p => p.id === id); if (at >= 0) panes.splice(at, 1) }
  /** The plugin closing a pane: the ids it asked for, then the same as the person's close. */
  const closed: string[] = []
  on('ui.close', (_$, e) => (closed.push((e as { id: string }).id), closePane((e as { id: string }).id), { value: undefined }) as never)
  return { clock, opened, closed, toasts, session, compacts, compact, panes, closePane, fail, front, focus, files, disk, saved, kv, commands, tools, toolSpecs, agentSpecs }
}
