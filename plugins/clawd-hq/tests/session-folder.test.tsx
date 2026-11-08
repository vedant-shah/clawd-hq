// Issue #5: the desktop app starts a session in a spare folder and then moves it to the project. Session start fires once, in the
// spare folder; afterwards the engine reads the project for the session's folder (`$.session.cwd()`, `$.session.root()`) and raises
// a folder change. Setup, its scout and `/office-setup` must look at the project the session is in now, not the folder it started in.
// `/office-setup <folder>` scans the folder given instead, and still files the team under the project.
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { noFolderLine } from '../hooks/onboard-cards'
import { FOLLOW_MS, MOVED, guardRun, resolveFolder } from '../hooks/session-folder'
import { START } from './host'
import { CWD, HOME, frames, office, onboardHost, settle } from './onboard-host'
import type { OnboardHost } from './onboard-host'

/** The spare folder the host starts the session in, gone by the time setup runs unless a test puts files in it. */
const SPARE = '/spares/spare-one'

type On = Parameters<typeof onboardHost>[0]

/** The session's folder as the engine reads it: `start` until the host moves the session. */
function sessionFolder(on: On, start = SPARE) {
  const where = { folder: start }
  on('session.cwd', () => ({ value: where.folder }) as never)
  on('session.root', () => ({ value: where.folder }) as never)
  on('classic.CwdChanged', () => ({}) as never) // no settings hook beneath: the change is only announced
  return where
}

/** The host moves the session from the spare folder to the project, as the desktop app does after session start; announced or not. */
async function moveToProject($: Engine, where: { folder: string }, isAnnounced = true) {
  where.folder = CWD
  if (isAnnounced) await $.classic.CwdChanged({ old_cwd: SPARE, new_cwd: CWD })
}

const startIn = ($: Engine, cwd: string) => $.session.start({ cwd, surface: 'terminal', isInteractive: true } as never)

async function offerTwo($: Engine) {
  for (const [agent, description] of [['ecc:planner', 'Plans work before anyone builds.'], ['ecc:code-reviewer', 'Reviews code for quality and security.']] as const) {
    await $.agent.offer({ agent, description } as never)
  }
}

const more = async (h: OnboardHost) => { await settle(h, 300); await h.clock.advance(2_000); await settle(h, 300) }
const lastBrief = (h: OnboardHost) => h.scout.spawned.at(-1)?.prompt ?? ''
const setup = ($: Engine, args: string) => $.command.run({ command: 'office-setup', args } as never) as Promise<{ text?: string }>
const opusCalls = (h: OnboardHost) => h.calls.models.filter(m => m.model === 'opus').length
const stopsOf = (h: OnboardHost) => h.calls.tools.filter(t => t.tool === 'TaskStop').map(t => String(t.input.task_id))

// ---- A session that does not move stays put ----

test('a session whose root stays the start folder stays put across many frames: one setup run, one scout', async ($, on) => {
  const h = onboardHost(on)
  sessionFolder(on, CWD)
  await $.session.start(START)
  await offerTwo($)
  await frames(h, 60)
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  expect(opusCalls(h)).toBe(1)
})

test('another spelling of the same folder is no move: a trailing slash, another case, or a link that lands there', async ($, on) => {
  const h = onboardHost(on)
  const where = sessionFolder(on, CWD)
  await $.session.start(START)
  await offerTwo($)
  await frames(h)
  await more(h)
  h.links['/linked/repo'] = CWD
  for (const spelling of [`${CWD}/`, CWD.toUpperCase(), '/linked/repo']) {
    where.folder = spelling
    await frames(h, 17)
  }
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  expect(opusCalls(h)).toBe(1) // setup never ran again
  expect([...h.saved.keys()].filter(k => /^(onboard|team|payroll):/.test(k) && !k.endsWith(`:${CWD}`))).toEqual([])
})

test('a root that cannot be read leaves the folder as it is, and is written to the debug log once a session', async ($, on) => {
  const h = onboardHost(on)
  const logs: string[] = []
  on('session.root', () => { throw new Error('no root here') })
  on('ui.log', (_$, e) => (logs.push(String((e as { text: string }).text)), { value: undefined }) as never)
  await $.session.start(START)
  await offerTwo($)
  await frames(h, 40)
  await more(h)
  expect(logs.filter(l => l.includes('could not read the session\'s project folder'))).toHaveLength(1)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
})

// ---- The session's own folder, followed after a move ----

