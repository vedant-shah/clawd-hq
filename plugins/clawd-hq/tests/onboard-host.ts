// The test host for setup end to end: a small project on disk, installed agents and skills, the question box, the
// models, hires and the prompt box, each answered the way the tests say and recorded.
import type { Engine } from 'claude-code/testing'
import { PANE, host } from './host'

type On = Parameters<typeof host>[0]
type Surface = 'terminal' | 'desktop'

export const CWD = '/repo'
export const HOME = '/home/me'
export const RUN_Q = 'Should I run the chat as your chief of staff, handing real work to specialists?'
export const QUIET_Q = 'Should I keep the chat quiet, hiding the "finished" notices of specialists I hired?'

/** A project with code and no tests, a README, and a CLAUDE.md that names a helper and lists a routine. */
export const PROJECT: Readonly<Record<string, string>> = {
  [`${CWD}/package.json`]: JSON.stringify({ dependencies: { express: '1' } }),
  [`${CWD}/src/app.ts`]: 'export const app = 1\n',
  [`${CWD}/src/routes.ts`]: 'export const routes = []\n',
  [`${CWD}/src/db.ts`]: 'export const db = {}\n',
  [`${CWD}/src/auth.ts`]: 'export const auth = {}\n',
  [`${CWD}/src/util.ts`]: 'export const util = {}\n',
  [`${CWD}/README.md`]: '# Shop API\n\nA small shop backend.\n',
  [`${CWD}/CLAUDE.md`]: '# Rules\n\nUse ecc:planner before a big change.\n\n1. Plan the change first\n2. Write the tests\n3. Build it\n',
  [`${HOME}/.claude/skills/old-notes/SKILL.md`]: '---\nname: old-notes\ndescription: Keeps notes the old way.\n---\nBody.\n',
}

/** The agents Claude Code offers here, and what each is for. */
export const AGENTS: Readonly<Record<string, string>> = {
  'ecc:planner': 'Plans work before anyone builds.',
  'ecc:code-reviewer': 'Reviews code for quality and security.',
  'ecc:go-reviewer': 'Reviews Go code.',
  'legal:review-contract': 'Reads contracts closely.',
  Explore: 'Maps a codebase.',
}

/** The engine's breakdown: the agents above and one plugin skill; `old-notes` is on disk only, so a hire of it is dropped. */
export const LOADED = {
  agents: Object.keys(AGENTS).map(agentType => ({ agentType, source: 'plugin', tokens: 10 })),
  skills: { totalSkills: 1, includedSkills: 1, tokens: 10, skillFrontmatter: [{ name: 'ecc:tdd-workflow', source: 'plugin', pluginName: 'ecc', tokens: 10 }] },
}

export const OPUS_TEAM = JSON.stringify({ picks: [
  { seat: 'Plan', name: 'ecc:planner', why: 'MODEL WORDS' },
  { seat: 'Make', name: 'ecc:tdd-workflow', why: 'MODEL WORDS' },
  { seat: 'Check', name: 'ecc:code-reviewer', why: 'MODEL WORDS' },
  { seat: 'Specialist', name: 'old-notes', why: 'MODEL WORDS' },
] })
export const WORKFLOW_REPLY = '1. Plan the change first.\n2. Write the tests.\n3. Build it.'

type Box = { mode: 'answer' | 'deny' | 'throw'; answers: Record<string, string> }

