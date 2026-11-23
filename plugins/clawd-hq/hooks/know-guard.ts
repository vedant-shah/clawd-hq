// The risky-action guard, pure. DECIDED: code only, no model. At each hand-back it reads the specialist's own steps, which the
// main chat (and so the "You should know" check) never sees, for three things: a destructive command, a command run with the
// sandbox off, and an action the person refused that was then done another way. What it shows is only the kind of action and
// the tool: never the command or its arguments, which can hold a password. Patterns are narrow on purpose: deleting build output
// or temp folders, stopping one named dev process, and everyday git are routine work, not risks.
import type { SessionMessage } from 'claude-code'
import { isStepTool } from './steps'

export type RiskKind = 'denied-retried' | 'destructive' | 'sandbox-off'
/** One risky step: its kind, what it did in plain words, its number among the run's steps, and the tool that took it. */
export type Risk = { kind: RiskKind; what: string; step: number; tool: string }
type Use = SessionMessage['toolUses'][number]

const SHELL = new Set(['Bash', 'PowerShell'])
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])

/** Folders whose loss is routine: build output, caches, installed packages, temp. Anywhere in a path. */
const THROWAWAY_PARTS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo', '.cache', '.parcel-cache', 'target', '__pycache__',
  '.pytest_cache', '.mypy_cache', '.venv', 'venv', 'tmp', '.tmp', 'temp',
])
const TEMP_ROOT = /^(\/tmp|\/private\/tmp|\/var\/folders|\$TMPDIR|\$\{TMPDIR\})(\/|$)/

export const WHAT = {
  delete: 'deletes files and folders for good',
  deleteGiven: 'deletes the files it is handed, for good',
  findDelete: 'deletes the files it finds, for good',
  reset: 'throws away uncommitted changes',
  push: 'overwrites history on the shared copy',
  pushDelete: 'deletes a branch on the shared copy',
  clean: 'deletes files git does not track',
  branch: 'deletes a branch whose work may not be merged',
  kill: 'stops many programs at once',
  docker: 'deletes Docker data for good',
  drop: 'drops a database table',
  truncate: 'empties a database table',
  deleteRows: 'deletes every row of a database table',
  updateRows: 'changes every row of a database table',
} as const

// ---- Reading a command line: words and simple commands, quotes and heredoc bodies kept whole ----

/** A heredoc opener (`<<EOF`, `<<-'SQL'`), not a here-string (`<<<`). */
const HEREDOC = /(?<!<)<<(?!<)-?\s*['"]?([A-Za-z_][\w-]*)['"]?/g

/** The command with the bodies of its heredocs taken out, and the bodies in order: a body is text handed to a program, not commands to run. */
function splitHeredocs(command: string): { text: string; bodies: string[] } {
  const kept: string[] = []
  const bodies: string[] = []
  const ends: string[] = []
  let body: string[] = []
  for (const line of command.split('\n')) {
    if (ends.length > 0) {
      if (line.trim() !== ends[0]) { body.push(line); continue }
      bodies.push(body.join('\n'))
      body = []
      ends.shift()
      continue
    }
    kept.push(line)
    ends.push(...[...line.matchAll(HEREDOC)].map(m => m[1]!))
  }
  if (ends.length > 0) bodies.push(body.join('\n'))
  return { text: kept.join('\n'), bodies }
}

/** One simple command: its words with the quotes taken off, the text fed to it (a heredoc body or a here-string), and whether it pipes into the next. */
type Command = { words: string[]; input: string; pipesOn: boolean }

/** The input a command's words carry: each heredoc's body, in order, and each here-string. */
function inputOf(words: readonly string[], bodies: string[]): string {
  return words.flatMap((w, i) => {
    if (w === '<<<') return [words[i + 1] ?? '']
    if (w.startsWith('<<<')) return [w.slice(3)]
    return w.startsWith('<<') ? [bodies.shift() ?? ''] : []
  }).join('\n')
}

/** The simple commands of a command line; `;`, `&&`, `||`, `|`, `&` and new lines split them, unless quoted. */
function lexed(command: string): Command[] {
  const { text, bodies } = splitHeredocs(command)
  const all: Command[] = []
  let words: string[] = []
  let word: string | undefined
  let quote: string | undefined
  const endWord = () => { if (word !== undefined) words.push(word); word = undefined }
  const endCommand = (pipesOn = false) => { endWord(); if (words.length > 0) all.push({ words, input: inputOf(words, bodies), pipesOn }); words = [] }
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!
    if (quote) {
      if (c === quote) quote = undefined
      else if (c === '\\' && quote === '"' && i + 1 < text.length) word = (word ?? '') + text[(i += 1)]
      else word = (word ?? '') + c
    } else if (c === '"' || c === "'") {
      quote = c
      word ??= ''
    } else if (c === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[(i += 1)]
    } else if ((c === '|' || c === '&') && text[i + 1] === c) {
      i += 1
      endCommand()
    } else if (c === '|') {
      endCommand(true)
    } else if (c === ';' || c === '\n' || c === '&') {
      endCommand()
    } else if (/\s/.test(c)) {
      endWord()
    } else {
      word = (word ?? '') + c
    }
  }
  endCommand()
  return all
}

