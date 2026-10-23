// The office's panes: the host draws one tab per pane, so each of the four views is a pane of its own.
export type PaneView = 'office' | 'decisions' | 'people' | 'settings'

export type PaneSpec = {
  id: string
  view: PaneView
  /** The tab's label; the Decisions one carries how many decisions the project remembers. */
  title: (decisions: number) => string
}

const BY_VIEW: Record<PaneView, PaneSpec> = {
  office: { id: 'clawd-hq', view: 'office', title: () => 'Office' },
  decisions: { id: 'clawd-hq-decisions', view: 'decisions', title: n => (n > 0 ? `Decisions ${n}` : 'Decisions') },
  people: { id: 'clawd-hq-people', view: 'people', title: () => 'People' },
  settings: { id: 'clawd-hq-settings', view: 'settings', title: () => 'Settings' },
}

/** In the order the tabs read. The office keeps the id it always had. */
export const PANES: readonly PaneSpec[] = [BY_VIEW.office, BY_VIEW.decisions, BY_VIEW.people, BY_VIEW.settings]

/** The ids of the Log and Clawd tabs of earlier versions. Settings has an id of its own, so a pane left open under one of these is closed. */
const RETIRED = ['clawd-hq-log', 'clawd-hq-clawd'] as const

export const paneOf = (view: PaneView): PaneSpec => BY_VIEW[view]

/**
 * The room a pane's column should fill so its footer sits on the bottom edge: the rows the surface gave the body (it grows
 * with the content, never clips it). Without them, the other surfaces ask for their whole body; an inline terminal pane fits its tree.
 */
export function pinHeight(surface: string, placement: 'dock' | 'inline', bodyRows: number): number | string | undefined {
  if (Number.isInteger(bodyRows) && bodyRows > 0 && !(surface === 'terminal' && placement === 'inline')) return bodyRows
  return surface === 'terminal' ? undefined : '100%'
}

// ---- Opening, raising and retitling. The host's calls come in as `io`: `$` and the state atoms stay in register.tsx. ----

const COLUMNS = 60

export type PaneIo = {
  open: (args: { id: string; title: string; columns: number; focus?: true }) => Promise<unknown>
  list: () => Promise<ReadonlyArray<{ id: string; title: string; isShown: boolean; isPlaced: boolean }>>
  /** Closes a pane; an id that is not open is left alone. */
  close: (id: string) => Promise<unknown>
  /** How many decisions the project remembers now. */
  decisions: () => Promise<number>
}

/** A pane is chrome: the host refusing or failing one must never break the turn, command or tour that asked for it. */
async function attempt(task: () => Promise<unknown>) {
  try { await task() } catch { /* nothing to do: the pane stays as it was */ }
}

const openPane = (io: PaneIo, p: PaneSpec, decisions: number, isFocused: boolean) =>
  io.open({ id: p.id, title: p.title(decisions), columns: COLUMNS, ...(isFocused ? { focus: true as const } : {}) })

/**
 * Closes what an earlier version left open, then opens the four in tab order, each on its own so one failure leaves the rest.
 * The host appends each new pane to the strip and shows it, so Settings ends up in front; opening an open pane again only
 * retitles it. The one way to bring Office forward is a `focus` request, which the surface grants only over an empty, idle
 * prompt box and which then gives Office the keyboard too. So Office is opened once more with `focus` only when asked;
 * otherwise each pane is opened once and the person types at once.
 */
export async function openPanes(io: PaneIo, isFocusing: boolean) {
  let decisions = 0
  await attempt(async () => { decisions = await io.decisions() })
  for (const id of RETIRED) await attempt(() => io.close(id))
  for (const p of PANES) await attempt(() => openPane(io, p, decisions, false))
  if (isFocusing) await attempt(() => openPane(io, paneOf('office'), decisions, true))
}

/** The start's focus request was turned down (the surface was busy), so Office is asked for once more, after the first main-chat reply. */
let isFocusOwed = false

const officeOf = async (io: PaneIo) => (await io.list()).find(x => x.id === paneOf('office').id)

/** Office is placed but not the tab in front: what a refused focus request leaves. */
const isBehind = async (io: PaneIo) => {
  const office = await officeOf(io)
  return office !== undefined && office.isPlaced && !office.isShown
}

/** Office is open but not the tab in front, placed or not: a request refused, or made before any surface was there to grant it. */
const isNotFront = async (io: PaneIo) => {
  const office = await officeOf(io)
  return office !== undefined && !office.isShown
}

/**
 * The session start: the panes open and Office is asked to the front, on the desktop and the terminal alike. The surface
 * may turn the request down (a reply already running, text in the prompt box); that is noted for `askAgain`.
 * A plugin reloaded mid-session (a config changed) finds Office still up: the panes stay as the person left them, with
 * no focus request and no second try.
 */
export async function openAtStart(io: PaneIo) {
  isFocusOwed = false
  let isUp = false
  await attempt(async () => { isUp = (await io.list()).some(x => x.id === paneOf('office').id) })
  await openPanes(io, !isUp)
  if (!isUp) await attempt(async () => { isFocusOwed = await isNotFront(io) })
}

/** After the first main-chat reply: the one second try at the start's refused request. Never more than that in a session. */
export const askAgain = (io: PaneIo) => attempt(async () => {
  if (!isFocusOwed) return
  isFocusOwed = false
  if (await isBehind(io)) await openPane(io, paneOf('office'), await io.decisions(), true)
})

/**
 * A surface attached after the start (the desktop app runs the session before it draws anything): the panes are placed now,
 * with Settings, the one opened last, in front, so Office is asked for. A refusal stays owed for the first reply.
 */
export const askOnAttach = (io: PaneIo) => attempt(async () => {
  if (!isFocusOwed || !(await isBehind(io))) return
  await openPane(io, paneOf('office'), await io.decisions(), true)
  isFocusOwed = await isBehind(io)
})

/** Brings a pane to the front if it is still open; one the person closed stays closed. */
export const raise = (io: PaneIo, view: PaneView) => attempt(async () => {
  const p = paneOf(view)
  if ((await io.list()).some(x => x.id === p.id)) await openPane(io, p, await io.decisions(), true)
})

/** The Decisions tab's count follows the memory: an open pane is retitled in place, a closed one is left closed. */
export const retitleDecisions = (io: PaneIo) => attempt(async () => {
  const p = paneOf('decisions')
  const decisions = await io.decisions()
  const shown = (await io.list()).find(x => x.id === p.id)
  if (shown !== undefined && shown.title !== p.title(decisions)) await openPane(io, p, decisions, false)
})
