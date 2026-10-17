import { expect, test } from 'claude-code/testing'
import type { PastUse, UsageBreakdown } from '../hooks/onboard-types'
import { BUILT_INS, firstSentence, frontMatterDescription, installedHelpers, isBuiltIn } from '../hooks/helpers'
import { fakeScan } from './scan-fake'

const none: PastUse = { agents: {}, skills: {}, files: 0, skipped: 0 }
const breakdown: UsageBreakdown = {
  agents: [
    { name: 'ecc:planner', source: 'plugin' },
    { name: 'my-helper', source: 'userSettings' },
    { name: 'repo-bot', source: 'projectSettings' },
  ],
  skills: [
    { name: 'grill-me', source: 'userSettings' },
    { name: 'ecc:aside', source: 'plugin', pluginName: 'ecc' },
  ],
}
const find = <T extends { name: string }>(list: readonly T[], name: string) => list.find(h => h.name === name)

test('a sentence is the first one, whitespace folded, at most 160 characters and never cut mid-word', () => {
  expect(firstSentence('Plans things.  Then more\nwords here.')).toBe('Plans things.')
  expect(firstSentence('No full stop at all')).toBe('No full stop at all')
  expect(firstSentence('')).toBe('')
  const long = firstSentence(`${'word '.repeat(60)}end.`)
  expect(long.length).toBeLessThanOrEqual(160)
  expect(long.endsWith('word')).toBe(true)
})

test('a description is read from front matter: plain, quoted, or folded over lines', () => {
  expect(frontMatterDescription('---\nname: x\ndescription: Does a thing. More.\n---\nbody')).toBe('Does a thing. More.')
  expect(frontMatterDescription('---\ndescription: "Quoted: yes"\n---')).toBe('Quoted: yes')
  expect(frontMatterDescription('---\ndescription: >\n  First line\n  second line.\nname: z\n---')).toBe('First line second line.')
  expect(frontMatterDescription('no front matter')).toBe('')
})

test('the built-in helpers are known by name', () => {
  expect([...BUILT_INS].sort()).toEqual(['Explore', 'Plan', 'general-purpose', 'statusline-setup'])
  expect(isBuiltIn('Explore')).toBe(true)
  expect(isBuiltIn('planner')).toBe(false)
})

test('agents and skills come from what the engine lists, with where each came from', async () => {
  const f = fakeScan({}, { breakdown, blurbs: { 'ecc:planner': 'Plans big work. Slowly.', 'my-helper': 'Helps me.' } })
  const list = await installedHelpers(f.io, none, '')
  expect(find(list, 'ecc:planner')).toEqual({ name: 'ecc:planner', kind: 'agent', source: 'ecc', plugin: 'ecc', about: 'Plans big work.', uses: 0, isNamed: false, isOwn: false })
  expect(find(list, 'my-helper')).toMatchObject({ kind: 'agent', source: 'your own', isOwn: true, about: 'Helps me.' })
  expect(find(list, 'repo-bot')).toMatchObject({ source: 'this project', isOwn: false })
  expect(find(list, 'ecc:aside')).toMatchObject({ kind: 'skill', source: 'ecc', plugin: 'ecc' })
  expect(find(list, 'grill-me')).toMatchObject({ kind: 'skill', source: 'your own', isOwn: true })
})

test('a skill is described from the engine command list, else from its own SKILL.md', async () => {
  const f = fakeScan(
    { '/home/me/.claude/skills/grill-me/SKILL.md': '---\nname: grill-me\ndescription: Interview the user. Relentlessly.\n---\n' },
    { breakdown, commands: [{ name: 'ecc:aside', description: 'Answer a side question. Resume after.' }] },
  )
  const list = await installedHelpers(f.io, none, '')
  expect(find(list, 'ecc:aside')?.about).toBe('Answer a side question.')
  expect(find(list, 'grill-me')?.about).toBe('Interview the user.')
})

test('a command listed by its short name still describes a prefixed skill', async () => {
  const f = fakeScan({}, { breakdown, commands: [{ name: 'aside', description: 'Short name match.' }] })
  expect(find(await installedHelpers(f.io, none, ''), 'ecc:aside')?.about).toBe('Short name match.')
})

test('own skills and agents on disk are found when the engine list is missing or cut', async () => {
  const f = fakeScan({
    '/home/me/.claude/skills/cut-one/SKILL.md': '---\ndescription: Was cut from the list.\n---',
    '/home/me/.claude/agents/disk-agent.md': '---\nname: disk-agent\ndescription: An agent on disk.\n---',
    '/work/proj/.claude/skills/proj-skill/SKILL.md': '---\ndescription: Project skill.\n---',
  })
  const list = await installedHelpers(f.io, none, '')
  expect(find(list, 'cut-one')).toMatchObject({ kind: 'skill', isOwn: true, source: 'your own', about: 'Was cut from the list.' })
  expect(find(list, 'disk-agent')).toMatchObject({ kind: 'agent', isOwn: true, about: 'An agent on disk.' })
  expect(find(list, 'proj-skill')).toMatchObject({ kind: 'skill', isOwn: false, source: 'this project' })
})

