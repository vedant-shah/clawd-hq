// Clawd's instructions: the person's own copies live in the home folder (hooks/instructions.ts). Also the profile from setup, which rides with them.
import type { EngineInterface, On } from 'claude-code'

import { readFailed, readFailedLine, refreshClawd } from './clawd-edit'
import type { ClawdIo } from './clawd-edit'
import { SECTION_ID, SEED_KEYS, isBriefed, readBriefing } from './instructions'
import type { BriefingIo, BriefingOptions } from './instructions'
import { PROFILE_KEY } from './onboard-types'
import type { Profile } from './onboard-types'
import { PROFILE_BLOCK, profileBlock } from './profile'
import { BYPASS_KEY, fallbackText, isFallbackDue, judged, withCompose, withSent } from './rules-reach'
import { getBoss, readClawdBrief, ses, setBoss, updateClawdBrief } from './register-state'
import { BRIEF0, reasonOf } from './state'

/** File calls do not expand `~`: the home folder by name, '' when the process has none. */
export async function homeOf($: EngineInterface) { return ((await $.env.get("HOME").catch(() => undefined)) || (await $.env.get("USERPROFILE").catch(() => undefined)) || '').replace(/[\\/]+$/, '') }

export function briefIo($: EngineInterface, home: string, warn: (text: string) => void): BriefingIo {
  return {
    root: $.plugin.root, home, warn, read: path => $.fs.read(path), exists: path => $.fs.exists(path),
    seed: async part => { const v = await $.store.get(SEED_KEYS[part]); return typeof v === 'string' ? v : undefined },
  }
}

/** This session's briefing. Set before anything is awaited, so requests made at the same moment share one read (and one warning). */
export function briefingOf($: EngineInterface, opts: BriefingOptions) {
  return (ses.briefing ??= homeOf($).then(home => readBriefing(briefIo($, home, text => void $.ui.toast(text)), opts)))
}

/** The rules (and the profile from setup) for a prompt, where the system prompt hook has not run: once per conversation. */
export async function rulesRide($: EngineInterface, opts: BriefingOptions, e: { text: string; command?: unknown }): Promise<string[]> {
  if (!opts.isOn || e.command !== undefined || e.text.trimStart().startsWith('/') || !isFallbackDue(ses.reach, ses.wasBypassed)) return []
  const { text } = await briefingOf($, opts)
  if (text === undefined) return []
  ses.reach = withSent(ses.reach)
  return [fallbackText(text, profileBlock((await $.store.get(PROFILE_KEY).catch(() => undefined)) as Profile | undefined))]
}

/** After a main chat request: what this machine does with the system prompt is kept, and Clawd's card warns when the rules were missing. */
export async function judgeReach($: EngineInterface) {
  const { isLost, bypassed } = judged(ses.reach, ses.wasBypassed)
  if (bypassed !== undefined) { ses.wasBypassed = bypassed; await $.store.set(BYPASS_KEY, bypassed) }
  if ((await getBoss($)).isRulesLost !== isLost) await setBoss($, b => ({ ...b, isRulesLost: isLost }))
}

/** The calls behind the buttons for Clawd's instructions in the Settings tab (hooks/clawd-edit.ts). The prompt box is filled after what is there, never sent. */
export async function clawdIo($: EngineInterface, opts: BriefingOptions): Promise<ClawdIo> {
  return {
    isOn: opts.isOn, voiceFile: opts.voiceFile, briefing: briefIo($, await homeOf($), () => undefined),
    loaded: () => (ses.briefing ?? Promise.resolve(undefined)).catch(() => undefined),
    write: (path, text) => $.fs.write(path, text), setSeed: (part, text) => $.store.set(SEED_KEYS[part], text),
    promptRead: () => $.prompt.read(), fill: text => $.prompt.fill({ text, mode: 'append' }),
    get: async () => ({ ...BRIEF0, ...(await readClawdBrief($)) }), set: fn => updateClawdBrief($, b => fn({ ...BRIEF0, ...b })),
  }
}

/** The tab follows the files. A read that fails is an amber line in the tab with why (a toast if even that fails); it never stops the hook that asked. */
export function refreshTab($: EngineInterface, opts: BriefingOptions, isFresh: boolean) {
  return clawdIo($, opts).then(io => refreshClawd(io, isFresh))
    .catch((err: unknown) => updateClawdBrief($, b => readFailed({ ...BRIEF0, ...b }, err))).catch((err: unknown) => $.ui.toast(readFailedLine(reasonOf(err))))
}

export function registerRules(on: On, brief: BriefingOptions) {
  // Clawd's rules and voice join the main chat's instructions: read once a session (and again after /clear), then the same text on every request, so the prompt cache holds.
  // A plugin seated outermost can send this event past ours (hooks/rules-reach.ts): the rules then ride with a prompt instead.
  on('prompt.compose', async ($, e, next) => {
    const base = await next(e)
    if (!brief.isOn || !isBriefed(e.traits)) return base
    const { text } = await briefingOf($, brief)
    ses.reach = withCompose(ses.reach, text !== undefined)
    return text === undefined ? base : { sections: [...base.sections, { id: SECTION_ID, scope: 'session', text } as const] }
  })

  // Who the person is, from setup, rides at the top of every conversation.
  on('prompt.context', async ($, e, next) => {
    const r = await next(e)
    const profile = profileBlock((await $.store.get(PROFILE_KEY).catch(() => undefined)) as Profile | undefined)
    return profile ? { ...r, blocks: [...r.blocks, { name: PROFILE_BLOCK, text: profile }] } : r
  })
}
