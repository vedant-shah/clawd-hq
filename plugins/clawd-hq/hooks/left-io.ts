// Left undone, the work (no `$`): what each source adds to the list, and the two buttons. register.tsx holds the list's
// atom and the hooks and hands in what each call may do as `LeftIo`; the pure parts are in left-scan.ts, left-list.ts and left-check.ts.
import type { ModelCompleteResult } from 'claude-code'
import type { LeftItem } from '../types'
import { fit } from './desk'
import { CHECK_MAX_TOKENS, CHECK_MODEL, CHECK_TIMEOUT_MS, checkAsk, leftStart as resetCheck, parseUndone, takeCheck } from './left-check'
import { cleanLeft, promptOf, withLeft } from './left-list'
import type { FreshItem } from './left-list'
import { deferredIn, linesWritten } from './left-scan'
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

// ---- Source 1: the final answer ----

async function fromAnswer(io: LeftIo, folder: string, e: { reason: string; answer: string }, by: string) {
  if (e.reason !== 'answer') return
  await add(io, folder, deferredIn(e.answer).map((text): FreshItem => ({ text, source: 'answer', by })))
}

/** A specialist handed its report back: the deferring sentences in it join the list under its name. Never throws. */
export async function leftAnswer(io: LeftIo, e: { reason: string; answer: string }, by: string) {
  await fromAnswer(io, io.folder(), e, by).catch(() => undefined)
}

// ---- Source 2: unfinished-work lines written into files ----

/** A file tool's call as the hook hears it: the tool, who made it, and its input. */
export type WriteCall = { tool: string; agentId?: string } & Record<string, unknown>

const pathOf = (call: WriteCall) => [call.file_path, call.notebook_path].find((p): p is string => typeof p === 'string' && p !== '')

/** The path as shown: from the project folder when it lies inside it. */
function shownPath(path: string, folder: string): string {
  const inside = folder !== '' && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path
  return fit(plainText(inside), 200)
}

/** The line a hit landed on: a Write knows it; an edit's is found by looking for the text in the file as it is now. A notebook's cell has none. */
function lineOf(tool: string, hit: FileHit, now: string | undefined): number | undefined {
  if (tool === 'Write') return hit.line
  const at = tool === 'NotebookEdit' || now === undefined ? -1 : now.split(/\r?\n/).findIndex(line => line.includes(hit.text))
  return at < 0 ? undefined : at + 1
}

async function fromFile(io: LeftIo, call: WriteCall, path: string, before: string) {
  const folder = io.folder()
  const hits = linesWritten(call.tool, call, before)
  if (hits.length === 0) return
  const [by, now] = [call.agentId === undefined ? 'Clawd' : await io.byOf(call.agentId), call.tool === 'Write' ? undefined : await io.read(path).catch(() => undefined)]
  const file = shownPath(path, folder)
  await add(io, folder, hits.map((hit): FreshItem => {
    const line = lineOf(call.tool, hit, now)
    return { text: hit.text, source: 'file', by, file, ...(line === undefined ? {} : { line }) }
  }))
}

/**
 * Wraps one call to a file tool. A Write is read against the file as it was; once the call has gone through (a refusal or an
 * error counts for nothing), the lines it wrote are looked at, not waited for. The tool's own answer is returned as it came.
 */
export async function leftWatch<R>(io: LeftIo, call: WriteCall, run: () => Promise<R>): Promise<R> {
  const path = pathOf(call)
  const before = path !== undefined && call.tool === 'Write' ? await io.read(path).catch(() => '') : ''
  const ran = await run()
  const answer = (ran ?? {}) as { deny?: unknown; isError?: unknown }
  if (path !== undefined && answer.deny === undefined && !answer.isError) void fromFile(io, call, path, before).catch(() => undefined)
  return ran
}

// ---- Source 3: the second check, and the end of Clawd's own turn ----

/** The one question to the small model; what it lists joins the list. Whatever goes wrong, nothing is added. */
async function runCheck(io: LeftIo, folder: string, job: { request: string; report: string }) {
  const ask = checkAsk(job.request, job.report)
  const reply = await io.complete({ model: CHECK_MODEL, system: ask.system, prompt: ask.prompt, maxTokens: CHECK_MAX_TOKENS, timeoutMs: CHECK_TIMEOUT_MS })
  if (!reply.isAnswered) return
  await add(io, folder, parseUndone(reply.text).map((text): FreshItem => ({ text, source: 'check', by: 'Clawd' })))
}

/**
 * Clawd's own turn ended: its answer is read for deferring sentences, and, when `isCheckOn` and the turn used five tools or
 * more without handing work to a specialist, a check joins the line of background questions to the model. Never throws.
 */
export async function leftOwnTurn(io: LeftIo, e: { reason: string; answer: string }, isCheckOn: boolean) {
  const [folder, job] = [io.folder(), takeCheck(e)]
  if (isCheckOn && job) side.queue(() => runCheck(io, folder, job).catch(() => undefined))
  await fromAnswer(io, folder, e, 'Clawd').catch(() => undefined)
}
