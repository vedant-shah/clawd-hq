import { expect, test } from 'claude-code/testing'
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, pastUse } from '../hooks/usage-history'
import { MAX_META_BYTES, MAX_SUBAGENT_READS, agentTypeOf } from '../hooks/usage-subagents'
import { fakeScan } from './scan-fake'

const dir = '/home/me/.claude/projects/-work-proj'
const SECRET = 'a private task description'
const meta = (agentType: string) => JSON.stringify({ agentType, description: SECRET, toolUseId: 'toolu_1', spawnDepth: 1, model: 'sonnet' })
const use = (name: string, input: Record<string, unknown>) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } })
const sub = (session: string, id: string, ext: 'meta.json' | 'jsonl' | 'prefix.json') => `${dir}/${session}/subagents/agent-${id}.${ext}`
const big = (session: string) => ({ [`${dir}/${session}.jsonl`]: MAX_FILE_BYTES + 1 })

test('an agent type is read from a meta file, and nothing else in it', () => {
  expect(agentTypeOf(meta('ecc:tdd-guide'))).toBe('ecc:tdd-guide')
  for (const bad of ['not json', '{}', '{"agentType":""}', '{"agentType":7}', 'null', JSON.stringify({ agentType: 'x'.repeat(101) })]) expect(agentTypeOf(bad)).toBeUndefined()
})

test('a session file too big to read still names its agents, from the meta files beside it', async () => {
  const f = fakeScan({
    [`${dir}/s1.jsonl`]: 'never read',
    [sub('s1', 'a', 'meta.json')]: meta('ecc:tdd-guide'),
    [sub('s1', 'b', 'meta.json')]: meta('ecc:tdd-guide'),
    [sub('s1', 'c', 'meta.json')]: meta('ecc:planner'),
    [sub('s1', 'x', 'prefix.json')]: '{"agentType":"ecc:ignored"}',
  }, { sizes: big('s1') })
  const got = await pastUse(f.io)
  expect(got).toEqual({ agents: { 'ecc:tdd-guide': 2, 'ecc:planner': 1 }, skills: {}, files: 0, skipped: 1 })
  expect(JSON.stringify(got)).not.toContain(SECRET)
  expect(f.log.reads).not.toContain(`${dir}/s1.jsonl`)
})

test('a session file that was read is not counted twice: its meta files are left alone', async () => {
  const f = fakeScan({
    [`${dir}/s1.jsonl`]: use('Agent', { subagent_type: 'ecc:planner' }),
    [sub('s1', 'a', 'meta.json')]: meta('ecc:planner'),
    [`${dir}/s2.jsonl`]: 'x',
    [sub('s2', 'a', 'meta.json')]: meta('ecc:code-reviewer'),
  }, { sizes: big('s2') })
  const got = await pastUse(f.io)
  expect(got.agents).toEqual({ 'ecc:planner': 1, 'ecc:code-reviewer': 1 })
  expect(f.log.reads).not.toContain(sub('s1', 'a', 'meta.json'))
})

test('the skills a subagent ran are counted from its own file, for read and unread sessions alike; its agent calls are not', async () => {
  const f = fakeScan({
    [`${dir}/s1.jsonl`]: use('Skill', { skill: 'main-skill' }),
    [sub('s1', 'a', 'jsonl')]: [use('Skill', { skill: 'ecc:plan' }), use('Agent', { subagent_type: 'nested' }), 'not json "tool_use"'].join('\n'),
    [`${dir}/s2.jsonl`]: 'x',
    [sub('s2', 'a', 'jsonl')]: use('Skill', { skill: 'ecc:plan' }),
    [sub('s2', 'a', 'meta.json')]: meta('ecc:planner'),
  }, { sizes: big('s2') })
  const got = await pastUse(f.io)
  expect(got.skills).toEqual({ 'main-skill': 1, 'ecc:plan': 2 })
  expect(got.agents).toEqual({ 'ecc:planner': 1 })
})

test('meta files that are not JSON, name no type, are too big, or are not agent files add nothing', async () => {
  const f = fakeScan({
    [`${dir}/s1.jsonl`]: 'x',
    [sub('s1', 'a', 'meta.json')]: 'not json',
    [sub('s1', 'b', 'meta.json')]: '{"model":"sonnet"}',
    [sub('s1', 'c', 'meta.json')]: meta('too-big'),
    [`${dir}/s1/subagents/notes.meta.json`]: meta('not-an-agent-file'),
    [sub('s1', 'd', 'meta.json')]: meta('fine'),
  }, { sizes: { ...big('s1'), [sub('s1', 'c', 'meta.json')]: MAX_META_BYTES + 1 } })
  expect((await pastUse(f.io)).agents).toEqual({ fine: 1 })
})

