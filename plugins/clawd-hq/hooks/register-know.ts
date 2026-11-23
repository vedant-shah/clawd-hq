// "You should know" (hooks/know-check.ts): what it may do is spelled here, each a `$` call.
import type { EngineInterface, On } from 'claude-code'

import type { KnowState } from '../types'
import { isWatching } from './know-check'
import type { KnowIo } from './know-check'
import { KNOW0, QUIET_FORK, isBuiltinKnow } from './know'
import type { BriefingOptions } from './instructions'
import { logNote } from './register-history'
import { readKnow, updateKnow } from './register-state'

export function knowIo($: EngineInterface): KnowIo {
  return {
    now: () => $.clock.now(),
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value as never),
    surfaces: () => $.session.surfaces(),
    panes: () => $.ui.panes(),
    messages: agentId => $.session.messages({ agentId }),
    // DECIDED: no effort named. The session's own level rides along, so the fork reads the main thread's cache on every model;
    // naming another level can cost a cache write of the whole conversation (types/claude-code ModelForkRequest).
    fork: prompt => $.model.fork({ prompt }),
    readPrompt: file => $.fs.read(`${$.plugin.root}/${file}`),
    after: (ms, fn) => $.clock.after(ms, fn),
    card: async (): Promise<KnowState> => ({ ...KNOW0, ...(await readKnow($)) }),
    setCard: fn => updateKnow($, s => fn({ ...KNOW0, ...s })),
    fillPrompt: text => $.prompt.fill({ text, mode: 'append' }),
    noted: (agentId, tag) => logNote($, agentId, tag),
  }
}

export function registerKnow(on: On, brief: BriefingOptions) {
  // While ours is on and an office tab is open, Claude Code's own "You should know" stays quiet; every other side question passes, ours too.
  on('model.fork', async ($, e, next) => (brief.isKnowOn && isBuiltinKnow(next.origin) && (await isWatching(knowIo($))) ? { value: QUIET_FORK } : next(e)))
  // A compaction of the main chat holds the next check (register-coffee.ts has the one hook on it, and calls `knowCompacted`).
}
