// The office's fixed numbers and tool names. register.tsx holds the hooks that use them.
export const FRAME_MS = 400
export const CHEER_TICKS = 5
/** A given name is a word or two; anything longer is cut. */
export const NAME_CHARS = 40
/** How much of a question is kept in front of its answer in a saved decision. */
export const TITLE_CHARS = 600
export const BLURB_CHARS = 200
// Agent-written text is cut to one line where it is stored.
export const DESCRIPTION_CHARS = 160
export const MAX_BLURBS = 120
export const DEMO_TOOL = 'mcp__clawd-hq__demo'
export const MEM_TOOL = 'mcp__clawd-hq__remember'
export const STEP_TOOL = 'mcp__clawd-hq__step'
export const TEAM_TOOL = 'mcp__clawd-hq__team_pick'
// The memory keeps this many entries per project; Clawd and each brief get the newest RECALL.
/** The newest this many decisions are kept: in the file and in the pane. */
export const MAX_MEMORY = 1000
export const RECALL = 25
