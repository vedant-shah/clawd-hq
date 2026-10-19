// The scout's answer, checked. Its picks come from a model that read files it does not control, so nothing in them is trusted:
// the seat must be a seat, the name must be on the candidate list (a name missing its plugin is repaired when one candidate fits),
// and a reason is kept only when it cites a file the scout really opened. Pure; no `$`.
import { SEATS } from './onboard-types'
import type { ScoutReport, Seat } from './onboard-types'
import { HIDDEN_MARKS } from './plain'
import { isInside, resolveIn } from './scout-guard'
import type { Candidate, RawPick } from './team-rules'

/** Only this many entries of an answer are looked at. */
const MAX_ENTRIES = 40
/** A reason is one short sentence; a longer one is not shown (it is not cut). */
export const REASON_CHARS = 140
/** The file named beside a reason; a longer path leaves the reason without it. */
const PATH_CHARS = 80
const NAME_CHARS = 100

type Entry = Readonly<Record<string, unknown>>
const isRecord = (v: unknown): v is Entry => typeof v === 'object' && v !== null && !Array.isArray(v)
const bare = (id: string) => id.replace(/^.*:/, '')
/** Untrusted text as one plain line: control characters and hidden marks become spaces, runs of space one. */
const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(HIDDEN_MARKS, ' ').replace(/\s+/g, ' ').trim()

const seatOf = (v: unknown): Seat | undefined => {
  const said = typeof v === 'string' ? v.trim().toLowerCase() : undefined
  return SEATS.find(s => s.toLowerCase() === said)
}

type Named = { readonly id: string } | { readonly problem: string }

/** The candidate a name means: an exact id, else the one candidate whose short name it is (only for a name given without a plugin). */
function nameOf(given: string, cands: readonly Candidate[]): Named {
  if (given === '' || given.length > NAME_CHARS) return { problem: `"${given.slice(0, 40)}" is not a usable name.` }
  const exact = cands.find(c => c.id === given)
  if (exact) return { id: exact.id }
  const fits = given.includes(':') ? [] : cands.filter(c => bare(c.id).toLowerCase() === given.toLowerCase())
  if (fits.length === 1 && fits[0]) return { id: fits[0].id }
  return { problem: fits.length > 1 ? `"${given}" fits several helpers (${fits.map(c => c.id).join(', ')}); give the full name.` : `"${given}" is not on the candidate list.` }
}

/** One spelling per file: case is ignored only on a Windows drive, where it means nothing. */
const keyOf = (path: string) => (/^[A-Za-z]:/.test(path) ? path.toLowerCase() : path)

/** The files the scout opened, as one spelling each. */
const readSet = (folder: string, reads: readonly string[]): ReadonlySet<string> =>
  new Set(reads.flatMap(r => { const p = resolveIn(folder, r); return p === undefined ? [] : [keyOf(p)] }))

/** The reason with the file it rests on, or `undefined` when it is empty, too long, or cites a file the scout did not open. */
function reasonOf(entry: Entry, folder: string, opened: ReadonlySet<string>): string | undefined {
  const reason = typeof entry.reason === 'string' ? oneLine(entry.reason) : ''
  const file = typeof entry.evidence === 'string' ? resolveIn(folder, entry.evidence) : undefined
  const root = resolveIn(folder, '.')
  if (reason === '' || reason.length > REASON_CHARS || file === undefined || root === undefined) return undefined
  if (!opened.has(keyOf(file)) || !isInside(root, file)) return undefined
  const shown = file === root ? file : file.slice(root.length + 1)
  // The path is untrusted text too: one with control, escape or direction marks in it, or one too long, is left off.
  return shown.length <= PATH_CHARS && oneLine(shown) === shown ? `${reason} (${shown})` : reason
}

/** One entry as a pick, or the problem with its name; an entry that is not a seat and a name is skipped without a word. */
function pickOf(entry: unknown, cands: readonly Candidate[], folder: string, opened: ReadonlySet<string>): { pick?: RawPick; problem?: string } {
  const seat = isRecord(entry) ? seatOf(entry.seat) : undefined
  const given = isRecord(entry) && typeof entry.name === 'string' ? entry.name.trim() : undefined
  if (!isRecord(entry) || seat === undefined || given === undefined) return {}
  const named = nameOf(given, cands)
  if ('problem' in named) return { problem: named.problem }
  const reason = reasonOf(entry, folder, opened)
  return { pick: { seat, name: named.id, ...(reason === undefined ? {} : { reason }) } }
}

/** The picks that can be used, in the order given, and what was wrong with the names that could not be. */
export function scoutPicks(report: ScoutReport, cands: readonly Candidate[], folder: string): { readonly picks: readonly RawPick[]; readonly problems: readonly string[] } {
  const list = isRecord(report.picks) ? report.picks.picks : undefined
  if (!Array.isArray(list)) return { picks: [], problems: ['There was no list of picks in the answer.'] }
  const opened = readSet(folder, report.reads)
  const found = list.slice(0, MAX_ENTRIES).map(entry => pickOf(entry, cands, folder, opened))
  return {
    picks: found.flatMap(f => (f.pick ? [f.pick] : [])),
    problems: found.flatMap(f => (f.problem ? [f.problem] : [])),
  }
}