/** The simple commands of a command line, each as its words with the quotes taken off. */
export const commandsOf = (command: string): string[][] => lexed(command).map(c => c.words)

/** The words of one simple command without `sudo`, `env` and leading `NAME=value` settings. */
function bare(words: readonly string[]): string[] {
  const at = words.findIndex(w => w !== 'sudo' && w !== 'env' && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w))
  return at < 0 ? [] : words.slice(at)
}

const nameOf = (word: string | undefined) => word?.split('/').pop()
/** A path under build output, a cache or temp; never one that climbs out with `..` (`build/../src`). */
function isThrowaway(path: string): boolean {
  const parts = path.split('/')
  if (parts.includes('..')) return false
  return TEMP_ROOT.test(path) || parts.some(part => THROWAWAY_PARTS.has(part))
}
const flagHas = (flags: readonly string[], long: string, short: RegExp) => flags.some(f => f === long || (/^-[^-]/.test(f) && short.test(f)))

/** What the run has done before this step that changes how a step reads: the branches it merged. */
type Seen = { merged: ReadonlySet<string> }

function rmWhat(args: readonly string[]): string | undefined {
  const flags = args.filter(a => a.startsWith('-'))
  const targets = args.filter(a => !a.startsWith('-'))
  const isForced = flagHas(flags, '--recursive', /[rR]/) && flagHas(flags, '--force', /f/)
  return isForced && targets.some(t => !isThrowaway(t)) ? WHAT.delete : undefined
}

/** File kinds that are always safe to clear out: compiled files, logs, editor and OS litter. */
const JUNK_EXTENSIONS = new Set(['pyc', 'pyo', 'log', 'tmp', 'temp', 'bak', 'orig', 'rej', 'swp', 'swo', 'map', 'o', 'class', 'tsbuildinfo'])
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '__pycache__', '.pytest_cache'])
/** A `-name` glob that only matches litter: `*.pyc`, `*.log`, `.DS_Store`. */
const isJunkGlob = (glob: string) => JUNK_NAMES.has(glob) || (/^\*\.([A-Za-z0-9]+)$/.test(glob) && JUNK_EXTENSIONS.has(glob.slice(2).toLowerCase()))

