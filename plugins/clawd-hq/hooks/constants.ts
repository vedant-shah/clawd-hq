// The office's fixed numbers and tool names. the register-*.ts files hold the hooks that use them.
export const FRAME_MS = 400
export const CHEER_TICKS = 5
/** A given name is a word or two; anything longer is cut. */
export const NAME_CHARS = 40
/** What an agent type is for, kept at a word with no mark: long enough that the People row's first sentence is seldom cut. */
export const BLURB_CHARS = 600
// Agent-written text is cut to one line where it is stored.
export const DESCRIPTION_CHARS = 160
export const MAX_BLURBS = 120
export const DEMO_TOOL = 'mcp__clawd-hq__demo'
export const RULE_TOOL = 'mcp__clawd-hq__offer_rule'
export const STEP_TOOL = 'mcp__clawd-hq__step'
export const PAUSE_TOOL = 'mcp__clawd-hq__before_question'
export const PLAN_TOOL = 'mcp__clawd-hq__plan'
export const FIND_TOOL ='mcp__clawd-hq__find_helpers'
export const CONTRACTOR_TOOL = 'mcp__clawd-hq__hire_contractor'
/**
 * The one release of the `skills` command that Clawd runs to install a skill from the public registry, and only after the person's yes
 * (`npx -y skills@<this> add <source>@<skillId>`). Pinned on purpose, never left floating: a floating `npx` would run whatever was published
 * last. Bumped on purpose, by hand, to the newest release at least 14 days old. Chosen on 15 Nov 2026: this release came out on 19 Oct, and
 * the next ones on 2, 3, 10 and 11 Nov. The search does not use it: that is a web request (hooks/registry-search.ts).
 */
export const SKILLS_CLI_VERSION = '1.7.4'
/** What that release needs: its `engines.node` is `>=22.20.0` (`npm view skills@<version> engines`), and on older Node it crashes. Change it with the version. */
export const SKILLS_CLI_NODE = '22.20.0'
