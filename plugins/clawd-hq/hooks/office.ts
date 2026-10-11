// Pure pieces of the office: who a subagent is, how they look, what they and Clawd say.
import type { Employee, Badge } from '../types'

export type Role = {
  key: string
  title: string
  prop: string
  words: RegExp
  /** What Clawd says when one is hired. */
  hello: string
}

// First match wins, so the narrow roles sit above the broad ones.
export const ROLES: Role[] = [
  { key: 'clone', title: 'Clone of Clawd', prop: '🦀', words: /^(claude|fork)$/i, hello: 'Another me? Finally, someone who gets it.' },
  { key: 'security', title: 'Security Guard', prop: '🛡', words: /secur|vuln|owasp|threat|sanitiz/i, hello: 'Security’s here. Hide the .env files.' },
  { key: 'detective', title: 'Bug Hunter', prop: '🕵', words: /hunter|silent-failure|troubleshoot|debug|introspect/i, hello: 'A detective! The bug’s days are numbered.' },
  { key: 'reviewer', title: 'Reviewer', prop: '🔍', words: /review|audit|critic|analy[sz]er|comply/i, hello: 'Reviewer on deck. Brace for nits.' },
  { key: 'designer', title: 'Designer', prop: '🎨', words: /\bui\b|ux|frontend|a11y|accessib|impeccable|css|motion|taste/i, hello: 'A designer! Quick, hide the Comic Sans.' },
  { key: 'architect', title: 'Architect', prop: '📐', words: /architect|blueprint/i, hello: 'An Architect! Someone fetch the blueprints.' },
  { key: 'marketer', title: 'Marketer', prop: '📣', words: /marketing|seo|campaign|brand|launch/i, hello: 'Marketing’s in. Everything is now “revolutionary”.' },
  { key: 'planner', title: 'Planner', prop: '📋', words: /plan|prd|roadmap|\bspec\b/i, hello: 'A Planner. Finally, a plan for my plans.' },
  { key: 'tester', title: 'Tester', prop: '🧪', words: /test|tdd|e2e|\bqa\b|coverage|evaluat/i, hello: 'Tester hired. Things are about to break, on purpose.' },
  { key: 'speed', title: 'Speed Demon', prop: '⚡', words: /perform|optimi[sz]|benchmark|latency|throughput/i, hello: 'Speed Demon! Everyone talk faster.' },
  { key: 'ops', title: 'Ops', prop: '🖥', words: /loop|operator|statusline|setup|config|devops|deploy|network/i, hello: 'Ops is here. Don’t touch prod.' },
  { key: 'fixer', title: 'Fixer', prop: '🔧', words: /build|resolver|fix|error|compile|refactor|cleaner|simplif/i, hello: 'Fixer hired. The build is in good claws now.' },
  { key: 'engineer', title: 'Engineer', prop: '🏗', words: /generat|applier|packag|forker|engineer|implement|executor/i, hello: 'An Engineer! Ship it, ship it.' },
  { key: 'comms', title: 'Comms Desk', prop: '📬', words: /chief-of-staff|email|slack|comms|newsletter|\bvoc\b|messag/i, hello: 'Comms Desk! My inbox thanks you.' },
  { key: 'people', title: 'People Team', prop: '🪪', words: /onyx|onboard|\bhr\b|policy|employee|persona/i, hello: 'People Team’s here. Remember to take your leave!' },
  { key: 'exec', title: 'Executive', prop: '👔', words: /execut|stakeholder|strateg|leadership/i, hello: 'An Executive. Everyone look busy.' },
  { key: 'customer', title: 'Customer Success', prop: '🤝', words: /customer|renewal|partner|success/i, hello: 'Customer Success! Our customers are in good claws.' },
  { key: 'librarian', title: 'Librarian', prop: '📖', words: /guide|lookup|reference|knowledge|docs-?lookup/i, hello: 'The Librarian! Shh, everyone.' },
  { key: 'explorer', title: 'Scout', prop: '🧭', words: /explor|scout|locat|^search|code-explorer/i, hello: 'A Scout! Map me that codebase.' },
  { key: 'writer', title: 'Writer', prop: '📚', words: /doc|writ|article|copy|content|humaniz/i, hello: 'A Writer! Mind the em dashes.' },
  { key: 'analyst', title: 'Analyst', prop: '📊', words: /data|analyst|metric|sql|database|research|competit|market/i, hello: 'An Analyst. Show me the numbers!' },
]

export const GENERALIST: Role = {
  key: 'generalist', title: 'Generalist', prop: '💼', words: /.^/, hello: 'A Generalist. Jack of all trades!',
}

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const pick = <T>(list: T[], seed: number): T => list[seed % list.length] as T

export const bareType = (type: string) => type.replace(/^[^:]+:/, '').replace(/^\([^()]*\)\s*/, '')

/** The role is read from the agent's type first, then its instructions. */
export function roleOf(type: string, blurb = ''): Role {
  const bare = bareType(type)
  return ROLES.find(r => r.words.test(bare)) ?? ROLES.find(r => r.words.test(blurb)) ?? GENERALIST
}

export function clip(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length > width ? text.slice(0, width - 1) + '…' : text
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

// ---- Clawd, the chief of staff ----

export type ClawdMood = 'chill' | 'focused' | 'delegating' | 'proud' | 'stressed' | 'oops' | 'sleepy' | 'waiting'

export const CLAWD_COLOR = '#d97757'

/** The office's brand: a neutral slate blue for the chrome; Clawd keeps his own orange. */
export const BRAND = 'Clawd HQ'
export const ACCENT = '#7C9FD1'
/** "Needs you" and "waiting on you". */
export const AMBER = '#e0a83a'
/** Done, all clear. */
export const GREEN = '#6bbf7a'

export const CLAWD_LINES: Record<ClawdMood, string[]> = {
  chill: ['Shell yeah, quiet day.', 'Sipping coffee, admiring the roadmap.', 'Anyone need anything? No? Great.', 'I alphabetised the agents. Again.', 'Inbox zero. I am unstoppable.'],
  focused: ['Claws on keyboard.', 'Let’s get cracking.', 'Reading. Thinking. Pinching.', 'In the zone. Do not disturb.'],
  delegating: ['Delegation is a love language.', 'Teamwork makes the dream work.'],
  proud: ['Claw-some work, {title}!', 'The {title} nailed it. Raise incoming.', 'That’s my {title}!'],
  stressed: ['{n} agents at once? I’m a crab, not an octopus.', 'Everything is fine. Totally fine. 💦', 'Who approved all this headcount? Oh. Me.'],
  oops: ['Nobody panic. I’m panicking.', 'Take the rest of the day, {title}.', 'We’ll call that a learning opportunity.'],
  sleepy: ['zZz…', '…five more minutes…', '…mmh… delegate… the… zZz'],
  waiting: ['The CEO has {q} thing(s) to decide. No pressure.', 'Your desk, boss: {q} waiting. I’ve kept everyone busy meanwhile.', 'Holding the fort until the CEO decides.'],
}

export function fill(line: string, vars: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export const lineOf = (lines: string[], seed: number) => pick(lines, seed)