function findWhat(args: readonly string[]): string | undefined {
  const at = args.findIndex(a => /^[-(!]/.test(a))
  const roots = (at < 0 ? args : args.slice(0, at))
  const exec = args.findIndex(a => a === '-exec' || a === '-execdir')
  const isDeleting = args.includes('-delete') || (exec >= 0 && nameOf(args[exec + 1]) === 'rm')
  if (!isDeleting || (roots.length > 0 && roots.every(isThrowaway))) return undefined
  // Every `-name` names litter: routine. No `-name` at all, or one that could match real files, deletes for good.
  const globs = args.flatMap((a, i) => (a === '-name' || a === '-iname' ? [args[i + 1] ?? ''] : []))
  return globs.length > 0 && globs.every(isJunkGlob) ? undefined : WHAT.findDelete
}

function pushWhat(more: readonly string[]): string | undefined {
  if (more.includes('--delete') || more.includes('-d') || more.some(a => /^:[^:]/.test(a))) return WHAT.pushDelete
  const isForced = more.some(a => a === '-f' || a === '--force' || /^\+\S/.test(a))
  return isForced ? WHAT.push : undefined
}

function gitWhat(args: readonly string[], seen: Seen): string | undefined {
  const rest = [...args]
  // `git -C path` and `git -c key=value` take a value before the subcommand.
  while (rest.length > 0 && rest[0]!.startsWith('-')) rest.splice(0, /^-[Cc]$/.test(rest[0]!) ? 2 : 1)
  const [sub, ...more] = rest
  if (sub === 'reset' && more.includes('--hard')) return WHAT.reset
  if (sub === 'push') return pushWhat(more)
  if (sub === 'clean' && flagHas(more, '--force', /f/)) return WHAT.clean
  if (sub === 'branch' && more.includes('-D')) {
    const names = more.filter(a => !a.startsWith('-'))
    return names.length > 0 && names.every(n => seen.merged.has(n)) ? undefined : WHAT.branch
  }
  return undefined
}

/** Interpreters and servers: a pattern that is only one of these names stops every program of that kind. */
const BROAD_NAMES = new Set(['node', 'python', 'python3', 'ruby', 'java', 'php', 'perl', 'bun', 'deno', 'npm', 'npx', 'bash', 'sh', 'zsh', 'docker', 'chrome', '.', '.*', '*'])

/** `pkill` or `killall`: broad unless it names one program that is not a whole runtime (`vite`, `next-server`, `"node server.js"`). */
function killByNameWhat(args: readonly string[]): string | undefined {
  if (args.some(a => a === '-u' || a === '-U' || a === '-g')) return WHAT.kill
  const pattern = [...args].reverse().find(a => !a.startsWith('-'))
  return pattern === undefined || BROAD_NAMES.has(pattern.toLowerCase()) ? WHAT.kill : undefined
}

/** What one simple command destroys, in plain words; none for everyday work. */
function simpleWhat(words: readonly string[], seen: Seen, depth: number): string | undefined {
  const [head, ...args] = bare(words)
  const name = nameOf(head)
  if (name === undefined) return undefined
  if (SHELLS.has(name)) {
    const at = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
    return at >= 0 && args[at + 1] !== undefined && depth < 3 ? commandWhat(args[at + 1]!, seen, depth + 1) : undefined
  }
  if (name === 'xargs') {
    const run = args.findIndex((a, i) => !a.startsWith('-') && !/^-[IinPLdEs]$/.test(args[i - 1] ?? ''))
    if (run < 0) return undefined
    return nameOf(args[run]) === 'rm' ? WHAT.deleteGiven : simpleWhat(args.slice(run), seen, depth)
  }
  if (name === 'rm') return rmWhat(args)
  if (name === 'find') return findWhat(args)
  if (name === 'git') return gitWhat(args, seen)
  if (name === 'killall' || name === 'pkill') return killByNameWhat(args)
  if (name === 'kill' && args[args.length - 1] === '-1') return WHAT.kill
  if (name === 'taskkill' && args.some(a => /^\/im$/i.test(a))) return WHAT.kill
  if ((name === 'docker' || name === 'podman') && args.includes('prune')) return WHAT.docker
  return undefined
}

// ---- SQL, in a database client's command line or a database tool's query ----

const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'duckdb', 'clickhouse-client'])
/** A database client as the program a simple command runs (`psql`, `cockroach sql`, `supabase db`). */
function isSqlClient(words: readonly string[]): boolean {
  const name = nameOf(words[0])?.toLowerCase()
  return name !== undefined && (SQL_CLIENTS.has(name) || (name === 'cockroach' && words[1] === 'sql') || (name === 'supabase' && words[1] === 'db'))
}
const FEEDERS = new Set(['echo', 'printf'])

