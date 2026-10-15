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

/**
 * The settings row of this plugin's field: `<plugin>.<field>`. The plugin part may carry a suffix (a plugin loaded
 * from a folder is `<name>@inline`), so the row the settings list wins; with no list, the plain name is tried.
 */
export function configKeyOf(rows: ReadonlyArray<{ key: string }>, plugin: string, field: ConfigField): string {
  const plain = `${plugin}.${field}`
  const listed = rows.find(r => r.key === plain) ?? rows.find(r => r.key.startsWith(`${plugin}@`) && r.key.endsWith(`.${field}`))
  return listed?.key ?? plain
}

/** The line shown when a change did not go through: which config, and the reason as it was given. */
export function refusalOf(field: ConfigField, reason: string): string {
  const title = TOGGLES.find(t => t.field === field)?.title ?? field
  return `Could not change ${title}: ${reason}`
}
