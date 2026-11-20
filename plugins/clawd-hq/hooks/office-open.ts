// Whether the office is open: the one state Clawd's rules (hooks/toggle-store.ts) and Automatic setup (hooks/register-setup.ts) follow.
// It is the office's own state, not whether a pane is on screen right now. It becomes open through a real open (`/office`,
// `/office-setup`, the "Open the office at session start" switch, the Office pane shown) and closed through `/office` closing it
// or the person closing the Office pane. No imports, so every module can read it.

// Unknown until a session starts, which sets the real state (hooks/register-session.ts). Unknown holds nothing back: there is no session yet.
let state: boolean | undefined

/** The office is open. Unknown is not open: `/office` opens it, and setup waits. */
export const isOfficeOpen = () => state === true

/** The office is known to be closed. Clawd is held back only then. */
export const isOfficeClosed = () => state === false

/** Set by the code that opens or closes the office; the state is replaced, never changed in parts. */
export const setOfficeOpen = (value: boolean) => { state = value }
