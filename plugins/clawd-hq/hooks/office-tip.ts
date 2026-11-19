// The one-line tip shown at session start while the office is closed: how to open it. It stops for good once the person has opened it once.
import type { EngineInterface } from 'claude-code'

import { paneOf } from './panes'
import { getFx } from './register-state'

export const OFFICE_TIP = 'Type /office to open the office'

/** The plugin's store key of the marker: true once the person has opened the office with /office. */
export const OPENED_KEY = 'officeOpened'

/** Whether the marker is kept. A store that cannot be read counts as not kept: the tip is better shown than lost. */
async function wasOpened($: EngineInterface): Promise<boolean> {
  try {
    return (await $.store.get(OPENED_KEY)) === true
  } catch {
    return false
  }
}

/** At session start with the panels closed: the tip, as a toast, unless the office has been opened before. Never rejects. */
export async function tipOffice($: EngineInterface): Promise<void> {
  if (await wasOpened($)) return
  try {
    await $.ui.toast(OFFICE_TIP)
  } catch {
    // a toast the host refuses must not cost the start
  }
}

/** Whether the office has been opened for real since this plugin loaded (`/office`, `/office-setup`, or the switch at start). The tour does not count. */
let isOpened = false
export const isOfficeOpened = () => isOpened

/**
 * The office panel shown by Claude Code's own controls, with no `/office` typed, is an open too: looked for at the frames
 * while nothing has opened it. The tour's panes do not count, and neither does another tab on its own. Never rejects.
 */
export async function noticeOpen($: EngineInterface): Promise<void> {
  if (isOpened) return
  try {
    const shown = (await $.ui.panes()).some(p => p.id === paneOf('office').id && p.isShown)
    if (shown && (await getFx($)).demo === undefined) await markOpened($)
  } catch {
    // a host that cannot list its panes only means the open is looked for again at the next check
  }
}

/** The office was opened for real: Automatic setup may start, and the tip is over. A marker that cannot be kept only means the tip may show once more. */
export async function markOpened($: EngineInterface): Promise<void> {
  isOpened = true
  try {
    await $.store.set(OPENED_KEY, true)
  } catch {
    // see above
  }
}
