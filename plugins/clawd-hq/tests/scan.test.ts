import { expect, test } from 'claude-code/testing'
import type { PastUse, ProjectFacts } from '../hooks/onboard-types'
import { guessRole, projectFacts } from '../hooks/scan'
import { fakeScan } from './scan-fake'

const root = '/work/proj'
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
const repo: Record<string, string> = {
  [`${root}/.claude-plugin/marketplace.json`]: '{}',
  [`${root}/.env.local`]: 'SECRET=1',
  [`${root}/CLAUDE.md`]: '# Rules\nBe plain.\n@docs/extra.md\n@../secret.md\n',
  [`${root}/README.md`]: lines(50),
  [`${root}/docs/extra.md`]: 'Extra words.',
  [`${root}/node_modules/x/index.js`]: 'x',
  [`${root}/plugins/clawd-hq/package.json`]: JSON.stringify({ dependencies: { react: '1' }, devDependencies: { vitest: '2' } }),
  [`${root}/plugins/clawd-hq/hooks/a.ts`]: 'a',
  [`${root}/plugins/clawd-hq/hooks/b.tsx`]: 'b',
  [`${root}/plugins/clawd-hq/tests/a.test.ts`]: 't',
}

test('the quiet look finds the signs, file types, outline, dependencies, readme and instructions', async () => {
  const f = fakeScan(repo)
  const facts = await projectFacts(f.io)
  expect(facts.tells).toEqual(['has .claude-plugin/ : a Claude Code plugin / mod', 'has plugins/ : a monorepo-style layout'])
  expect(facts.fileTypes).toEqual({ '.md': 3, '.json': 2, '.ts': 2, '.local': 1, '.tsx': 1 })
  expect(facts.codeFiles).toBe(3)
  expect(facts.deps).toEqual(['react', 'vitest'])
  expect(facts.readmeHead).toBe(lines(40))
  expect(facts.outline).toEqual([
    '.claude-plugin/', '  marketplace.json', 'CLAUDE.md', 'README.md', 'docs/', '  extra.md', 'plugins/', '  clawd-hq/', '    hooks/', '    tests/',
  ])
})

test('instructions carry the project file and what it imports, never a path that leaves the project', async () => {
  const f = fakeScan(repo)
  const { instructions } = await projectFacts(f.io)
  expect(instructions).toContain('--- CLAUDE.md\n# Rules')
  expect(instructions).toContain('--- docs/extra.md (imported)\nExtra words.')
  expect(instructions).not.toContain('never read')
  expect(f.log.reads).not.toContain(`${root}/../secret.md`)
})

test('heavy folders are not opened and environment files are left out of the outline', async () => {
  const f = fakeScan(repo)
  const facts = await projectFacts(f.io)
  expect(f.log.lists.some(d => d.includes('node_modules'))).toBe(false)
  expect(facts.outline.join('\n')).not.toContain('.env')
})

test('the folders are listed only to a limited depth', async () => {
  const deep = fakeScan({ [`${root}/a/b/c/d/ok.ts`]: 'x', [`${root}/a/b/c/d/e/no.ts`]: 'x' })
  const facts = await projectFacts(deep.io)
  expect(facts.fileTypes).toEqual({ '.ts': 1 })
  expect(deep.log.lists.some(d => d.endsWith('/d/e'))).toBe(false)
})

test('an empty folder gives empty facts, not an error', async () => {
  const facts = await projectFacts(fakeScan({}).io)
  expect(facts).toEqual({ tells: [], fileTypes: {}, outline: [], deps: [], readmeHead: '', instructions: '', codeFiles: 0 })
})

test('a broken manifest is ignored and python requirements give names', async () => {
  const facts = await projectFacts(fakeScan({
    [`${root}/package.json`]: '{ nope',
    [`${root}/requirements.txt`]: 'pandas==2.0\n# note\nnumpy>=1\ntorch\n',
  }).io)
  expect(facts.deps).toEqual(['pandas', 'numpy', 'torch'])
})

