// Contractors: an installed skill that is not on the team, hired for one job. `hire_contractor` registers a one-job agent that preloads the
// skill (the way setup registers a skill hire) and answers with the agent type to hire. The agent is never put in the team record. Hires are
// counted per project and skill; on the second hire of a skill the Office tab offers to make it staff, and "Make staff" adds it to the
// saved team through the existing hire path. No `$` here: register.tsx hands in the calls as closures.
import type { ContractorOffer } from '../types'
import { contractorName, contractorType } from './contractor-name'
import { listHelpers } from './find-helpers'
import type { FindIo } from './find-helpers'
import { HIRE_PROMPT, addSkillHire, installedSkills } from './hire'
import type { OnboardIo } from './onboard-types'
import { inLine, reasonOf } from './state'

/** A role is a short title, at most this many characters once cleaned. */
export const ROLE_CHARS = 30
/** The newest this many offers are kept; they last for the session only. */
export const MAX_OFFERS = 5
/** The refusal for anyone but Clawd. */
export const CONTRACTOR_DENY = 'Only Clawd hires contractors. Put what you need in your report and Clawd will staff it.'

/** What the contractor calls may do. */
export type ContractorIo = FindIo & Pick<OnboardIo, 'set' | 'registerHire'> & {
  /** Changes the list of offers on the Office tab and gives the list as it stands after. */
  readonly change: (fn: (list: ContractorOffer[]) => ContractorOffer[]) => Promise<ContractorOffer[]>
  readonly toast: (text: string) => void
}
export type ContractorActions = { contractorStaff: (id: string) => unknown; contractorLater: (id: string) => unknown }

// ---- What a call may say ----

/** Untrusted text as one plain line of letters, digits, spaces, hyphens and apostrophes. */
const plain = (text: string) => text.replace(/[^\p{L}\p{N}\s'-]+/gu, ' ').replace(/\s+/g, ' ').trim()

/** What `hire_contractor` was given: the exact skill and a short role as one clean line, or why it is refused. */
export function parseContractor(input: Record<string, unknown>): { skill: string; role: string } | { error: string } {
  const skill = typeof input.skill === 'string' ? input.skill.trim() : ''
  if (skill === '') return { error: 'skill must be the exact name of an installed skill. Call find_helpers to see the names.' }
  const role = typeof input.role === 'string' ? plain(input.role) : ''
  if (!/\p{L}/u.test(role)) return { error: 'role must be a short title in words, such as "Designer".' }
  if (role.length > ROLE_CHARS) return { error: `role is ${role.length} characters; the most is ${ROLE_CHARS}. Use a short title such as "Designer".` }
  return { skill, role }
}

/** The words on the offer card. */
export const offerText = (role: string, times: number) => `${role} has worked here ${times === 2 ? 'twice' : `${times} times`}. Make them staff?`

/** The list with this offer on top; one for the same skill is replaced by it. */
export const withOffer = (list: readonly ContractorOffer[], offer: ContractorOffer): ContractorOffer[] =>
  [offer, ...list.filter(one => one.id !== offer.id)].slice(0, MAX_OFFERS)

export const withoutOffer = (list: readonly ContractorOffer[], id: string): ContractorOffer[] => list.filter(one => one.id !== id)

// ---- The count of hires ----

const countsKey = (folder: string) => `contractors:${folder}`

/** The saved counts, checked: the store is data, so anything that is not a whole number above zero is dropped. */
function cleanCounts(v: unknown): Readonly<Record<string, number>> {
  if (typeof v !== 'object' || v === null) return {}
  return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number' && Number.isInteger(n) && n > 0))
}

/** One more hire of this skill in this project; the new count. A store that refuses loses the count and nothing else. */
const countHire = (io: ContractorIo, skill: string): Promise<number> => inLine(async () => {
  const counts = cleanCounts(await io.get<unknown>(countsKey(io.cwd)).catch(() => undefined))
  const times = (counts[skill] ?? 0) + 1
  await io.set(countsKey(io.cwd), { ...counts, [skill]: times }).catch(() => undefined)
  return times
})

/** Skills whose offer the person put off with Not now, for this session. */
let putOff: ReadonlySet<string> = new Set()

// ---- The hire ----

const nameFor = (role: string) => role.toLowerCase().replace(/\s+/g, '-')
const answerFor = (skill: string, role: string) =>
  `Contractor ready: "${role}" works from the skill ${skill}. Hire it now with the Agent tool: subagent_type "${contractorType(skill)}", name "${nameFor(role)}", and a brief for the one job. ` +
  'It does that job and leaves. If the Agent tool does not know the type yet, say so in one line and hire the general-purpose agent instead, naming the skill in the brief.'

/**
 * Clawd's call of `hire_contractor`: the skill is checked against the installed list, the one-job agent is registered, the hire is counted
 * and, from the second hire of the skill, the offer to make it staff goes on the Office tab. A specialist's call is refused.
 */
export async function hireContractor(io: ContractorIo, agentId: string | undefined, input: Record<string, unknown>): Promise<{ readonly result: string } | { readonly deny: string }> {
  if (agentId !== undefined) return { deny: CONTRACTOR_DENY }
  const parsed = parseContractor(input)
  if ('error' in parsed) return { deny: parsed.error }
  const { skill, role } = parsed
  const [listed, engine] = [await listHelpers(io), await installedSkills(io)]
  const found = listed.find(h => h.kind === 'skill' && h.id === skill)
  if (!(engine ? engine.some(s => s.name === skill) : found !== undefined)) return { deny: `"${skill}" is not an installed skill. Call find_helpers for the exact name.` }
  if (found?.status === 'staff' && found.hireAs) return { deny: `"${skill}" is on the team. Hire the agent "${found.hireAs}" instead, and give it a role name.` }
  const about = found?.about || engine?.find(s => s.name === skill)?.about || skill
  const isOk = await io.registerHire({ name: contractorName(skill), description: `${role}: ${about}`, prompt: HIRE_PROMPT, skills: [skill] })
  if (!isOk) return { deny: `The engine could not register a contractor for "${skill}". Hire a staff helper or the general-purpose agent instead.` }
  const times = await countHire(io, skill)
  if (times >= 2 && !putOff.has(skill)) await inLine(() => io.change(list => withOffer(list, { id: skill, role, times })))
  return { result: answerFor(skill, role) }
}

// ---- The card's buttons ----

/** The two buttons. Make staff puts the skill on the saved team and takes the card away; when it cannot, the card stays and a toast says why. */
export function contractorActions(open: () => Promise<ContractorIo>): ContractorActions {
  return {
    contractorStaff: id => inLine(async () => {
      const io = await open()
      const offer = (await io.change(list => list)).find(one => one.id === id)
      if (!offer) return
      try {
        const report = await addSkillHire(io, id, `hired ${offer.times}× as a contractor here`)
        if (report.dropped.length > 0) return io.toast(`Could not make ${offer.role} staff: ${id} is not an installed skill.`)
        await io.change(list => withoutOffer(list, id))
        io.toast(report.failed.length > 0 ? `${offer.role} is now staff, but the engine would not start its hire until the next session.` : `${offer.role} is now staff.`)
      } catch (err) {
        io.toast(`Could not make ${offer.role} staff: ${reasonOf(err)}.`)
      }
    }),
    contractorLater: id => inLine(async () => {
      putOff = new Set([...putOff, id])
      await (await open()).change(list => withoutOffer(list, id))
    }),
  }
}