test('a session moved from a spare folder to the project: setup scans the project and briefs the scout with it', async ($, on) => {
  const h = onboardHost(on)
  const where = sessionFolder(on)
  await startIn($, SPARE)
  await moveToProject($, where)
  await offerTwo($)
  await frames(h)
  await more(h)
  expect(h.scout.spawned).toHaveLength(1)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
  expect(lastBrief(h)).not.toContain(SPARE)
  expect(lastBrief(h)).toContain('Shop API') // the quick scan read the project's README, so it is not empty
  expect(h.saved.has(`team:${CWD}`)).toBe(true)
  expect(h.saved.has(`team:${SPARE}`)).toBe(false)
})

test('/office-setup after the move tries again with the project, though the first run used the spare folder', async ($, on) => {
  const h = onboardHost(on)
  const where = sessionFolder(on)
  await startIn($, SPARE)
  await offerTwo($)
  await frames(h)
  await more(h) // the first run starts before the host moves the session, so it may only see the spare folder
  await moveToProject($, where)
  await setup($, '')
  await more(h)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
  expect(lastBrief(h)).not.toContain(SPARE)
  expect(h.saved.has(`team:${CWD}`)).toBe(true)
})

test('/office-setup reads the folder again even when the host moved the session without saying so', async ($, on) => {
  const h = onboardHost(on)
  const where = sessionFolder(on)
  await startIn($, SPARE)
  await offerTwo($)
  await moveToProject($, where, false)
  await setup($, '')
  await more(h)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
  expect(h.saved.has(`team:${CWD}`)).toBe(true)
})

/** The payroll review card an earlier look left in the session's state. Nothing writes it now, so a test shows it. */
const LAYOFFS = { count: 1, total: 2, stacks: [], why: [] }
type StateCall = { key: string; value?: unknown }
type StateAnswer = { value: { value?: Record<string, unknown>; version: number } }

/**
 * The plugin's session state as it goes by: the frame ticks written, and every write of `fx`. While `isLayoffsShown`, a read of `fx` also
 * shows the review card; the first write of `fx` without it takes it away, as the state itself would.
 */
function watchState(on: On) {
  const seen = { ticks: 0, fx: [] as Array<Record<string, unknown>>, isLayoffsShown: false }
  on('state.get', async (_$, e, next) => {
    const read = (await next(e)) as unknown as StateAnswer
    if (!seen.isLayoffsShown || (e as StateCall).key !== 'fx') return read as never
    return { value: { ...read.value, value: { ...read.value.value, layoffs: LAYOFFS } } } as never
  })
  on('state.set', (_$, e, next) => {
    const { key, value } = e as StateCall
    if (key === 'tick') seen.ticks += 1
    if (key === 'fx') {
      seen.fx.push(value as Record<string, unknown>)
      if ((value as { layoffs?: unknown }).layoffs === undefined) seen.isLayoffsShown = false
    }
    return next(e)
  })
  return seen
}

test('a root that never answers holds no frame: the check gives up after ten seconds, says so once, and a later move goes through', { timeoutMs: 30_000 }, async ($, on) => {
  const h = onboardHost(on)
  const seen = watchState(on)
  const logs: string[] = []
  const where = { folder: SPARE, isHung: false }
  // A hung read sleeps on the test's clock for far longer than the time limit (a promise that never settled would hold the test kit too).
  on('session.root', async () => {
    if (where.isHung) await h.clock.sleep(3 * FOLLOW_MS)
    return { value: where.folder } as never
  })
  on('classic.CwdChanged', () => ({}) as never)
  on('ui.log', (_$, e) => (logs.push(String((e as { text: string }).text)), { value: undefined }) as never)
  await startIn($, SPARE)
  await offerTwo($)
  where.isHung = true
  await frames(h, 9) // a check starts, and its read of the root does not answer in time
  const before = seen.ticks
  await frames(h, 9)
  expect(seen.ticks).toBeGreaterThan(before) // the frames go on meanwhile
  await h.clock.advance(FOLLOW_MS)
  await settle(h)
  expect(logs.filter(l => l.includes('took over 10 seconds'))).toHaveLength(1)
  where.isHung = false
  where.folder = CWD
  await h.clock.advance(FOLLOW_MS) // a check that started while the root still hung gives up too
  await settle(h)
  await frames(h, 17)
  await more(h)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
  // The reads that hung answer at last, long after their checks gave up: too old to act on, so nothing moves again.
  const spawned = h.scout.spawned.length
  await h.clock.advance(3 * FOLLOW_MS)
  await settle(h)
  expect(h.scout.spawned).toHaveLength(spawned)
})

