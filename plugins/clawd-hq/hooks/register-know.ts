// "You should know": the check on finished work (hooks/know-check.ts). What it may do is spelled here, each a `$` call.
import type { EngineInterface, On } from 'claude-code'

import type { KnowState } from '../types'
import { isWatching } from './know-check'
import type { KnowIo } from './know-check'
import { KNOW0, QUIET_FORK, isBuiltinKnow } from './know'
import type { BriefingOptions } from './instructions'
import { readKnow, updateKnow } from './register-state'

export function knowIo($: EngineInterface): KnowIo {
  return {
    now: () => $.clock.now(),
    get: key => $.store.get(key),
    set: (key, value) => $.store.set(key, value as never),
    surfaces: () => $.session.surfaces(),
    panes: () => $.ui.panes(),
    messages: agentId => (agentId === undefined ? $.session.messages() : $.session.messages({ agentId })),
    complete: ask => $.model.complete(ask),
    card: async (): Promise<KnowState> => ({ ...KNOW0, ...(await readKnow($)) }),
    setCard: fn => updateKnow($, s => fn({ ...KNOW0, ...s })),
    fillPrompt: text => $.prompt.fill({ text, mode: 'append' }),
  }
}

export function registerKnow(on: On, brief: BriefingOptions) {
  // While ours is on and an office tab is open, Claude Code's own "You should know" stays quiet; every other side question passes.
  on('model.fork', async ($, e, next) => (brief.isKnowOn && isBuiltinKnow(next.origin) && (await isWatching(knowIo($))) ? { value: QUIET_FORK } : next(e)))
}
