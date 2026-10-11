# Clawd HQ

A Claude Code mod that adds a side panel with a pixel-art office. Clawd, the chief of staff, sits in the corner office. Every subagent he hires is an employee at a desk. There is a CEO desk for questions that need you, and a project memory of the decisions you have made.

It is early and still changing, so expect rough edges.

## Requirements

- Claude Code with mods support, v2.1.287 or later.
- Mods do not run in Cowork or Chat.

## Install

```bash
claude plugin marketplace add vedant-shah/clawd-hq
claude plugin install clawd-hq@clawd-hq
```

## Getting updates

```bash
claude plugin marketplace update clawd-hq
```

Then run `/reload-plugins` or restart Claude Code. Auto-update is off by default. You can switch it on for this marketplace in `/plugin`.

## Commands

- `/office` opens the office.
- `/ceo` opens the CEO desk.
- `/office-demo` plays a one-minute tour.

In the office, the tabs are `o` Office (who is at work), `d` Decisions (the project memory), `p` People (hire and lay off) and `l` Log (work finished this session). `i` opens the CEO desk. The top row shows how full the context is and, on a Claude subscription, how much of your session and weekly limits you have used.

## What this plugin changes

- It adds a short note to every subagent brief. The note asks agents to raise questions for you and to report choices they made.
- It adds a note to the description of the agent tool, so Clawd picks a model and effort for each hire.
- It adds your project's recorded decisions to the conversation and to subagent briefs. Choices that agents report are marked as notes for reference, not instructions.
- It adds three tools: one to file a question on the CEO desk, one to record a decision, and one that plays the demo.
- It can hide agent types you lay off in the payroll.
- It stores decisions, the payroll and the agent roster on your machine, in a file in your Claude Code configuration folder. Decisions and the payroll are kept per project folder, so every Claude Code session in that folder shares them. The roster of agent names is shared by all projects.
- It makes no network calls and starts no processes of its own.

## Development

From `plugins/clawd-hq`:

```bash
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc --noEmit -p .
```

## Unofficial

Unofficial. Not made by, endorsed by, or affiliated with Anthropic. Clawd is Anthropic's mascot.

## License

MIT. See [LICENSE](LICENSE).
