// The state every register-*.ts module shares: the values the office keeps (read and written through `$`), and the few plain
// variables of the session, which sit on one object so any module can change them where a bare `let` could not be shared.
//
// The plugin check reads a value's reference only where the atom is written in the same file as the `read`/`update` call, so every
// read and write of an atom is a function declaration here, and the other modules call these.
import { atom, read, update } from 'claude-code'
import type { Atom, EngineInterface } from 'claude-code'

import type { Artifact, Badge, Boss, ContractorOffer, Employee, Fx, LeftItem, Payroll, RuleOffer } from '../types'
import type { Effort } from './desk'
import type { Briefing } from './instructions'
import { KNOW0 } from './know'
import type { OnboardCard } from './onboard-types'
import { agentListCache } from './quiet-agents'
import { quietRecorder } from './quiet-debug'
import { REACH0 } from './rules-reach'
import { BOSS0, BRIEF0, FX0, GAUGE0, PAYROLL0 } from './state'

const staff = atom({ plugin: 'clawd-hq', key: 'staff' } as const, [] as Employee[])
const boss = atom({ plugin: 'clawd-hq', key: 'boss' } as const, BOSS0)
const fx = atom({ plugin: 'clawd-hq', key: 'fx' } as const, FX0)
const tick = atom({ plugin: 'clawd-hq', key: 'tick' } as const, 0)
const blurbs = atom({ plugin: 'clawd-hq', key: 'blurbs' } as const, {} as Record<string, string>)
const roster = atom({ plugin: 'clawd-hq', key: 'roster' } as const, {} as Record<string, Badge>)
const projectTokens = atom({ plugin: 'clawd-hq', key: 'projectTokens' } as const, {} as Record<string, number>)
const payroll = atom({ plugin: 'clawd-hq', key: 'payroll' } as const, PAYROLL0)
const gauge = atom({ plugin: 'clawd-hq', key: 'gauge' } as const, GAUGE0)
const artifacts = atom({ plugin: 'clawd-hq', key: 'artifacts' } as const, [] as Artifact[])
const leftUndone = atom({ plugin: 'clawd-hq', key: 'leftUndone' } as const, [] as LeftItem[])
const ruleOffers = atom({ plugin: 'clawd-hq', key: 'ruleOffers' } as const, [] as RuleOffer[])
const contractorOffers = atom({ plugin: 'clawd-hq', key: 'contractorOffers' } as const, [] as ContractorOffer[])
const know = atom({ plugin: 'clawd-hq', key: 'know' } as const, KNOW0)
const clawdBrief = atom({ plugin: 'clawd-hq', key: 'brief' } as const, BRIEF0)
const onboard = atom({ plugin: 'clawd-hq', key: 'onboard' } as const, null as OnboardCard | null)

/** The change a write applies to what an atom holds. */
type Change<A> = A extends Atom<infer T> ? (value: T) => T : never

export function readStaff($: EngineInterface) { return read($, staff) }
export function updateStaff($: EngineInterface, fn: Change<typeof staff>) { return update($, staff, fn) }
export function readTick($: EngineInterface) { return read($, tick) }
export function updateTick($: EngineInterface, fn: Change<typeof tick>) { return update($, tick, fn) }
export function readBlurbs($: EngineInterface) { return read($, blurbs) }
export function updateBlurbs($: EngineInterface, fn: Change<typeof blurbs>) { return update($, blurbs, fn) }
export function readRoster($: EngineInterface) { return read($, roster) }
export function updateRoster($: EngineInterface, fn: Change<typeof roster>) { return update($, roster, fn) }
export function readProjectTokens($: EngineInterface) { return read($, projectTokens) }
export function updateProjectTokens($: EngineInterface, fn: Change<typeof projectTokens>) { return update($, projectTokens, fn) }
export function updatePayroll($: EngineInterface, fn: Change<typeof payroll>) { return update($, payroll, fn) }
export function readGauge($: EngineInterface) { return read($, gauge) }
export function updateGauge($: EngineInterface, fn: Change<typeof gauge>) { return update($, gauge, fn) }
export function readArtifacts($: EngineInterface) { return read($, artifacts) }
export function updateArtifacts($: EngineInterface, fn: Change<typeof artifacts>) { return update($, artifacts, fn) }
export function readLeftUndone($: EngineInterface) { return read($, leftUndone) }
export function updateLeftUndone($: EngineInterface, fn: Change<typeof leftUndone>) { return update($, leftUndone, fn) }
export function readRuleOffers($: EngineInterface) { return read($, ruleOffers) }
export function updateRuleOffers($: EngineInterface, fn: Change<typeof ruleOffers>) { return update($, ruleOffers, fn) }
export function readContractorOffers($: EngineInterface) { return read($, contractorOffers) }
export function updateContractorOffers($: EngineInterface, fn: Change<typeof contractorOffers>) { return update($, contractorOffers, fn) }
export function readKnow($: EngineInterface) { return read($, know) }
export function updateKnow($: EngineInterface, fn: Change<typeof know>) { return update($, know, fn) }
export function readClawdBrief($: EngineInterface) { return read($, clawdBrief) }
export function updateClawdBrief($: EngineInterface, fn: Change<typeof clawdBrief>) { return update($, clawdBrief, fn) }
export function readOnboard($: EngineInterface) { return read($, onboard) }
export function updateOnboard($: EngineInterface, fn: Change<typeof onboard>) { return update($, onboard, fn) }

// Values written by an older version of the mod lack the newer fields: fill them in.
export async function getBoss($: EngineInterface): Promise<Boss> { return { ...BOSS0, ...(await read($, boss)) } }
export async function getFx($: EngineInterface): Promise<Fx> { return { ...FX0, ...(await read($, fx)) } }
export async function getPayroll($: EngineInterface): Promise<Payroll> { return { ...PAYROLL0, ...(await read($, payroll)) } }
export async function setBoss($: EngineInterface, fn: (b: Boss) => Boss) { await update($, boss, b => fn({ ...BOSS0, ...b })) }
export async function setFx($: EngineInterface, fn: (f: Fx) => Fx) { await update($, fx, f => fn({ ...FX0, ...f })) }

/**
 * The plain variables of the session. Each starts over with the module and is reset at session start, where it was before.
 * - cwd: the project the session runs in; payroll is kept per project.
 * - briefing: what this session's chat was given, read at its first request, again after a session start or /clear.
 * - reach: which road the rules took this session (hooks/rules-reach.ts).
 * - wasBypassed: what an earlier session learnt of this machine.
 * - isEditTurn: the main chat's turn began with an edit request from the Settings tab, so the plugin's own instruction files are off limits until it ends.
 * - isArtifactsWarned: set once a write of the artifact list failed this session, so the person is told once.
 * - quietLog, agentList: the quiet chat's record of its decisions (`debug:quiet`, hooks/quiet-debug.ts) and its short-lived read of the agent list; both start over with each conversation.
 */
export const ses = {
  cwd: '',
  briefing: undefined as Promise<Briefing> | undefined,
  reach: REACH0,
  wasBypassed: undefined as boolean | undefined,
  isEditTurn: false,
  isArtifactsWarned: false,
  quietLog: quietRecorder(),
  agentList: agentListCache(),
}
export const forgetQuiet = () => { ses.quietLog.reset(); ses.agentList = agentListCache() }

// Each agent's effort, set the moment it is hired so its first request already carries it; staff keeps it across reloads.
export const efforts = new Map<string, Effort>()
