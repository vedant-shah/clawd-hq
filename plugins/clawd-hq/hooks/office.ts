// Pure pieces of the office: who a subagent is, how they look, what they and Clawd say.
import type { Employee, Mood, Badge } from '../types'

export type Role = {
  key: string
  title: string
  prop: string
  hat: string
  eyes?: string
  words: RegExp
  /** What Clawd says when one is hired. */
  hello: string
}

// First match wins, so the narrow roles sit above the broad ones.
export const ROLES: Role[] = [
  { key: 'clone', title: 'Clone of Clawd', prop: '🦀', hat: ' ▐▛▜▌', words: /^(claude|fork)$/i, hello: 'Another me? Finally, someone who gets it.' },
  { key: 'security', title: 'Security Guard', prop: '🛡', hat: ' ▄█▄ ', words: /secur|vuln|owasp|threat|sanitiz/i, hello: 'Security’s here. Hide the .env files.' },
  { key: 'detective', title: 'Bug Hunter', prop: '🕵', hat: ' ▄▀▄ ', words: /hunter|silent-failure|troubleshoot|debug|introspect/i, hello: 'A detective! The bug’s days are numbered.' },
  { key: 'reviewer', title: 'Reviewer', prop: '🔍', hat: ' ▁▁▁ ', eyes: '■', words: /review|audit|critic|analy[sz]er|comply/i, hello: 'Reviewer on deck. Brace for nits.' },
  { key: 'designer', title: 'Designer', prop: '🎨', hat: ' ~◠~ ', words: /\bui\b|ux|frontend|a11y|accessib|impeccable|css|motion|taste/i, hello: 'A designer! Quick, hide the Comic Sans.' },
  { key: 'architect', title: 'Architect', prop: '📐', hat: '▟▀▀▀▙', words: /architect|blueprint/i, hello: 'An Architect! Someone fetch the blueprints.' },
  { key: 'marketer', title: 'Marketer', prop: '📣', hat: ' ⋆⋆⋆ ', words: /marketing|seo|campaign|brand|launch/i, hello: 'Marketing’s in. Everything is now “revolutionary”.' },
  { key: 'planner', title: 'Planner', prop: '📋', hat: ' ┳━┳ ', words: /plan|prd|roadmap|\bspec\b/i, hello: 'A Planner. Finally, a plan for my plans.' },
  { key: 'tester', title: 'Tester', prop: '🧪', hat: ' ╭╮  ', words: /test|tdd|e2e|\bqa\b|coverage|evaluat/i, hello: 'Tester hired. Things are about to break, on purpose.' },
  { key: 'speed', title: 'Speed Demon', prop: '⚡', hat: ' ≫≫≫ ', words: /perform|optimi[sz]|benchmark|latency|throughput/i, hello: 'Speed Demon! Everyone talk faster.' },
  { key: 'ops', title: 'Ops', prop: '🖥', hat: ' ┌┬┐ ', words: /loop|operator|statusline|setup|config|devops|deploy|network/i, hello: 'Ops is here. Don’t touch prod.' },
  { key: 'fixer', title: 'Fixer', prop: '🔧', hat: ' ▄▄▄ ', words: /build|resolver|fix|error|compile|refactor|cleaner|simplif/i, hello: 'Fixer hired. The build is in good claws now.' },
  { key: 'engineer', title: 'Engineer', prop: '🏗', hat: ' ╤═╤ ', words: /generat|applier|packag|forker|engineer|implement|executor/i, hello: 'An Engineer! Ship it, ship it.' },
  { key: 'comms', title: 'Comms Desk', prop: '📬', hat: ' ✉✉  ', words: /chief-of-staff|email|slack|comms|newsletter|\bvoc\b|messag/i, hello: 'Comms Desk! My inbox thanks you.' },
  { key: 'people', title: 'People Team', prop: '🪪', hat: ' ♡♡♡ ', words: /onyx|onboard|\bhr\b|policy|employee|persona/i, hello: 'People Team’s here. Remember to take your leave!' },
  { key: 'exec', title: 'Executive', prop: '👔', hat: ' ▀█▀ ', words: /execut|stakeholder|strateg|leadership/i, hello: 'An Executive. Everyone look busy.' },
  { key: 'customer', title: 'Customer Success', prop: '🤝', hat: ' ◡◡◡ ', words: /customer|renewal|partner|success/i, hello: 'Customer Success! Our customers are in good claws.' },
  { key: 'librarian', title: 'Librarian', prop: '📖', hat: ' ▔▔▔ ', words: /guide|lookup|reference|knowledge|docs-?lookup/i, hello: 'The Librarian! Shh, everyone.' },
  { key: 'explorer', title: 'Scout', prop: '🧭', hat: ' ⌒⌒⌒ ', words: /explor|scout|locat|^search|code-explorer/i, hello: 'A Scout! Map me that codebase.' },
  { key: 'writer', title: 'Writer', prop: '📚', hat: ' ═══ ', words: /doc|writ|article|copy|content|humaniz/i, hello: 'A Writer! Mind the em dashes.' },
  { key: 'analyst', title: 'Analyst', prop: '📊', hat: ' ┬┬┬ ', words: /data|analyst|metric|sql|database|research|competit|market/i, hello: 'An Analyst. Show me the numbers!' },
]

