// The Settings switches as pressed, kept in the plugin's own store for this machine. The desktop app's SDK session lists
// no settings rows at all, so a press there cannot reach the settings; and where it can, the reload comes later.
// Every feature reads a switch through `liveOptions`: the saved value first, then the settings' value, then the default.
import type { ConfigField as ToggleField } from './configs'
import type { BriefingOptions } from './instructions'

export type Saved = Readonly<Partial<Record<ToggleField, boolean>>>

const FIELDS: readonly ToggleField[] = ['chiefOfStaff', 'quietChat', 'recap', 'youShouldKnow', 'leftUndone', 'autoSetup']

/** The store key of one switch: one key each, so two sessions changing different switches never undo each other. */
export const savedKey = (field: ToggleField) => `toggle:${field}`

/** The switches saved so far, as this process knows them: read at session start, replaced (never changed in place) on a press. */
let saved: Saved = {}

export const savedNow = (): Saved => saved
export const useSaved = (next: Saved) => { saved = next }

/** What the store holds for each switch, kept only when it is true or false. */
export async function loadSaved(get: (key: string) => Promise<unknown>): Promise<Saved> {
  const pairs = await Promise.all(FIELDS.map(async f => [f, await get(savedKey(f)).catch(() => undefined)] as const))
  return Object.fromEntries(pairs.filter(([, v]) => typeof v === 'boolean'))
}

/**
 * The options as every feature reads them, at the moment it reads: a saved switch over the settings' value (which already
 * has the default filled in). A fresh load forgets the last load's switches until session start reads the store again.
 */
export function liveOptions(base: BriefingOptions): BriefingOptions {
  saved = {}
  const pick = (field: ToggleField, settings: boolean) => saved[field] ?? settings
  return {
    voiceFile: base.voiceFile,
    get isOn() { return pick('chiefOfStaff', base.isOn) },
    get isQuiet() { return pick('quietChat', base.isQuiet) },
    get isRecapOn() { return pick('recap', base.isRecapOn) },
    get isKnowOn() { return pick('youShouldKnow', base.isKnowOn) },
    get isLeftOn() { return pick('leftUndone', base.isLeftOn) },
    get isAutoOn() { return pick('autoSetup', base.isAutoOn) },
  }
}
