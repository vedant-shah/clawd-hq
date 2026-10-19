// Onboarding, piece 4: the rules around the team pick. They build the candidate list (obvious noise out, what the
// person used, named or installed themselves always kept), read the project's signals, write each pick's receipt from
// facts, and pick a team by seat when no model gives a usable answer. Ported from the tested scripts in
// experiments/onboarding-tests/roster-test (rules.mjs, build3.mjs, lib.mjs). No `$` and no model call here.
import type { Helper, PastUse, ProjectFacts, Seat } from './onboard-types'
import { SEAT_LIMITS } from './onboard-types'

/** One helper the team may hold, as the prompt and the card name it. */
export type Candidate = {
  /** The name a pick must copy exactly: `plugin:name` for a plugin's helper, the bare name otherwise. */
  readonly id: string
  readonly kind: 'agent' | 'skill'
  /** Where it came from, in the prompt's words: its plugin, "your own", or "built in / not on disk". */
  readonly source: string
  readonly plugin?: string
  readonly about: string
  readonly uses: number
  readonly isNamed: boolean
  readonly isOwn: boolean
}
/** A seat and a name, before the limits and the list are checked. `reason` is the scout's own words, kept only when they rest on a file it opened. */
export type RawPick = { readonly seat: Seat; readonly name: string; readonly reason?: string }

/** Always on, never on a seat. */
export const BUILTINS: ReadonlySet<string> = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup'])
/** This plugin's own hires, made from an earlier team. */
const OWN_HIRE = /^clawd-hq:/
const NOT_ON_DISK = 'built in / not on disk'
const NO_ABOUT = '(no description available)'
const ABOUT_CHARS = 160
const NAME_CHARS = 100
const SAFE_NAME = /^[\w.@/-]+(:[\w.@/-]+)?$/
/** Short descriptions of our own for helpers past sessions used that have no file on disk. */
const KNOWN_ABOUT: Readonly<Record<string, string>> = {
  'claude-code-guide': 'Answers questions about Claude Code, the Claude Agent SDK and the Claude API: features, hooks, plugins and settings.',
  'plugin-authoring': 'Makes or changes a Claude Code mod: panels, status lines, slash commands and hooks.',
}

// ---- The noise filter (rules.mjs) ----

const TOOL_NAME = /^(strategic-compact|loop|loop-.*|schedule|aside|checkpoint|pptx|docx|xlsx|pdf|commit|pr|prp-commit|prp-pr|pm2|jira|jira-integration|configure-ecc|config-gc|update-config|keybindings-help|fewer-permission-prompts|init|setup-claude|save-session|resume-session|sessions|projects|prune|promote|cost-report|cost-tracking|terminal-opener|terminal-ops|clipboard.*|explain-usage|find-skills|skill-creator|skill-create|skill-health|skill-stocktake|skill-scout|skill-comply|hookify.*|instinct-.*|learn|learn-eval|evolve|continuous-learning.*|consolidate-memory|import-memory|unified-.*|email-ops|messages-ops|google-workspace.*|x-api|crosspost|frontend-slides|video-editing|videodb|remotion-video-creation|manim-video|ui-demo|fal-ai-media|ecc-guide|ck|team-builder|dmux-workflows|nanoclaw-repl|token-budget-advisor|context-budget|harness-audit|workspace-surface-audit|agent-sort|rules-distill|ecc-tools-cost-audit|multi-.*|epic-.*|ito-.*|dashboard-builder)$/

const own = <T>(map: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(map, key) ? map[key] : undefined)
const bare = (id: string) => id.replace(/^.*:/, '')
const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9+#]+/).filter(Boolean))
const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
const firstSentence = (text: string) => (text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '').slice(0, ABOUT_CHARS)
/** Dependency names, whether listed bare or as `package.json: a, b`. */
const depNames = (deps: readonly string[]) =>
  deps.flatMap(d => d.replace(/^[^\s:]*\.(json|toml|txt|lock):\s*/i, '').split(/[\s,]+/)).filter(Boolean).map(d => d.toLowerCase())

/** A skill that runs a tool or the harness, not a kind of work: decks, loops, settings, session care. Judged by its name only. */
export const isToolLike = (name: string) => TOOL_NAME.test(bare(name))

// A skill that works by talking to the person (interviewing, quizzing, asking questions) is something they run, not a background hire.
// The rule is narrow on purpose: the verb must be aimed at "me", "you" or "the user", so a skill that only mentions users stays.
const GRILL_NAME = 'grill'
const TALKS_AT = /\b(?:interview(?:s|ing)?|grill(?:s|ing)?|quiz(?:zes|zing)?)\s+(?:me|you|the\s+(?:user|person))\b/i
const ASKS_QUESTIONS = /\bask(?:s|ing)?\s+(?:me|the\s+user)(?:\s+[\w-]+){0,2}\s+questions\b/i

