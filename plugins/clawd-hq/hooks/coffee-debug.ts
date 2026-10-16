// One small record of why the coffee break button is or is not on the pane, so a live failure can be read and not guessed. Kept under one
// key, the latest only, never growing and never holding a word of the chat: numbers, flags and the origin kind of the person's last message.
// register.tsx hands in every call as `io` (`$` never leaves that file).
import { coffeeView, tokensOf, triggerAt } from './coffee-break'
import { atWork } from './panel-model'
import type { PanelData } from './panel-types'

/** Where the record lives in the plugin's store (the file is ~/.claude/plugins/store/clawd-hq_inline-*.json). */
export const DEBUG_KEY = 'debug:coffee'

export type CoffeeRecord = {
  at: number
  /** What wrote it: a main-chat turn ending, or the engine's measure that follows it (which carries the turn's own context reading). */
  by: 'turn' | 'measure'
  contextTokens: number | null
  /** The token count from which the button may show (the 300k mark, or 90% of the engine's own compaction point). */
  threshold: number
  autoCompactAt: number | null
  isBusy: boolean
  atWorkCount: number
  handedBackAt: number | null
  turns: number
  isCheckpoint: boolean
  carriedAt: number | null
  /** The origin kind of the person's latest message (`none` where the engine named none); null before any. */
  spokeBy: string | null
  demo: boolean
  /** The button (or its working word) is on the pane right now. */
  shown: boolean
}

export type CoffeeDebugIo = {
  now: () => Promise<number>
  data: () => Promise<Pick<PanelData, 'boss' | 'staff' | 'fx' | 'gauge'>>
  save: (key: string, value: CoffeeRecord) => Promise<unknown>
}

export function coffeeRecord(data: Pick<PanelData, 'boss' | 'staff' | 'fx' | 'gauge'>, at: number, by: CoffeeRecord['by']): CoffeeRecord {
  const { boss, staff, fx, gauge } = data
  return {
    at, by, contextTokens: tokensOf(gauge) ?? null, threshold: triggerAt(gauge), autoCompactAt: gauge.autoCompactAt ?? null,
    isBusy: boss.isBusy, atWorkCount: atWork(staff).length, handedBackAt: boss.handedBackAt ?? null, turns: boss.turns,
    isCheckpoint: boss.isCheckpoint === true, carriedAt: boss.carriedAt ?? null, spokeBy: boss.spokeBy ?? null,
    demo: fx.demo !== undefined, shown: coffeeView(data).state !== 'hidden',
  }
}

/** Writes the record over the last. A diagnostic must never stop a turn or a hook, so a read or a write that fails leaves the old record and nothing else. */
export async function keepCoffeeRecord(io: CoffeeDebugIo, by: CoffeeRecord['by']): Promise<void> {
  try {
    await io.save(DEBUG_KEY, coffeeRecord(await io.data(), await io.now(), by))
  } catch { /* the last record stays; this is only a way to look */ }
}
