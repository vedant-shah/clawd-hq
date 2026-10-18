// Onboarding: the names shared by the scan, team pick, hiring, workflow, cards and flow pieces. Types and tiny constants only.
// Nothing here touches `$` or an atom; register.tsx fills OnboardIo with closures (see docs/research/onboarding-step1-plan.md).

/** Where setup stands. `done` and `skipped` end it; `/office-setup` restarts at `intro`. */
export type OnboardStep = 'offer' | 'intro' | 'scan' | 'team' | 'workflow' | 'first' | 'done' | 'skipped'

/** The two settings setup asks about (the Settings switches of the same names). */
export type ToggleField = 'chiefOfStaff' | 'quietChat'
/** One answer not applied yet: the other question is still open, or Clawd's turn is running. Each is dropped once applied, so a reload resumes with the rest. */
export type PendingToggle = { readonly field: ToggleField; readonly value: boolean }

/** Setup's place, kept per project at `onboard:<folder>`. `later` hides the offer until the next session. */
export type OnboardSave = {
  readonly step: OnboardStep
  readonly later?: true
  readonly pending: readonly PendingToggle[]
  readonly role?: string
  readonly at: number
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

/** One hire. `receipt` is built from facts only ("used 12× here", "named in CLAUDE.md"). */
export type Pick = { readonly seat: Seat; readonly name: string; readonly kind: 'agent' | 'skill'; readonly receipt: string }

/** Who chose the team: Opus first, then Haiku, then the rules. */
export type TeamBy = 'opus' | 'haiku' | 'rules'
/** The starting team, kept at `team:<folder>` with the skill hires made from it. */
export type Team = { readonly picks: readonly Pick[]; readonly empty: readonly Seat[]; readonly by: TeamBy }

/** Who the person is, kept on the whole machine at `profile`. */
export type Profile = { readonly role?: string; readonly workflow?: readonly string[]; readonly at: number }

/** The roles setup guesses from, and the guess with whether the evidence was thin. */
export const ROLES: readonly string[] = [
  'Software engineer',
  'Web developer',
  'Data / ML',
  'Mobile developer',
  'Tool or plugin builder',
  'Writer or researcher',
]
export type RoleGuess = { readonly role: string; readonly isThin: boolean }

/** The most steps the workflow card shows, and the most characters of instructions read for it. */
export const WORKFLOW_STEPS = 5
export const WORKFLOW_CHARS = 24000

/** Store keys, one per kind of record. */
export const onboardKey = (folder: string) => `onboard:${folder}`
export const usageKey = (folder: string) => `usage:${folder}`
export const teamKey = (folder: string) => `team:${folder}`
export const PROFILE_KEY = 'profile'

/** A choice on a card. It fills the prompt box or runs a flow action; it never sends anything. */
export type OnboardAction =
  | 'start' | 'later' | 'skip'
  | 'yes' | 'no'
  | 'changeRole'
  | 'hire' | 'adjust'
  | 'searchYes' | 'searchNo'
  | 'useWorkflow' | 'skipWorkflow'
  | 'useFirst'
export type OnboardButton = { readonly action: OnboardAction; readonly label: string; readonly isPrimary?: boolean }

/** What the Office tab draws for the current step. Facts go in `lines` (Text); buttons carry labels only. */
export type OnboardCard = {
  readonly step: OnboardStep
  readonly lines: readonly string[]
  readonly buttons: readonly OnboardButton[]
  readonly role?: string
  readonly team?: Team
  /** Agent types parked by the hire, for "Parked m". */
  readonly parked?: number
  readonly workflow?: readonly string[]
  /** The first-job suggestion. */
  readonly suggestion?: string
  /** A seat setup offers to search skills.sh for. */
  readonly searchSeat?: Seat
  /** A short plain note, such as "can't change that setting from here". */
  readonly note?: string
}

/** One question for the question box. */
export type AskQuestion = {
  readonly question: string
  readonly header: string
  readonly options: readonly { readonly label: string; readonly description: string }[]
  readonly multiSelect?: boolean
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
  /**
   * One question in Claude Code's own question box (`$.ui.ask`: a mod's direct AskUserQuestion call is refused by the host),
   * resolving to the label chosen or text typed under Other; `undefined` when it was dismissed or could not open.
   */
  readonly ask: (question: AskQuestion) => Promise<string | undefined>
  /** Goes through the Settings switch path; `false` when it could not be changed from here. */
  readonly setToggle: (field: ToggleField, value: boolean) => Promise<boolean>
  /** The current value of a setting. */
  readonly options: () => Promise<Readonly<Record<ToggleField, boolean>>>
  /** Clawd's turn is running: a switch change waits until it ends (the Settings switch refuses then too). */
  readonly isBusy: () => Promise<boolean>
  readonly registerHire: (spec: HireSpec) => Promise<boolean>
  /** Replaces the payroll's laid-off list, marks the payroll reviewed and keeps its stacks. */
  readonly savePayroll: (laidOff: readonly string[]) => Promise<void>
  /** The agent types on the laid-off list now: parked earlier, by hand or by a past setup. */
  readonly parked: () => readonly string[]
  readonly allAgentTypes: () => readonly string[]
  readonly showPeople: () => void
  /** Appends to the prompt box; nothing is sent. */
  readonly fill: (text: string) => Promise<void>
  /** The person's answer, saved in Decisions. */
  readonly decide: (question: string, said: string) => Promise<void>
  readonly card: () => Promise<OnboardCard | undefined>
  readonly setCard: (card: OnboardCard | undefined) => Promise<void>
  readonly toast: (text: string) => void
}
