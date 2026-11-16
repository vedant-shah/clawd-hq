# Clawd HQ

A chief of staff for your Claude Code project. Brief Clawd once. He picks specialists from the helpers you already have installed, runs independent work in the background, and brings back one report. A live pixel-art office panel shows who is working on what.

Needs Claude Code v2.1.287 or later.

## Install

```bash
claude plugin marketplace add vedant-shah/clawd-hq
claude plugin install clawd-hq@clawd-hq
```

Start a session. The office opens on its own. Type `/office-demo` for a tour of about a minute and a half.

## What it reads, sends, runs and writes

Most of it runs on your machine. Model calls go through Claude Code's own model calls and use your plan.

| When | Model | What it sees |
| --- | --- | --- |
| Setup picks a team | Sonnet scout | The project folder path, a quick scan (README head, instruction files, dependencies, outline, file types), your helpers' names, descriptions and use counts, and the project files it opens |
| Setup fallback | Opus, once, only if the scout gives nothing usable | The same quick scan, and your helpers' names, descriptions and use counts |
| Setup writes your workflow | Haiku | Your instruction files |
| You should know | Haiku | The brief, each step, and the report. Long outputs are trimmed. |
| Left undone check | Haiku | Your request and Clawd's final report |
| Coffee break | The session's model | One short question on the cached chat |
| The plan and the history | No model | Nothing is sent. They are files in your project (see "What it writes"). |
| Installed matches for a job are weak or missing | No model. Claude Code fetches up to three skills.sh search pages for the plugin | Up to three searches, each with a few plain words in the address: the keywords for the job, and when they find nothing, words from the job description. The "Search the public skill registry when matches are weak" switch in Settings turns it off. A skill is fetched from its source only if you say yes to installing it. |

Apart from the registry search above, it fetches nothing from the network and starts no processes. That search is made through Claude Code, only when the installed matches are weak or missing and its switch is on. The job's keywords therefore go to skills.sh more often than when it ran only if nothing matched.

What it starts and calls by itself:

- The setup scout: its only tools are Read and Glob (no content search), and it runs in `dontAsk` mode, so a call that would need your approval is refused. It is told to stay in the project folder and not to open secret-named files. Reads outside the project are refused because Claude Code asks before them by default; a rule of yours that allows such reads would apply to the scout too. It never gains a permission; it only has fewer.
- A start of the scout by anyone but the plugin is refused, except while setup has asked Clawd to hire it.
- TaskStop, for the scout, if it gives no team within 90 seconds.
- The Artifact tool's `list` action, at session start, only when Claude Code says the call needs no question to you. Pages it no longer lists leave the Artifact Desk.
- `/office-council <question>` sends "Hold a council on: <question>" as your own message. It submits no other prompt.

What it reads on this computer:

- Past session files in `~/.claude/projects` (or `CLAUDE_CONFIG_DIR`): only helper names and use counts are kept.
- Your helpers in `~/.claude/agents`, `~/.claude/skills` and the project's `.claude/` folder.
- The project's README, instruction files, manifests and file names, for setup's quick scan.
- Specialists' transcripts, and the main chat after a long turn of Clawd's own, for the "You should know" check; the scout's transcript, for its picks.
- Text written by Edit and Write calls, for TODO, skipped-test and not-implemented markers (Left undone).
- The project's `.clawd-hq/plans/` and `.clawd-hq/history-*.jsonl`, for the plan and the History tab. A plan file is read by Clawd, like CLAUDE.md: the newest one becomes the goal in hand when a session starts, and Clawd sees its title, summary, steps and Later items each time he uses the plan. So a plan file someone else committed is text Clawd will read.
- Your own voice file, if you set one.

What it writes:

- `<project>/.clawd-hq/plans/<goal>.md`: Clawd's plan for the goal in hand (title, an optional one-sentence summary, steps, the choices a specialist made, and a Later list), as Markdown you can commit. It is made when Clawd starts a goal and emptied when the goal ends. Put-off items then move to the Left undone list.
- `<project>/.clawd-hq/history-<session>.jsonl`: one line per goal start and end, specialist run, tool call and model request. A tool call keeps its name, timing and whether it worked, never its input or output. A model request keeps token counts. The only free text is a goal's title, summary and steps, a step's Decided lines, a run's task, and an artifact's title, each cut to 120 characters. Artifact links are kept too. It rolls over at 2 MB, old files are kept, and nothing is deleted. When `.clawd-hq/.gitignore` is missing, the plugin writes it with that rule (`history*.jsonl`), which keeps these files out of git. A `.clawd-hq` folder that leads out of the project is refused.
- `~/.clawd-hq/chief-of-staff.md` and `~/.clawd-hq/soul.md`: your copies of Clawd's rules and voice, which the main chat follows. Made only when you press Edit; saved as `.bak` and emptied only when you press Reset.
- Your project's CLAUDE.md: only the exact rule line shown, when you press "Add to CLAUDE.md".
- The plugin's own store in your Claude Code config folder: setup's team and profile, who you laid off, hire counts, each project's token totals per helper, the Artifact Desk list, "You should know" notes, the Left undone list, a short log of its checks (when, what came of it, how many items; never your request or its report), the steps of a plan the Planner wrote that is waiting for a goal to end (dropped after seven days), short lines about plan problems that were passed over (never your words), and the Settings switches.

What it changes as text passes through:

- System prompt: while "Clawd runs the chat" is on, it adds Clawd's rules and voice as one section. If that section did not reach the model, the same text rides along with your next message.
- Agent tool description: while Clawd runs the chat, it adds a note on choosing each hire's model and effort and a standing instruction that you want work handed to agents without being asked each time. With it off, the description is left as it is.
- Hire briefs: it removes Clawd's `[effort: …]` and `PAIR-UP:` lines and adds a short note on how to report questions and choices. The agent type, tools, model and permission mode are never changed. The specialist's requests use the effort Clawd chose.
- Your messages: they may carry, unseen, an edit note when you edit Clawd's files from Settings, and setup's ask to hire the scout.
- Every conversation: while Clawd runs the chat, your role and way of working, from setup, ride along as one block. With it off, nothing is added.
- Agent list: while Clawd runs the chat, helpers you laid off are hidden from the model. With it off, none are hidden.
- Quiet chat: it hides specialists' finished notices, Clawd's no-update lines and background hints, and hides or dims the office's own bookkeeping rows. Errors always show, and the expanded view (ctrl+o) shows everything.
- "You should know": while this one is on and an office tab is open, Claude Code's own "You should know" question gets a quiet answer.
- While you edit Clawd's files from Settings, writes to the plugin's built-in files are refused.

The Settings switches are kept in the plugin's own store. Claude Code's /config does not show a press; a value set in /config is used until you press that switch.

The `tests/` folder is run only by `claude plugin test`. The plugin never loads it.

## Full guide

See the [full README](https://github.com/vedant-shah/clawd-hq#readme) for features, setup, settings and FAQ.

## License

MIT. See [LICENSE](LICENSE).
