// The office's panes: the host draws one tab per pane, so each of the five views is a pane of its own.
export type PaneView = 'office' | 'decisions' | 'people' | 'log' | 'clawd'

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
  log: { id: 'clawd-hq-log', view: 'log', title: () => 'Log' },
  clawd: { id: 'clawd-hq-clawd', view: 'clawd', title: () => 'Clawd' },
}

/** In the order the tabs read. The office keeps the id it always had. */
export const PANES: readonly PaneSpec[] = [BY_VIEW.office, BY_VIEW.decisions, BY_VIEW.people, BY_VIEW.log, BY_VIEW.clawd]

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
  list: () => Promise<ReadonlyArray<{ id: string; title: string }>>
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
 * Opens the five in tab order, each on its own so one failure leaves the rest. The host appends each new pane to the strip and
 * shows it, so Clawd ends up in front; opening an open pane again only retitles it. The one way to bring Office forward is a
 * `focus` request, which the surface grants only over an empty, idle prompt box and which then gives Office the keyboard too.
 * So Office is opened once more with `focus` only when asked; otherwise each pane is opened once and the person types at once.
 */
export async function openPanes(io: PaneIo, isFocusing: boolean) {
  let decisions = 0
  await attempt(async () => { decisions = await io.decisions() })
  for (const p of PANES) await attempt(() => openPane(io, p, decisions, false))
  if (isFocusing) await attempt(() => openPane(io, paneOf('office'), decisions, true))
}

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
