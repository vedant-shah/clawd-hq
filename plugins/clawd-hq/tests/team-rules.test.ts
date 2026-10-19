import { expect, test } from 'claude-code/testing'
import type { Helper, PastUse, ProjectFacts } from '../hooks/onboard-types'
import { BUILTINS, candidateList, isToolLike, needsPerson, projectSignals, receiptOf, rulePick } from '../hooks/team-rules'
import type { Candidate } from '../hooks/team-rules'

const facts = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  tells: ['Claude Code mod'],
  fileTypes: { '.ts': 60, '.tsx': 20, '.md': 12 },
  outline: ['.claude-plugin/', 'docs/', 'plugins/', '  clawd-hq/', '    tests/', 'package.json', 'tsconfig.json', 'vitest.config.ts'],
  deps: ['typescript', 'langfuse'],
  readmeHead: '# Clawd HQ',
  instructions: 'Use the code-reviewer agent.',
  codeFiles: 80,
  ...over,
})
const helper = (name: string, over: Partial<Helper> = {}): Helper => ({
  name, kind: 'agent', source: 'plugin', plugin: 'ecc', about: `Does ${name} work.`, uses: 0, isNamed: false, isOwn: false, ...over,
})
const skill = (name: string, over: Partial<Helper> = {}) => helper(name, { kind: 'skill', ...over })
const use = (over: Partial<PastUse> = {}): PastUse => ({ agents: {}, skills: {}, files: 3, skipped: 0, ...over })
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, kind: 'agent', source: 'ecc', plugin: 'ecc', about: `Does ${id}.`, uses: 0, isNamed: false, isOwn: false, ...over,
})
const ids = (list: readonly Candidate[]) => list.map(c => c.id)

// ---- The noise filter ----

test('tool-like skills are noise by their name only, not by what their description says', () => {
  for (const name of ['pptx', 'loop', 'strategic-compact', 'skill-creator', 'hookify-list', 'epic-sync']) expect(isToolLike(name)).toBe(true)
  expect(isToolLike('deck-maker')).toBe(false)
  expect(isToolLike('cron-thing')).toBe(false)
  for (const name of ['planner', 'tdd-workflow', 'code-review', 'shadcn', 'plugin-authoring']) expect(isToolLike(name)).toBe(false)
})

test('a helper for a language the project does not use stays a candidate: the list has no language filter', () => {
  const pythonProject = facts({ fileTypes: { '.py': 40 }, outline: ['pyproject.toml'], deps: [], tells: [] })
  const list = candidateList([
    helper('kotlin-reviewer', { about: 'Reviews Kotlin and Android code.' }),
    helper('go-build', { about: 'Fixes Go builds.' }),
    helper('code-reviewer', { about: 'Reviews code.' }),
  ], use())
  expect(ids(list)).toEqual(['ecc:kotlin-reviewer', 'ecc:go-build', 'ecc:code-reviewer'])
})

// ---- The candidate list ----

test('the list drops noise and built-ins but always keeps what was used, named or is the person\'s own', () => {
  const list = candidateList([
    helper('planner'),
    skill('pptx'),
    skill('loop', { uses: 2 }),
    skill('pdf', { isOwn: true, source: 'user', plugin: undefined }),
    helper('python-reviewer'),
    helper('django-reviewer', { isNamed: true }),
    helper('general-purpose', { plugin: undefined, source: 'built-in' }),
    helper('Explore', { plugin: undefined, source: 'built-in' }),
    helper('clawd-hq:make-shadcn', { plugin: undefined }),
  ], use())
  // `loop` was used, but a tool by name is the person's to run by hand; `pdf` is theirs, so it stays.
  // `python-reviewer` stays although the project is TypeScript: the team pick sees every helper.
  expect(ids(list)).toEqual(['ecc:planner', 'pdf', 'ecc:python-reviewer', 'ecc:django-reviewer'])
  for (const name of BUILTINS) expect(ids(list)).not.toContain(name)
})

test('a tool by name is dropped when used, kept when the person owns it or names it, and a description-only tool stays when used', () => {
  const list = candidateList([
    skill('strategic-compact', { uses: 9 }),
    skill('pptx', { uses: 2, isNamed: true }),
    skill('schedule', { uses: 1, plugin: undefined, source: 'built in' }),
    skill('deck-maker', { uses: 3, about: 'Makes .pptx files from notes.' }),
  ], use({ skills: { 'ecc:aside': 4 } }))
  expect(ids(list)).toEqual(['ecc:pptx', 'ecc:deck-maker'])
})

