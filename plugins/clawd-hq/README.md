# Clawd HQ

A chief of staff for your Claude Code project. Brief Clawd once. He picks specialists from the helpers you already have installed, runs independent work in the background, and brings back one report. A live pixel-art office panel shows who is working on what.

Needs Claude Code v2.1.287 or later.

## Install

```bash
claude plugin marketplace add vedant-shah/clawd-hq
claude plugin install clawd-hq@clawd-hq
```

Start a session. The office opens on its own. Type `/office-demo` for a 90-second tour.

## What it reads, sends, runs and writes

Most of it runs on your machine. Model calls go through Claude Code's own model calls and use your plan.

| When | Model | What it sees |
| --- | --- | --- |
| Setup picks a team | Sonnet scout | The project folder path, a quick scan (README head, instruction files, dependencies, outline, file types), your helpers' names, descriptions and use counts, and the project files it opens |
| Setup fallback | Opus, once, only if the scout gives nothing usable | The same quick scan, and your helpers' names, descriptions and use counts |
| Setup writes your workflow | Haiku | Your instruction files |
| Recap | The session's model | One short question on the cached chat |
| You should know | Haiku | The brief, each step, and the report. Long outputs are trimmed. |
| Left undone check | Haiku | Your request and Clawd's final report |
| Coffee break | The session's model | One short question on the cached chat |

It fetches nothing from the network and starts no processes.

What it starts and calls by itself:

- The setup scout: its only tools are Read and Glob (no content search), and it runs in `dontAsk` mode, so a call that would need your approval is refused. It is told to stay in the project folder and not to open secret-named files. It never gains a permission; it only has fewer.
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
- Your own voice file, if you set one.

What it writes:

- `~/.clawd-hq/chief-of-staff.md` and `~/.clawd-hq/soul.md`: your copies of Clawd's rules and voice, which the main chat follows. Made only when you press Edit; saved as `.bak` and emptied only when you press Reset.
- Your project's CLAUDE.md: only the exact rule line shown, when you press "Add to CLAUDE.md".
- The plugin's own store in your Claude Code config folder, never your project: setup's team and profile, who you laid off, hire counts, the Artifact Desk list, "You should know" notes, the Left undone list, and the Settings switches.

What it changes as text passes through:

- System prompt: while "Clawd runs the chat" is on, it adds Clawd's rules and voice as one section. If that section did not reach the model, the same text rides along with your next message.
- Agent tool description: it adds a note on choosing each hire's model and effort and, while Clawd runs the chat, a standing instruction that you want work handed to agents without being asked each time.
- Hire briefs: it removes Clawd's `[effort: …]` and `PAIR-UP:` lines and adds a short note on how to report questions and choices. The agent type, tools, model and permission mode are never changed. The specialist's requests use the effort Clawd chose.
- Your messages: they may carry, unseen, an edit note when you edit Clawd's files from Settings, and setup's ask to hire the scout.
- Every conversation: your role and way of working, from setup, ride along as one block.
- Agent list: helpers you laid off are hidden from the model.
- Quiet chat: it hides specialists' finished notices, Clawd's no-update lines and background hints, and hides or dims the office's own bookkeeping rows. Errors always show, and the expanded view (ctrl+o) shows everything.
- "You should know": while this one is on and an office tab is open, Claude Code's own "You should know" question gets a quiet answer.
- While you edit Clawd's files from Settings, writes to the plugin's built-in files are refused.

The Settings switches are kept in the plugin's own store. Claude Code's /config does not show a press; a value set in /config is used until you press that switch.

The `tests/` folder is run only by `claude plugin test`. The plugin never loads it.

## Full guide

See the [full README](https://github.com/vedant-shah/clawd-hq#readme) for features, setup, settings and FAQ.

## License

MIT. See [LICENSE](LICENSE).
