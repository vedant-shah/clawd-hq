// The tokens each agent type used in one project folder, kept in the store under `tokens:<folder>`: the People tab's token line.
// The machine-wide record (`roster`) keeps its own lifetime counts as before; those cannot be split by project, so a project
// counts from the day this was added. No `$` and no atoms: register.tsx hands in what may be done as closures (`TokensIo`).
import { inLine } from './state'

/** What the per-project totals may do: the session's folder now, the store, the People tab's copy of this folder's totals, and a toast. */
export type TokensIo = {
  readonly folder: () => string
  readonly get: (key: string) => Promise<unknown>
  readonly set: (key: string, value: unknown) => Promise<unknown>
  readonly showTokens: (totals: Record<string, number>) => Promise<unknown>
  readonly toast: (text: string) => void
}

export const SAVE_FAILED = 'Could not save this project\'s token totals, so the People tab may show fewer tokens than were used.'

/** Set once a save of the totals failed this session, so the person is told once (as the Artifact Desk does); a session start clears it. */
let isWarned = false

export const tokensKey = (folder: string) => `tokens:${folder}`

/** What the store holds for a folder, checked: a type with a positive whole count is kept, anything else is dropped. */
export function tokensOf(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter((pair): pair is [string, number] => Number.isSafeInteger(pair[1]) && (pair[1] as number) > 0))
}

/** The totals with `tokens` more for this type. */
export const withTokens = (totals: Record<string, number>, type: string, tokens: number): Record<string, number> =>
  ({ ...totals, [type]: (totals[type] ?? 0) + tokens })

/**
 * Adds a run's tokens to the folder it ran in, which the caller names (not the session's folder at this moment, which may have moved).
 * Queued, so two runs that end at once both count; the People tab follows only when that folder is the one open now.
 * It never throws: the end of a run (its toast, Clawd's reaction, the rest of the reconcile) must go on, so a failed save is told once instead.
 */
export const keepTokens = (io: TokensIo, folder: string, type: string, tokens: number): Promise<void> => inLine(async () => {
  if (folder === '' || tokens <= 0) return
  const next = withTokens(tokensOf(await io.get(tokensKey(folder))), type, tokens)
  await io.set(tokensKey(folder), next)
  if (folder === io.folder()) await io.showTokens(next)
}).catch(() => {
  if (!isWarned) io.toast(SAVE_FAILED)
  isWarned = true
})

/** At session start: the People tab is shown this folder's totals, none for a project with no runs yet. Queued behind a run being counted. */
export const loadTokens = (io: TokensIo): Promise<void> => inLine(async () => {
  isWarned = false
  const folder = io.folder()
  await io.showTokens(folder === '' ? {} : tokensOf(await io.get(tokensKey(folder))))
})
