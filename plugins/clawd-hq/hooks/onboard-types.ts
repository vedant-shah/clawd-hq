// Onboarding: the names shared by the scan, team pick, hiring, workflow, cards and flow pieces. Types and tiny constants only.
// Nothing here touches `$` or an atom; register.tsx fills OnboardIo with closures (see docs/research/onboarding-step1-plan.md).

/**
 * Where setup stands: it runs by itself, scan → team (picked, then hired) → workflow → done. `done` ends it; `/office-setup` starts
 * again at `scan`. A record the old flow left (an offer, a question, a first job, a skip) is read as never started or as done.
 */
export type OnboardStep = 'scan' | 'team' | 'workflow' | 'done'

/**
 * Setup's place, kept per project at `onboard:<folder>`, so a restart part way resumes or retries. `at` is when the place was last
 * saved (a run under two minutes old may still be working). `failures` counts runs that stopped; it goes when a run finishes.
 */
export type OnboardSave = {
  readonly step: OnboardStep
  readonly role?: string
  readonly at: number
  readonly failures?: number
}

/** One agent or skill the person has installed. `about` is the first sentence of its description. */
export type Helper = {
  readonly name: string
  readonly kind: 'agent' | 'skill'
  readonly source: string
  readonly plugin?: string
  readonly about: string
  readonly uses: number
  /** Named in an instruction file (CLAUDE.md and the like). */
  readonly isNamed: boolean
  /** Under ~/.claude/agents or ~/.claude/skills. */
  readonly isOwn: boolean
}

/** What a quiet look at the project found. */
export type ProjectFacts = {
  /** Plain-words signs, such as "Claude Code mod" for `.claude-plugin/`. */
  readonly tells: readonly string[]
  /** File extension to count. */
  readonly fileTypes: Readonly<Record<string, number>>
  /** Folders and files down to three levels. */
  readonly outline: readonly string[]
  /** Names from the manifests. */
  readonly deps: readonly string[]
  /** The first 40 lines of the README. */
  readonly readmeHead: string
  /** The text of the instruction files. */
  readonly instructions: string
  readonly codeFiles: number
}

/** What past sessions in this folder used: names and counts only, never content. Kept at `usage:<folder>`. */
export type PastUse = {
  readonly agents: Readonly<Record<string, number>>
  readonly skills: Readonly<Record<string, number>>
  /** Session files read. */
  readonly files: number
  /** Session files left out for being over the size limit. */
  readonly skipped: number
}

/** The kinds of work a team covers. */
export type Seat = 'Plan' | 'Make' | 'Check' | 'Find out' | 'Specialist'
/** Every seat, in the order the card draws them. */
export const SEATS: readonly Seat[] = ['Plan', 'Make', 'Check', 'Find out', 'Specialist']
/** The most picks a seat holds, and the most on a whole team. */
export const SEAT_LIMITS: Readonly<Record<Seat, number>> = { Plan: 2, Make: 1, Check: 2, 'Find out': 1, Specialist: 3 }
export const TEAM_LIMIT = 8

/**
 * One hire. `receipt` is the reason on the card: the scout's own sentence when it rests on a file the scout opened
 * ("Tests run with vitest. (package.json)"), else built from facts only ("used 12× here", "named in CLAUDE.md").
 */
export type Pick = { readonly seat: Seat; readonly name: string; readonly kind: 'agent' | 'skill'; readonly receipt: string }

/** Who chose the team: the scout first, then one Opus call, then the rules. */
export type TeamBy = 'scout' | 'opus' | 'rules'
/** The starting team, kept at `team:<folder>` with the skill hires made from it. */
export type Team = { readonly picks: readonly Pick[]; readonly empty: readonly Seat[]; readonly by: TeamBy }

/** Who the person is, kept on the whole machine at `profile`. */
export type Profile = { readonly role?: string; readonly workflow?: readonly string[]; readonly at: number }

/** The role setup guesses, and whether the evidence was thin (a thin guess picks the team but is not kept as who the person is). */
export type RoleGuess = { readonly role: string; readonly isThin: boolean }

/** The most steps the workflow card shows, and the most characters of instructions read for it. */
export const WORKFLOW_STEPS = 5
export const WORKFLOW_CHARS = 24000

/** Store keys, one per kind of record. */
export const onboardKey = (folder: string) => `onboard:${folder}`
export const usageKey = (folder: string) => `usage:${folder}`
export const teamKey = (folder: string) => `team:${folder}`
export const PROFILE_KEY = 'profile'

