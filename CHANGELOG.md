# Changelog

All notable changes to Clawd HQ. Newest first.

## 1.2.0 - 2026-11-16

### Added

- **The plan.** For a job of several steps, Clawd keeps a short, ordered plan for the one goal in hand, through a new `plan` tool. It is saved in your project as `.clawd-hq/plans/<goal>.md`, so you can commit it. When a session starts, Clawd picks up the newest plan file as the goal in hand, so commit one only if you want your team's Clawd to work from it. It has an optional one-sentence summary, a "Later" list for put-off ideas, and the choices a specialist made under each step. A step ticks itself when its specialist finishes well, and stays open if the specialist failed. A plan from the Planner becomes the plan, or waits as a draft (up to seven days) while another goal is in hand.
- **A plan on the Office tab.** Clawd's card, then "Needs you", then the plan: a line beside the steps, the last finished step kept in view, each specialist under its step, and a failed specialist's reason under **Details** with **Retry** and **Ask Clawd**. Pair-ups and councils stay together on one card under "Also at work". The terminal wraps the plan by cell width, so wide characters stay whole.
- **The Later fold.** The plan's put-off ideas and the Left undone items sit together, each with **Do it now** and **Dismiss**. Left undone items can now be dismissed one by one. When a goal ends, its put-off items move to the Left undone list.
- **The History tab.** A fourth tab: the goal in progress; finished goals (opened: summary, totals, steps, retries and failures, pages made); other work, one line per run; and Artifacts. A goal that was set aside has **Resume**, which fills your prompt box and never sends it.
- **The audit history.** `.clawd-hq/history-<session>.jsonl` holds one line per goal start and end, specialist run, tool call and model request. A tool call keeps only its name, timing and whether it worked, never its input or output. A model request keeps only token counts. A file rolls over at 2 MB, old files are kept, and `.clawd-hq/.gitignore` keeps them out of git.
- **A built-in skills.sh search.** When nothing installed fits a job, Clawd HQ searches the public registry itself (up to three short searches) and asks before installing anything. A new Settings switch, on by default, turns it off.
- **The tour shows the plan and the History tab.** `/office-demo` plays a stand-in plan and a stand-in finished goal. Nothing is written to your project.

### Changed

- **One hand-over rule.** Clawd does a job himself only when one or two tool calls finish it. Anything bigger goes to a specialist. His instructions are reorganised around this, with the plan, pair-ups and councils each in their own section.
- **Progress in plain words.** The step tool is now optional. Briefs ask each specialist to start its updates with a short sentence like "Step 2 of 4: checking the tests", and the office draws the progress bar from it.
- **Briefs and failures.** Briefs tell a specialist not to commit, push or install anything unless you asked. Clawd tells you in one line when a specialist fails, stops early or goes silent.
- **Artifacts moved** from the Office tab to the History tab.
- **The Left undone section** of the Office tab is now part of the Later fold. The list and the "Left undone check" setting are unchanged.
- **Short reports.** A short answer no longer ends with a list of what was checked and skipped.

### Removed

- **Recap.** It is gone, with its Settings switch and tour step. When a goal is in hand, the plan shows where things stand.
- **The `find-skills` advice.** Clawd no longer suggests installing the find-skills skill with `npx` when nothing fits. The built-in search replaces it.

### Fixed

- The test suite builds its fake secrets at runtime, so secret scanners no longer flag the repository.

## 1.1.4 - 2026-11-11

### Fixed

- Quiet chat shows a specialist's report that mentions a failure, an error, something blocked, skipped or timed out, or a request for your permission or approval. A clean report is still hidden.
- With "Clawd runs the chat" off, Clawd HQ leaves the Agent tool as Claude Code wrote it, lists laid-off agents normally, and no longer adds your setup profile to the chat. The panel stays.
- The automatic trim of unused helpers (in projects with 15 or more agent types) runs only with Automatic setup on, and leaves a card on the Office tab naming who was set aside.
- Setup starts right when a session restarts mid-setup: the scout keeps its brief, and an empty folder gets the standard team. Thanks to @magicx78 (#6).
- The setup card names the built-in agents once when no helpers were found (#1).
- Markdown files keep LF line endings on Windows, so agent front matter can't break as in #7.

## 1.1.3 - 2026-11-11

### Changed

- Before he opens the question box, Clawd writes a short catch-up: **Bottom line**, **What was done**, and **Caveat** when one matters.
- The catch-up shows as written. Clawd takes one silent pause step before the question, a new built-in tool called `before_question`. Its row in the chat is dimmed.

### Fixed

- The Researcher and Reviewer load with their tools and model again. Their descriptions had an unquoted colon, which newer Claude Code reads as broken front matter. Thanks to @magicx78 (#7).

## 1.1.2 - 2026-11-09

### Fixed

- Quiet chat hides a hired specialist's report handed back to the chat. Clawd still reads every report and brings you anything that needs you.
- Finished background commands stay hidden even when the command has a "?" in it. A failed command, or one that asks you something, still shows.
- In the desktop app, the coffee break button goes away when the compaction finishes, not after your next turn.
- Pages published or edited through the claude-artifacts connector appear on the Artifact Desk, and an edit updates the row. Sessions without the built-in Artifact tool get a working desk too.

### Changed

- The plugin's main wiring file is split into one small file per feature. No change in behaviour.

## 1.1.1 - 2026-11-08

### Added

- `/office-setup [folder]` scans a folder you name. The team is still filed under the session's own project.

### Fixed

- Setup finds your project in the Claude desktop app, which can start a session in a temporary folder and then move it. Clawd HQ now follows the session's real project folder, and your team, payroll, Left undone and artifacts follow it (#5). Thanks to @vigneshiyergithub.
- A missing folder stops setup with a plain line on the card, instead of picking an empty team.

## 1.1.0 - 2026-11-05

### Changed

- Installed helpers come first. When your team already has a planner, builder, reviewer or researcher of your own, it takes that seat, and Clawd HQ's matching built-in helper steps back as a backup. The built-in four still fill any role nothing installed covers.
- The People tab gives Claude's built-in agents their own heading, and your personal agents can be laid off like any other helper.
- The README has a short "Why" section and plainer wording on your own kit and on pair-ups.

## 1.0.1 - 2026-11-04

### Added

- "Left undone" keeps a short log of its checks (when, the outcome, how many items; never your request or Clawd's report).

### Fixed

- "You should know" no longer flags a specialist for following a later instruction from Clawd. The check sees every later instruction, re-reads work whose check failed or timed out, and notes when a run was stopped or hit an error.
- The People tab no longer shows helpers hired in other projects. Hires stay with their project, and token counts are per project.
- Thanks to @ArnavVerma170209 for fixing two outdated comments (#4).

## 1.0.0 - 2026-11-03

### Added

- The first release. Clawd hands larger jobs to specialists in the background, picks a small team from the agents and skills you already have installed, and sizes each job's model and effort.
- Pair-ups and a council, for risky work and hard choices.
- A live office panel with plain-words progress.
- "You should know" and "Left undone" checks on finished work, each of which can be turned off.
- A recap when you come back, and a coffee break that compacts a long chat.
- Lasting rules go into your CLAUDE.md only when you press the button.