export const GENERALIST: Role = {
  key: 'generalist', title: 'Generalist', prop: '💼', hat: ' ___ ', words: /.^/, hello: 'A Generalist. Jack of all trades!',
}

export const NAMES = [
  'Pip', 'Nova', 'Bolt', 'Mochi', 'Ziggy', 'Juno', 'Taro', 'Bea', 'Kiwi', 'Remy', 'Lumi', 'Otto', 'Fig', 'Dot', 'Rook', 'Suki',
  'Milo', 'Ivy', 'Gus', 'Wren', 'Biscuit', 'Nori', 'Pixel', 'Clover', 'Echo', 'Sage', 'Waffles', 'Indie', 'Basil', 'Peaches', 'Tofu', 'Rex',
  'Opal', 'Chip', 'Luna', 'Momo', 'Pickle', 'Hazel', 'Yuki', 'Ollie', 'Dune', 'Maple', 'Bean', 'Zara', 'Cosmo', 'Tilly', 'Bao', 'Atlas',
  'Poppy', 'Ash', 'Noodle', 'Quinn', 'Sprout', 'Jinx', 'Moss', 'Kit', 'Olive', 'Toast', 'Rumi', 'Echo II', 'Pebble', 'Sunny', 'Mango', 'Vale',
]
const COLORS = ['#6aa9ff', '#6cc570', '#a984ff', '#ff8fc7', '#4fd1c5', '#f2c94c', '#ef6b6b', '#b5e655', '#5fd7ff', '#c3a6ff', '#7ee0b0', '#e57cd8']
const EYES = ['•', 'o', '◕', '°', '^', '⊙', 'ˇ', '◉']

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const pick = <T>(list: T[], seed: number): T => list[seed % list.length] as T

const bareType = (type: string) => type.replace(/^[^:]+:/, '').replace(/^\([^()]*\)\s*/, '')

/** The role is read from the agent's type first, then its instructions. */
export function roleOf(type: string, blurb = ''): Role {
  const bare = bareType(type)
  return ROLES.find(r => r.words.test(bare)) ?? ROLES.find(r => r.words.test(blurb)) ?? GENERALIST
}

/** A name for a type new to the roster: its hash's pick, walked on past names taken. */
export function nameFor(type: string, taken: Set<string>): string {
  const seed = hash(type)
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[(seed + i) % NAMES.length] as string
    if (!taken.has(name)) return name
  }
  return `${pick(NAMES, seed)} ${taken.size}`
}

/** One character per agent type, so a type always comes back as the same person. */
export function looksOf(type: string, roster: Record<string, Badge> = {}) {
  const seed = hash(type)
  const face = /\(([^()]{3})\)/.exec(type)?.[1]
  return {
    name: roster[type]?.name ?? pick(NAMES, seed),
    color: pick(COLORS, seed >>> 4),
    eyes: pick(EYES, seed >>> 8),
    blink: seed % 7,
    face,
  }
}

const MOUTH: Record<Mood, string> = { arriving: 'o', working: '_', thinking: '~', done: '▽', failed: 'n' }

/** Three rows: hat, face, body. `tick` drives blinking, typing and cheering. */
export function sprite(type: string, blurb: string, mood: Mood, tick: number, isParty: boolean): string[] {
  const role = roleOf(type, blurb)
  const look = looksOf(type)
  const isBlink = (tick + look.blink) % 9 === 0
  const eye = isBlink ? '-' : (role.eyes ?? look.eyes)
  // A type whose name carries its own face (acme-ops' "(o_o) data-analyst") keeps it.
  const face = look.face && !isBlink ? `(${look.face})` : `(${eye}${isParty ? '▽' : MOUTH[mood]}${eye})`
  const cheer = isParty || mood === 'done'
  const body = cheer
    ? (tick % 2 ? '\\(█)/' : ' (█) ')
    : mood === 'working'
      ? (tick % 2 ? '/|█|\\' : '\\|█|/')
      : mood === 'failed' ? '/|█|\\' : ' |█| '
  return [role.hat, face, body]
}

