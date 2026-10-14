/** `lost`: still running by the engine's word, but silent too long; a third way a run ends, neither a win nor a failure. */
export type Mood = 'arriving' | 'working' | 'thinking' | 'done' | 'failed' | 'lost'

/** What ended a run: a stop signal from the agent itself, the engine's agent list (a guess), or too long without a sign of life (a guess). */
export type EndedBy = 'signal' | 'engine' | 'stale'

export type Employee = {
  id: string
  type: string
  description: string
  /** The name the hiring call gave it (a teammate, or a specialist addressed by name); most have none. */
  name?: string
  mood: Mood
  /** What it is doing now, as one plain sentence (see hooks/activity.ts); none before its first step. */
  activity?: string
  /** What it said in its last step, as one to three plain sentences (see narrationOf); kept until newer words replace it, and gone when its run ends. */
  said?: string
  tools: number
  startedAt: number
  endedAt?: number
  endedBy?: EndedBy
  /** The last sign of life: spawn, restart, tool call, model step, or the engine's status moving. */
  lastSeen?: number
  /** The engine's status for it as of the last look. */
  engine?: string
  joinedTick: number
  doneTick?: number
  model?: string
  /** The effort Clawd hired it at, applied to every request it makes. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** What this run used: its largest request input plus everything generated. */
  tokens?: number
  /** Tokens generated across this run's requests; part of `tokens`. */
  outTokens?: number
  /** The largest request input of this run; the input half of `tokens`, so a compaction cannot lower it. */
  peakInput?: number
  context?: number
}

/** One thing Clawd remembers for this project: a decision the user made, or a key choice an agent came back with. */
export type Memory = {
  id: string
  kind: 'decision' | 'choice'
  text: string
  by: string
  at: number
  source: 'desk' | 'report' | 'clawd'
}

/** A page on claude.ai that Claude published or opened with the Artifact tool in this project, newest first. */
export type Artifact = {
  /** Its link, one of the two shapes hooks/artifacts.ts accepts. */
  url: string
  /** Untrusted text, one line. */
  title: string
  /** When it was last published or opened. */
  at: number
}

export type Payroll = { laidOff: string[]; isReviewed: boolean; stacks: string[] }

/** An agent type's place on the books, kept across sessions. */
export type Badge = { jobs: number }

export type Boss = {
  activity: string
  isBusy: boolean
  waveUntil: number
  turns: number
  proudUntil: number
  oopsUntil: number
  lastTitle: string
  quip?: { text: string; until: number }
  doneAt?: number
  /** One line on where things stand, made after a few quiet minutes; gone when the next turn starts. */
  recap?: string
  idleSince: number
  hires: number
  wins: number
  fails: number
}

/** One rate-limit window as `$.session.usage()` reports it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/** What the header meters read: when this session began, how full the context is, and the rate-limit windows. */
export type Gauge = { startedAt: number; contextPercent?: number; limits: Limit[] }

export type Fx = {
  /** What the person typed into each tab's filter. */
  finds?: { decisions?: string; people?: string }
  demo?: { step: number; total: number; caption: string }
  /** The payroll review waiting in the People tab: how many agent types this project has no use for, and why. */
  layoffs?: { count: number; total: number; stacks: string[]; why: string[] }
}

/** How a note on Clawd's card is headed: a fact worth knowing, or a risk that may need action. */
export type KnowTag = 'You should know' | 'Heads up'

/** One note from the check on finished work (hooks/know.ts): untrusted model text, made plain before it is kept. */
export type KnowNote = {
  id: string
  /** Who did the work it is about: a specialist's label, or Clawd. */
  who: string
  /** The note itself, one sentence of about 20 words. */
  line: string
  tag: KnowTag
  /** A short bold title for Learn more; absent when the reply gave no explanation. */
  title?: string
  /** What Learn more shows, as plain text; absent when the reply gave none, and Learn more is then hidden. */
  explain?: string
  at: number
}

/** The notes waiting on Clawd's card, shown one at a time, oldest first. */
export type KnowState = {
  notes: KnowNote[]
  /** The front note's explanation is open. */
  isOpen: boolean
  /** The person's prompts since the front note appeared: the second takes it off. */
  promptsSince: number
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-hq': {
      staff: Employee[]
      boss: Boss
      fx: Fx
      tick: number
      blurbs: Record<string, string>
      roster: Record<string, Badge>
      payroll: Payroll
      memory: Memory[]
      gauge: Gauge
      artifacts: Artifact[]
      know: KnowState
    }
  }
}
