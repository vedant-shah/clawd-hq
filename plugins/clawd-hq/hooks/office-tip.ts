// The one-line tip shown at session start while the office is closed: how to open it. It stops for good once the person has opened it once.
// Also where an open is told to the plugin (`markOpened`, `noticeOpen`); the state itself is in hooks/office-open.ts.
import type { EngineInterface } from 'claude-code'

import { isOfficeOpen, setOfficeOpen } from './office-open'
import { saveOpen } from './office-saved'
import { paneOf } from './panes'
import { getFx } from './register-state'

export const OFFICE_TIP = 'Type /office to open the office'
/** The tip while "Clawd runs the chat" is on: Clawd comes with the office. */
export const OFFICE_TIP_WITH_CLAWD = 'Type /office to open the office and bring in Clawd'

/** The plugin's store key of the marker: true once the person has opened the office. */
export const OPENED_KEY = 'officeOpened'

/** Whether the marker is kept. A store that cannot be read counts as not kept: the tip is better shown than lost. */
async function wasOpened($: EngineInterface): Promise<boolean> {
  try {
    return (await $.store.get(OPENED_KEY)) === true
  } catch {
    return false
  }
}

/** At session start with the panels closed: the tip, as a toast, unless the office has been opened before. `isChiefOn`: Clawd comes with the office. Never rejects. */
export async function tipOffice($: EngineInterface, isChiefOn: boolean): Promise<void> {
  if (await wasOpened($)) return
  try {
    await $.ui.toast(isChiefOn ? OFFICE_TIP_WITH_CLAWD : OFFICE_TIP)
  } catch {
    // a toast the host refuses must not cost the start
  }
}

/** Whether the office is open now (hooks/office-open.ts): Automatic setup may start, and Clawd is on if his switch is. */
export const isOfficeOpened = isOfficeOpen

/**
 * The office panel shown by Claude Code's own controls, with no `/office` typed, is an open too: looked for at the frames
 * while the office is closed. The tour's panes do not count, and neither does another tab on its own. Never rejects.
 */
export async function noticeOpen($: EngineInterface): Promise<void> {
  if (isOfficeOpen()) return
  try {
    const shown = (await $.ui.panes()).some(p => p.id === paneOf('office').id && p.isShown)
    if (shown && (await getFx($)).demo === undefined) await markOpened($)
  } catch {
    // a host that cannot list its panes only means the open is looked for again at the next check
  }
}

/**
 * Everything the host caches that depends on whether Clawd is on is asked for again: the Agent tool's text, the task-list reminder
 * notes, the profile block, and the panes (Clawd's card). Called at every open, close and restored state.
 */
export function refreshOffice($: EngineInterface): void {
  $.ui.invalidate('tool.describe')
  $.ui.invalidate('prompt.attachment')
  $.ui.invalidate('prompt.context')
  $.ui.invalidate('ui.render')
}

/** The office was opened for real: it is open now, and the tip is over. A marker that cannot be kept only means the tip may show once more. */
export async function markOpened($: EngineInterface): Promise<void> {
  setOfficeOpen(true)
  refreshOffice($)
  await saveOpen($, true) // kept for this session: a reload or a resume finds it open
  try {
    await $.store.set(OPENED_KEY, true)
  } catch {
    // see above
  }
}

/** A close of the Office pane that is the person's own (their close mark or key), as the engine stamps it. One of ours, or another tab's, is not. */
export const isPersonClosingOffice = (e: { id: string; origin: { kind: string } }) => e.origin.kind === 'person' && e.id === paneOf('office').id

/** The office was closed, by `/office` or by the person closing its pane: closed now, and kept for this session. The marker stays: the person has opened it once. */
export async function markClosed($: EngineInterface): Promise<void> {
  setOfficeOpen(false)
  refreshOffice($)
  await saveOpen($, false)
}
