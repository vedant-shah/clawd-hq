// find_helpers, the tool: Clawd searches every installed agent and skill for a job and gets the top five with where each stands.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { FIND_TOOL, SKILLS_CLI_NODE, SKILLS_CLI_VERSION } from '../hooks/constants'
import { SETTINGS, START } from './host'
import { CWD, HOME, offerAgents, onboardHost } from './onboard-host'

const TEAM = {
  picks: [
    { seat: 'Plan', name: 'ecc:planner', kind: 'agent', receipt: 'used 3× here' },
    { seat: 'Make', name: 'ecc:tdd-workflow', kind: 'skill', receipt: 'used 3× here' },
  ],
  empty: [],
  by: 'rules',
  hires: [{ name: 'tdd-workflow', description: 'Make: Writes tests first.', prompt: 'p', skills: ['ecc:tdd-workflow'] }],
}
const PAYROLL = { laidOff: ['ecc:go-reviewer'], isReviewed: true, stacks: [] }
type Match = { name: string; kind: string; about: string; status: string; next: string }

/** A project with a saved team, one agent laid off, and a skill on disk that is not on the team. */
async function office(on: Parameters<typeof onboardHost>[0]) {
  const h = onboardHost(on, { [`team:${CWD}`]: TEAM, [`payroll:${CWD}`]: PAYROLL })
  h.files.set(`${HOME}/.claude/skills/pitch-deck/SKILL.md`, '---\nname: pitch-deck\ndescription: Builds investor pitch decks and slide stories.\n---\nBody.\n')
  return h
}

const find = ($: Engine, input: Record<string, unknown>, agentId?: string) =>
  $.tool.call({ tool: FIND_TOOL, ...input, ...(agentId ? { agentId } : {}) } as never) as Promise<{ result?: string; deny?: string }>
const matchesOf = async ($: Engine, job: string) => (JSON.parse((await find($, { job })).result ?? '{}') as { matches: Match[] }).matches

test('the tool is registered for Clawd in the prompt\'s own list, so he needs no search to find it', async ($, on) => {
  const h = await office(on)
  await $.session.start(START)
  expect(h.tools).toContain('find_helpers')
  expect(h.toolSpecs.find(t => t.name === 'find_helpers')?.isDeferred).toBe(false)
})

test('a helper on the team is staff, with how to hire it', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  const [top] = await matchesOf($, 'plan the work')
  expect(top).toMatchObject({ name: 'ecc:planner', kind: 'agent', status: 'staff' })
  expect(top?.about).toBe('Plans work before anyone builds.')
  expect(top?.next).toContain('ecc:planner')
})

test('a skill on the team is staff, and its hire is named', async ($, on) => {
  await office(on)
  await $.session.start(START)
  const [top] = await matchesOf($, 'write tests first')
  expect(top).toMatchObject({ name: 'ecc:tdd-workflow', kind: 'skill', status: 'staff' })
  expect(top?.next).toContain('clawd-hq:tdd-workflow')
})

test('each skill match says what it adds: knowledge or process. An agent carries no such label', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  const found = await matchesOf($, 'plan the work and write tests first with an investor pitch deck')
  const by = (name: string) => found.find(m => m.name === name) as (Match & { use?: string }) | undefined
  expect(by('ecc:tdd-workflow')?.use).toBe('process')
  expect(by('pitch-deck')?.use).toBe('knowledge')
  expect(by('ecc:planner')).toBeDefined()
  expect(by('ecc:planner')).not.toHaveProperty('use')
})

test('keywords from Clawd find a paraphrased job that the plain words miss', async ($, on) => {
  await office(on)
  await $.session.start(START)
  expect(await matchesOf($, 'something for the money people')).toEqual([])
  const found = (JSON.parse((await find($, { job: 'something for the money people', keywords: ['investor', 'slides', 7, ''] })).result ?? '{}') as { matches: Match[] }).matches
  expect(found[0]).toMatchObject({ name: 'pitch-deck' })
})

test('an agent laid off for this project is still found, and marked laid off', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  const [top] = await matchesOf($, 'review my go code')
  expect(top).toMatchObject({ name: 'ecc:go-reviewer', kind: 'agent', status: 'laid off' })
  expect(top?.next).toMatch(/hire it anyway|bring/i)
})

test('an installed skill that was not picked is "not on team", and the way to hire it is a contractor', async ($, on) => {
  await office(on)
  await $.session.start(START)
  const [top] = await matchesOf($, 'make an investor pitch deck')
  expect(top).toMatchObject({ name: 'pitch-deck', kind: 'skill', status: 'not on team', about: 'Builds investor pitch decks and slide stories.' })
  expect(top?.next).toContain('hire_contractor')
})

