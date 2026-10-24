// skill-use: tells Clawd whether a skill is worth its tokens. A skill adds knowledge (a framework, a library, an API, a design style, a domain)
// or only a process (a way of working a capable model already follows: test-first, review, planning, checks, commits). Pure; no `$`.
export type SkillUse = 'knowledge' | 'process'

/** Words in a skill's name that mark a way of working. */
const PROCESS_NAME = new Set(['tdd', 'workflow', 'workflows', 'review', 'verification', 'verify', 'loop', 'plan', 'planning', 'checkpoint', 'commit', 'gate', 'checklist', 'orch'])
/** Phrases in its description that say the same. */
const PROCESS_ABOUT = /test-driven|tests? first|\btdd\b/i

/** "process" when the name or description is about how to work; else "knowledge". A best guess from the name and description alone. */
export function useOf(id: string, about: string): SkillUse {
  const bare = id.slice(id.indexOf(':') + 1).toLowerCase().split(/[^a-z0-9]+/)
  return bare.some(w => PROCESS_NAME.has(w)) || PROCESS_ABOUT.test(about) ? 'process' : 'knowledge'
}