test('after a move the payroll review is filed again, for the new folder', async ($, on) => {
  const OTHER = '/other'
  const roster = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ecc:helper-${i}`, { jobs: 1 }]))
  const h = onboardHost(on, { roster, [`onboard:${CWD}`]: { step: 'done', at: 1 }, [`onboard:${OTHER}`]: { step: 'done', at: 1 } })
  const where = sessionFolder(on, CWD)
  await $.session.start(START)
  await $.agent.offer({ agent: 'ecc:planner', description: 'Plans work.' } as never) // one offer loads the machine-wide record
  await frames(h, 30)
  expect((h.saved.get(`payroll:${CWD}`) as { isReviewed?: boolean } | undefined)?.isReviewed).toBe(true)
  where.folder = OTHER
  await $.classic.CwdChanged({ old_cwd: CWD, new_cwd: OTHER })
  await frames(h, 30)
  expect((h.saved.get(`payroll:${OTHER}`) as { isReviewed?: boolean } | undefined)?.isReviewed).toBe(true)
})

test('a move takes away the payroll review card left from the old folder', async ($, on) => {
  const h = onboardHost(on)
  const seen = watchState(on)
  const where = sessionFolder(on, CWD)
  await $.session.start(START)
  await frames(h)
  seen.isLayoffsShown = true // shown just before the move: a settled payroll in the frames would take it away by itself
  where.folder = '/other'
  await $.classic.CwdChanged({ old_cwd: CWD, new_cwd: '/other' })
  expect(seen.isLayoffsShown).toBe(false)
  expect(seen.fx.at(-1)?.layoffs).toBeUndefined()
})

test('a move seen only by the frames, with no folder change announced and no /office-setup, is followed', async ($, on) => {
  const h = onboardHost(on)
  const where = sessionFolder(on)
  await startIn($, SPARE)
  await offerTwo($)
  await frames(h)
  await more(h)
  await moveToProject($, where, false)
  await frames(h, 17)
  await more(h)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
  expect(h.saved.has(`team:${CWD}`)).toBe(true)
})

test('a scout started for the old folder is stopped once the session has moved', async ($, on) => {
  const h = onboardHost(on)
  h.files.set(`${SPARE}/notes.txt`, 'scratch\n')
  h.scout.mode = 'silent' // started, and still looking when the host moves the session
  const where = sessionFolder(on)
  await startIn($, SPARE)
  await offerTwo($)
  await frames(h)
  await settle(h, 300)
  expect(lastBrief(h)).toContain(`The project folder is: ${SPARE}`)
  expect(stopsOf(h)).toEqual([])
  await moveToProject($, where)
  await frames(h)
  await settle(h, 300)
  expect(stopsOf(h)).toEqual(['sc1'])
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
})

test('the guard on a dropped run refuses its hire and its payroll write, and lets them through while the folder stands', async () => {
  const done: string[] = []
  const io = {
    set: async () => { done.push('set') }, setCard: async () => { done.push('card') }, spawnScout: async () => ({ why: 'none' }),
    complete: async () => undefined, registerHire: async () => { done.push('hire'); return true }, savePayroll: async () => { done.push('payroll') },
  }
  let isStale = false
  const guarded = guardRun(() => isStale, io as never) as typeof io
  const outcome = (p: Promise<unknown>) => p.then(() => 'ran', (err: Error) => err.message)
  expect(await outcome(guarded.registerHire())).toBe('ran')
  expect(await outcome(guarded.savePayroll())).toBe('ran')
  isStale = true
  expect(await outcome(guarded.registerHire())).toBe(MOVED)
  expect(await outcome(guarded.savePayroll())).toBe(MOVED)
  expect(done).toEqual(['hire', 'payroll'])
})

test('a session folder that is not there stops setup with a plain line on the card, and no scout starts', async ($, on) => {
  const h = onboardHost(on)
  sessionFolder(on)
  await startIn($, SPARE)
  await offerTwo($)
  await frames(h)
  await more(h)
  expect(h.scout.spawned).toHaveLength(0)
  expect((await office($, 'terminal')).joined).toContain(`there is no folder at ${SPARE}`)
})

test('a setup run started in the old folder is dropped after a move: nothing is filed for it, and setup runs again for the project', async ($, on) => {
  const h = onboardHost(on)
  h.files.set(`${SPARE}/notes.txt`, 'scratch\n') // the spare folder is there this time, so the first run gets as far as the scout
  h.scout.mode = 'classifier' // the first run then waits for Clawd to hire the scout
  const where = sessionFolder(on)
  await startIn($, SPARE)
  await offerTwo($)
  await frames(h)
  await settle(h, 300)
  expect(lastBrief(h)).toContain(`The project folder is: ${SPARE}`)
  await moveToProject($, where)
  await frames(h)
  await settle(h, 300)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}`)
  expect((h.scout.registered.at(-1) as { prompt?: string } | undefined)?.prompt).toContain(`The project folder is: ${CWD}`) // the brief Clawd's hire would carry
  expect(h.saved.has(`team:${SPARE}`)).toBe(false)
  expect(h.calls.models.filter(m => m.model === 'opus')).toHaveLength(0) // the dropped run never fell back to an Opus call
})

