// Left undone, the work (no `$`): what each source adds to the list, and the two buttons. register.tsx holds the list's
// atom and the hooks and hands in what each call may do as `LeftIo`; the pure parts are in left-scan.ts, left-list.ts and left-check.ts.
import type { ModelCompleteResult } from 'claude-code'
import type { LeftItem } from '../types'
import { fit } from './desk'
import { CHECK_MAX_TOKENS, CHECK_MODEL, CHECK_TIMEOUT_MS, checkAsk, leftStart as resetCheck, parseUndone, takeCheck } from './left-check'
import { cleanLeft, promptOf, withLeft } from './left-list'
import type { FreshItem } from './left-list'
import { isProjectCode, linesWritten } from './left-scan'
import type { FileHit } from './left-scan'
import { plainText } from './know'
import { side } from './side-ask'
import { inLine } from './state'

// What register.tsx's hooks need besides the work below, in one import.
export { leftAsked, leftToolUsed, leftTurnStart } from './left-check'
export { FILE_TOOLS } from './left-scan'

/** A session starts: the turn and the request being counted start over, and the stored list is read as a clean one. */
export function leftStart(raw: unknown): LeftItem[] {
  resetCheck()
  return cleanLeft(raw)
}

/** What the list may do, each one a `$` call made in register.tsx. */
export type LeftIo = {
  folder: () => string
  now: () => Promise<number>
  /** The list as it stands when the write lands: the change is made on that, so changes made at the same moment all land. */
  change: (fn: (list: LeftItem[]) => LeftItem[]) => Promise<LeftItem[]>
  save: (folder: string, list: LeftItem[]) => Promise<unknown>
  read: (path: string) => Promise<string>
  complete: (ask: { model: string; system: string; prompt: string; maxTokens: number; timeoutMs: number }) => Promise<ModelCompleteResult>
  /** Puts text after what is in the person's prompt box; never sends it. */
  fillPrompt: (text: string) => Promise<unknown>
  /** The name an agent is filed under. */
  byOf: (agentId: string) => Promise<string>
}

export type LeftActions = { leftDo: (id: string) => unknown; leftClear: () => unknown }

/** One change to the list, made on the list as it stands when its turn comes and saved under the folder. A project that changed meanwhile is not written to; a save that fails is let go (the list stays for the session, and nothing is shown). */
function commit(io: LeftIo, folder: string, fn: (list: LeftItem[]) => LeftItem[]) {
  return inLine(async () => {
    if (io.folder() !== folder) return
    const next = await io.change(fn)
    if (folder) await io.save(folder, next).catch(() => undefined)
  })
}

async function add(io: LeftIo, folder: string, fresh: readonly FreshItem[]) {
  if (fresh.length === 0) return
  const at = await io.now()
  await commit(io, folder, list => withLeft(list, fresh, at))
}

/** The buttons: Do it now puts the item's sentence in the prompt box (and keeps the item); Clear empties the list. */
export function leftActions(io: LeftIo): LeftActions {
  return {
    leftDo: async id => {
      const item = (await io.change(list => list)).find(one => one.id === id)
      if (item) await io.fillPrompt(promptOf(item))
    },
    leftClear: () => commit(io, io.folder(), () => []),
  }
}

/**
 * A specialist handed its report back. Nothing is read from an answer any more (phrase matching listed descriptions of the
 * work as if they were unfinished work); this stays so register.tsx's call to it still holds, and does nothing.
 */
export function leftAnswer(_io: LeftIo, _e: { reason: string; answer: string }, _by: string): Promise<void> {
  return Promise.resolve()
}

// ---- Source 1: unfinished-work lines written into code files ----

/** A file tool's call as the hook hears it: the tool, who made it, and its input. */
export type WriteCall = { tool: string; agentId?: string } & Record<string, unknown>

const pathOf = (call: WriteCall) => (typeof call.file_path === 'string' && call.file_path !== '' ? call.file_path : undefined)

/** The path from the project folder, when the file lies inside it and is a code file outside docs/ and node_modules/; otherwise nothing. */
function codePath(path: string, folder: string): string | undefined {
  const root = folder.replace(/[\\/]+$/, '')
  const relative = root !== '' && path.startsWith(`${root}/`) ? fit(plainText(path.slice(root.length + 1)), 200) : undefined
  return relative !== undefined && isProjectCode(relative) ? relative : undefined
}

/** The line a hit landed on: a Write knows it; an edit's is found by looking for the text in the file as it is now. */
function lineOf(tool: string, hit: FileHit, now: string | undefined): number | undefined {
  if (tool === 'Write') return hit.line
  const at = now === undefined ? -1 : now.split(/\r?\n/).findIndex(line => line.includes(hit.text))
  return at < 0 ? undefined : at + 1
}

async function fromFile(io: LeftIo, call: WriteCall, path: string, file: string, before: string) {
  const hits = linesWritten(call.tool, call, before)
  if (hits.length === 0) return
  const [by, now] = [call.agentId === undefined ? 'Clawd' : await io.byOf(call.agentId), call.tool === 'Write' ? undefined : await io.read(path).catch(() => undefined)]
  await add(io, io.folder(), hits.map((hit): FreshItem => {
    const line = lineOf(call.tool, hit, now)
    return { text: hit.text, source: 'file', by, file, ...(line === undefined ? {} : { line }) }
  }))
}

/**
 * Wraps one call to a file tool. Only a code file inside the project is looked at. A Write is read against the file as it was;
 * once the call has gone through (a refusal or an error counts for nothing), the lines it wrote are looked at, not waited for.
 * The tool's own answer is returned as it came.
 */
export async function leftWatch<R>(io: LeftIo, call: WriteCall, run: () => Promise<R>): Promise<R> {
  const path = pathOf(call)
  const file = path === undefined ? undefined : codePath(path, io.folder())
  if (path === undefined || file === undefined) return run()
  const before = call.tool === 'Write' ? await io.read(path).catch(() => '') : ''
  const ran = await run()
  const answer = (ran ?? {}) as { deny?: unknown; isError?: unknown }
  if (answer.deny === undefined && !answer.isError) void fromFile(io, call, path, file, before).catch(() => undefined)
  return ran
}

// ---- Source 2: the strict second check, and the end of Clawd's own turn ----

/** The one question to the small model; what it lists joins the list. Whatever goes wrong, nothing is added. */
async function runCheck(io: LeftIo, folder: string, job: { request: string; report: string }) {
  const ask = checkAsk(job.request, job.report)
  const reply = await io.complete({ model: CHECK_MODEL, system: ask.system, prompt: ask.prompt, maxTokens: CHECK_MAX_TOKENS, timeoutMs: CHECK_TIMEOUT_MS })
  if (!reply.isAnswered) return
  await add(io, folder, parseUndone(reply.text).map((text): FreshItem => ({ text, source: 'check', by: 'Clawd' })))
}

/**
 * Clawd's own turn ended. When `isCheckOn` and the turn used five tools or more without handing work to a specialist, a check
 * of his final report joins the line of background questions to the model. His answer is judged only by that check. Never throws.
 */
export function leftOwnTurn(io: LeftIo, e: { reason: string; answer: string }, isCheckOn: boolean): Promise<void> {
  const [folder, job] = [io.folder(), takeCheck(e)]
  if (isCheckOn && job) side.queue(() => runCheck(io, folder, job).catch(() => undefined))
  return Promise.resolve()
}
