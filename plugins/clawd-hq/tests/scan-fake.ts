// A fake folder for the scan tests: files by absolute path, listed and read the way OnboardIo does.
import type { CommandEntry, FsListEntry, UsageBreakdown } from '../hooks/onboard-types'

export type FakeOver = {
  readonly cwd?: string
  readonly home?: string
  readonly configDir?: string
  readonly sizes?: Readonly<Record<string, number>>
  readonly times?: Readonly<Record<string, number>>
  readonly breakdown?: UsageBreakdown
  readonly commands?: readonly CommandEntry[]
  readonly blurbs?: Readonly<Record<string, string>>
  /** The plugin's own store, by key. */
  readonly store?: Readonly<Record<string, unknown>>
}

type Listed = FsListEntry & { readonly mtimeMs?: number }

/** The closures the scan modules take, over `files` (absolute path to text). Also counts reads and lists. */
export function fakeScan(files: Readonly<Record<string, string>>, over: FakeOver = {}) {
  const log = { reads: [] as string[], lists: [] as string[] }
  const paths = Object.keys(files)
  const children = (dir: string): readonly Listed[] => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    const names = new Map<string, boolean>()
    for (const p of paths) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash < 0 ? rest : rest.slice(0, slash)
      names.set(name, (names.get(name) ?? false) || slash >= 0)
    }
    return [...names].map(([name, isDir]) => {
      const full = `${prefix}${name}`
      return { name, isDir, size: isDir ? 0 : over.sizes?.[full] ?? files[full]?.length ?? 0, mtimeMs: over.times?.[full] ?? 0 }
    })
  }
  const io = {
    cwd: over.cwd ?? '/work/proj',
    home: () => over.home ?? '/home/me',
    configDir: () => over.configDir,
    list: async (dir: string) => {
      log.lists.push(dir)
      const found = children(dir)
      if (found.length === 0) throw new Error(`no such folder ${dir}`)
      return found
    },
    read: async (path: string) => {
      log.reads.push(path)
      return files[path]
    },
    exists: async (path: string) => path in files || children(path).length > 0,
    breakdown: async () => over.breakdown,
    commands: async () => over.commands ?? [],
    blurbs: () => over.blurbs ?? {},
    get: async <T>(key: string) => over.store?.[key] as T | undefined,
    set: async (): Promise<void> => undefined,
  }
  return { io, log }
}