test('the shipped four are always staff, and the plugin\'s own skill hires are not listed beside their skill', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await $.agent.offer({ agent: 'clawd-hq:core-builder', description: 'Clawd HQ\'s Builder. Carries out one scoped change.' } as never)
  await $.agent.offer({ agent: 'clawd-hq:tdd-workflow', description: 'Make: Writes tests first, then the code.' } as never)
  const found = await matchesOf($, 'build the feature and write tests first')
  expect(found.find(m => m.name === 'clawd-hq:core-builder')).toMatchObject({ kind: 'agent', status: 'staff' })
  expect(found.some(m => m.name === 'clawd-hq:tdd-workflow')).toBe(false)
})

const CORE_REVIEWER = 'clawd-hq:core-reviewer'
const REVIEW_JOB = 'review the changes, tests and diffs'
/** One sentence, since only the first is kept: it shares four of the job's words, where the code reviewer's shares one. */
const REVIEWER_ABOUT = 'Reviews the changes, tests and diffs.'

/** The office above with this payroll, every agent offered, and Clawd HQ's Reviewer described so it fits the review job best by its words. */
async function reviewOffice($: Engine, on: Parameters<typeof onboardHost>[0], payroll: Record<string, unknown>) {
  onboardHost(on, { [`team:${CWD}`]: TEAM, [`payroll:${CWD}`]: { ...PAYROLL, ...payroll } })
  await $.session.start(START)
  await offerAgents($)
  await $.agent.offer({ agent: CORE_REVIEWER, description: REVIEWER_ABOUT } as never)
  return (await matchesOf($, REVIEW_JOB)).map(m => m.name)
}

test('an installed code reviewer on the team ranks above Clawd HQ\'s Reviewer, though the Reviewer fits the words better', async ($, on) => {
  const names = await reviewOffice($, on, {})
  expect(names.indexOf('ecc:code-reviewer')).toBeLessThan(names.indexOf(CORE_REVIEWER))
  expect(names).toContain(CORE_REVIEWER)
})

test('with the code reviewer laid off, Clawd HQ\'s Reviewer ranks by its own fit', async ($, on) => {
  const names = await reviewOffice($, on, { laidOff: ['ecc:go-reviewer', 'ecc:code-reviewer'] })
  expect(names[0]).toBe(CORE_REVIEWER)
})

test('Clawd HQ\'s Reviewer, set aside for an installed one, shows as laid off', async ($, on) => {
  onboardHost(on, { [`team:${CWD}`]: TEAM, [`payroll:${CWD}`]: { ...PAYROLL, laidOff: [CORE_REVIEWER], ruleLaidOff: [CORE_REVIEWER] } })
  await $.session.start(START)
  await $.agent.offer({ agent: CORE_REVIEWER, description: REVIEWER_ABOUT } as never)
  const found = await matchesOf($, REVIEW_JOB)
  expect(found.find(m => m.name === CORE_REVIEWER)).toMatchObject({ status: 'laid off' })
})

test('at most five come back, and a job nothing fits says so and points to the general agent', async ($, on) => {
  await office(on)
  await $.session.start(START)
  await offerAgents($)
  expect((await matchesOf($, 'review plan test code contract go')).length).toBeLessThanOrEqual(5)
  const none = JSON.parse((await find($, { job: 'knit a sweater' })).result ?? '{}') as { matches: Match[]; note: string }
  expect(none.matches).toEqual([])
  expect(none.note).toMatch(/general-purpose/)
  expect(none.note).toContain('Nothing installed fits this job. Say so in one line, and why.')
})

// ---- The public skill registry, searched over the web when nothing installed fits ----

type Skill = { name: string; source: string; skillId: string; installs: number; page: string; status: string }
type Answer = { matches: Match[]; registry?: Skill[]; note?: string; ifNoneFits?: string }
const answerOf = async ($: Engine, input: Record<string, unknown>) => JSON.parse((await find($, input)).result ?? '{}') as Answer
const answerTo = ($: Engine, job: string, keywords?: string[]) => answerOf($, { job, ...(keywords ? { keywords } : {}) })
const NOTHING = 'knit a sweater'
const SOME = 'review plan test code contract go'
const PLAIN = 'Nothing installed fits this job. Use the general-purpose agent, write a fuller brief, and say in one line why nothing fit.'
const REGISTRY_JSON = JSON.stringify({
  query: 'changelog',
  skills: [
    { id: 'elevenlabs/skills/update-skills-from-changelog', source: 'elevenlabs/skills', skillId: 'update-skills-from-changelog', name: 'update-skills-from-changelog', installs: 7211 },
    { id: 'acme/tools/changelog-writer', source: 'acme/tools', skillId: 'changelog-writer', name: 'changelog-writer', installs: 480 },
  ],
})