/** Whether a skill needs the person present: named for grilling, or described as interviewing, quizzing or questioning them. */
export const needsPerson = (name: string, about: string) =>
  tokens(bare(name)).has(GRILL_NAME) || TALKS_AT.test(about) || ASKS_QUESTIONS.test(about)

/** A tool-like skill, by its name. Its description does not count: a skill that makes mods is still a fit for a mod project. */
const isToolByName = (c: Candidate) => c.kind === 'skill' && isToolLike(c.id)

// ---- The candidate list (build3.mjs) ----

const idOf = (h: Helper) => (h.name.includes(':') || !h.plugin ? h.name : `${h.plugin}:${h.name}`)
const isAllowed = (id: string) => !BUILTINS.has(id) && !OWN_HIRE.test(id)
const isKept = (c: Candidate) => c.uses > 0 || c.isNamed || c.isOwn
const isNoise = (c: Candidate) => isToolByName(c)
/**
 * Never a hire, however much it was used, named or owned: the person has to be there for it.
 * A skill that is a tool by its name (compact, pptx, loop) is the person's to run by hand, so using it is no reason to hire it; only their own or a named one stays.
 */
const wantsPerson = (c: Candidate) => c.kind === 'skill' && needsPerson(c.id, c.about)
const isHandTool = (c: Candidate) => isToolByName(c) && !c.isOwn && !c.isNamed

/** Past use by the full id, plus by the bare name for a plugin's helper (sessions name both ways). */
function usesOf(use: PastUse, kind: Candidate['kind'], id: string): number {
  const map = kind === 'agent' ? use.agents : use.skills
  const byBare = bare(id) === id ? 0 : count(own(map, bare(id)))
  return count(own(map, id)) + byBare
}

function fromHelper(h: Helper, use: PastUse): Candidate {
  const id = idOf(h)
  return {
    id,
    kind: h.kind,
    source: h.isOwn ? 'your own' : (h.plugin ?? h.source),
    ...(h.plugin ? { plugin: h.plugin } : {}),
    about: firstSentence(h.about),
    uses: Math.max(count(h.uses), usesOf(use, h.kind, id)),
    isNamed: h.isNamed,
    isOwn: h.isOwn,
  }
}

/** Helpers past sessions used that nothing installed matches, such as claude-code-guide. */
function notOnDisk(use: PastUse, known: ReadonlySet<string>): readonly Candidate[] {
  const extras = (kind: Candidate['kind'], map: Readonly<Record<string, number>>) => Object.entries(map).flatMap(([name, n]): Candidate[] => {
    const uses = count(n)
    const isSafe = name.length <= NAME_CHARS && SAFE_NAME.test(name)
    if (uses === 0 || !isSafe || !isAllowed(name) || known.has(name)) return []
    return [{ id: name, kind, source: NOT_ON_DISK, about: own(KNOWN_ABOUT, name) ?? NO_ABOUT, uses, isNamed: false, isOwn: false }]
  })
  return [...extras('agent', use.agents), ...extras('skill', use.skills)]
}

/** One entry per id, in first-seen order; an agent wins over a skill of the same name. */
function onePerId(list: readonly Candidate[]): readonly Candidate[] {
  const best = list.reduce((acc, c) => {
    const had = acc.get(c.id)
    return !had || (had.kind === 'skill' && c.kind === 'agent') ? new Map(acc).set(c.id, c) : acc
  }, new Map<string, Candidate>())
  return [...best.values()]
}

/** Everything the model may pick from: no field cut and no seat cut, only built-in agents, skills that need the person, tools and obvious noise left out. */
export function candidateList(helpers: readonly Helper[], use: PastUse): readonly Candidate[] {
  const installed = helpers.map(h => fromHelper(h, use)).filter(c => isAllowed(c.id) && (isKept(c) || !isNoise(c)))
  const known = new Set(helpers.flatMap(h => [idOf(h), h.name, bare(h.name)]))
  return onePerId([...installed, ...notOnDisk(use, known)].filter(c => !wantsPerson(c) && !isHandTool(c)))
}

// ---- Signals and receipts ----