test('a helper on disk and in the engine list appears once', async () => {
  const f = fakeScan({ '/home/me/.claude/skills/grill-me/SKILL.md': '---\ndescription: Hi.\n---' }, { breakdown })
  expect((await installedHelpers(f.io, none, '')).filter(h => h.name === 'grill-me')).toHaveLength(1)
})

test('blurbs the agent hook kept add agents the engine list did not carry', async () => {
  const f = fakeScan({}, { blurbs: { 'seen-agent': 'Seen once.' } })
  expect(await installedHelpers(f.io, none, '')).toEqual([
    { name: 'seen-agent', kind: 'agent', source: 'installed', about: 'Seen once.', uses: 0, isNamed: false, isOwn: false },
  ])
})

test('uses come from past sessions, by full name or the name with its plugin', async () => {
  const f = fakeScan({}, { breakdown })
  const used: PastUse = { agents: { 'ecc:planner': 3, 'my-helper': 2 }, skills: { aside: 1, 'ecc:aside': 4 }, files: 2, skipped: 0 }
  const list = await installedHelpers(f.io, used, '')
  expect(find(list, 'ecc:planner')?.uses).toBe(3)
  expect(find(list, 'my-helper')?.uses).toBe(2)
  expect(find(list, 'ecc:aside')?.uses).toBe(5)
})

test('named in an instruction file is a whole-word match, so a longer name does not count', async () => {
  const f = fakeScan({}, { breakdown })
  const list = await installedHelpers(f.io, none, 'Use the my-helper agent. Never repo-bot-extra. Ask ecc:planner first.')
  expect(find(list, 'my-helper')?.isNamed).toBe(true)
  expect(find(list, 'repo-bot')?.isNamed).toBe(false)
  expect(find(list, 'ecc:planner')?.isNamed).toBe(true)
})

test('a plugin agent is also named by its distinctive short name', async () => {
  const b: UsageBreakdown = { agents: [{ name: 'ecc:code-reviewer', source: 'plugin' }, { name: 'ecc:planner', source: 'plugin' }], skills: [] }
  const list = await installedHelpers(fakeScan({}, { breakdown: b }).io, none, 'Run the code-reviewer. Make a planner happy.')
  expect(find(list, 'ecc:code-reviewer')?.isNamed).toBe(true)
  expect(find(list, 'ecc:planner')?.isNamed).toBe(false)
})

test('helpers past sessions used that are not installed are added with a description Clawd HQ wrote; built-ins are not', async () => {
  const used: PastUse = { agents: { 'claude-code-guide': 5, Explore: 9, 'odd-one': 2 }, skills: { 'gone-skill': 1 }, files: 3, skipped: 0 }
  const list = await installedHelpers(fakeScan({}).io, used, '')
  expect(find(list, 'claude-code-guide')).toMatchObject({ kind: 'agent', source: 'built in / not on disk', uses: 5 })
  expect(find(list, 'claude-code-guide')?.about).toMatch(/Claude Code/)
  expect(find(list, 'odd-one')?.about).toBe('Used here before; no description available.')
  expect(find(list, 'gone-skill')).toMatchObject({ kind: 'skill', uses: 1 })
  expect(find(list, 'Explore')).toBeUndefined()
})

test('a used name that matches an installed helper is not added twice', async () => {
  const f = fakeScan({}, { breakdown })
  const list = await installedHelpers(f.io, { ...none, files: 1, skills: { aside: 1 } }, '')
  expect(list.filter(h => h.kind === 'skill' && h.name.endsWith('aside'))).toHaveLength(1)
})

test('built-in helpers in the engine list are left out', async () => {
  const b: UsageBreakdown = { agents: [{ name: 'general-purpose', source: 'built-in' }, { name: 'x', source: 'plugin' }], skills: [] }
  expect((await installedHelpers(fakeScan({}, { breakdown: b }).io, none, '')).map(h => h.name)).toEqual(['x'])
})

test('nothing available gives an empty list, and a failing engine list does not stop the rest', async () => {
  expect(await installedHelpers(fakeScan({}).io, none, '')).toEqual([])
  const f = fakeScan({}, { blurbs: { a: 'Fine.' } })
  const list = await installedHelpers({ ...f.io, breakdown: async () => { throw new Error('boom') } }, none, '')
  expect(list.map(h => h.name)).toEqual(['a'])
})