/** What a piece of SQL destroys: a dropped or emptied table, or a DELETE or UPDATE with no WHERE. */
export function sqlWhat(sql: string): string | undefined {
  for (const statement of sql.split(';')) {
    if (/\bdrop\s+(table|database|schema|view|index)\b/i.test(statement)) return WHAT.drop
    if (/\btruncate(\s+table)?\s+["'`\w]/i.test(statement)) return WHAT.truncate
    const hasWhere = /\bwhere\b/i.test(statement)
    if (/\bdelete\s+from\s+["'`\w.]+/i.test(statement) && !hasWhere) return WHAT.deleteRows
    if (/\bupdate\s+["'`\w.]+\s+set\b/i.test(statement) && !hasWhere) return WHAT.updateRows
  }
  return undefined
}

/**
 * The SQL a database client is given: its own arguments, its heredoc or here-string, and the text an `echo` or `printf` pipes
 * into it. SQL anywhere else on the line (a commit message, a search) is not run, so it is not read.
 */
function clientSqlWhat(all: readonly Command[], at: number): string | undefined {
  const words = bare(all[at]!.words)
  if (!isSqlClient(words)) return undefined
  const before = at > 0 && all[at - 1]!.pipesOn ? bare(all[at - 1]!.words) : []
  const piped = FEEDERS.has(nameOf(before[0]) ?? '') ? before.slice(1).join(' ') : ''
  return sqlWhat([words.slice(1).join(' '), all[at]!.input, piped].join(';\n'))
}

function commandWhat(command: string, seen: Seen, depth = 0): string | undefined {
  const all = lexed(command)
  return all.map((c, i) => clientSqlWhat(all, i) ?? simpleWhat(c.words, seen, depth)).find(what => what !== undefined)
}

/** The branches a command merges, so deleting them afterwards is tidying up. */
function mergedBy(command: string): string[] {
  return commandsOf(command).flatMap(words => {
    const [head, sub, ...more] = bare(words)
    return nameOf(head) === 'git' && sub === 'merge' ? more.filter(a => !a.startsWith('-')) : []
  })
}

// ---- Refused, then done another way ----

const DENIAL = /permission to use .*(has been|was) denied|haven't granted it yet|doesn't want to proceed with this tool use|tool use was rejected|blocked by (a |the )?(\w+ )?hook|denied by (a |the )?(hook|policy|rule|plugin)/i
const isDenied = (use: Use) => use.isError === true && DENIAL.test(use.text ?? '')
const isSameCall = (a: Use, b: Use) => a.tool === b.tool && JSON.stringify(a.input) === JSON.stringify(b.input)
const classOf = (tool: string) => (FILE_TOOLS.has(tool) ? 'file' : SHELL.has(tool) ? 'shell' : undefined)
const pathOf = (use: Use) => [use.input.file_path, use.input.notebook_path].find((v): v is string => typeof v === 'string')
const SCRIPT_RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
/**
 * A shell command's program and subcommand (`git push`), from its first simple command. A package manager's `run` takes the
 * script name too, so `npm run build` and `npm run lint` differ, while `npm test` and `npm test -- foo` are the same script.
 */
function headOf(use: Use): string {
  const words = bare(commandsOf(String(use.input.command ?? ''))[0] ?? [])
  const isRun = SCRIPT_RUNNERS.has(nameOf(words[0]) ?? '') && (words[1] === 'run' || words[1] === 'run-script')
  return words.slice(0, isRun ? 3 : 2).join(' ')
}

/**
 * The later step that did a refused one another way: the same class of tool (file edits, or the shell) on the same full path,
 * or the same program and subcommand with a different command. The session does not record approvals, so the same call
 * succeeding later is read as the person saying yes, and nothing after it counts.
 */
function retryOf(denied: Use, later: readonly Use[]): Use | undefined {
  const kind = classOf(denied.tool)
  if (!kind) return undefined
  const path = pathOf(denied)
  const head = kind === 'shell' ? headOf(denied) : ''
  for (const u of later) {
    if (isSameCall(u, denied)) {
      if (isDenied(u)) continue
      return undefined
    }
    if (classOf(u.tool) !== kind || isDenied(u)) continue
    if (kind === 'file' ? path !== undefined && pathOf(u) === path : head.includes(' ') && headOf(u) === head) return u
  }
  return undefined
}

// ---- The run's risks, and the note ----

/** A tool's name as shown: as the engine names it when it is plain, else "a tool". */
const toolLabel = (tool: string) => (/^[A-Za-z0-9_.-]{1,60}$/.test(tool) ? tool : 'a tool')

function stepWhat(use: Use, seen: Seen): string | undefined {
  if (SHELL.has(use.tool)) return commandWhat(String(use.input.command ?? ''), seen)
  const sql = [use.input.query, use.input.sql].filter((v): v is string => typeof v === 'string').join(';\n')
  return sql === '' ? undefined : sqlWhat(sql)
}

/** Every risky step of the run, in order; the progress tool is no step, so steps count as the person would count them. */
export function risksOf(rows: readonly SessionMessage[]): Risk[] {
  const uses = rows.flatMap(r => r.toolUses).filter(u => !isStepTool(u.tool))
  const risk = (kind: RiskKind, what: string, use: Use): Risk => ({ kind, what, step: uses.indexOf(use) + 1, tool: toolLabel(use.tool) })
  const merged = new Set<string>()
  const retried = new Set<Use>()
  const found = uses.flatMap((use, i): Risk[] => {
    // A merge in this same command counts: `git merge x && git branch -D x` is tidying up.
    if (SHELL.has(use.tool)) for (const name of mergedBy(String(use.input.command ?? ''))) merged.add(name)
    const what = stepWhat(use, { merged })
    const later = isDenied(use) ? retryOf(use, uses.slice(i + 1)) : undefined
    // Two refusals worked round by the same later step are one risk.
    const retry = later && !retried.has(later) ? later : undefined
    if (retry) retried.add(retry)
    return [
      ...(retry ? [risk('denied-retried', 'was refused an action, then did it another way', retry)] : []),
      ...(what ? [risk('destructive', what, use)] : []),
      ...(SHELL.has(use.tool) && use.input.dangerouslyDisableSandbox === true ? [risk('sandbox-off', 'ran a command with the sandbox turned off', use)] : []),
    ]
  })
  return [...found].sort((a, b) => a.step - b.step)
}

const LISTED = 3
const LEAD: readonly RiskKind[] = ['denied-retried', 'destructive', 'sandbox-off']
const THE_CHAT = 'in steps the main chat does not show'

/** The most serious risk: a refusal worked round, then a destructive step, then the sandbox off. */
export const leadRisk = (risks: readonly Risk[]): Risk | undefined => [...risks].sort((a, b) => LEAD.indexOf(a.kind) - LEAD.indexOf(b.kind))[0]

const actionOf = (r: Risk) => (SHELL.has(r.tool) ? 'a command' : 'a step')

function lineOf(who: string, lead: Risk): string {
  if (lead.kind === 'denied-retried') return `The ${who} was refused an action, then did it another way, ${THE_CHAT}.`
  if (lead.kind === 'sandbox-off') return `The ${who} ran a command with the sandbox turned off, ${THE_CHAT}.`
  return `The ${who} ${SHELL.has(lead.tool) ? 'ran a command' : 'took a step'} that ${lead.what}, ${THE_CHAT}.`
}

function itemOf(r: Risk): string {
  const what = r.kind === 'denied-retried' ? 'an action it was refused, done another way' : r.kind === 'sandbox-off' ? 'a command run with the sandbox turned off' : `${actionOf(r)} that ${r.what}`
  return `Step ${r.step}: ${what} (${r.tool})`
}

/** The note for the card: the most serious risk as its line, up to three steps in its explanation. None when nothing was found. */
export function guardNote(who: string, risks: readonly Risk[]): { line: string; tag: 'Heads up'; title: string; explain: string } | undefined {
  const lead = leadRisk(risks)
  if (!lead) return undefined
  const items = risks.slice(0, LISTED).map(itemOf)
  const more = risks.length - LISTED
  const listed = more > 0 ? `${items.join('. ')}, and ${more} more.` : `${items.join('. ')}.`
  return {
    line: lineOf(who, lead),
    tag: 'Heads up',
    title: `A risky step in the ${who}'s work`,
    explain: `These come from the ${who}'s own steps, which you and Clawd do not see in the chat. ${listed} Check nothing you need was lost or changed, and ask Clawd if this was not meant to happen.`,
  }
}
