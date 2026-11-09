// The coffee break (hooks/coffee-break.ts) and the header readings that decide when its button shows.
import type { EngineInterface, On } from 'claude-code'

import { isBreakTime, isPersonCompact, tokensOf, whileCompacting, withFreshReading, withoutCoffee } from './coffee-break'
import type { CoffeeIo } from './coffee-break'
import { withNewWork } from './checkpoint'
import { keepCoffeeRecord } from './coffee-debug'
import type { CoffeeDebugIo } from './coffee-debug'
import { limitsOf } from './meters'
import { getBoss, getFx, readGauge, readStaff, setBoss, setFx, updateGauge } from './register-state'
import { contextOf } from './usage'

/** The coffee break button (hooks/coffee-break.ts). Where the engine has no compact call (the desktop app can bundle 2.1.295), calling it fails and the command is put in the prompt box instead. */
export function coffeeIo($: EngineInterface): CoffeeIo {
  return {
    now: () => $.clock.now(), after: (ms, fn) => $.clock.after(ms, fn),
    isBreak: async () => isBreakTime(await getBoss($), await readStaff($), await getFx($)),
    ask: prompt => $.model.fork({ prompt }), // the note's one short question, on the cached chat
    compact: args => $.session.compact(args),
    promptRead: () => $.prompt.read(), fill: text => $.prompt.fill({ text, mode: 'append' }),
    setNote: async note => { const { turns } = await getBoss($); await setFx($, f => ({ ...f, coffee: note && { ...note, turns } })) },
    clearReading: async () => { await setBoss($, withNewWork); await updateGauge($, g => ({ ...g, contextPercent: undefined, contextTokens: undefined })) }, // a compaction ends the checkpoint too
    tokens: async () => tokensOf(await readGauge($)),
  }
}
/** Another conversation takes over: the coffee note (the mug, the wait for a fresh reading) was the last one's. */
export async function forgetCoffee($: EngineInterface) { const f = await getFx($); if (withoutCoffee(f) !== f) await setFx($, withoutCoffee) }

/** The record of why the coffee break button shows or not (hooks/coffee-debug.ts), kept at `debug:coffee` in the store. */
export function coffeeDebugIo($: EngineInterface): CoffeeDebugIo {
  return {
    now: () => $.clock.now(), save: (key, value) => $.store.set(key, value),
    data: async () => ({ boss: await getBoss($), staff: await readStaff($), fx: await getFx($), gauge: await readGauge($) }),
  }
}

export function registerCoffee(on: On) {
  // The header's context bar and limit countdowns follow the engine's own readings.
  on('session.measure', async ($, e, next) => {
    await updateGauge($, g => ({ ...g, ...contextOf(e.context), limits: limitsOf(e.rateLimits) }))
    const [measured, effects] = [await readGauge($), await getFx($)] // a reading of the chat after a compaction lets the button back (hooks/coffee-break.ts)
    if (withFreshReading(effects, measured) !== effects) await setFx($, f => withFreshReading(f, measured))
    void keepCoffeeRecord(coffeeDebugIo($), 'measure') // the reading of the turn that just ended, which the turn's own record could not have yet
    return next(e)
  })

  // The person's own /compact (typed, or the one the coffee break button filled): Clawd drinks while it runs, and a while after it stands.
  on('session.compact', async ($, e, next) => (isPersonCompact(e) ? whileCompacting(coffeeIo($), () => next(e)) : next(e)))
}
