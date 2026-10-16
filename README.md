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

`/office` opens four tabs: Office (who is at work and what each specialist is doing right now), Decisions (the project memory), People (hire and lay off) and Settings (the plugin's configs, with toggles, the work finished this session, and Clawd's instructions and voice notes, which you can ask Claude to edit). The bottom row of each tab shows how full the context is and, on a Claude subscription, how much of your session and weekly limits you have used, with each number turning amber at 70% and red at 90%.

The office opens on the Office tab when a session starts, in the terminal and in the desktop app alike. Showing a tab this way also gives it the keyboard, so your first keys go to the panel until you click the prompt box or press Esc. If Claude Code cannot do that at that moment (a reply is already running, or there is text in the prompt box), the request is made once more when the first reply ends, and then not again. When the plugin reloads during a session (for example, after you change a config in the Settings tab), the tabs stay as you left them.

## What this plugin changes

- It adds Clawd's instructions to the main chat. With them, Claude works as a chief of staff: it does small jobs itself, hands real work to specialists in the background, asks you only what needs you (in one batch, not one by one), and reports in plain words. The two texts are in [`plugins/clawd-hq/prompts`](plugins/clawd-hq/prompts): the rules and the voice. Subagents and teammates do not get them. See [Settings](#settings) to turn this off or to use your own voice.
- It lets you change those instructions from the Settings tab. The lower part of the tab shows the rules and the voice notes as Clawd gets them, each as plain rendered Markdown in its own box on a slightly different background. A box shows about 12 lines at a time; when the file is longer, ▲ and ▼ under it move it about 10 lines and a count says which lines you see (for example, "lines 1–12 of 80"). The box never cuts a line or splits a code block, list item or table. It remembers where you were and goes back to the top when the file changes. "Edit with Claude" (one button for each file) puts a short line such as `Edit Clawd's instructions: ` in your prompt box when the box is empty; you finish the sentence and send it yourself. Nothing is ever sent for you. Claude then edits your own copy, one for all your projects, at `~/.clawd-hq/chief-of-staff.md` or `~/.clawd-hq/soul.md`; the plugin's built-in files are never changed, and while that request runs, writes to them are refused. The "Always" rules are fixed in the plugin and cannot be edited. Changes apply from your next session or after `/clear`. Reset puts your copy aside as a `.bak` file and goes back to the built-in text. A copy you never edited keeps following the built-in text when the plugin updates.
- It adds a short note to every subagent brief. The note asks agents not to stop for a question: they make their best call, list their questions at the end of their report for Clawd, and report the choices they made. It also asks them to start each step with one plain sentence about what they are doing, which is what a specialist's row in the Office tab shows, along with its model and effort level.
- It adds a note to the description of the agent tool, so Clawd picks a model and effort for each hire. While Clawd runs the chat, the note also says that handing work to agents is your standing wish, so he does not wait to be asked each time.
- It adds your project's recorded decisions to the conversation and to subagent briefs. Choices that agents report are marked as notes for reference, not instructions.
- It adds three tools: one to record a decision, one that plays the demo, and one a specialist uses to report how far along it is.
- It shows each specialist's progress. The brief note asks a specialist to plan its work in 3 to 8 steps and to report each step with that small tool. Its row in the Office tab then shows a small bar and a count such as 2/5, with its few words on the step. A specialist that never reports gets no bar.
- It saves what you answer in Clawd's question box as your decision.
- It can hide agent types you lay off in the payroll. When many agent types are on offer that the project does not use, a payroll review appears in the People tab with two answers: lay them off, or keep everyone.
- It saves your decisions as a plain Markdown file in your project, at `.clawd-hq/decisions.md`: one line per decision, which you can read and edit by hand. Commit it to share the decisions with your team, or add `.clawd-hq/` to `.gitignore` to keep them private. Notes and headings you add to the file are left alone, and it keeps the newest 1000 decisions. Treat the file like `CLAUDE.md`: whatever it says is given to the agents as your decisions.
- It keeps the payroll (who you have laid off) and a count of how often each agent type was hired on your machine, in your Claude Code configuration folder. The payroll is kept per project folder.
- It keeps the main chat quiet while Clawd runs it. It hides the "finished" notice of any background job that ended well (a specialist Clawd hired, or a background command or monitor), the messages of teammates he hired by name, and the `[no update]` line he writes when such a message leaves nothing to tell you. It also hides small bookkeeping rows (the progress steps, "tool loaded", and the "ctrl+b to run in background" hint) and dims the rows for remembered decisions, messages to his teammates, and the task list. He reports once the job is done, and the Settings tab lists what finished. A job that failed or was stopped, anything that errored or was interrupted, and anything that asks for something (a question, or a request for permission or approval) is never hidden or dimmed. Neither are your own messages, messages from other sessions or channels, his reports, or the "Async agent launched" line. See [Settings](#settings) to turn it off. The full view (`ctrl+o`) shows the finished notices and messages in full, but not the hidden tool rows, because the engine does not say which view a tool row is drawn in.
- It makes a recap for Clawd's card. After at least three turns and three quiet minutes, it asks the model one short question about the session and shows the answer as one line, "Where we left off", until your next message. This works the way Claude Code's own session recap does: the question rides on the session's cached conversation, so it is cheap while that cache is still warm. If the machine slept through the pause and the cache has lapsed, that one question costs as much as a normal message. One recap per pause. See [Settings](#settings) to turn it off.
- It adds an Artifact Desk to the Office tab. Whenever Claude publishes or opens a page on claude.ai with its Artifact tool, in the main chat or in a specialist's work, the page is listed there under its title with how long ago it was made, and one click opens it. The newest 6 are shown and the older ones are counted. The list is kept for each project folder, the newest 50, in your Claude Code configuration folder, and it is not drawn until there is a page to show.
- It checks finished work against what was reported, with its own version of Claude Code's "You should know". After each specialist hands its work back, and after any turn of Clawd's own that used six tools or more, a small model (Haiku) reads the full record of the run: the brief, every step with its outcome, the specialist's own words and the report. Only long outputs are trimmed, and each trim is marked. It speaks rarely and finds nothing most of the time. It speaks only when you would change what you do, or be upset to find out later: a claim no step backs up, a failure the report hides, a change outside the brief or against a decision you recorded, or a real risk to your files, data, money or time. General tips about git, npm or the shell are never a note. Then one short note appears in its own "You should know" section under Clawd's card, headed "You should know" or "Heads up" and the name of who did the work, with Learn more, Knew this already and Dismiss. Only one note shows at a time, no new check is made while it is showing, and at most one note comes for each message you send. Checks are made only while one of the office tabs is open (any of the four); a note made while you are on another tab waits in that section. Your second message after a note takes it off, and a note you opened with Learn more goes after your fourth message since you opened it (a note you opened never counts as passed over); after several notes go unanswered it checks less often, until you press a button again. Each check costs a small Haiku call from your plan. For each project folder, it keeps the notes it showed, the ones you already knew, and a log of the last 20 checks (outcome, tokens, time) in your Claude Code configuration folder, never in your project. While it is on and an office tab is open, Claude Code's own "You should know" note above the prompt box stays quiet, so you never get two; with no office tab open, Claude Code's own note works as usual. See [Settings](#settings) to turn it off.
- It offers a "☕ Coffee break" button in the footer of the panel, beside the Usage button, when it is a good time to compact a long chat. It shows only when two things are true. The chat has reached 300,000 tokens, or 90% of the point where Claude Code would compact by itself, whichever comes first. And a piece of work has just closed: a specialist handed its work back, Clawd reported it (even if the report ends by asking what next). It stays hidden while a question box is open, while Clawd or any specialist is working, between the steps of a job, after a plain chat reply, and once new work starts (a specialist hired or resumed, or Clawd using tools himself) or the chat is compacted, until the next piece of work closes. Plain chat does not hide it. Pressing it compacts the chat right away, with a short note asking the summary to keep your latest request, the open work, any question still waiting, what the specialists finished and what is left, and a pointer to `.clawd-hq/decisions.md` for the recorded decisions. The model adds a few lines of its own about this session, written from one short cached question (the fixed list alone is used if that fails or takes over 10 seconds). While the button shows, Clawd stays awake and says it is time for a coffee break; he picks up the mug only after you press it, and keeps it for two minutes after a successful compaction. If the compaction is skipped or fails, one amber line under the footer says why. On the desktop app, or an older Claude Code that cannot compact for a plugin, the button puts `/compact` and the note in your prompt box instead, when the box is empty, and you send it yourself.
- Apart from the recap and these checks, it makes no network calls and starts no processes of its own.

## Settings

The Settings tab in the panel lists them under "Configs", one row each: the setting's name on the left and its toggle (`● On` or `○ Off`) on the right. What each one does is in the table below. Press a toggle to turn it the other way. The change is saved to your settings, and the plugin reloads with it at once. While Clawd is working on a message, the toggles are dimmed and wait until he is free, so a reload cannot cut into his turn. If Claude Code refuses the change (for example, when your organization manages that setting), the tab says why in plain words and the setting stays as it was. A plugin loaded from a folder may have no row of its own in `/config`; then the tab says so and points you to `/plugin`. The voice file is a path, not a toggle: its row shows only when one is set, and you change it in `/plugin`, on the plugin's own page, or in `/config`, as you can every setting. Below the configs, "Finished this session" swaps the tab to the list of work that finished in this session, with a Back link. Under that come Clawd's instructions and voice notes, each with where the text comes from (built-in, your copy, or your voice file setting) and its "Edit with Claude" button, and each in a box you can move through with ▲ and ▼. The fixed "Always" rules come last. Edits apply from your next session.

Clawd's instructions also reach scripted runs (`claude -p` and the Agent SDK), because the plugin's hooks run there too. If you script Claude and want its usual behaviour, turn the first setting off.

| Setting | Default | What it does |
| --- | --- | --- |
| Clawd runs the chat (`chiefOfStaff`) | On | Off: Claude behaves as usual in the main chat. You keep the panel, the decisions file and everything else. |
| Quiet chat (`quietChat`) | On | Off: the main chat shows every row as Claude Code draws it, and Clawd is not asked to write the `[no update]` line. It only applies while "Clawd runs the chat" is on. |
| Recap on Clawd's card (`recap`) | On | Off: no recap is made, and the model is never asked for one. |
| You should know (`youShouldKnow`) | On | Off: finished work is not checked, no notes appear in the Office tab, and Claude Code's own "You should know" works as usual. |
| Your own voice file (`voiceFile`) | Empty | The full path of a text file that sets how Clawd sounds, in place of his built-in voice. It changes his tone only, never his rules. It is read when a session starts, and a file over 8000 characters is not used. When it is set, it wins over your own copy from the Settings tab, and the tab shows and edits this file instead. |

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