test('a candidate\'s id carries its plugin, and its past use is counted by that id or its bare name', () => {
  const list = candidateList(
    [helper('planner', { uses: 1 }), helper('ecc:code-reviewer'), skill('tdd-workflow'), skill('mine', { isOwn: true, plugin: undefined, source: 'user' })],
    use({ agents: { 'ecc:code-reviewer': 40, 'code-reviewer': 3, planner: 6 }, skills: { 'ecc:tdd-workflow': 2, mine: 5 } }),
  )
  expect(list.map(c => [c.id, c.kind, c.uses, c.source])).toEqual([
    ['ecc:planner', 'agent', 6, 'ecc'],
    ['ecc:code-reviewer', 'agent', 43, 'ecc'],
    ['ecc:tdd-workflow', 'skill', 2, 'ecc'],
    ['mine', 'skill', 5, 'your own'],
  ])
})

test('helpers used here but not installed join the list with a short description of our own', () => {
  const list = candidateList([helper('planner')], use({
    agents: { 'claude-code-guide': 3, 'general-purpose': 9, Explore: 4, 'clawd-hq:make': 2, 'ecc:planner': 1, 'bad name; drop table': 2 },
    skills: { 'mystery-skill': 1 },
  }))
  expect(ids(list)).toEqual(['ecc:planner', 'claude-code-guide', 'mystery-skill'])
  const guide = list[1]!
  expect(guide.uses).toBe(3)
  expect(guide.about).toMatch(/Claude Code/)
  expect(list[2]!.about).toBe('(no description available)')
})

test('odd keys in the past-use record never count as use', () => {
  const list = candidateList([helper('constructor', { plugin: undefined }), helper('toString', { plugin: undefined })], use({ agents: { toString: 'many' as unknown as number } }))
  expect(list.map(c => c.uses)).toEqual([0, 0])
})

test('one id appears once, the agent first', () => {
  const list = candidateList([skill('planner'), helper('planner')], use())
  expect(list.map(c => [c.id, c.kind])).toEqual([['ecc:planner', 'agent']])
})

test('a description is cut to one plain line', () => {
  const [c] = candidateList([helper('planner', { about: 'Plans\nthings well. And more.' + 'x'.repeat(400) })], use())
  expect(c!.about).toBe('Plans things well.')
  const [long] = candidateList([helper('planner', { about: 'y'.repeat(400) })], use())
  expect(long!.about.length).toBeLessThanOrEqual(160)
})

// ---- Skills that need the person present ----

test('a skill that interviews, grills or quizzes the person, or asks them questions, needs the person present', () => {
  expect(needsPerson('grill-me', '')).toBe(true)
  expect(needsPerson('ecc:grill-me', 'Whatever.')).toBe(true)
  expect(needsPerson('stress-test', 'Interview the user relentlessly about a plan or design until reaching shared understanding.')).toBe(true)
  expect(needsPerson('x', 'Interviews me about the idea before anything is written.')).toBe(true)
  expect(needsPerson('x', 'Grill the user on their design.')).toBe(true)
  expect(needsPerson('x', 'Quizzes the user on what they learned.')).toBe(true)
  expect(needsPerson('x', 'Asks the user clarifying questions, then writes a spec.')).toBe(true)
  expect(needsPerson('x', 'Ask the user questions one at a time.')).toBe(true)
})

test('a skill that only mentions the user, or interviews as a topic, does not need the person present', () => {
  expect(needsPerson('human-resources:interview-prep', 'Prepare interview questions and a rubric for candidates.')).toBe(false)
  expect(needsPerson('user-research:user-research-cookiy', 'Conduct user interviews and synthesise what users say.')).toBe(false)
  expect(needsPerson('ecc:plan', 'Restate requirements and wait for the user to confirm before touching any code.')).toBe(false)
  expect(needsPerson('x', 'Reviews code the user wrote and reports problems to the user.')).toBe(false)
  expect(needsPerson('x', 'Asks the user to approve the diff.')).toBe(false)
  expect(needsPerson('x', 'Answers questions from the user about the codebase.')).toBe(false)
  expect(needsPerson('x', 'Builds a quiz app and a grill menu page.')).toBe(false)
  expect(needsPerson('ecc:user-journey', 'Maps the user journey.')).toBe(false)
})

