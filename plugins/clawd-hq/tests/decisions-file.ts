// The project's old decisions file, seeded by hand. Nothing writes decisions any more, so a test of the Decisions tab (until it is
// retired) starts from a file such as an earlier version left, as the plugin once wrote it.
import { toMarkdown } from '../hooks/logbook'
import type { Memory } from '../types'

export const DECISIONS_FILE = '/repo/.clawd-hq/decisions.md'

export type Seed = { text: string; kind?: Memory['kind']; by?: string }

/** Puts these entries, oldest first, in the old decisions file of `files` (the host's in-memory file system). The ids run M1, M2, ... */
export function seedDecisions(files: Map<string, string>, entries: readonly Seed[]) {
  const list = entries.map((one, i): Memory => ({
    id: `M${i + 1}`, kind: one.kind ?? 'decision', text: one.text.replace(/\s+/g, ' ').trim(), by: one.by ?? 'CEO', at: Date.UTC(2026, 9, 10, 14, i), source: 'desk',
  }))
  files.set(DECISIONS_FILE, toMarkdown(list))
}