const VERBS: Record<string, string> = {
  Read: 'reading', Edit: 'editing', Write: 'writing', MultiEdit: 'editing', NotebookEdit: 'editing',
  Bash: 'running', Grep: 'searching', Glob: 'looking for', WebFetch: 'browsing', WebSearch: 'googling',
  Agent: 'delegating', Task: 'delegating', TodoWrite: 'planning', Skill: 'studying',
}

export function verbOf(tool: string): string {
  if (tool.startsWith('mcp__')) return tool.split('__').slice(-1)[0]?.replace(/_/g, ' ') ?? tool
  return VERBS[tool] ?? tool
}

const base = (path: string) => path.split('/').filter(Boolean).slice(-1)[0] ?? path

/** A few words naming what a tool call works on. */
export function targetOf(input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const path = str('file_path') ?? str('notebook_path') ?? str('path')
  if (path) return base(path)
  const url = str('url')
  if (url) return url.replace(/^https?:\/\//, '').split('/')[0] ?? url
  const skill = str('skill')
  if (skill) return `📖 ${skill.replace(/^[^:]+:/, '')}`
  const raw = str('subagent_type') ?? str('description') ?? str('command') ?? str('pattern') ?? str('query') ?? ''
  return raw.replace(/\s+/g, ' ').trim()
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

export function displayName(e: Employee, staff: Employee[], roster: Record<string, Badge> = {}): string {
  const same = staff.filter(o => o.type === e.type)
  const n = same.findIndex(o => o.id === e.id)
  const name = looksOf(e.type, roster).name
  return same.length > 1 && n > 0 ? `${name} #${n + 1}` : name
}

// ---- Clawd, the chief of staff ----

export type ClawdMood = 'chill' | 'focused' | 'delegating' | 'proud' | 'stressed' | 'oops' | 'sleepy' | 'waiting'

export const CLAWD_COLOR = '#d97757'

/** The office's brand: a neutral slate blue for the chrome; Clawd keeps his own orange. */
export const BRAND = 'Clawd HQ'
export const ACCENT = '#6C8EBF'

const BODY = [' ▝▜█████▛▘ ', '   ▘▘ ▝▝   ']
export const CLAWD_ART: Record<'normal' | 'blink' | 'shades' | 'sleepy' | 'wave' | 'wave2', string[]> = {
  normal: ['  ▐▛███▜▌  ', ...BODY],
  blink: ['  ▐▄███▄▌  ', ...BODY],
  shades: ['  ▐█▀█▀█▌  ', ...BODY],
  sleepy: ['  ▐▀███▀▌  ', ...BODY],
  wave: [' ▗▐▛███▜▌▖ ', '  ▜█████▛  ', '   ▘▘ ▝▝   '],
  wave2: ['▗ ▐▛███▜▌ ▖', ' ▝▜█████▛▘ ', '   ▘▘ ▝▝   '],
}

export const CLAWD_PROP: Record<ClawdMood, string> = {
  chill: '☕', focused: '⌨', delegating: '📋', proud: '🏆', stressed: '💦', oops: '😱', sleepy: '💤', waiting: '📥',
}

export const CLAWD_LINES: Record<ClawdMood, string[]> = {
  chill: ['Shell yeah, quiet day.', 'Sipping coffee, admiring the roadmap.', 'Anyone need anything? No? Great.', 'I alphabetised the agents. Again.', 'Inbox zero. I am unstoppable.'],
  focused: ['Claws on keyboard.', 'Let’s get cracking.', 'Reading. Thinking. Pinching.', 'In the zone. Do not disturb.'],
  delegating: ['Delegation is a love language.', 'Teamwork makes the dream work.'],
  proud: ['Claw-some work, {name}!', '{name} nailed it. Raise incoming.', 'That’s my {title}!'],
  stressed: ['{n} agents at once? I’m a crab, not an octopus.', 'Everything is fine. Totally fine. 💦', 'Who approved all this headcount? Oh. Me.'],
  oops: ['Nobody panic. I’m panicking.', '{name}, take the rest of the day.', 'We’ll call that a learning opportunity.'],
  sleepy: ['zZz…', '…five more minutes…', '…mmh… delegate… the… zZz'],
  waiting: ['The CEO has {q} thing(s) to decide. No pressure.', 'Your desk, boss: {q} waiting. I’ve kept everyone busy meanwhile.', 'Holding the fort until the CEO decides.'],
}

export function fill(line: string, vars: Record<string, string | number>): string {
  return line.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))
}

export const lineOf = (lines: string[], seed: number) => pick(lines, seed)
