export type Mood = 'arriving' | 'working' | 'thinking' | 'done' | 'failed'

export type Employee = {
  id: string
  type: string
  description: string
  prompt: string
  mood: Mood
  tool?: string
  target?: string
  tools: number
  startedAt: number
  endedAt?: number
  joinedTick: number
  doneTick?: number
  log: string[]
  model?: string
  /** The effort Clawd hired it at, applied to every request it makes. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** What this run used: the latest request's whole input plus everything generated. */
  tokens?: number
  /** Tokens generated across this run's requests; part of `tokens`. */
  outTokens?: number
  context?: number
}

/** Something on the CEO's desk: a decision with options, or an open question. */
export type Ask = {
  id: string
  kind: 'decision' | 'question'
  title: string
  detail?: string
  options: string[]
  recommend?: string
  fallback?: string
  from: string
  fromType?: string
  fromId?: string
  source: 'tool' | 'report' | 'dialog' | 'office'
  status: 'open' | 'live' | 'answered' | 'dismissed'
  answer?: string
  askedAt: number
  answeredAt?: number
  isDelivered: boolean
  action?: 'payroll'
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

export type Payroll = { laidOff: string[]; isReviewed: boolean; stacks: string[] }

/** An agent type's place on the books, kept across sessions. */
export type Badge = { name: string; jobs: number }

export type Boss = {
  activity: string
  isBusy: boolean
  waveUntil: number
  turns: number
  proudUntil: number
  oopsUntil: number
  lastName: string
  lastTitle: string
  quip?: { text: string; until: number }
  /** The last thing the user asked for, and how that turn ended. */
  task?: string
  doneAt?: number
  outcome?: 'done' | 'stopped'
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
  view: 'office' | 'decisions' | 'people' | 'log'
  /** What the person typed into each tab's filter. */
  finds?: { decisions?: string; people?: string }
  demo?: { step: number; total: number; caption: string }
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
      desk: Ask[]
      payroll: Payroll
      memory: Memory[]
      gauge: Gauge
    }
  }
}
