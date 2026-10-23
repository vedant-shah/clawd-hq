// The one-time card for a project that still has an old decisions file (no `$`; register.tsx hands in what each call may do).
// Clawd HQ no longer reads that file. The card says so and offers to turn what is in it into CLAUDE.md rules: the button puts a
// prompt in the prompt box, never sends it. The plugin never reads, changes or removes the file; this is the only place that names it.
import { reasonOf } from './state'

/** The old file, from the project folder. */
export const OLD_FILE = '.clawd-hq/decisions.md'
/** What the offer button puts in the prompt box. The decisions are the person's, so the agents' notes are left out, and each rule goes through the Add to CLAUDE.md card. */
export const OLD_PROMPT = 'Read .clawd-hq/decisions.md. List my decisions (not the agents\' notes) that should still guide later work, each as one short rule, and offer each with offer_rule.'

/** The store key that holds the person's answer for one project. */
export const oldKey = (folder: string) => `oldDecisions:${folder}`

export type OldIo = {
  folder: () => string
  exists: (path: string) => Promise<boolean>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: true) => Promise<unknown>
  /** Puts text after what is in the prompt box; whether the box took it. */
  fill: (text: string) => Promise<boolean>
  /** Shows the card (or takes it away). */
  show: (isShown: boolean) => Promise<unknown>
  toast: (text: string) => void
}

export type OldActions = { oldOffer: () => unknown; oldDismiss: () => unknown }

/** Whether the card is due: the project has the old file and the person has not answered yet. A check that fails shows nothing. */
export async function checkOld(io: OldIo): Promise<void> {
  const folder = io.folder()
  const isDue = folder !== '' && await (async () => {
    try { return !(await io.get(oldKey(folder))) && (await io.exists(`${folder.replace(/[\\/]+$/, '')}/${OLD_FILE}`)) } catch { return false }
  })()
  await io.show(isDue)
}

/** Remembers the answer for this project and takes the card away. */
async function settle(io: OldIo, folder: string) {
  await io.set(oldKey(folder), true)
  await io.show(false)
}

/** The two buttons. The offer is settled only once the text is in the box: a box that could not take it keeps the card, with a word of why. */
export function oldActions(io: OldIo): OldActions {
  return {
    oldOffer: async () => {
      const folder = io.folder()
      try {
        if (!(await io.fill(OLD_PROMPT))) { io.toast('The prompt box could not take the text just now. Press the button again in a moment.'); return }
        await settle(io, folder)
      } catch (err) {
        io.toast(`Could not use the old decisions file just now: ${reasonOf(err)}.`)
      }
    },
    oldDismiss: async () => {
      try { await settle(io, io.folder()) } catch (err) { io.toast(`Could not save your answer: ${reasonOf(err)}.`) }
    },
  }
}
