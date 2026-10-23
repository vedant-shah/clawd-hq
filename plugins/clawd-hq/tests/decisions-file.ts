// The project's old decisions file, seeded by hand. Clawd HQ no longer reads or writes it, so a test that wants to show that
// starts from a file such as an earlier version left, in the form it was written.

export const DECISIONS_FILE = '/repo/.clawd-hq/decisions.md'

export type Seed = { text: string; kind?: 'decision' | 'choice'; by?: string }

const HEADER = '# Clawd HQ decisions\n\nWhat you decided and what your agents chose, one line each, oldest first.\n\n'

/** Puts these entries, oldest first, in the old decisions file of `files` (the host's in-memory file system). The ids run M1, M2, ... */
export function seedDecisions(files: Map<string, string>, entries: readonly Seed[]) {
  const lines = entries.map((one, i) =>
    `- M${i + 1} · 2026-10-10 14:${String(i % 60).padStart(2, '0')} · ${one.kind ?? 'decision'} · ${one.by ?? 'CEO'} · desk · ${one.text.replace(/\s+/g, ' ').trim()}\n`)
  files.set(DECISIONS_FILE, `${HEADER}${lines.join('')}`)
}