test('a next.config, a vercel.json and a vitest config each add a sign', async () => {
  const facts = await projectFacts(fakeScan({
    [`${root}/next.config.mjs`]: '', [`${root}/vercel.json`]: '{}', [`${root}/vitest.config.ts`]: '',
  }).io)
  expect(facts.tells).toEqual(['has next.config : a Next.js web app', 'deployed on Vercel', 'tests run with vitest'])
})

const base: ProjectFacts = { tells: [], fileTypes: {}, outline: [], deps: [], readmeHead: '', instructions: '', codeFiles: 20 }
const none: PastUse = { agents: {}, skills: {}, files: 0, skipped: 0 }
const facts = (over: Partial<ProjectFacts>): ProjectFacts => ({ ...base, ...over })

test('a plugin sign gives a tool or plugin builder', () => {
  expect(guessRole(facts({ tells: ['has .claude-plugin/ : a Claude Code plugin / mod'], fileTypes: { '.ts': 20 } }), none))
    .toEqual({ role: 'Tool or plugin builder', isThin: false })
})

test('web dependencies and web files give a web developer', () => {
  expect(guessRole(facts({ deps: ['next', 'react'], fileTypes: { '.tsx': 15, '.css': 3 } }), none).role).toBe('Web developer')
  expect(guessRole(facts({ fileTypes: { '.html': 8, '.css': 6, '.js': 6 } }), none).role).toBe('Web developer')
})

test('data libraries and notebooks give data / ml', () => {
  expect(guessRole(facts({ deps: ['pandas', 'torch'], fileTypes: { '.py': 12 } }), none).role).toBe('Data / ML')
  expect(guessRole(facts({ fileTypes: { '.ipynb': 9, '.py': 3 } }), none).role).toBe('Data / ML')
})

test('swift, kotlin and flutter give a mobile developer', () => {
  expect(guessRole(facts({ fileTypes: { '.swift': 30, '.json': 2 } }), none).role).toBe('Mobile developer')
  expect(guessRole(facts({ deps: ['react-native', 'expo'], fileTypes: { '.tsx': 10 } }), none).role).toBe('Mobile developer')
})

test('mostly prose and almost no code gives a writer or researcher', () => {
  const g = guessRole(facts({ codeFiles: 0, fileTypes: { '.md': 30, '.pdf': 4 }, instructions: '--- CLAUDE.md\nWrite well.' }), none)
  expect(g).toEqual({ role: 'Writer or researcher', isThin: false })
})

test('a code folder full of docs is not a writer', () => {
  expect(guessRole(facts({ codeFiles: 40, fileTypes: { '.go': 40, '.md': 60 } }), none).role).toBe('Software engineer')
})

test('plain code with no other sign is a software engineer', () => {
  expect(guessRole(facts({ fileTypes: { '.go': 50 } }), none)).toEqual({ role: 'Software engineer', isThin: false })
})

test('what past sessions used can tip a close call', () => {
  const used: PastUse = { ...none, files: 4, skills: { 'frontend-patterns': 3, 'react-patterns': 1 } }
  expect(guessRole(facts({ fileTypes: { '.js': 10 } }), used).role).toBe('Web developer')
})

test('thin evidence: few code files, no instruction files and no past use', () => {
  expect(guessRole(facts({ codeFiles: 2 }), none)).toEqual({ role: 'Software engineer', isThin: true })
  expect(guessRole(facts({ codeFiles: 4, instructions: 'x' }), none).isThin).toBe(false)
  expect(guessRole(facts({ codeFiles: 4 }), { ...none, files: 1 }).isThin).toBe(false)
  expect(guessRole(facts({ codeFiles: 5 }), none).isThin).toBe(false)
})

const ROLES = ['Software engineer', 'Web developer', 'Data / ML', 'Mobile developer', 'Tool or plugin builder', 'Writer or researcher']

test('every guess comes from the fixed list', () => {
  for (const f of [facts({}), facts({ deps: ['next'] }), facts({ fileTypes: { '.swift': 9 } }), facts({ codeFiles: 0, fileTypes: { '.md': 9 } })]) {
    expect(ROLES).toContain(guessRole(f, none).role)
  }
})
