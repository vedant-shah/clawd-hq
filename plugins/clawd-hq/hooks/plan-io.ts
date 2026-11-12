// The plan files, the work (no `$`): the calls that read and write `<project>/.clawd-hq/plans/<slug>.md`. It follows `appendRule`
// (hooks/rule-io.ts): a file that could not be read is never written to, the file's own line breaks are kept, writes go one at a time
// through `inLine`, and each change is made on the file as it is when the write is about to land.
// `inLine` orders the writes of THIS process only. Another Claude Code session on the same folder is not held back by it: it can write
// between our read and our write, and then its change is lost. Re-reading right before each write keeps that window short; it does not
// close it. Two goals in two sessions use two files for that reason.
// A failure comes back as its reason, never thrown, and leaves a debug record. Only plain files inside the project's own plans folder
// are read or written: a link, or a folder that leads elsewhere, is refused. The register-*.ts files will hand in `PlanIo` (Phase 2).
import { applyOp, startPlan, viewOf } from './plan'
import type { PlanOp, PlanView } from './plan'
import { parsePlanFile, serialisePlanFile } from './plan-file'
import { inLine, reasonOf } from './state'

/**
 * The file calls the plan needs. `stat` is `$.fs.stat(path, { resolve: true })`. `debug` takes one line for the debug record (what
 * failed and why, never the person's words). There is no mkdir: `$.fs.write` creates the folders it needs (see the fs types, "Writes
 * `text` to a file, creating it and its directories as needed").
 */
export type PlanIo = {
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<ReadonlyArray<{ name: string; kind: string; isLink?: boolean }>>
  stat: (path: string) => Promise<{ kind: string; mtimeMs: number; isLink: boolean; realPath?: string }>
  debug: (note: string) => Promise<unknown>
}

export type PlanSaved = { ok: true; slug: string; plan: PlanView } | { ok: false; reason: string }
type Refused = { ok: false; reason: string }

const NO_FOLDER = 'there is no project folder to keep a plan in.'
const OUTSIDE = 'The plans folder does not lie inside the project (it is a link to somewhere else), so it was left alone.'
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The folder of plan files, in the project. */
export const plansDir = (root: string) => `${root.replace(/[\\/]+$/, '')}/.clawd-hq/plans`
const fileOf = (root: string, slug: string) => `${plansDir(root)}/${slug}.md`
const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** Writes a line in the debug record; a record that cannot be written changes nothing. */
async function note(io: PlanIo, line: string): Promise<void> {
  try {
    await io.debug(line)
  } catch { /* the record is only a way to look */ }
}

/** A failed call, as the answer and as a record. */
async function failed(io: PlanIo, what: string, err: unknown): Promise<Refused> {
  const reason = `Could not ${what}: ${reasonOf(err)}`
  await note(io, `plan: ${reason}`)
  return { ok: false, reason }
}

/**
 * Where the plans folder really is, or why it may not be used. The project folder, `.clawd-hq` and `plans` are each looked up with their
 * links followed; each that exists must lie where its name says, inside the project. A folder that is not there yet is fine: the write makes it.
 */
async function placeOf(io: PlanIo, root: string): Promise<{ ok: true; dir: string } | Refused> {
  const base = (await io.stat(root)).realPath
  if (base === undefined) return { ok: false, reason: 'The project folder could not be placed, so the plans were left alone.' }
  const inside = norm(base)
  for (const sub of ['.clawd-hq', '.clawd-hq/plans']) {
    const path = `${norm(root)}/${sub}`
    if (!(await io.exists(path))) break
    const real = (await io.stat(path)).realPath
    if (real === undefined || norm(real).toLowerCase() !== `${inside}/${sub}`.toLowerCase()) return { ok: false, reason: OUTSIDE }
  }
  return { ok: true, dir: `${inside}/.clawd-hq/plans` }
}

/** The modified time of a plain file that lies in the plans folder; nothing for a link, a folder, or a path that leads elsewhere. */
async function plainFile(io: PlanIo, dir: string, path: string, name: string): Promise<{ mtimeMs: number } | undefined> {
  const s = await io.stat(path)
  const isPlain = s.kind === 'file' && !s.isLink && s.realPath !== undefined && norm(s.realPath).toLowerCase() === `${dir}/${name}`.toLowerCase()
  return isPlain ? { mtimeMs: s.mtimeMs } : undefined
}

/** The slugs of the plan files there are, in lower case; none when the folder is not there yet. */
async function takenSlugs(io: PlanIo, dir: string): Promise<string[]> {
  if (!(await io.exists(dir))) return []
  return (await io.list(dir)).filter(one => one.name.endsWith('.md')).map(one => one.name.slice(0, -3).toLowerCase())
}