type Sign = { readonly label: string; readonly words: readonly string[]; readonly files: readonly RegExp[]; readonly deps: readonly string[]; readonly tell?: RegExp }
/** Kinds of work a project shows, the files and dependencies that show them, and the name words of helpers that fit. */
const SIGNS: Readonly<Record<string, Sign>> = {
  tests: { label: 'tests', words: ['tdd', 'test', 'tests', 'testing', 'coverage'], files: [/^(vitest|jest|karma)\.config\./, /^(pytest\.ini|conftest\.py)$/, /\.(test|spec)\.[jt]sx?$/, /^(tests?|__tests__|spec)\/$/], deps: ['vitest', 'jest', 'pytest', 'mocha'] },
  e2e: { label: 'end-to-end tests', words: ['e2e', 'playwright', 'cypress'], files: [/^(playwright|cypress)\.config\./, /^e2e\/$/], deps: ['playwright', '@playwright/test', 'cypress'] },
  database: { label: 'a database', words: ['database', 'sql', 'postgres', 'schema', 'migration', 'migrations', 'supabase', 'prisma'], files: [/^(prisma|migrations|drizzle|supabase)\/$/, /\.sql$/], deps: ['pg', 'prisma', '@prisma/client', 'drizzle-orm', 'sqlalchemy', '@supabase/supabase-js', 'psycopg2', 'alembic'] },
  containers: { label: 'containers', words: ['docker', 'container', 'containers', 'kubernetes'], files: [/^dockerfile$/i, /^docker-compose[^/]*\.ya?ml$/i], deps: [] },
  docs: { label: 'docs', words: ['doc', 'docs', 'documentation', 'codemap', 'codemaps', 'readme'], files: [/^docs\/$/], deps: [] },
  web: { label: 'a web front end', words: ['react', 'frontend', 'ui', 'css', 'nextjs', 'accessibility', 'a11y', 'wcag', 'shadcn', 'tailwind'], files: [/^next\.config\./, /^(frontend|components)\/$/], deps: ['react', 'next', 'vite', 'tailwindcss', 'vue', 'svelte'], tell: /web app|next\.js/i },
  mobile: { label: 'a mobile app', words: ['mobile', 'flutter', 'swift', 'android', 'ios', 'kotlin'], files: [/^pubspec\.yaml$/, /^(ios|android)\/$/], deps: ['react-native', 'expo'] },
  data: { label: 'data or ML work', words: ['ml', 'rag', 'pandas', 'pytorch', 'llm', 'embedding', 'embeddings'], files: [/\.ipynb$/], deps: ['pandas', 'numpy', 'torch', 'scikit-learn', 'langchain', 'openai', 'anthropic', '@anthropic-ai/sdk', 'transformers'] },
  security: { label: 'auth or payments', words: ['security', 'auth', 'vulnerability', 'owasp'], files: [/^\.env\.example$/, /^(auth|login)\/$/], deps: ['jsonwebtoken', 'jose', 'passport', 'next-auth', 'stripe'] },
  mod: { label: 'a Claude Code mod', words: ['plugin', 'plugins', 'mod', 'hook', 'hooks'], files: [/^\.claude-plugin\/$/], deps: [], tell: /claude code/i },
}
const EVIDENCE_CHARS = 60

function signFound(sign: Sign, tells: readonly string[], entries: readonly string[], deps: readonly string[]): string | undefined {
  const tell = sign.tell ? tells.find(t => sign.tell?.test(t)) : undefined
  if (tell) return tell.slice(0, EVIDENCE_CHARS)
  const file = sign.files.map(re => entries.find(e => re.test(e))).find(e => e !== undefined)
  const evidence = file ?? deps.find(d => sign.deps.includes(d))
  return evidence ? `${sign.label} found (${evidence.slice(0, EVIDENCE_CHARS)})` : undefined
}

/** Each kind of work the project shows, with the plain phrase that names what shows it. */
export function projectSignals(facts: ProjectFacts): Readonly<Record<string, string>> {
  const entries = facts.outline.map(line => line.trim())
  const deps = depNames(facts.deps)
  return Object.fromEntries(Object.entries(SIGNS).flatMap(([kind, sign]) => {
    const found = signFound(sign, facts.tells, entries, deps)
    return found ? [[kind, found]] : []
  }))
}

type Fit = { readonly text: string; readonly strength: number; readonly kind?: string }
/** A helper fits when the project depends on a package of its name, or shows the kind of work its name says. */
function fitOf(c: Candidate, signals: Readonly<Record<string, string>>, deps: readonly string[]): Fit | undefined {
  const name = bare(c.id).toLowerCase()
  const dep = deps.find(d => d === name || d.startsWith(`@${name}/`))
  if (dep) return { text: `uses ${dep}`, strength: 12 }
  const words = tokens(name)
  const kind = Object.keys(SIGNS).find(k => own(signals, k) && SIGNS[k]?.words.some(w => words.has(w)))
  const found = kind ? own(signals, kind) : undefined
  return found ? { text: found, strength: 10, kind } : undefined
}

/** The kinds of work the project's own tells name (a Claude Code mod says so itself), not just files and dependencies that hint at it. */
const tellKindsOf = (facts: ProjectFacts): ReadonlySet<string> =>
  new Set(Object.entries(SIGNS).filter(([, sign]) => sign.tell !== undefined && facts.tells.some(t => sign.tell?.test(t))).map(([kind]) => kind))

