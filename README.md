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
- It adds a note to the description of the agent tool, so Clawd picks a model and effort for each hire. While Clawd runs the chat, the note also says that handing work to agents is your standing wish, so he does not wait to be asked each time.
- It adds your project's recorded decisions to the conversation and to subagent briefs. Choices that agents report are marked as notes for reference, not instructions.
- It adds two tools: one to record a decision, and one that plays the demo.
- It saves what you answer in Clawd's question box as your decision.
- It can hide agent types you lay off in the payroll. When many agent types are on offer that the project does not use, a payroll review appears in the People tab with two answers: lay them off, or keep everyone.
- It saves your decisions as a plain Markdown file in your project, at `.clawd-hq/decisions.md`: one line per decision, which you can read and edit by hand. Commit it to share the decisions with your team, or add `.clawd-hq/` to `.gitignore` to keep them private. Notes and headings you add to the file are left alone, and it keeps the newest 1000 decisions. Treat the file like `CLAUDE.md`: whatever it says is given to the agents as your decisions.
- It keeps the payroll (who you have laid off) and a count of how often each agent type was hired on your machine, in your Claude Code configuration folder. The payroll is kept per project folder.
- It keeps the main chat quiet while Clawd runs it. It hides the "finished" notice of a specialist Clawd hired, the messages of teammates he hired by name, and the `[no update]` line he writes when such a message leaves nothing to tell you. He reports once the job is done, and the Log tab lists what finished. A failure is never hidden, and neither is a message that asks for something: a question, or a request for permission or approval. The full view (`ctrl+o`) shows everything. See [Settings](#settings) to turn it off.
- It makes a recap for Clawd's card. After at least three turns and three quiet minutes, it asks the model one short question about the session and shows the answer as one line, "Where we left off", until your next message. This works the way Claude Code's own session recap does: the question rides on the session's cached conversation, so it is cheap while that cache is still warm. If the machine slept through the pause and the cache has lapsed, that one question costs as much as a normal message. One recap per pause. See [Settings](#settings) to turn it off.
- It adds an Artifact Desk to the Office tab. Whenever Claude publishes or opens a page on claude.ai with its Artifact tool, in the main chat or in a specialist's work, the page is listed there under its title with how long ago it was made, and one click opens it. The newest 6 are shown and the older ones are counted. The list is kept for each project folder, the newest 50, in your Claude Code configuration folder, and it is not drawn until there is a page to show.
- It checks finished work against what was reported, with its own version of Claude Code's "You should know". After each specialist hands its work back, and after any turn of Clawd's own that used six tools or more, a small model (Haiku) reads the full record of the run: the brief, every step with its outcome, the specialist's own words and the report. Only long outputs are trimmed, and each trim is marked. Most of the time it finds nothing and shows nothing. When the report leaves out or gets wrong something that matters (a claim no step backs up, a test that failed, a file changed outside the brief), one short note appears on Clawd's card, headed "You should know" or "Heads up" and the name of who did the work, with Learn more, Knew this already and Dismiss. Up to three notes wait their turn. Checks are made only while one of the office tabs is open (any of the four); a note made while you are on another tab waits on Clawd's card. Your second message after a note takes it off; after several notes go unanswered it checks less often, until you press a button again. Each check costs a small Haiku call from your plan. It keeps the notes it showed, the ones you already knew, and a log of the last 20 checks (outcome, tokens, time) in your Claude Code configuration folder, never in your project. While it is on and an office tab is open, Claude Code's own "You should know" note above the prompt box stays quiet, so you never get two; with no office tab open, Claude Code's own note works as usual. See [Settings](#settings) to turn it off.
- Apart from the recap and these checks, it makes no network calls and starts no processes of its own.

## Settings

Change these in `/plugin`, on the plugin's own page, or in `/config`. A change takes effect when the plugin reloads.

Clawd's instructions also reach scripted runs (`claude -p` and the Agent SDK), because the plugin's hooks run there too. If you script Claude and want its usual behaviour, turn the first setting off.

| Setting | Default | What it does |
| --- | --- | --- |
| Clawd runs the chat (`chiefOfStaff`) | On | Off: Claude behaves as usual in the main chat. You keep the panel, the decisions file and everything else. |
| Quiet chat (`quietChat`) | On | Off: the main chat shows every row as Claude Code draws it, and Clawd is not asked to write the `[no update]` line. It only applies while "Clawd runs the chat" is on. |
| Recap on Clawd's card (`recap`) | On | Off: no recap is made, and the model is never asked for one. |
| You should know (`youShouldKnow`) | On | Off: finished work is not checked, no notes appear on Clawd's card, and Claude Code's own "You should know" works as usual. |
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