/** Everything setup calls, answered and recorded. `opus` and `haiku` are the team answers (undefined: no answer). */
export function onboardHost(on: On, store: Record<string, unknown> = {}) {
  const h = host(on, [], store)
  for (const [path, text] of Object.entries(PROJECT)) h.files.set(path, text)
  h.session.loaded = LOADED
  const models = { opus: OPUS_TEAM as string | undefined, haiku: undefined as string | undefined, workflow: WORKFLOW_REPLY as string | undefined }
  const box: Box = { mode: 'answer', answers: { [RUN_Q]: 'Yes (Recommended)', [QUIET_Q]: 'No' } }
  const calls = { models: [] as Array<{ model: string; prompt: string }>, boxes: 0, asked: [] as Array<{ question: string; labels: string[] }>, fills: [] as string[], sent: [] as string[], fetches: [] as string[], registered: [] as Array<{ name: string; skills?: readonly string[] }>, configSets: [] as unknown[] }
  const children = (dir: string) => {
    const prefix = `${dir.replace(/\/+$/, '')}/`
    const names = new Map<string, boolean>()
    for (const p of h.files.keys()) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash < 0 ? rest : rest.slice(0, slash)
      names.set(name, slash >= 0 || (names.get(name) ?? false))
    }
    return [...names].map(([name, isDir]) => ({ name, kind: isDir ? 'dir' : 'file', size: isDir ? 0 : (h.files.get(`${prefix}${name}`) ?? '').length }))
  }
  on('fs.list', (_$, e) => ({ value: children((e as { path: string }).path) }) as never)
  on('fs.stat', (_$, e) => ({ value: { kind: 'file', size: (h.files.get((e as { path: string }).path) ?? '').length, mtimeMs: 0, isLink: false } }) as never)
  on('fs.ancestors', (_$, e) => ({ value: (e as { names: string[] }).names.flatMap(name => (h.files.has(`${CWD}/${name}`) ? [{ dir: CWD, name, content: h.files.get(`${CWD}/${name}`), parts: [] }] : [])) }) as never)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'HOME' ? HOME : undefined }) as never)
  on('model.complete', (_$, e) => {
    const { model, prompt } = e as { model: string; prompt: string }
    calls.models.push({ model, prompt })
    const text = prompt.includes('<instructions>') ? models.workflow : model === 'opus' ? models.opus : models.haiku
    return { value: text === undefined ? { isAnswered: false, reason: 'error' } : { isAnswered: true, text, usage: {} } } as never
  })
  on('tool.call', (_$, e) => {
    if ((e as { tool: string }).tool !== 'AskUserQuestion') return { result: 'ok' } as never
    calls.boxes += 1
    for (const q of (e as { questions?: Array<{ question: string; options: Array<{ label: string }> }> }).questions ?? []) calls.asked.push({ question: q.question, labels: q.options.map(o => o.label) })
    if (box.mode === 'throw') throw new Error('no question box here')
    return (box.mode === 'deny' ? { deny: 'not available' } : { result: { answers: box.answers } }) as never
  })
  on('agent.register', (_$, e) => (calls.registered.push(e as never), { value: { agent: `clawd-hq:${(e as { name: string }).name}` } }) as never)
  on('command.list', () => ({ value: [{ name: 'ecc:tdd-workflow', description: 'Writes tests first, then the code.', source: 'plugin' }] }) as never)
  on('prompt.fill', (_$, e) => (calls.fills.push((e as { text: string }).text), { isFilled: true }) as never)
  on('prompt.submit', (_$, e) => (calls.sent.push((e as { text: string }).text), { text: (e as { text: string }).text }) as never)
  on('http.fetch', (_$, e) => (calls.fetches.push(String((e as { url: string }).url)), { value: { status: 500 } }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('config.set', (_$, e) => (calls.configSets.push(e), { value: (e as { value: unknown }).value }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('agent.offer', () => ({ isOffered: true }) as never)
  return { ...h, models, box, calls }
}
export type OnboardHost = ReturnType<typeof onboardHost>

/** Lets background work run a round at a time without moving the clock. */
export const settle = async (h: OnboardHost, rounds = 60) => { for (let i = 0; i < rounds; i += 1) await h.clock.advance(0) }
/** Enough frames for the setup check (every 8th), then the work it started. */
export const frames = async (h: OnboardHost, n = 9) => { for (let i = 0; i < n; i += 1) await h.clock.advance(400); await settle(h) }

/** Every agent type is offered, as Claude Code does at session start. */
export async function offerAgents($: Engine) {
  for (const [agent, description] of Object.entries(AGENTS)) await $.agent.offer({ agent, description } as never)
}

/** The Office tab as drawn now: its texts and the setup card's buttons (key and label). */
export async function office($: Engine, surface: Surface) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => String(t.text))
  const buttons = (await ui.findAll({ type: 'Button' })).map(b => ({ key: String(b.key), label: String(b.props.label) }))
  await ui.unmount()
  const setup = buttons.filter(b => b.key.startsWith('onboard-'))
  return { texts, joined: texts.join('\n'), setup, labels: setup.map(b => b.label) }
}

/** Presses one setup button on the Office tab and lets the step it starts run. */
export async function press($: Engine, h: OnboardHost, surface: Surface, key: string) {
  const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
  await ui.press({ key })
  await ui.unmount()
  await settle(h)
}

export const saveOf = (h: OnboardHost) => h.saved.get(`onboard:${CWD}`) as { step: string; later?: true; pending: unknown[]; role?: string } | undefined
