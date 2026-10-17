// The plugin's on/off configs as the Settings tab shows them, and how a press finds the settings row to change.
// `setToggle` makes a change through the io register.tsx builds (`configIo`); nothing here touches `$`.
import type { BriefingOptions } from './instructions'

export type ConfigField = 'chiefOfStaff' | 'quietChat' | 'recap' | 'youShouldKnow'

/** A config as its row shows it: the name only (what each does is in the README). */
export type ConfigToggle = {
  field: ConfigField
  title: string
  isOn: (o: BriefingOptions) => boolean
}

export const TOGGLES: readonly ConfigToggle[] = [
  { field: 'chiefOfStaff', title: 'Clawd runs the chat', isOn: o => o.isOn },
  { field: 'quietChat', title: 'Quiet chat', isOn: o => o.isQuiet },
  { field: 'recap', title: 'Recap', isOn: o => o.isRecapOn },
  { field: 'youShouldKnow', title: 'You should know', isOn: o => o.isKnowOn },
]

/** Saving a config writes the settings, and the engine reloads the plugin with its new options at once (Register's contract). */
export const WHEN_APPLIED = 'Changes apply right away.'

/** A reload in the middle of Clawd's turn would lose what the turn holds, so the toggles wait until he is free. */
export const WAIT_FOR_FREE = 'You can change these when Clawd is free.'

/** Shown when the settings list has no row of this plugin for the field: a plugin run from a folder may have none. */
export const NO_ROW = 'This setting can\'t be changed from here while the plugin runs from a folder. Use /plugin.'

/** The store key of the last settings list's row keys (hooks/register.tsx writes it at each press). */
export const ROWS_KEY = 'debug:config-rows'

/** A settings row as `$.config.list()` gives it: its key and the plugin that owns it. */
export type ListedRow = { key: string; provider: { plugin: string } }

/** The field a row's key names: the part after its last dot. */
const fieldOf = (key: string) => key.slice(key.lastIndexOf('.') + 1)

/**
 * Whether a row's owner is this plugin. The engine names the owner as the loader keys the plugin, `<name>@inline` from a
 * folder or `<name>@<marketplace>` installed (seen in the store's `debug:config-rows`), not by its bare name.
 */
const isOurs = (owner: string, plugin: string) => owner === plugin || owner.startsWith(`${plugin}@`)

/**
 * The key of the row this plugin owns for `field`, matched on the row's owner and field and never on a guessed key
 * (a plugin run from a folder has rows whose keys do not start with its name). None when no such row is listed.
 */
export function configKeyOf(rows: readonly ListedRow[], plugin: string, field: ConfigField): string | undefined {
  return rows.find(r => isOurs(r.provider.plugin, plugin) && fieldOf(r.key) === field)?.key
}

/** What the store keeps of a list, to see its real shape: our rows' keys, and other plugins' keys with their owner. Never a value. */
export function rowKeys(rows: readonly ListedRow[], plugin: string) {
  return {
    plugin,
    keys: rows.filter(r => isOurs(r.provider.plugin, plugin)).map(r => r.key),
    others: rows.filter(r => !isOurs(r.provider.plugin, plugin) && r.provider.plugin !== 'engine').map(r => `${r.provider.plugin}: ${r.key}`),
  }
}

/** What setting a toggle needs from the engine: this plugin's name, the settings rows, a change to one, and a place for the rows' keys. */
export type ConfigIo = {
  plugin: string
  list: () => Promise<readonly ListedRow[]>
  set: (args: { key: string; value: boolean }) => Promise<{ deny?: string }>
  keepKeys: (record: ReturnType<typeof rowKeys>) => Promise<unknown>
}

/**
 * Sets one of the plugin's on/off configs in the settings, as /config would; the engine then reloads the plugin with it.
 * The one way in, for the Settings switch and for code (onboarding). Resolves to nothing once written, or to the plain
 * line saying why not (no row of ours, a refusal, a call that failed); it never rejects.
 */
export async function setToggle(io: ConfigIo, field: ConfigField, value: boolean): Promise<string | undefined> {
  try {
    const rows = await io.list()
    await io.keepKeys(rowKeys(rows, io.plugin)).catch(() => undefined) // a look-up aid only: a failed write must not stop the change
    const key = configKeyOf(rows, io.plugin, field)
    if (key === undefined) return NO_ROW
    const r = await io.set({ key, value })
    return r.deny === undefined ? undefined : refusalOf(field, r.deny)
  } catch (err) {
    return refusalOf(field, err instanceof Error ? err.message : String(err))
  }
}

/** The line shown when a change did not go through: which config, and the reason as it was given. */
export function refusalOf(field: ConfigField, reason: string): string {
  const title = TOGGLES.find(t => t.field === field)?.title ?? field
  return `Could not change ${title}: ${reason}`
}
