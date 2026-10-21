// What every specialist is told, who stays on the payroll, how Clawd sizes a hire, and the key choices a specialist reports.

/** Appended to every subagent's brief: questions go into the report for Clawd, who asks the user only what needs the user. */
export const BRIEF_NOTE =
  '\n\n(Office note from Clawd HQ: if you reach a decision or question only the user can settle, do not stall. ' +
  'Make your best call, carry on, and end your final report with one line per item: ' +
  '`QUESTION: <question> | <option> / <option> | recommend: <option>`. ' +
  'Do the work yourself: do not hire or start other agents or subagents. If the job needs more hands, say so in your report and Clawd will staff it. ' +
  'Clawd, the chief of staff, reads these and asks the user only what needs the user. ' +
  'For each key choice you made yourself that later work should follow (a library, a schema, an interface, a convention), add `DECIDED: <choice> — <why>`. ' +
  'The user watches your progress live. As you work, start each step with one short sentence in everyday words that says what you are doing now, ' +
  'for example "Step 2 of 4: checking that the tests pass." Use no tool names, file paths or jargon in that sentence.)\n' +
  '(Progress: before other work, call the `mcp__clawd-hq__step` tool with your plan as `total` (3 to 8 steps) and `done: 0`; ' +
  'then call it again after each step with `done` and a note of a few plain words.)'