/**
 * Makes a new plan file and answers with the plan. One goal only: `hasCurrent` is asked inside the queue, when this start's turn comes,
 * so two starts at the same moment cannot both pass it (give it the live state; it may read the folder). Nothing is written when the
 * folder cannot be listed, since the name could clash with a plan already there.
 */
export function startGoal(io: PlanIo, root: string, input: { goal: unknown; steps: readonly unknown[]; hasCurrent: () => boolean | Promise<boolean> }): Promise<PlanSaved> {
  return inLine(async (): Promise<PlanSaved> => {
    let doing = 'start the plan'
    try {
      const hasCurrent = await input.hasCurrent()
      const asked = startPlan({ ...input, hasCurrent, taken: [] })
      if (!asked.ok) return asked
      if (root === '') return { ok: false, reason: `Cannot start: ${NO_FOLDER}` }
      doing = 'look in the plans folder'
      const place = await placeOf(io, root)
      if (!place.ok) return place
      const made = startPlan({ ...input, hasCurrent, taken: await takenSlugs(io, plansDir(root)) })
      if (!made.ok) return made
      const path = fileOf(root, made.slug)
      doing = 'write the plan file'
      if (await io.exists(path)) return { ok: false, reason: 'A plan file with that name is already there.' }
      await io.write(path, serialisePlanFile(made.file))
      return { ok: true, slug: made.slug, plan: viewOf(made.file) }
    } catch (err) {
      return failed(io, doing, err)
    }
  })
}

/**
 * One operation on a plan file, made on the file as it is now. `active` is the ids of the steps a specialist is working on. A file that
 * cannot be read, is not a plan, or is not a plain file in the plans folder is left exactly as it is; so is one whose operation is
 * refused or changes nothing.
 */
export function changeGoal(io: PlanIo, root: string, slug: string, op: PlanOp, active: ReadonlySet<string>): Promise<PlanSaved> {
  return inLine(async (): Promise<PlanSaved> => {
    if (root === '') return { ok: false, reason: `Cannot change the plan: ${NO_FOLDER}` }
    if (!SLUG.test(slug)) return { ok: false, reason: 'That is not the name of a plan file.' }
    const path = fileOf(root, slug)
    let doing = 'change the plan'
    try {
      doing = 'look in the plans folder'
      const place = await placeOf(io, root)
      if (!place.ok) return place
      doing = 'read the plan file'
      if (!(await io.exists(path))) return { ok: false, reason: 'That plan file is gone.' }
      if (!(await plainFile(io, place.dir, path, `${slug}.md`))) return { ok: false, reason: 'That is not a plain file in the plans folder, so it was left alone.' }
      const before = await io.read(path)
      const file = parsePlanFile(before)
      if (file === undefined) return { ok: false, reason: 'That file is not a plan (its first line is not "# title"), so it was left alone.' }
      const done = applyOp(file, op, active)
      if (!done.ok) return done
      const text = serialisePlanFile(done.file)
      doing = 'write the plan file'
      if (text !== before) await io.write(path, text)
      return { ok: true, slug, plan: viewOf(done.file) }
    } catch (err) {
      return failed(io, doing, err)
    }
  })
}

/** Reads one file of the folder into a plan, or nothing when it is not a plan or not a plain file (or could not be read, which is recorded). */
async function loadOne(io: PlanIo, dir: string, root: string, name: string) {
  try {
    const path = `${plansDir(root)}/${name}`
    const plain = await plainFile(io, dir, path, name)
    const file = plain === undefined ? undefined : parsePlanFile(await io.read(path))
    return file === undefined || plain === undefined ? [] : [{ slug: name.slice(0, -3), plan: viewOf(file), mtimeMs: plain.mtimeMs }]
  } catch (err) {
    await failed(io, `read ${name}`, err)
    return []
  }
}

/**
 * Every plan in the folder, the one written most recently first (by the file's modified time). Nothing here writes, not even the ids a
 * step added by hand lacks. A folder or file that fails is skipped and recorded; names that are not `<slug>.md`, links and folders are skipped.
 */
export async function loadGoals(io: PlanIo, root: string): Promise<Array<{ slug: string; plan: PlanView; mtimeMs: number }>> {
  if (root === '') return []
  try {
    if (!(await io.exists(plansDir(root)))) return []
    const place = await placeOf(io, root)
    if (!place.ok) {
      await note(io, `plan: ${place.reason}`)
      return []
    }
    const names = (await io.list(plansDir(root))).filter(one => one.kind === 'file' && one.isLink !== true && one.name.endsWith('.md') && SLUG.test(one.name.slice(0, -3))).map(one => one.name)
    const goals = (await Promise.all(names.map(name => loadOne(io, place.dir, root, name)))).flat()
    return goals.sort((a, b) => b.mtimeMs - a.mtimeMs || a.slug.localeCompare(b.slug))
  } catch (err) {
    await failed(io, 'look in the plans folder', err)
    return []
  }
}
