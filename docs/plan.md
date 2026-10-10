# Implementation plan: Clawd HQ (`clawd-hq`)

Status: APPROVED by the user on 2026-10-10. Build one step at a time and stop after each for the user's OK.

Source of truth for features: the project owner's working notes (not in this repo).

## What we are building

One plugin that turns Claude Code into a project office:
- a chief of staff who knows your specialists and only orchestrates
- a human voice with a Quiet mode
- a unique avatar per skill
- a project logbook
- a slimmer version that works in Cowork for non-technical users

## How the code looks today

| Area | What exists | What it means for the plan |
|---|---|---|
| Main file | `plugins/clawd-hq/hooks/register.tsx` is 1,165 lines and holds every hook, the pane and the desk | Over the 800-line limit. Split it by feature before adding anything. |
| Pure helpers | `hooks/desk.ts` holds parsing logic with no side effects, tested in `tests/desk.test.ts` | The pattern to copy. New logic goes in small pure files, with tests written first. |
| Behavior tests | `tests/office.test.tsx` runs full scenarios on both terminal and desktop | Every user-visible feature gets a scenario test on both. |
| Saved data | Memory and the roster live in the plugin's private store | Cowork cannot read that store. The logbook must move to plain files in the project folder. |
| Branding | A company logo and color were built into the code | With a public repo, the default must be neutral. A company brand becomes something onboarding detects. |
| Errors and logging | No shared pattern exists yet | Set one in phase 0: fail quietly in the pane, never break the user's turn. |

## Check first: seven short experiments

Each one is small and throwaway. A "no" changes the plan, so they run before the feature that depends on them.

| # | Question | Blocks |
|---|---|---|
| E1 | Can a mod replace how tool calls are drawn, on terminal and desktop? | Quiet mode |
| E2 | Does a mod's added system prompt section reliably shape Clawd's voice and delegation? | Chief of staff |
| E3 | Can a mod read saved session files? They can be bigger than the 4 MB a mod may read in one go. | Usage-based hiring |
| E4 | Can a mod decode a small website icon into pixels? | Company logo |
| E5 | Can a mod trigger compaction and tell when a task is at a safe stopping point? | Coffee break |
| E6 | What can a mod see and start in agent teams? | Pair-up |
| E7 | In Cowork, can a skill read and write the logbook files? | Cowork support |

## Priority order

One feature at a time. Stop after each for the user's OK. Sizes: S is about a session, M is 2 to 3 sessions, L is more.

### Release v0.2: Groundwork

| Step | Feature | Size | Why here |
|---|---|---|---|
| 1 | Publish and clean up. Public GitHub repo, the catalog file (`.claude-plugin/marketplace.json`), drop the fixed version so every push updates, add a README and license, add an "unofficial, not made by Anthropic" note, switch to neutral default branding, remove the poke/pizza buttons and the idle line. | S | Lets the user install on other devices and test everything after this for real. |
| 2 | Restructure. Split the big file by feature. Move the logbook to plain files in the project. Set the error pattern. No behavior change; the existing 12 tests must still pass. | M | Everything later builds on this. |
| 3 | Usage recording (silent). Count which skills and agents get used. | S | Reviews need history, so start the clock early. |

### Release v0.3: Hire and talk (the reason to install)

| Step | Feature | Size | Needs |
|---|---|---|---|
| 4 | Onboarding A. Scan what is installed, read usage history, propose a team and a talent pool. | M | E3 |
| 5 | Onboarding B. Workflow cards, recommend the lead kit from usage (most and most recently used; user decides; skip if no workflows found), offer earlier compaction (about 300K). | M | |
| 6 | Chief of staff brain. The system prompt: orchestrate only, human voice, workflow cards, settled decisions. | M | E2 |
| 7 | Quiet mode with the four guardrails; Normal and Full as fallbacks. | M | E1 |
| 8 | Avatars. Bring the parts library (`docs/avatars/parts.json`) into the plugin, auto-assemble one per skill, list icons, another pass on the weak four (planner, docker, database, get-to-the-point), add hand-tuned ones for the most used (agent-reach, prompt-architect, pptx, architect), then Clawd's own after his system prompt exists. | M | |
| 9 | Onboarding C. Company name, pixel logo and color from email or project. | M | E4 |