/** Agent-written text as one short line: whitespace collapsed, cut to `max` characters with an ellipsis. */
export function oneLine(text: string, max: number): string {
  // Counted in whole characters (code points), so a cut never lands inside an emoji.
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

/**
 * The most that is kept of anything saved as a decision or a choice. Saved text is kept whole; this only stops a
 * runaway one, at a word and without a mark, so a saved line never ends in an ellipsis that hides the answer.
 */
export const SAVED_CHARS = 2000
/** A specialist's own choice is a note, and the newest notes ride along in every brief, so it gets a tighter stop. */
const CHOICE_CHARS = 600

/** One line like `oneLine`, but cut at a word and without a mark: for text the pane wraps, where an ellipsis would only hide words. */
export function fit(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  if (chars.length <= max) return chars.join('')
  const cut = chars.slice(0, max).join('')
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd()
}

/** Who something is from: "Guard", or "Guard" from an older "Sage the Guard"; "CEO" and "Clawd" stay as they are. */
export const whoOf = (from: string) => from.split(' the ').pop() ?? from

// ---- Payroll ----

/** Stacks an agent type is only useful for, by the files that mark a project as that stack. */
export const STACKS: Array<{ stack: string; agents: RegExp; marks: RegExp }> = [
  { stack: 'Go', agents: /^go-/, marks: /^go\.mod$/ },
  { stack: 'Rust', agents: /^rust-/, marks: /^Cargo\.toml$/ },
  { stack: 'Python', agents: /^(python|django|fastapi|pytorch)-/, marks: /^(pyproject\.toml|requirements.*\.txt|setup\.py|Pipfile|manage\.py)$/ },
  { stack: 'Java/Kotlin', agents: /^(java|kotlin)-/, marks: /^(pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?)$/ },
  { stack: 'Dart/Flutter', agents: /^(dart|flutter)-/, marks: /^pubspec\.yaml$/ },
  { stack: 'Swift', agents: /^swift-/, marks: /^(Package\.swift|.*\.xcodeproj)$/ },
  { stack: '.NET', agents: /^(csharp|fsharp)-/, marks: /\.(csproj|fsproj|sln)$/ },
  { stack: 'C++', agents: /^cpp-/, marks: /^CMakeLists\.txt$/ },
  { stack: 'HarmonyOS', agents: /^harmonyos-/, marks: /^oh-package\.json5$/ },
  { stack: 'TypeScript/React', agents: /^(typescript|react)-/, marks: /^(package\.json|tsconfig\.json)$/ },
]

/** Specialists for domains a software project rarely needs; the CEO can rehire any of them. */
export const NICHE = /^(healthcare|homelab|network|mle|gan|opensource|seo|marketing)-|^(chief-of-staff|loop-operator|harness-optimizer|conversation-analyzer)$/

const bare = (type: string) => type.replace(/^[^:]+:/, '')

/** Which plugin agent types this project has no use for, given the file names found in it. */
export function proposeLayoffs(types: string[], files: string[]): { laidOff: string[]; stacks: string[]; why: string[] } {
  const present = STACKS.filter(s => files.some(f => s.marks.test(f)))
  const absent = STACKS.filter(s => !present.includes(s))
  const laidOff: string[] = []
  const why = new Set<string>()
  for (const type of types) {
    if (!type.includes(':')) continue // built-in agents are never laid off
    const b = bare(type)
    const stack = absent.find(s => s.agents.test(b))
    if (stack) { laidOff.push(type); why.add(stack.stack) } else if (NICHE.test(b)) { laidOff.push(type); why.add('niche domains') }
  }
  return { laidOff: laidOff.sort(), stacks: present.map(s => s.stack), why: [...why] }
}

/** The names at the top of the project and one level below (hidden folders and node_modules not opened): what marks its stack. `list` is the host's folder listing. */
export async function projectFiles(cwd: string, list: (path: string) => Promise<ReadonlyArray<{ name: string; kind: string }>>): Promise<string[]> {
  if (!cwd) return []
  const names: string[] = []
  try {
    for (const one of await list(cwd)) {
      names.push(one.name)
      if (one.kind === 'dir' && !one.name.startsWith('.') && one.name !== 'node_modules') {
        try { for (const sub of await list(`${cwd}/${one.name}`)) names.push(sub.name) } catch { /* unreadable folder */ }
      }
    }
  } catch { /* no project folder */ }
  return names
}

// ---- Staffing: Clawd picks each agent's model and effort ----

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** Added to the Agent tool's description, so Clawd sizes every hire to the job. */
export const STAFFING_NOTE =
  '\n\nClawd HQ staffing: you are Clawd, the chief of staff, and you size every hire to the job. ' +
  'Set `model`: `haiku` for jobs with a clear spec that a check can prove: lookups, searches, counting; summarising a log or test output; running tests and reporting what failed; wording, comment and README edits; and small code edits where the brief names the file and the exact change and a test shows it worked, such as renaming text across files, moving or removing a line, or changing a string. ' +
  'Tell haiku to do the job itself and not hand it on, and give it the file, the exact change and the exact check that means done. ' +
  'Not `haiku`: unclear specs, judgment calls, design across several files, debugging when the cause is unknown, security. ' +
  'A job that only reads and reports starts at `haiku` unless it needs judgment. ' +
  '`sonnet` for routine implementation, tests and reviews; ' +
  '`opus` for architecture, hard debugging, security and anything ambiguous. ' +
  'Start `prompt` with one line `[effort: low|medium|high|xhigh|max]`: low for lookups, medium by default, high for design and debugging, ' +
  'xhigh or max only for the hardest problems. The office removes that line before the agent reads its brief and applies the effort to every request it makes.'

/**
 * Added after the staffing note while Clawd runs the chat. The tool's own text can say to start agents only when the
 * user asks; a person who runs this office has asked, once and for all.
 */
export const HANDOVER_NOTE =
  '\n\nClawd HQ standing instruction: the user who set up this office wants work handed to agents without being asked each time. ' +
  'This replaces any line above that says to start agents only when the user asks. ' +
  'Hand over every job of more than two or three steps that can run without the user, and run it in the background so you stay free to talk. ' +
  'Do a job yourself only when it takes one or two steps.'

const EFFORT_TAG = /^\s*\[effort:\s*([a-z]+)\s*\]\s*\n?/i

/** The `[effort: …]` line Clawd starts a brief with, and the brief without it. */
export function parseEffort(prompt: string): { effort?: Effort; prompt: string } {
  const m = prompt.match(EFFORT_TAG)
  if (!m) return { prompt }
  const level = m[1]!.toLowerCase() as Effort
  return EFFORTS.includes(level) ? { effort: level, prompt: prompt.slice(m[0].length) } : { prompt }
}

// ---- Key choices a specialist reports ----

const DECIDED = /^[ \t]*[-*]?[ \t]*DECIDED:[ \t]*(.+?)[ \t]*$/gim

/** The DECIDED lines of a subagent's final report. */
export function parseChoices(text: string): string[] {
  return [...text.matchAll(DECIDED)].map(m => fit(m[1] ?? '', CHOICE_CHARS)).filter(Boolean)
}