const RECEIPT_PARTS = 2
const originOf = (c: Candidate) => (c.plugin ? `from the ${c.plugin} plugin` : /built/i.test(c.source) ? 'built into Claude Code' : 'installed')

/** Why a pick is on the card, from facts only: past use, the instructions, ownership, a fit, or where it came from. */
export function receiptOf(c: Candidate, signals: Readonly<Record<string, string>>, deps: readonly string[]): string {
  const fit = fitOf(c, signals, depNames(deps))
  const parts = [
    c.uses > 0 ? `used ${c.uses}× here` : undefined,
    c.isNamed ? 'named in your instructions' : undefined,
    c.isOwn ? `your own ${c.kind}` : undefined,
    fit ? `fits: ${fit.text}` : undefined,
  ].filter((p): p is string => p !== undefined)
  return parts.length > 0 ? parts.slice(0, RECEIPT_PARTS).join(' · ') : originOf(c)
}

// ---- The rule pick (lib.mjs `pick`, by seat) ----

type CoreSeat = Exclude<Seat, 'Specialist'>
const CORE_SEATS: readonly CoreSeat[] = ['Plan', 'Make', 'Check', 'Find out']
/** Name words that say which kind of work a helper does; one kind of work is one seat. */
const SEAT_WORDS: Readonly<Record<CoreSeat, readonly string[]>> = {
  Plan: ['planner', 'architect', 'plan', 'planning'],
  Make: ['tdd', 'build', 'builder', 'implementer', 'developer'],
  Check: ['reviewer', 'review', 'audit', 'auditor', 'security', 'hunter', 'verification', 'verifier', 'qa'],
  'Find out': ['explorer', 'explore', 'research', 'researcher', 'lookup', 'search', 'guide'],
}
const CORE_NAMES: ReadonlySet<string> = new Set(['planner', 'architect', 'tdd-guide', 'code-reviewer', 'security-reviewer', 'code-explorer', 'docs-lookup'])
const NAMED_WEIGHT = 500
const CORE_WEIGHT = 100
const USE_WEIGHT = 3
/** A fit to what the project says it is (its own tells) ranks above a fit read from its files: plugin-authoring in a Claude Code mod. */
const TELL_FIT_WEIGHT = 50
/** A seat's second pick needs at least this: a core name, real past use, or a mention in the instructions. */
const STRONG = 100

type Ranked = { readonly c: Candidate; readonly seat?: CoreSeat; readonly score: number; readonly hasFit: boolean }

function ranked(c: Candidate, signals: Readonly<Record<string, string>>, deps: readonly string[], tellKinds: ReadonlySet<string>): Ranked {
  const words = tokens(bare(c.id))
  const fit = fitOf(c, signals, deps)
  const tellBonus = fit?.kind !== undefined && tellKinds.has(fit.kind) ? TELL_FIT_WEIGHT : 0
  const score = (c.isNamed ? NAMED_WEIGHT : 0) + c.uses * USE_WEIGHT + (CORE_NAMES.has(bare(c.id)) ? CORE_WEIGHT : 0) + (fit?.strength ?? 0) + tellBonus + (c.kind === 'agent' ? 1 : 0)
  return { c, seat: CORE_SEATS.find(s => SEAT_WORDS[s].some(w => words.has(w))), score, hasFit: fit !== undefined }
}

const seatPicks = (seat: CoreSeat, list: readonly Ranked[]): RawPick[] =>
  list.filter(r => r.seat === seat).filter((r, i) => i === 0 || r.score >= STRONG).slice(0, SEAT_LIMITS[seat]).map(r => ({ seat, name: r.c.id }))

/** The team when no model answers: each seat's strongest helper by its kind of work, then specialists that rest on a fact. */
export function rulePick(cands: readonly Candidate[], facts: ProjectFacts): readonly RawPick[] {
  const signals = projectSignals(facts)
  const deps = depNames(facts.deps)
  const tellKinds = tellKindsOf(facts)
  const list = cands.filter(c => !wantsPerson(c)).map(c => ranked(c, signals, deps, tellKinds)).filter(r => !isToolByName(r.c))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id))
  const core = CORE_SEATS.flatMap(seat => seatPicks(seat, list))
  const taken = new Set(core.map(p => p.name))
  const specialists = list.filter(r => !taken.has(r.c.id) && (r.hasFit || r.c.isNamed || r.c.uses > 0))
    .slice(0, SEAT_LIMITS.Specialist).map((r): RawPick => ({ seat: 'Specialist', name: r.c.id }))
  return [...core, ...specialists]
}