test('a skill that needs the person is never a candidate, even when used, named or the person\'s own', () => {
  const list = candidateList([
    skill('grill-me', { isOwn: true, source: 'userSettings', plugin: undefined, uses: 4, isNamed: true, about: 'Interview the user relentlessly about a plan.' }),
    skill('stress-test', { about: 'Interviews the user about a design.', uses: 2 }),
    skill('ecc:plan', { about: 'Restate requirements and wait for the user to confirm.' }),
    helper('planner'),
  ], use({ skills: { 'grill-me': 4 } }))
  expect(ids(list)).toEqual(['ecc:plan', 'ecc:planner'])
})

test('an agent is not dropped by the interview rule, only skills', () => {
  const list = candidateList([helper('requirements-bot', { about: 'Asks the user clarifying questions.' })], use())
  expect(ids(list)).toEqual(['ecc:requirements-bot'])
})

// ---- Built-in skills ----

const modFacts = () => facts()
const pluginAuthoring = () => skill('plugin-authoring', {
  plugin: undefined, source: 'built in',
  about: 'Make a mod: a change to Claude\'s own interface or behaviour, such as a live pane or panel, a status line, a toast, a slash command, or a hook on tool calls or prompts.',
})

test('a built-in skill that fits the project stays a candidate even though its description names a slash command', () => {
  const list = candidateList([pluginAuthoring(), helper('planner')], use())
  expect(ids(list)).toContain('plugin-authoring')
  expect(list.find(c => c.id === 'plugin-authoring')?.source).toBe('built in')
  expect(receiptOf(list.find(c => c.id === 'plugin-authoring')!, projectSignals(modFacts()), modFacts().deps)).toBe('fits: Claude Code mod')
})

test('a built-in skill that is a tool is noise by name; one that fits the project stays, whatever its description says', () => {
  const noMod = facts({ tells: [], outline: ['src/', 'package.json'], deps: [] })
  const list = candidateList([
    skill('loop', { plugin: undefined, source: 'built in', about: 'Run a prompt on a recurring interval.' }),
    skill('pptx', { plugin: undefined, source: 'built in', about: 'Makes slide decks.' }),
    skill('schedule', { plugin: undefined, source: 'built in', about: 'Create a cron job.' }),
    pluginAuthoring(),
  ], use())
  expect(ids(list)).toEqual(['plugin-authoring'])
  expect(rulePick([cand('loop', { kind: 'skill', uses: 3, plugin: undefined, source: 'built in', about: 'Run a prompt on a recurring interval.' })], noMod)).toEqual([])
})

test('the rule pick seats a built-in skill that fits the project as a specialist', () => {
  const plugin = cand('plugin-authoring', { kind: 'skill', plugin: undefined, source: 'built in', about: pluginAuthoring().about })
  expect(rulePick([cand('ecc:planner'), plugin], modFacts())).toEqual([{ seat: 'Plan', name: 'ecc:planner' }, { seat: 'Specialist', name: 'plugin-authoring' }])
})

test('an installed planner fills the Plan seat ahead of skills that only talk about plans or need the person', () => {
  const list = candidateList([
    skill('grill-me', { isOwn: true, source: 'userSettings', plugin: undefined, uses: 3, about: 'Interview the user relentlessly about a plan or design.' }),
    skill('ecc:plan', { uses: 2, about: 'Restate requirements and create a step-by-step plan.' }),
    helper('planner', { about: 'Expert planning specialist for complex features.' }),
    pluginAuthoring(),
  ], use())
  const picks = rulePick(list, modFacts())
  expect(picks.find(p => p.seat === 'Plan')).toEqual({ seat: 'Plan', name: 'ecc:planner' })
  expect(picks.map(p => p.name)).not.toContain('grill-me')
  expect(picks.map(p => p.name)).toContain('plugin-authoring')
})

// ---- Facts and receipts ----

test('the project\'s signals each name the tell, file or dependency that shows them', () => {
  const signals = projectSignals(facts())
  // A test config is stronger evidence than a folder called tests.
  expect(signals.tests).toBe('tests found (vitest.config.ts)')
  expect(signals.docs).toBe('docs found (docs/)')
  expect(signals.mod).toBe('Claude Code mod')
  expect(signals.database).toBeUndefined()
  expect(projectSignals(facts({ outline: [], tells: [], deps: ['@prisma/client'] })).database).toBe('a database found (@prisma/client)')
  expect(projectSignals(facts({ outline: [], tells: [], deps: ['package.json: react, vitest'] }))).toEqual({ tests: 'tests found (vitest)', web: 'a web front end found (react)' })
})

