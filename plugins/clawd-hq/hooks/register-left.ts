// Left undone (hooks/left-io.ts): work put off, kept per project folder.
import type { EngineInterface, On } from 'claude-code'

import { FILE_TOOLS, leftWatch } from './left-io'
import type { LeftIo } from './left-io'
import { byOf } from './register-io'
import { knowIo } from './register-know'
import { ses, updateLeftUndone } from './register-state'

/** The Do it now button reuses the heads-up card's prompt fill. */
export function leftIo($: EngineInterface): LeftIo {
  return {
    folder: () => ses.cwd, now: () => $.clock.now(), change: fn => updateLeftUndone($, fn), save: (folder, list) => $.store.set(`leftUndone:${folder}`, list),
    read: path => $.fs.read(path), complete: ask => $.model.complete(ask), fillPrompt: text => knowIo($).fillPrompt(text), byOf: id => byOf($, id), get: key => $.store.get(key), set: (key, value) => $.store.set(key, value),
  }
}

export function registerLeft(on: On) {
  // Unfinished-work lines Claude or a specialist writes into files (TODO, a skipped test, "not implemented") join Left undone.
  for (const tool of FILE_TOOLS) on('tool.call', { tool: tool as 'Edit' }, ($, e, next) => leftWatch(leftIo($), e as never, () => next(e))) // MultiEdit is no declared tool name, but the engine runs one if a build has it
}
