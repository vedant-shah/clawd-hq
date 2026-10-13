# Clawd HQ

A Claude Code mod that adds a side panel with a pixel-art office. Clawd, the chief of staff, sits in the corner office. Every subagent he hires is an employee at a desk. Clawd asks you only what needs you, in one question box, and keeps a project memory of the decisions you have made.

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
- `/office-demo` plays a one-minute tour.

`/office` opens four tabs: Office (who is at work and what each specialist is doing right now), Decisions (the project memory), People (hire and lay off) and Log (work finished this session). The bottom row of each tab shows how full the context is and, on a Claude subscription, how much of your session and weekly limits you have used.

## What this plugin changes

- It adds Clawd's instructions to the main chat. With them, Claude works as a chief of staff: it does small jobs itself, hands real work to specialists in the background, asks you only what needs you (in one batch, not one by one), and reports in plain words. The two texts are in [`plugins/clawd-hq/prompts`](plugins/clawd-hq/prompts): the rules and the voice. Subagents and teammates do not get them. See [Settings](#settings) to turn this off or to use your own voice.
- It adds a short note to every subagent brief. The note asks agents not to stop for a question: they make their best call, list their questions at the end of their report for Clawd, and report the choices they made. It also asks them to start each step with one plain sentence about what they are doing, which is what a specialist's row in the Office tab shows, along with its model.
- It adds a note to the description of the agent tool, so Clawd picks a model and effort for each hire.
- It adds your project's recorded decisions to the conversation and to subagent briefs. Choices that agents report are marked as notes for reference, not instructions.
- It adds two tools: one to record a decision, and one that plays the demo.
- It saves what you answer in Clawd's question box as your decision.
- It can hide agent types you lay off in the payroll. When many agent types are on offer that the project does not use, a payroll review appears in the People tab with two answers: lay them off, or keep everyone.
- It saves your decisions as a plain Markdown file in your project, at `.clawd-hq/decisions.md`: one line per decision, which you can read and edit by hand. Commit it to share the decisions with your team, or add `.clawd-hq/` to `.gitignore` to keep them private. Notes and headings you add to the file are left alone, and it keeps the newest 1000 decisions. Treat the file like `CLAUDE.md`: whatever it says is given to the agents as your decisions.
- It keeps the payroll (who you have laid off) and a count of how often each agent type was hired on your machine, in your Claude Code configuration folder. The payroll is kept per project folder.
- It makes no network calls and starts no processes of its own.

## Settings

Change these in `/plugin`, on the plugin's own page, or in `/config`. A change takes effect when the plugin reloads.

Clawd's instructions also reach scripted runs (`claude -p` and the Agent SDK), because the plugin's hooks run there too. If you script Claude and want its usual behaviour, turn the first setting off.

| Setting | Default | What it does |
| --- | --- | --- |
| Clawd runs the chat (`chiefOfStaff`) | On | Off: Claude behaves as usual in the main chat. You keep the panel, the decisions file and everything else. |
| Your own voice file (`voiceFile`) | Empty | The full path of a text file that sets how Clawd sounds, in place of his built-in voice. It changes his tone only, never his rules. It is read when a session starts, and a file over 8000 characters is not used. |

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