test('after a move what is kept per folder is the project\'s: a helper laid off there is held back again', async ($, on) => {
  const h = onboardHost(on, { [`payroll:${CWD}`]: { laidOff: ['ecc:go-reviewer'], isReviewed: true, stacks: [] } })
  const where = sessionFolder(on)
  await startIn($, SPARE)
  expect(await $.agent.offer({ agent: 'ecc:go-reviewer', description: 'Reviews Go code.' } as never)).toEqual({ isOffered: true })
  await moveToProject($, where)
  expect(await $.agent.offer({ agent: 'ecc:go-reviewer', description: 'Reviews Go code.' } as never)).toEqual({ isOffered: false })
  expect(h.saved.get(`payroll:${SPARE}`)).toBeUndefined()
})

// ---- `/office-setup <folder>` ----

test('/office-setup <folder> scans that folder and briefs the scout with it, but files the team under the project', async ($, on) => {
  const h = onboardHost(on)
  h.files.set(`${HOME}/side/README.md`, '# Side Notebook\n\nExperiments kept on the side.\n')
  h.files.set(`${HOME}/side/main.py`, 'print(1)\n')
  sessionFolder(on, CWD)
  await $.session.start(START)
  await offerTwo($)
  await frames(h)
  await more(h)
  h.saved.delete(`team:${CWD}`)
  await setup($, `${HOME}/side`)
  await more(h)
  expect(lastBrief(h)).toContain(`The project folder is: ${HOME}/side`)
  expect(lastBrief(h)).toContain('Side Notebook')
  expect(h.saved.has(`team:${CWD}`)).toBe(true)
  expect(h.saved.has(`team:${HOME}/side`)).toBe(false)
})

test('/office-setup <folder> with no folder there says so on the card and in its answer, and starts no scout', async ($, on) => {
  const h = onboardHost(on)
  sessionFolder(on, CWD)
  await $.session.start(START)
  await offerTwo($)
  await frames(h)
  await more(h)
  const before = h.scout.spawned.length
  const answer = await setup($, 'nowhere')
  await more(h)
  expect(h.scout.spawned).toHaveLength(before)
  expect(answer.text).toContain(`there is no folder at ${CWD}/nowhere`)
  expect((await office($, 'terminal')).joined).toContain(`there is no folder at ${CWD}/nowhere`)
})

test('/office-setup <folder> with no folder there, while a setup is running: the answer says so and the running setup keeps its card', async ($, on) => {
  const h = onboardHost(on)
  h.scout.mode = 'classifier' // setup waits for Clawd's hire, so it is still running
  sessionFolder(on, CWD)
  await $.session.start(START)
  await offerTwo($)
  await frames(h)
  await settle(h, 300)
  const answer = await setup($, 'nowhere')
  expect(answer.text).toContain(`there is no folder at ${CWD}/nowhere`)
  expect((await office($, 'terminal')).joined).not.toContain('there is no folder')
})

test('a long path echoed back is cut to about 120 characters, its end kept', () => {
  const line = noFolderLine(`/${'deep/'.repeat(60)}end`)
  expect(line.length).toBeLessThan(170)
  expect(line).toMatch(/….*\/end\.$/)
})

test('/office-setup <folder> with a relative path looks under the session\'s project folder', async ($, on) => {
  const h = onboardHost(on)
  sessionFolder(on, CWD)
  await $.session.start(START)
  await offerTwo($)
  await frames(h)
  await more(h)
  await setup($, 'src')
  await more(h)
  expect(lastBrief(h)).toContain(`The project folder is: ${CWD}/src`)
})

test('a folder given to /office-setup: ~ is the home folder, a relative path is under the root, . and .. are folded, quotes come off', () => {
  expect(resolveFolder('~', '/root/proj', '/home/me')).toBe('/home/me')
  expect(resolveFolder('~/side', '/root/proj', '/home/me')).toBe('/home/me/side')
  expect(resolveFolder('src', '/root/proj/', '/home/me')).toBe('/root/proj/src')
  expect(resolveFolder('./src/../lib/', '/root/proj', '/home/me')).toBe('/root/proj/lib')
  expect(resolveFolder('/elsewhere/one', '/root/proj', '/home/me')).toBe('/elsewhere/one')
  expect(resolveFolder('"my folder"', '/root/proj', '/home/me')).toBe('/root/proj/my folder')
})
