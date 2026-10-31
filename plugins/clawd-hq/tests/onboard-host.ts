// The test host for setup end to end: a small project on disk, installed agents and skills, the question box, the
// models, hires and the prompt box, each answered the way the tests say and recorded.
import type { Engine } from 'claude-code/testing'
import { PANE, host } from './host'

type On = Parameters<typeof host>[0]
type Surface = 'terminal' | 'desktop'

export const CWD = '/repo'
export const HOME = '/home/me'

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

/** Everything setup calls, answered and recorded. `opus` and `haiku` are the team answers (undefined: no answer). */
export function onboardHost(on: On, store: Record<string, unknown> = {}) {
  const agentList: unknown[] = [] // the agents the engine lists; a started scout joins it, as it would
  const h = host(on, agentList, store)
  for (const [path, text] of Object.entries(PROJECT)) h.files.set(path, text)
  h.session.loaded = LOADED
  const models = { opus: OPUS_TEAM as string | undefined, haiku: undefined as string | undefined, workflow: WORKFLOW_REPLY as string | undefined }
  const calls = { models: [] as Array<{ model: string; prompt: string }>, fills: [] as string[], sent: [] as string[], fetches: [] as string[], get registered() { return h.agentSpecs.filter(s => s.name !== 'scout') }, configSets: [] as unknown[], contexts: [] as string[][], tools: [] as Array<{ tool: string; agentId?: string; input: Record<string, unknown> }> }
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
  // The engine puts a relative path under its own working folder, which on a test is not the project. Here a path that ends like one of the
  // project's files or folders (and is not under the project, the home folder or the system's) is taken for that file or folder.
  const projectPath = (given: string) => {
    if (given.startsWith(CWD) || given.startsWith(HOME) || given.startsWith('/etc')) return given
    const rels = [...h.files.keys()].filter(k => k.startsWith(`${CWD}/`)).flatMap(k => {
      const parts = k.slice(CWD.length + 1).split('/')
      return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
    })
    const best = rels.filter(rel => given === rel || given.endsWith(`/${rel}`)).sort((a, b) => b.length - a.length)[0]
    return best === undefined ? given : `${CWD}/${best}`
  }
  // `links`: a path that really lands somewhere else, as a symbolic link would. A path asked to resolve lands where it is, if it is a file here or the folder of some.
  const links: Record<string, string> = {}
  on('fs.stat', (_$, e) => {
    const { path: given, resolve } = e as { path: string; resolve: boolean }
    const path = projectPath(given)
    const isThere = h.files.has(path) || path === CWD || [...h.files.keys()].some(p => p.startsWith(`${path.replace(/\/+$/, '')}/`))
    const real = links[path] ?? (isThere ? path : undefined)
    return { value: { kind: 'file', size: (h.files.get(path) ?? '').length, mtimeMs: 0, isLink: links[path] !== undefined, ...(resolve && real !== undefined ? { realPath: real } : {}) } } as never
  })
  on('fs.ancestors', (_$, e) => ({ value: (e as { names: string[] }).names.flatMap(name => (h.files.has(`${CWD}/${name}`) ? [{ dir: CWD, name, content: h.files.get(`${CWD}/${name}`), parts: [] }] : [])) }) as never)
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'HOME' ? HOME : undefined }) as never)
  on('model.complete', (_$, e) => {
    const { model, prompt } = e as { model: string; prompt: string }
    calls.models.push({ model, prompt })
    const text = prompt.includes('<instructions>') ? models.workflow : model === 'opus' ? models.opus : models.haiku
    return { value: text === undefined ? { isAnswered: false, reason: 'error' } : { isAnswered: true, text, usage: {} } } as never
  })
  on('tool.call', (_$, e) => {
    // What reached the tools: the calls the plugin let through (a rewritten input shows as it was rewritten).
    calls.tools.push({ tool: (e as { tool: string }).tool, agentId: (e as { agentId?: string }).agentId, input: e as Record<string, unknown> })
    return { result: 'ok' } as never
  })
  // The scout: `mode` 'deny' refuses its start (setup falls to Opus); 'silent' starts it, and the engine lists it as running.
  // No hook of the plugin runs inside a scout it started itself, so the plugin learns what it found only from its transcript:
  // `said`, read through `$.session.messages`. `end()` marks it finished in the engine's list.
  const scout = {
    // 'classifier': auto mode refuses the plugin's own start, as the desktop app's server-side classifier does.
    mode: 'deny' as 'deny' | 'silent' | 'classifier', id: 'sc1', spawned: [] as Array<{ prompt: string; subagentType?: string }>,
    said: [] as Array<{ role: 'user' | 'assistant'; text: string; toolUses: Array<{ tool: string; input: Record<string, unknown> }> }>,
    end: () => { for (const a of agentList as Array<{ id: string; status: string }>) if (a.id === scout.id) a.status = 'completed' },
    /** The scout's definition, as the plugin registered it at session start. */
    get registered() { return h.agentSpecs.filter(s => s.name === 'scout') },
  }
  on('session.messages', (_$, e) => ({ value: (e as { agentId?: string }).agentId === scout.id ? scout.said : { deny: 'no such agent here' } }) as never)
  // The engine's command list; a test adds to it for the skills that come past the cut breakdown.
  const commandList = [{ name: 'ecc:tdd-workflow', description: 'Writes tests first, then the code.', source: 'plugin' }]
  on('command.list', () => ({ value: commandList }) as never)
  on('prompt.fill', (_$, e) => (calls.fills.push((e as { text: string }).text), { isFilled: true }) as never)
  on('prompt.submit', (_$, e) => {
    calls.sent.push((e as { text: string }).text)
    calls.contexts.push(((e as { context?: unknown[] }).context ?? []).map(String)) // what rode along with it, unseen in the chat
    return { text: (e as { text: string }).text } as never
  })
  on('http.fetch', (_$, e) => (calls.fetches.push(String((e as { url: string }).url)), { value: { status: 500 } }) as never)
  on('config.list', () => ({ value: [] }) as never)
  on('config.set', (_$, e) => (calls.configSets.push(e), { value: (e as { value: unknown }).value }) as never)
  on('turn.start', (_$, e) => ({ turnId: (e as { turnId: string }).turnId }) as never)
  on('agent.spawn', (_$, e) => {
    // A start the plugin makes itself reaches the host in the Agent tool's own spelling (`subagent_type`); a hire in the event's (`subagentType`).
    const spawn = e as { prompt: string; subagentType?: string; subagent_type?: string }
    const type = spawn.subagentType ?? spawn.subagent_type
    if (type !== 'clawd-hq:scout') return { model: 'claude-opus-5-5', agentId: 'a1' }
    scout.spawned.push({ prompt: spawn.prompt, subagentType: type })
    if (scout.mode === 'deny') return { deny: 'no scout in this host' } as never
    if (scout.mode === 'classifier') return { deny: 'The server-side auto mode classifier gave no verdict for Agent: the request that produced this action did not ask for one.' } as never
    agentList.push({ id: scout.id, type: 'clawd-hq:scout', description: 'Look around the project', status: 'running' })
    return { model: 'claude-sonnet-5-5', agentId: scout.id }
  })
  on('agent.offer', () => ({ isOffered: true }) as never)
  return { ...h, models, calls, scout, links, agentList, commandList }
}
export type OnboardHost = ReturnType<typeof onboardHost>

/** Real time passing, for work that starts on its own after a call returns (the scout's moves). The mock clock is not moved. */
export const realWait = (ms: number) => new Promise<void>(done => (globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => void }).setTimeout(done, ms))

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

export const saveOf = (h: OnboardHost) => h.saved.get(`onboard:${CWD}`) as { step: string; role?: string; at: number; failures?: number } | undefined
