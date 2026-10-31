# Clawd HQ

A chief of staff for your Claude Code project. Brief Clawd once. He picks specialists from the helpers you already have installed, runs independent work in the background, and brings back one report. A live pixel-art office panel shows who is working on what.

Needs Claude Code v2.1.287 or later.

## Install

```bash
claude plugin marketplace add vedant-shah/clawd-hq
claude plugin install clawd-hq@clawd-hq
```

Start a session. The office opens on its own. Type `/office-demo` for a 90-second tour.

## What it runs, sends and fetches

Most of it runs on your machine. Model calls use your plan.

| When | Model | What it sees |
| --- | --- | --- |
| Setup picks a team | Sonnet, read-only | Files in this project it opens (no content search, no secret-named files, nothing outside the folder), plus your helpers' names and use counts |
| Setup fallback | Opus, once | A project summary, the README, your instruction files, helper names and counts |
| Setup writes your workflow | Haiku | Your instruction files |
| Recap | The session's model | One short question on the cached chat |
| You should know | Haiku | The brief, each step, and the report. Long outputs are trimmed. |
| Left undone check | Haiku | Your request and Clawd's final report |
| Coffee break | The session's model | One short question on the cached chat |

Apart from these calls, the plugin opens no network connections and starts no processes.

What is stored, and where:

- Your Claude Code config folder, never your project: who you laid off, hire counts, the Artifact Desk list, "You should know" notes, and the Left undone list.
- Your project's CLAUDE.md: only the rule lines you add with "Add to CLAUDE.md".
- Past sessions: read on this computer. Only helper names and counts are kept.
- Your copies of Clawd's rules and voice: in `~/.clawd-hq/`, made only when you edit them.

## Full guide

See the [full README](https://github.com/vedant-shah/clawd-hq#readme) for features, setup, settings and FAQ.

## License

MIT. See [LICENSE](LICENSE).