type Web = { ok?: boolean; text?: string; throws?: boolean }
/** The host's network, as a test answers it: the office, with the registry page given back (the addresses asked for are in `calls.fetches`). */
async function web(on: Parameters<typeof onboardHost>[0], reply: Web = { text: REGISTRY_JSON }) {
  const h = await office(on)
  h.calls.web = reply
  return h.calls.fetches
}

test('with the switch on, a job nothing fits is searched on skills.sh over the web, and the answer lists what was found as not installed', async ($, on) => {
  const urls = await web(on)
  await $.session.start(START)
  await offerAgents($)
  const { matches, registry, note } = await answerTo($, NOTHING, ['changelog'])
  expect(matches).toEqual([])
  expect(urls).toEqual(['https://skills.sh/api/search?q=changelog'])
  expect(registry).toEqual([
    { name: 'update-skills-from-changelog', source: 'elevenlabs/skills', skillId: 'update-skills-from-changelog', installs: 7211, page: 'https://skills.sh/elevenlabs/skills/update-skills-from-changelog', status: 'not installed: from skills.sh' },
    { name: 'changelog-writer', source: 'acme/tools', skillId: 'changelog-writer', installs: 480, page: 'https://skills.sh/acme/tools/changelog-writer', status: 'not installed: from skills.sh' },
  ])
  expect(note).toContain('Nothing installed fits this job. Say so in one line, and why.')
  expect(note).toContain('its name, source, install count and why it fits')
  expect(note).toContain('ask whether to install it and use it for this job, or go ahead without it')
  expect(note).toContain('If none is good, say so in one line and use the general-purpose agent with a fuller brief.')
  expect(note).toContain('Never install anything without the person\'s yes.')
})