test('subagent files stay inside the byte budget that the session files left, and one over 4 MiB is never read', async () => {
  // Eight session files take all but 100 bytes of the budget.
  const files: Record<string, string> = { [sub('s1', 'a', 'jsonl')]: use('Skill', { skill: 'fits' }), [sub('s1', 'b', 'jsonl')]: use('Skill', { skill: 'too-much' }), [sub('s1', 'c', 'jsonl')]: use('Skill', { skill: 'huge' }) }
  const sizes: Record<string, number> = { [sub('s1', 'a', 'jsonl')]: 60, [sub('s1', 'b', 'jsonl')]: 60, [sub('s1', 'c', 'jsonl')]: MAX_FILE_BYTES + 1 }
  const times: Record<string, number> = { [sub('s1', 'a', 'jsonl')]: 3, [sub('s1', 'b', 'jsonl')]: 2, [sub('s1', 'c', 'jsonl')]: 1 }
  for (let i = 1; i <= 8; i += 1) {
    files[`${dir}/s${i}.jsonl`] = i === 1 ? use('Skill', { skill: 'main' }) : 'x'
    sizes[`${dir}/s${i}.jsonl`] = i === 8 ? MAX_FILE_BYTES - 100 : MAX_FILE_BYTES
  }
  const f = fakeScan(files, { sizes, times })
  const got = await pastUse(f.io)
  expect(got.files).toBe(8)
  expect(got.skills).toEqual({ main: 1, fits: 1 })
})

test('no more than 1000 subagent files are read in all, meta files first', async () => {
  const files: Record<string, string> = { [`${dir}/s1.jsonl`]: 'x' }
  for (let i = 0; i < MAX_SUBAGENT_READS + 5; i += 1) files[sub('s1', String(i), 'meta.json')] = meta('worker')
  files[sub('s1', 'z', 'jsonl')] = use('Skill', { skill: 'late' })
  const f = fakeScan(files, { sizes: big('s1') })
  const got = await pastUse(f.io)
  expect(got.agents).toEqual({ worker: MAX_SUBAGENT_READS })
  expect(got.skills).toEqual({})
  expect(f.log.reads.filter(p => p.includes('/subagents/'))).toHaveLength(MAX_SUBAGENT_READS)
})

test('the running tally fills in a session whose file was not read; the larger count of each name wins so nothing is counted twice', async () => {
  const f = fakeScan({
    [`${dir}/s1.jsonl`]: 'x',
    [sub('s1', 'a', 'meta.json')]: meta('ecc:planner'),
    [sub('s1', 'b', 'meta.json')]: meta('ecc:planner'),
  }, {
    sizes: big('s1'),
    store: { [`tally:/work/proj`]: { s1: { agents: { 'ecc:planner': 3, 'ecc:tdd-guide': 1 }, skills: { 'agent-reach': 2 } } } },
  })
  const got = await pastUse(f.io)
  expect(got.agents).toEqual({ 'ecc:planner': 3, 'ecc:tdd-guide': 1 })
  expect(got.skills).toEqual({ 'agent-reach': 2 })
})

test('the tally of a session whose file was read is ignored, and a session the files no longer list counts from the tally alone', async () => {
  const f = fakeScan({ [`${dir}/s1.jsonl`]: use('Agent', { subagent_type: 'ecc:planner' }) }, {
    store: { 'tally:/work/proj': { s1: { agents: { 'ecc:planner': 5 }, skills: {} }, gone: { agents: { old: 2 }, skills: { 'old-skill': 1 } } } },
  })
  const got = await pastUse(f.io)
  expect(got.agents).toEqual({ 'ecc:planner': 1, old: 2 })
  expect(got.skills).toEqual({ 'old-skill': 1 })
})

test('a damaged tally is read as far as it can be, never as an error', async () => {
  const f = fakeScan({ [`${dir}/s1.jsonl`]: 'x' }, {
    sizes: big('s1'),
    store: { 'tally:/work/proj': { s1: { agents: { good: 2, bad: 'many', neg: -1 }, skills: 'nope' }, s2: 7, s3: null } },
  })
  expect((await pastUse(f.io)).agents).toEqual({ good: 2 })
  const broken = { ...fakeScan({ [`${dir}/s1.jsonl`]: use('Skill', { skill: 'a' }) }).io, get: async () => { throw new Error('boom') } }
  expect((await pastUse(broken as never)).skills).toEqual({ a: 1 })
})