Checkpoint: the user uses it on real projects for two weeks before going further.

### Release v0.4: The logbook

| Step | Feature | Size |
|---|---|---|
| 10 | Tabs, with Office, Decisions and People. Office uses a running / done / scheduled layout with a context bar, cost and time per specialist. | M |
| 11 | Project manager specialist (called when a request arrives and when a working turn ends; cheap model; record kept in the logbook) and the Milestones tab. | M |
| 12 | Left undone, to the user's spec: three sources (deferring sentences in Claude's answer; unfinished-work lines written into files such as TODO, a skipped test, "not implemented"; a small second model comparing the request with the final report after any turn with five or more tool calls), a letter key drafts "You left this undone: ... Do it now." in the prompt box, `x` clears the list. | M |

### Release v0.5: Upkeep and advice

| Step | Feature | Size | Needs |
|---|---|---|---|
| 13 | Coffee break, built on native auto-compact, with the scribe and the break room. Buttons: "See the break room" and "Take a break now"; "ask me first" setting. | M | E5 |
| 14 | Council button. Uses the installed council skills (ecc:council by default; llm-council and ecc:council-multi-model with Codex as opt-in); "put it on trial" (court-skill style) is optional; the verdict goes to Decisions. | S | |
| 15 | "You should know" notes that are kept. | M | |

### Release v0.6: Teams and reach

| Step | Feature | Size | Needs |
|---|---|---|---|
| 16 | Pair-up with agent teams. | L | E6 |
| 17 | Cowork version. Tested by a non-technical colleague. | M | E7 |
| 18 | Skill reviews. By now there are weeks of data. | M | |

## Why this order

- Steps 1 to 3 are invisible but pay for themselves. Publishing lets the user test on other devices. The restructure stops the main file from growing past 2,000 lines. Usage recording cannot be backfilled later.
- Steps 4 to 9 are the product. "It knows my specialists and talks like a person" is why someone installs it.
- The logbook comes after because Decisions, Milestones and Left undone are much more useful once Clawd is routing work.
- Pair-up is late because agent teams are experimental and it is the largest piece.
- Reviews are last because they need data.

## How each step gets built

1. Clawd briefs specialists; he does not write the code himself.
2. Tests are written first for the pure logic, then the scenario test, then the code.
3. A code review follows every step, plus a security review for anything that reads files, the email, or the network.
4. Three checks must pass, run inside `plugins/clawd-hq`: `claude plugin validate .`, `claude plugin test .`, `npx -y -p typescript tsc --noEmit -p .`
5. Show the user the result and stop.

## Risks

| Risk | Level | What we do |
|---|---|---|
| Quiet mode hides something important | High | E1 first. Guardrails get their own tests. Normal mode is one setting away. |
| Reading session history and email touches personal data | High | Everything stays on the machine. Only the email's domain is used. The user confirms. A security review is required. |
| "Clawd" is Anthropic's mascot, in a public repo | Medium | A clear "unofficial" note, as other Clawd mods do. No Anthropic art is copied. |
| The mod system or agent teams change under us | Medium | Keep pieces small and isolated. Pair-up is late and optional. |
| Scope: 18 steps | Medium | The two-week checkpoint after v0.3. Anything not earning its place gets cut. |
| "Orchestrate only" makes small tasks slow | Medium | Clawd answers and routes himself, and uses the cheapest specialist for small jobs. Measure it at the checkpoint. |
| Auto-assembled avatars look bad | Low | Hand-tune the most-used ones; the rest fall back to a simple outfit. |

Overall size: large. v0.2 and v0.3 together are roughly 15 to 20 working sessions.

## Decisions made (2026-10-10)

1. Logbook files live in a `.clawd-hq/` folder in each project as readable text files and are committed to git with the project.
2. License: MIT.
3. The public default name and look is a neutral "Clawd HQ" with no company logo; a user's own company name and look come from onboarding.
4. Public GitHub repo `vedant-shah/clawd-hq`; the plugin name stays `clawd-hq`.

## Next action

Step 1 (publish and clean up) is in progress.