test('the install line is pinned and comes with the Node check: no run below the release\'s own Node, the skill\'s page instead, and no other route', async ($, on) => {
  await web(on)
  await $.session.start(START)
  const { note } = await answerTo($, NOTHING, ['changelog'])
  expect(SKILLS_CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  expect(SKILLS_CLI_NODE).toMatch(/^\d+\.\d+\.\d+$/)
  expect(note).toContain('Only after the person says yes: first run `node -v`.')
  expect(note).toContain(`If it is below ${SKILLS_CLI_NODE}, do not run the install: tell the person the install needs Node ${SKILLS_CLI_NODE} or newer, and give them the skill's \`page\``)
  expect(note).toContain(`run \`npx -y skills@${SKILLS_CLI_VERSION} add <source>@<skillId>\``)
  expect(note).toContain('There is no other way to install.')
  expect(note!.match(/skills@\S+/g)).toEqual([`skills@${SKILLS_CLI_VERSION}`])
})

test('no answer runs a registry `find` through npx or asks anyone to install find-skills', async ($, on) => {
  await web(on)
  await $.session.start(START)
  await offerAgents($)
  const all = [await answerTo($, NOTHING, ['changelog']), await answerTo($, SOME), await answerOf($, { job: SOME, registry: true })]
  for (const a of all) for (const text of [a.note, a.ifNoneFits]) expect(text ?? '').not.toMatch(/find-skills|vercel-labs|npx[^`]* find\b|npx skills /)
})

test('the keywords go into the address as plain words only, at most six', async ($, on) => {
  const urls = await web(on)
  await $.session.start(START)
  await answerTo($, NOTHING, ['UI; rm -rf /', 'a "quote" & $(boom)', 'layout', 'CSS', 'visual', 'polish', 'extra', 'seventh'])
  expect(urls).toEqual(['https://skills.sh/api/search?q=ui%20rm%20rf%20quote%20boom%20layout'])
  await answerTo($, 'knit a sweater in wool for the winter')
  expect(urls[1]).toBe('https://skills.sh/api/search?q=knit%20sweater%20wool%20winter')
})

const ODD: Array<[string, { ok?: boolean; text?: string; throws?: boolean }]> = [
  ['a fetch that throws', { throws: true }], ['an error status', { ok: false, text: 'nope' }], ['a body that is not JSON', { text: '<html>oops</html>' }],
  ['a skills list that is not a list', { text: '{"skills":"many"}' }], ['entries with nothing usable in them', { text: '{"skills":[{"x":1},{"source":"a b","skillId":"c"}]}' }], ['an empty body', { text: '' }],
]
for (const [what, reply] of ODD) {
  test(`${what} gives the one-line fallback to the general-purpose agent, and no list`, async ($, on) => {
    await web(on, reply)
    await $.session.start(START)
    const { registry, note } = await answerTo($, NOTHING, ['changelog'])
    expect(registry).toBeUndefined()
    expect(note).toBe('Nothing installed fits this job. Say so in one line, and why. The registry search did not work: say so in one line, and use the general-purpose agent with a fuller brief.')
  })
}

test('a search that finds nothing says so in one line and sends Clawd to the general-purpose agent', async ($, on) => {
  await web(on, { text: '{"query":"x","skills":[]}' })
  await $.session.start(START)
  const { registry, note } = await answerTo($, NOTHING, ['changelog'])
  expect(registry).toBeUndefined()
  expect(note).toContain('The registry search found nothing: say so in one line, and use the general-purpose agent with a fuller brief.')
})

test('with matches in hand nothing is fetched; none fitting is asked for again with `registry`, and then it is', async ($, on) => {
  const urls = await web(on)
  await $.session.start(START)
  await offerAgents($)
  const some = await answerTo($, SOME)
  expect(some.matches.length).toBeGreaterThan(0)
  expect(some.note).toBeUndefined()
  expect(some.ifNoneFits).toContain('call find_helpers again with the same job and keywords and `registry` set to true')
  expect(some.ifNoneFits).toContain('Never install anything without the person\'s yes.')
  expect(urls).toEqual([])
  const again = await answerOf($, { job: SOME, keywords: ['review', 'plan'], registry: true })
  expect(urls).toEqual(['https://skills.sh/api/search?q=review%20plan'])
  expect(again.matches.length).toBeGreaterThan(0)
  expect(again.registry?.map(r => r.skillId)).toEqual(['update-skills-from-changelog', 'changelog-writer'])
  expect(again.note).toContain('You judged that none of the matches fits.')
})

test('with the switch off in the settings, nothing is fetched and no search is mentioned: the plain path to the general-purpose agent', { options: { skillSearch: false } }, async ($, on) => {
  const urls = await web(on)
  await $.session.start(START)
  await offerAgents($)
  const none = await answerTo($, NOTHING, ['changelog'])
  expect(none.note).toBe(PLAIN)
  const some = await answerOf($, { job: SOME, registry: true })
  expect(some.ifNoneFits).toMatch(/general-purpose agent with a fuller brief/)
  for (const text of [none.note ?? '', some.ifNoneFits ?? '']) expect(text).not.toMatch(/skills\.sh|skills@|registry|npx|install it|node -v/)
  expect(urls).toEqual([])
  expect(some.registry).toBeUndefined()
})

test('a switch saved off in the store turns the search off', async ($, on) => {
  const h = onboardHost(on, { 'toggle:skillSearch': false })
  h.calls.web = { text: REGISTRY_JSON }
  const urls = h.calls.fetches
  await $.session.start(START)
  expect((await answerTo($, NOTHING, ['changelog'])).note).toBe(PLAIN)
  expect(urls).toEqual([])
})

test('a press of the Settings switch is followed at once, in both directions, with no reload', async ($, on) => {
  const urls = await web(on)
  await $.session.start(START)
  expect((await answerTo($, NOTHING, ['changelog'])).registry).toHaveLength(2)
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface: 'terminal', ...SETTINGS } as never)
  await ui.press({ key: 'config-skillSearch' })
  expect((await answerTo($, NOTHING, ['changelog'])).note).toBe(PLAIN)
  expect(urls).toHaveLength(1)
  await ui.press({ key: 'config-skillSearch' })
  expect((await answerTo($, NOTHING, ['changelog'])).registry).toHaveLength(2)
  expect(urls).toHaveLength(2)
  await ui.unmount()
})

test('a specialist cannot search: its call is refused with where to put the need instead', async ($, on) => {
  await office(on)
  await $.session.start(START)
  const asked = await find($, { job: 'plan the work' }, 'a1')
  expect(asked.result).toBeUndefined()
  expect(asked.deny).toMatch(/Clawd/)
})

test('a call with no job, or a job that is not text, is refused with why', async ($, on) => {
  await office(on)
  await $.session.start(START)
  for (const input of [{}, { job: '' }, { job: '   ' }, { job: 7 }]) {
    const answer = await find($, input)
    expect(answer.deny).toMatch(/job/)
  }
})

test('the search reads the lists from the engine, not the cut list the model sees: a skill past the cut is found', async ($, on) => {
  const h = await office(on)
  h.session.loaded = { ...h.session.loaded, skills: { totalSkills: 40, includedSkills: 1, tokens: 10, skillFrontmatter: [{ name: 'ecc:tdd-workflow', source: 'plugin', pluginName: 'ecc', tokens: 10 }] } }
  h.commandList.push({ name: 'marketing:seo-audit', description: 'Audits a site for search ranking problems.', source: 'plugin' })
  await $.session.start(START)
  const [top] = await matchesOf($, 'audit the site for search ranking')
  expect(top).toMatchObject({ name: 'marketing:seo-audit', kind: 'skill', status: 'not on team' })
})
