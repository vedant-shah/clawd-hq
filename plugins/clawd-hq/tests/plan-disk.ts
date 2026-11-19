// An in-memory project folder for the plan tests: the file calls the plan makes (`disk`), and the same files as the host answers them (`planFs`).
import type { PlanIo } from '../hooks/plan-io'

export const ROOT = '/repo'
export const DIR = `${ROOT}/.clawd-hq/plans`
export const FILE = `${DIR}/fix-login.md`
/** A plan file saved before plan files named their session: no one owns it. */
export const LEGACY = '# Fix login\n\n- [ ] Find the bug  <!-- s1 -->\n- [ ] Fix it  <!-- s2 -->\n'
/** The same plan, started by session `s1` (the session the tests' offices have unless they say another). */
export const BASE = `${LEGACY}<!-- session: s1 -->\n`

/**
 * A project folder in memory. Folders are what files lie in; `links` makes a path lead somewhere else (as `stat` and `list` tell it);
 * `listAs` changes how `list` names an entry; `extra` adds entries to a listing that no file stands behind.
 */
export function disk(files: Record<string, string> = {}) {
  const held = new Map(Object.entries(files))
  const writes: Array<{ path: string; text: string }> = []
  const notes: string[] = []
  const calls: string[] = []
  const fail = { exists: false, read: new Set<string>(), write: false, list: false, stat: false, debug: false }
  const mtimes = new Map<string, number>()
  const links = new Map<string, string>()
  const listAs = new Map<string, { kind: string; isLink?: boolean }>()
  const extra: Array<{ name: string; kind: string; isLink?: boolean }> = []
  // A few turns of the event loop, so two calls made at once would overlap if nothing queued them.
  const later = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve() }
  const isDir = (path: string) => path === ROOT || [...held.keys()].some(k => k.startsWith(`${path}/`))
  const io: PlanIo = {
    exists: async path => { calls.push(`exists ${path}`); if (fail.exists) throw new Error('the check failed'); return held.has(path) || isDir(path) },
    read: async path => { calls.push(`read ${path}`); await later(); if (fail.read.has(path)) throw new Error('too big to read'); const t = held.get(path); if (t === undefined) throw new Error('ENOENT'); return t },
    write: async (path, text) => { calls.push(`write ${path}`); await later(); if (fail.write) throw new Error('EACCES'); writes.push({ path, text }); held.set(path, text) },
    list: async path => {
      calls.push(`list ${path}`)
      if (fail.list) throw new Error('cannot list')
      const named = [...held.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(k => ({ name: k.slice(path.length + 1), kind: 'file', size: held.get(k)!.length, ...listAs.get(k) }))
      return [...named, ...extra]
    },
    stat: async path => {
      calls.push(`stat ${path}`)
      if (fail.stat) throw new Error('stat failed')
      if (!held.has(path) && !isDir(path)) throw new Error('ENOENT')
      return { kind: held.has(path) ? 'file' : 'dir', mtimeMs: mtimes.get(path) ?? 0, isLink: links.has(path), realPath: links.get(path) ?? path }
    },
    debug: async note => { if (fail.debug) throw new Error('the record failed'); notes.push(note) },
  }
  return { io, held, writes, notes, calls, fail, mtimes, links, listAs, extra }
}


type On = Parameters<typeof import('./host').host>[0]

/**
 * The host's answers to `fs.stat` and `fs.list` for the files a scenario test keeps in `files` (the host already answers exists, read and
 * write from the same map): every file is plain and lies where it says, and the folders are the ones the files stand in.
 */
export function planFs(on: On, files: Map<string, string>) {
  const isDir = (path: string) => path === ROOT || [...files.keys()].some(k => k.startsWith(`${path}/`))
  on('fs.stat', (_$, e) => {
    const path = (e as { path: string }).path
    if (!files.has(path) && !isDir(path)) throw new Error('ENOENT')
    return { value: { kind: files.has(path) ? 'file' : 'dir', size: files.get(path)?.length ?? 0, mtimeMs: 0, isLink: false, realPath: path } } as never
  })
  on('fs.list', (_$, e) => {
    const path = String((e as { path?: string }).path ?? '')
    const names = [...files.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/'))
    return { value: names.map(k => ({ name: k.slice(path.length + 1), kind: 'file', size: files.get(k)!.length, mtimeMs: 0, isLink: false })) } as never
  })
}
