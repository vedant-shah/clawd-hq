// The plugin's on/off configs as the Settings tab shows them, and how a press finds the settings row to change.
// register.tsx makes the change itself (`$.config.set`); nothing here touches `$`.
import type { BriefingOptions } from './instructions'

export type ConfigField = 'chiefOfStaff' | 'quietChat' | 'recap' | 'youShouldKnow'

export type ConfigToggle = {
  field: ConfigField
  title: string
  /** What it does, in one short line (12 words at most). */
  says: string
  isOn: (o: BriefingOptions) => boolean
}

export const TOGGLES: readonly ConfigToggle[] = [
  { field: 'chiefOfStaff', title: 'Clawd runs the chat', says: 'Clawd hands work to specialists and reports in plain words.', isOn: o => o.isOn },
  { field: 'quietChat', title: 'Quiet chat', says: 'Hides finished notices and no-update lines; ctrl+o shows everything.', isOn: o => o.isQuiet },
  { field: 'recap', title: 'Recap', says: 'One line on where things stand, after a few quiet minutes.', isOn: o => o.isRecapOn },
  { field: 'youShouldKnow', title: 'You should know', says: 'A small model checks finished work and may leave a note.', isOn: o => o.isKnowOn },
]

/** Saving a config writes the settings, and the engine reloads the plugin with its new options (Register's contract). */
export const WHEN_APPLIED = 'A change is saved to your settings, and the plugin reloads with it at once.'

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
 * The key of the row this plugin owns for `field`, matched on the row's owner and field and never on a guessed key
 * (a plugin run from a folder has rows whose keys do not start with its name). None when no such row is listed.
 */
export function configKeyOf(rows: readonly ListedRow[], plugin: string, field: ConfigField): string | undefined {
  return rows.find(r => r.provider.plugin === plugin && fieldOf(r.key) === field)?.key
}

/** What the store keeps of a list, to see its real shape: our rows' keys, and other plugins' keys with their owner. Never a value. */
export function rowKeys(rows: readonly ListedRow[], plugin: string) {
  return {
    plugin,
    keys: rows.filter(r => r.provider.plugin === plugin).map(r => r.key),
    others: rows.filter(r => r.provider.plugin !== plugin && r.provider.plugin !== 'engine').map(r => `${r.provider.plugin}: ${r.key}`),
  }
}

/** The line shown when a change did not go through: which config, and the reason as it was given. */
export function refusalOf(field: ConfigField, reason: string): string {
  const title = TOGGLES.find(t => t.field === field)?.title ?? field
  return `Could not change ${title}: ${reason}`
}