test('a receipt is built from facts only: past use, instructions, ownership, a fit, or where it came from', () => {
  const signals = projectSignals(facts())
  const deps = facts().deps
  expect(receiptOf(cand('ecc:code-reviewer', { uses: 12 }), signals, deps)).toBe('used 12× here')
  expect(receiptOf(cand('ecc:code-reviewer', { isNamed: true }), signals, deps)).toBe('named in your instructions')
  expect(receiptOf(cand('agent-reach', { kind: 'skill', isOwn: true, uses: 4 }), signals, deps)).toBe('used 4× here · your own skill')
  expect(receiptOf(cand('ecc:tdd-guide'), signals, deps)).toBe('fits: tests found (vitest.config.ts)')
  expect(receiptOf(cand('langfuse', { kind: 'skill' }), signals, deps)).toBe('fits: uses langfuse')
  expect(receiptOf(cand('ecc:planner'), signals, deps)).toBe('from the ecc plugin')
  expect(receiptOf(cand('claude-code-guide', { plugin: undefined, source: 'built in / not on disk' }), signals, deps)).toBe('built into Claude Code')
})

// ---- The rule pick ----

const clawdCands = (): Candidate[] => [
  cand('ecc:planner', { uses: 7 }),
  cand('ecc:architect'),
  cand('ecc:code-architect'),
  cand('ecc:plan', { kind: 'skill', uses: 1 }),
  cand('ecc:tdd-guide', { uses: 42 }),
  cand('ecc:build-error-resolver'),
  cand('ecc:code-reviewer', { uses: 43 }),
  cand('ecc:security-reviewer', { uses: 3 }),
  cand('ecc:silent-failure-hunter'),
  cand('ecc:code-explorer', { uses: 2 }),
  cand('ecc:doc-updater', { uses: 7 }),
  cand('plugin-authoring', { kind: 'skill', uses: 1, plugin: undefined, source: 'built in / not on disk' }),
  cand('claude-code-guide', { uses: 3, plugin: undefined, source: 'built in / not on disk' }),
  cand('ecc:strategic-compact', { kind: 'skill', uses: 2 }),
  cand('animation-vocabulary', { kind: 'skill', isOwn: true, plugin: undefined, source: 'your own' }),
]

test('the rule pick fills each seat by its kind of work, strongest first, and takes specialists only on a fact', () => {
  const picks = rulePick(clawdCands(), facts())
  expect(picks).toEqual([
    { seat: 'Plan', name: 'ecc:planner' },
    { seat: 'Plan', name: 'ecc:architect' },
    { seat: 'Make', name: 'ecc:tdd-guide' },
    { seat: 'Check', name: 'ecc:code-reviewer' },
    { seat: 'Check', name: 'ecc:security-reviewer' },
    { seat: 'Find out', name: 'ecc:code-explorer' },
    { seat: 'Specialist', name: 'plugin-authoring' },
    { seat: 'Specialist', name: 'ecc:doc-updater' },
    { seat: 'Specialist', name: 'claude-code-guide' },
  ])
})

test('a fit to what the project says it is outranks a fit read from its files: plugin-authoring leads the specialists of a Claude Code mod', () => {
  const cands = [
    cand('ecc:ai-regression-testing', { kind: 'skill' }),
    cand('ecc:e2e-testing', { kind: 'skill' }),
    cand('plugin-authoring', { kind: 'skill', plugin: undefined, source: 'built in' }),
  ]
  expect(rulePick(cands, facts()).map(p => p.name)).toEqual(['plugin-authoring', 'ecc:ai-regression-testing', 'ecc:e2e-testing'])
  // Without the project saying it is a mod, the same three tie on files and fall back to name order.
  const quiet = rulePick(cands, facts({ tells: [], outline: ['docs/', 'tests/', 'vitest.config.ts'] })).map(p => p.name)
  expect(quiet).toEqual(['ecc:ai-regression-testing', 'ecc:e2e-testing'])
})

test('the rule pick never seats a tool-like skill, and leaves a seat empty when nothing fits it', () => {
  const picks = rulePick([cand('ecc:strategic-compact', { kind: 'skill', uses: 9 }), cand('ecc:code-reviewer')], facts({ outline: [], tells: [] }))
  expect(picks).toEqual([{ seat: 'Check', name: 'ecc:code-reviewer' }])
  expect(rulePick([], facts())).toEqual([])
})
