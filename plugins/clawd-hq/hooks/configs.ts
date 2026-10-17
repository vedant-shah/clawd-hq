// The plugin's on/off configs as the Settings tab shows them, and how a press finds the settings row to change.
// `setToggle` makes a change through the io register.tsx builds (`configIo`); nothing here touches `$`.
import type { BriefingOptions } from './instructions'
import { savedKey, savedNow, useSaved } from './toggle-store'

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

/** A press applies at once (hooks/toggle-store.ts); where the settings list the row, the engine may also reload the plugin. */
export const WHEN_APPLIED = 'Changes apply right away.'

/** A reload in the middle of Clawd's turn would lose what the turn holds, so the toggles wait until he is free. */
export const WAIT_FOR_FREE = 'You can change these when Clawd is free.'

/** The reason shown when a trusted source (managed settings, the organization's policy) owns the row. */
export const LOCKED = 'your organization manages this setting.'

/** The store key of the last settings list's row keys (hooks/register.tsx writes it at each press). */
export const ROWS_KEY = 'debug:config-rows'

/** A settings row as `$.config.list()` gives it: its key, the plugin that owns it, and whether a trusted source holds it. */
export type ListedRow = { key: string; provider: { plugin: string }; isLocked?: boolean }

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
export function configRowOf(rows: readonly ListedRow[], plugin: string, field: ConfigField): ListedRow | undefined {
  return rows.find(r => isOurs(r.provider.plugin, plugin) && fieldOf(r.key) === field)
}

/** What the store keeps of a list, to see its real shape: our rows' keys, and other plugins' keys with their owner. Never a value. */
export function rowKeys(rows: readonly ListedRow[], plugin: string) {
  return {
    plugin,
    keys: rows.filter(r => isOurs(r.provider.plugin, plugin)).map(r => r.key),
    others: rows.filter(r => !isOurs(r.provider.plugin, plugin) && r.provider.plugin !== 'engine').map(r => `${r.provider.plugin}: ${r.key}`),
  }
}

/**
 * What setting a toggle needs from the engine: this plugin's name, the settings rows and a change to one, the plugin's
 * own store (a switch's value, and the rows' keys), and a refresh of what the engine holds from the old value.
 */
export type ConfigIo = {
  plugin: string
  list: () => Promise<readonly ListedRow[]>
  set: (args: { key: string; value: boolean }) => Promise<{ deny?: string }>
  save: (key: string, value: boolean) => Promise<unknown>
  keepKeys: (record: ReturnType<typeof rowKeys>) => Promise<unknown>
  refresh: () => Promise<unknown>
}

/**
 * Sets one of the plugin's on/off switches. The one way in, for the Settings switch and for code (onboarding).
 * It applies at once in this session, is saved in the plugin's store for this machine (the desktop app's SDK session lists
 * no settings rows, so the store is what holds it there), and is written to the settings row too where one is listed, so
 * /config shows it (the engine may then reload the plugin; the store holds the same value). A row a trusted source locks is
 * left alone. Resolves to nothing once kept, or to the plain line on what went wrong; it never rejects.
 */
export async function setToggle(io: ConfigIo, field: ConfigField, value: boolean): Promise<string | undefined> {
  try {
    const rows = await io.list().catch((): readonly ListedRow[] => []) // the desktop app's session lists none, or refuses
    await io.keepKeys(rowKeys(rows, io.plugin)).catch(() => undefined) // a look-up aid only: a failed write must not stop the change
    const row = configRowOf(rows, io.plugin, field)
    if (row?.isLocked === true) return refusalOf(field, LOCKED)
    useSaved({ ...savedNow(), [field]: value }) // every feature reads the saved value first, so this is the change
    const isKept = await io.save(savedKey(field), value).then(() => true, () => false)
    await io.refresh().catch(() => undefined)
    const isSet = row !== undefined && (await io.set({ key: row.key, value }).then(r => r.deny === undefined, () => false))
    return isKept || isSet ? undefined : notKept(field)
  } catch (err) {
    return refusalOf(field, err instanceof Error ? err.message : String(err))
  }
}

const titleOf = (field: ConfigField) => TOGGLES.find(t => t.field === field)?.title ?? field

/** The line shown when a change did not go through: which config, and the reason as it was given. */
export function refusalOf(field: ConfigField, reason: string): string {
  return `Could not change ${titleOf(field)}: ${reason}`
}

/** The line shown when a change holds in this session but neither the store nor the settings took it. */
export const notKept = (field: ConfigField) => `${titleOf(field)} is changed for this session only: it could not be saved.`
