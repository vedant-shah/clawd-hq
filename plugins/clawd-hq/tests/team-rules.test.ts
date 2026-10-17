import { expect, test } from 'claude-code/testing'
import type { Helper, PastUse, ProjectFacts } from '../hooks/onboard-types'
import { BUILTINS, candidateList, isToolLike, isWrongLanguage, projectSignals, projectTech, receiptOf, rulePick } from '../hooks/team-rules'
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

test('tool-like skills are noise, by name or by what they say they do', () => {
  for (const name of ['pptx', 'loop', 'strategic-compact', 'skill-creator', 'hookify-list', 'epic-sync']) expect(isToolLike(name, 'Helps.')).toBe(true)
  expect(isToolLike('deck-maker', 'Makes .pptx files from notes.')).toBe(true)
  expect(isToolLike('cron-thing', 'Runs a prompt on a recurring interval.')).toBe(true)
  for (const name of ['planner', 'tdd-workflow', 'code-review', 'shadcn']) expect(isToolLike(name, 'Helps build things.')).toBe(false)
})

test('the project\'s languages come from file counts, manifests and dependencies', () => {
  const ts = projectTech(facts())
  for (const lang of ['TypeScript', 'JavaScript']) expect(ts.has(lang)).toBe(true)
  expect(ts.has('Python')).toBe(false)
  const py = projectTech(facts({ fileTypes: { py: 40 }, outline: ['pyproject.toml'], deps: [] }))
  expect(py.has('Python')).toBe(true)
  expect(projectTech(facts({ deps: ['react', 'next'] })).has('React')).toBe(true)
  // A handful of files is not a language of the project.
  expect(projectTech(facts({ fileTypes: { '.ts': 200, '.py': 3 } })).has('Python')).toBe(false)
})

test('a helper for a language the project does not use is the wrong language, by name or by its description', () => {
  const tech = projectTech(facts())
  expect(isWrongLanguage('ecc:python-reviewer', 'Reviews code.', tech)).toBe(true)
  expect(isWrongLanguage('ecc:go-build', 'Fixes builds.', tech)).toBe(true)
  expect(isWrongLanguage('ecc:code-reviewer', 'Reviews code.', tech)).toBe(false)
  expect(isWrongLanguage('ecc:typescript-reviewer', 'Reviews TypeScript code.', tech)).toBe(false)
  expect(isWrongLanguage('ecc:patterns', 'Idiomatic Django and FastAPI patterns.', tech)).toBe(true)
  // A description that names the project's own language as well stays.
  expect(isWrongLanguage('ecc:api', 'REST patterns for Python and TypeScript.', tech)).toBe(false)
  expect(isWrongLanguage('ecc:python-reviewer', 'Reviews code.', projectTech(facts({ fileTypes: { '.py': 50 } })))).toBe(false)
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
  ], use(), facts())
  expect(ids(list)).toEqual(['ecc:planner', 'ecc:loop', 'pdf', 'ecc:django-reviewer'])
  for (const name of BUILTINS) expect(ids(list)).not.toContain(name)
})

test('a candidate\'s id carries its plugin, and its past use is counted by that id or its bare name', () => {
  const list = candidateList(
    [helper('planner', { uses: 1 }), helper('ecc:code-reviewer'), skill('tdd-workflow'), skill('mine', { isOwn: true, plugin: undefined, source: 'user' })],
    use({ agents: { 'ecc:code-reviewer': 40, 'code-reviewer': 3, planner: 6 }, skills: { 'ecc:tdd-workflow': 2, mine: 5 } }),
    facts(),
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
  }), facts())
  expect(ids(list)).toEqual(['ecc:planner', 'claude-code-guide', 'mystery-skill'])
  const guide = list[1]!
  expect(guide.uses).toBe(3)
  expect(guide.about).toMatch(/Claude Code/)
  expect(list[2]!.about).toBe('(no description available)')
})

test('odd keys in the past-use record never count as use', () => {
  const list = candidateList([helper('constructor', { plugin: undefined }), helper('toString', { plugin: undefined })], use({ agents: { toString: 'many' as unknown as number } }), facts())
  expect(list.map(c => c.uses)).toEqual([0, 0])
})

test('one id appears once, the agent first', () => {
  const list = candidateList([skill('planner'), helper('planner')], use(), facts())
  expect(list.map(c => [c.id, c.kind])).toEqual([['ecc:planner', 'agent']])
})

test('a description is cut to one plain line', () => {
  const [c] = candidateList([helper('planner', { about: 'Plans\nthings well. And more.' + 'x'.repeat(400) })], use(), facts())
  expect(c!.about).toBe('Plans things well.')
  const [long] = candidateList([helper('planner', { about: 'y'.repeat(400) })], use(), facts())
  expect(long!.about.length).toBeLessThanOrEqual(160)
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
    { seat: 'Specialist', name: 'ecc:doc-updater' },
    { seat: 'Specialist', name: 'plugin-authoring' },
    { seat: 'Specialist', name: 'claude-code-guide' },
  ])
})

test('the rule pick never seats a tool-like skill, and leaves a seat empty when nothing fits it', () => {
  const picks = rulePick([cand('ecc:strategic-compact', { kind: 'skill', uses: 9 }), cand('ecc:code-reviewer')], facts({ outline: [], tells: [] }))
  expect(picks).toEqual([{ seat: 'Check', name: 'ecc:code-reviewer' }])
  expect(rulePick([], facts())).toEqual([])
})