/** A choice on a card. The only one is Dismiss; a press never sends anything. */
export type OnboardAction = 'dismiss'
export type OnboardButton = { readonly action: OnboardAction; readonly label: string }

/**
 * What the card shows: `scan` while setup works, `done` once it has run, `failed` when a step stopped, and `quiet` for
 * nothing at all (held once setup has nothing to show this session, so the frame check stops looking).
 */
export type CardStep = 'scan' | 'done' | 'failed' | 'quiet'

/** What the Office tab draws for the current step. Facts go in `lines` (Text); buttons carry labels only. */
export type OnboardCard = {
  readonly step: CardStep
  readonly lines: readonly string[]
  readonly buttons: readonly OnboardButton[]
  /** A short plain note, such as "Claude Code would not add: x". */
  readonly note?: string
}

/** A skill or command the engine lists. */
export type CommandEntry = { readonly name: string; readonly description?: string; readonly source?: string }
/** A skill registered as a hired agent (the shape `$.agent.register` takes). */
export type HireSpec = {
  readonly name: string
  readonly description: string
  readonly prompt: string
  readonly skills: readonly string[]
  readonly model?: string
}
/** A model call; `undefined` back means no usable answer. */
export type CompleteRequest = {
  readonly model: 'opus' | 'haiku'
  readonly prompt: string
  readonly maxTokens: number
  readonly effort?: 'low' | 'medium' | 'high'
  readonly timeoutMs: number
}
/** What the scout sent through its pick tool (untrusted: checked against the candidate list) and the files it opened, as absolute paths. */
export type ScoutReport = { readonly picks: unknown; readonly reads: readonly string[] }
/** Judges the scout's picks as it sends them: the plain problem to send back to it, or `undefined` when they are usable. */
export type ScoutCheck = (picks: unknown, reads: readonly string[]) => string | undefined
/** `mtimeMs` is filled for session files (`.jsonl`) only, from a stat of each. */
export type FsListEntry = { readonly name: string; readonly isDir: boolean; readonly size?: number; readonly mtimeMs?: number }
/** The agents and skills the engine says are loaded, from `$.session.usage({ breakdown })`. */
export type UsageBreakdown = {
  readonly agents: readonly { readonly name: string; readonly source: string }[]
  readonly skills: readonly { readonly name: string; readonly source: string; readonly pluginName?: string }[]
  /** Fewer included than the total means the engine cut the skill list. */
  readonly includedSkills?: number
  readonly totalSkills?: number
}

/** The closures register.tsx fills; every onboarding module works through these and never sees `$`. */
export type OnboardIo = {
  readonly now: () => number
  /** The project folder; every per-project key hangs off it. */
  readonly cwd: string
  readonly get: <T>(key: string) => Promise<T | undefined>
  readonly set: (key: string, value: unknown) => Promise<void>
  /** A view is attached (the desktop attaches after session start). */
  readonly isShown: () => Promise<boolean>
  readonly list: (dir: string) => Promise<readonly FsListEntry[]>
  readonly read: (path: string) => Promise<string | undefined>
  readonly exists: (path: string) => Promise<boolean>
  readonly ancestors: (name: string) => Promise<readonly string[]>
  readonly home: () => string
  /** `CLAUDE_CONFIG_DIR`, or `undefined` for `~/.claude`. */
  readonly configDir: () => string | undefined
  readonly breakdown: () => Promise<UsageBreakdown | undefined>
  readonly commands: () => Promise<readonly CommandEntry[]>
  /** Agent type to its blurb, as the `agent.offer` hook keeps them. */
  readonly blurbs: () => Readonly<Record<string, string>>
  readonly complete: (req: CompleteRequest) => Promise<string | undefined>
  /** Starts the scout with the brief and waits for its picks; `undefined` when it could not start, ran out of time or sent nothing the check accepted. */
  readonly spawnScout: (brief: string, check: ScoutCheck) => Promise<ScoutReport | undefined>
  /** The Automatic setup switch, read as it is now: off means nothing starts by itself (`/office-setup` still runs). */
  readonly isAutoOn: () => boolean
  readonly registerHire: (spec: HireSpec) => Promise<boolean>
  /** Replaces the payroll's laid-off list, marks the payroll reviewed and keeps its stacks. */
  readonly savePayroll: (laidOff: readonly string[]) => Promise<void>
  /** The agent types on the laid-off list now: parked earlier, by hand or by a past setup. */
  readonly parked: () => readonly string[]
  readonly allAgentTypes: () => readonly string[]
  readonly card: () => Promise<OnboardCard | undefined>
  readonly setCard: (card: OnboardCard | undefined) => Promise<void>
}
