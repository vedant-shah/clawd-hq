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
  /** What the specialist itself reports with the step tool: steps done, the plan's size (1 to 12), and a few plain words on the step. None until it reports. */
  stepDone?: number
  stepTotal?: number
  stepNote?: string
  /** Where the progress came from: the step tool's report, which stands, or a "Step N of M" in the specialist's own words. */
  stepBy?: 'tool' | 'words'
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
  /** Clawd's turn count when a specialist last handed work back since the person's latest message; none until then (hooks/checkpoint.ts). */
  handedBackAt?: number
  /** A piece of work has closed: a hand-back was reported in a finished turn of Clawd's with no question left open. Lasts until the person's next message. */
  isCheckpoint?: boolean
  /** The turn of Clawd's that a background job's notification started or joined with no hand-back heard yet: a hand-back that comes in that turn is reported by it. */
  carriedAt?: number
  /** Where the person's latest message came from (its origin kind, or `none` where the engine named none), kept for the coffee break record. */
  spokeBy?: string
  idleSince: number
  hires: number
  wins: number
  fails: number
}

/** One rate-limit window as `$.session.usage()` reports it. */
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * What the footer reads: when this session began, how full the context is (tokens used, the window, and the percent),
 * the rate-limit windows, and the main chat's model and effort as its last request named them.
 */
export type Gauge = {
  startedAt: number
  contextPercent?: number
  contextTokens?: number
  contextWindow?: number
  /** The token count at which Claude Code compacts by itself; none when its auto-compact is off or has not been read. */
  autoCompactAt?: number
  limits: Limit[]
  model?: string
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export type Fx = {
  /** What the person typed into each tab's filter. */
  finds?: { decisions?: string; people?: string }
  demo?: { step: number; total: number; caption: string }
  /** The payroll review waiting in the People tab: how many agent types this project has no use for, and why. */
  layoffs?: { count: number; total: number; stacks: string[]; why: string[] }
  /** The usage footer's three rows are open above its button; shared by every pane. */
  isUsageOpen?: boolean
  /** The Settings tab shows the list of finished work instead of the configs and Clawd's instructions. */
  isLogOpen?: boolean
  /** Why the last press of a config's toggle did not change it; gone once a change goes through. */
  configNote?: string
  /**
   * The one line the coffee break button leaves under the footer's row: that it is compacting, that the command is ready in the prompt
   * box, or why it did not compact. `turns` is Clawd's turn count when it was made; a new turn of his makes it stale, and it is not drawn.
   * `done` is no line: a compaction stood at `at` (ms), and Clawd drinks coffee for a while after it.
   */
  coffee?: { kind: 'running' | 'ready' | 'problem' | 'done'; text: string; turns: number; at?: number }
  /** Where the Settings tab's box of each file is: its first line, and the fingerprint of the text it was for (another text starts at the top). */
  scroll?: { rules?: { at: number; of: number }; voice?: { at: number; of: number } }
}

/** One part of Clawd's briefing as the Settings tab shows it: the text now, where it comes from, and the file an edit goes to. */
export type ClawdPartView = {
  text: string
  /** The shipped text, the person's own copy, or the file the voice file setting names. */
  source: 'builtin' | 'own' | 'setting'
  /** The file an edit goes to; '' when there is no home folder. */
  path: string
  /** The text now differs from what this session's chat was given: it applies from the next session or /clear. */
  isChanged: boolean
  /** The own copy was made from an older built-in text than the plugin ships now. */
  isNewer: boolean
}

/** What the Settings tab draws of Clawd's instructions: whether Clawd runs the chat, both parts, and the word left by the last button pressed. */
export type ClawdBrief = {
  isOn: boolean
  rules?: ClawdPartView
  voice?: ClawdPartView
  /** `line`: the prompt to type by hand, where the prompt box could not take it. */
  notice?: { text: string; line?: string }
  /** Why the last read of the instructions failed; gone once a read works. */
  readError?: string
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

/** The note on Clawd's card: at most one, and none waiting behind it. */
export type KnowState = {
  note?: KnowNote
  /** The note's explanation is open. */
  isOpen: boolean
  /** The person's prompts since the note appeared: the second takes it off. */
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
      brief: ClawdBrief
    }
  }
}
