// The public skill registry (skills.sh), searched over the web when nothing installed fits a job: the plugin asks the host to fetch
// one URL, reads the JSON that comes back, and gives find_helpers up to five skills marked "not installed". Pure: the fetch comes in
// as a function (hooks/register-setup.ts builds it from `$.http.fetch`), and the endpoint is not documented, so every answer is
// checked and any odd one reads as "the search did not work". Nothing is downloaded or run, and no Node version is needed.
import { SKILLS_CLI_NODE, SKILLS_CLI_VERSION } from './constants'

export const REGISTRY_URL = 'https://skills.sh/api/search?q='
export const REGISTRY_RESULTS = 5
const WORDS = 6
const WORD_CHARS = 30
const BODY_CHARS = 500_000
/** The words that carry no meaning in a search (the same few the helper search drops). */
const SKIP = new Set('a an the and or but of to for in on at by as with from into about my me we us our your you it its is are was be do not so this that these those then than also just any all some can will help need make use new job work thing things'.split(' '))

/** One public skill as the registry lists it. `page` is its page on skills.sh, where a person can install it themselves. */
export type RegistrySkill = { readonly name: string; readonly source: string; readonly skillId: string; readonly installs: number; readonly page: string }
/** What the host's fetch gives back: whether it went through, and the body. */
export type RegistryFetch = (url: string) => Promise<{ readonly ok: boolean; readonly text: string }>

/** The search words: Clawd's keywords (else the job's own words) as plain words, letters, digits and hyphens only, at most six, no repeats. */
export function queryOf(job: string, keywords: readonly string[]): string {
  const from = keywords.length > 0 ? keywords.join(' ') : job
  const words = from.toLowerCase().replace(/[^a-z0-9 -]+/g, ' ').split(/\s+/).map(w => w.replace(/^-+|-+$/g, '').slice(0, WORD_CHARS))
  return [...new Set(words.filter(w => w !== '' && !SKIP.has(w)))].slice(0, WORDS).join(' ')
}

const SOURCE = /^[A-Za-z0-9][\w.-]{0,60}\/[\w.-]{1,80}$/
const SKILL_ID = /^[\w.-]{1,100}$/
const NAME = /^[\w .-]{1,80}$/

/** One entry of the registry's list, kept only when its source and id are plain; text from a third party is never passed on as it came. */
function skillOf(raw: unknown): RegistrySkill | undefined {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const { source, skillId, name, installs } = r
  if (typeof source !== 'string' || typeof skillId !== 'string' || !SOURCE.test(source) || !SKILL_ID.test(skillId)) return undefined
  return {
    name: typeof name === 'string' && NAME.test(name) ? name : skillId,
    source, skillId, installs: typeof installs === 'number' && Number.isFinite(installs) && installs >= 0 ? Math.floor(installs) : 0,
    page: `https://skills.sh/${source}/${skillId}`,
  }
}

/**
 * The skills in a registry answer, most installed first as the registry gave them, at most five. An empty list is a search that found nothing.
 * None when the body is not JSON, has no `skills` list, or lists entries and not one of them is usable: the shape is not the one expected.
 */
export function parseRegistry(body: string): readonly RegistrySkill[] | undefined {
  if (body.length === 0 || body.length > BODY_CHARS) return undefined
  const list = (() => { try { return (JSON.parse(body) as { skills?: unknown }).skills } catch { return undefined } })()
  if (!Array.isArray(list)) return undefined
  const kept = list.map(skillOf).filter((s): s is RegistrySkill => s !== undefined)
  return list.length > 0 && kept.length === 0 ? undefined : kept.slice(0, REGISTRY_RESULTS)
}

/** The registry's top skills for the words, or none when the words are empty, the fetch fails or refuses, or the answer is not as expected. Never rejects. */
export async function searchRegistry(fetch: RegistryFetch, job: string, keywords: readonly string[]): Promise<readonly RegistrySkill[] | undefined> {
  const query = queryOf(job, keywords)
  if (query === '') return undefined
  try {
    const answer = await fetch(`${REGISTRY_URL}${encodeURIComponent(query)}`)
    return answer.ok ? parseRegistry(answer.text) : undefined
  } catch {
    return undefined
  }
}

// ---- What Clawd is told ----

const SO_SAY = 'Say so in one line, and why.'
const GENERAL = 'use the general-purpose agent with a fuller brief'

/** The install, spelled out once: only after a yes, only with a Node the pinned release runs on, and no other way. */
const INSTALL_STEPS =
  'Only after the person says yes: first run `node -v`. ' +
  `If it is below ${SKILLS_CLI_NODE}, do not run the install: tell the person the install needs Node ${SKILLS_CLI_NODE} or newer, and give them the skill's \`page\`, where they can install it themselves. ` +
  `Otherwise run \`npx -y skills@${SKILLS_CLI_VERSION} add <source>@<skillId>\`. There is no other way to install.`

/** Clawd's note for a search made: what was found, or that it found nothing or did not work. `lead` is what he is told first. */
export function registryNote(lead: string, found: readonly RegistrySkill[] | undefined): string {
  if (found === undefined) return `${lead} The registry search did not work: say so in one line, and ${GENERAL}.`
  if (found.length === 0) return `${lead} The registry search found nothing: say so in one line, and ${GENERAL}.`
  return `${lead} \`registry\` lists up to five public skills from skills.sh, found with your keywords. None is installed. ` +
    'Judge them by name, source and installs. If one is a strong match, come back to the person with its name, source, install count and why it fits, ' +
    `and ask whether to install it and use it for this job, or go ahead without it. ${INSTALL_STEPS} ` +
    `If none is good, say so in one line and ${GENERAL}. Never install anything without the person's yes.`
}

export const NOTHING_FITS = `Nothing installed fits this job. ${SO_SAY}`
export const NONE_OF_THESE = 'You judged that none of the matches fits.'
/** With matches in hand and the search on: if none fits, ask again with `registry` set, and nothing is searched until then. */
export const IF_NONE_FITS_ON =
  `If none of these fits the job, ${SO_SAY.toLowerCase()} Then call find_helpers again with the same job and keywords and \`registry\` set to true: ` +
  'it searches the public skill registry (skills.sh) and answers with what it finds. Never install anything without the person\'s yes.'
/** With the search switched off: the plain path, and nothing is searched or sent. */
export const NO_FIT_OFF = `Nothing installed fits this job. Use the general-purpose agent, write a fuller brief, and say in one line why nothing fit.`
export const IF_NONE_FITS_OFF = `If none of these fits the job, ${SO_SAY.toLowerCase()} Use the general-purpose agent with a fuller brief.`

/** What each found skill looks like in the answer: marked as not installed, with its page. */
export const shownSkill = (s: RegistrySkill) => ({ name: s.name, source: s.source, skillId: s.skillId, installs: s.installs, page: s.page, status: 'not installed: from skills.sh' })
