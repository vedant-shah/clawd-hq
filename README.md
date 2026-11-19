<div align="center">

<img src="docs/avatars/banner.svg" alt="Clawd, the chief of staff, hands a document to a builder, who works on it and sends back a done tick" width="400">

# Clawd HQ

### A chief of staff for your Claude Code project.

Brief Clawd once. He picks specialists from your installed helpers, runs independent work in the background, and brings back one report. Keep talking while the specialists work.

`free to talk` · `uses your installed helpers` · `right-sized models` · `live office panel`

[What it does](#-what-it-does) · [How it runs](#-how-clawd-runs-the-work) · [The office](#-the-office) · [Setup](#-first-time-setup) · [Privacy](#-privacy)

[![Featured on ClaudeMods](https://claudemods.dev/badge/clawd-hq-0299b6.svg?style=large&theme=dark)](https://claudemods.dev/en/builds/clawd-hq-0299b6)
[![Listed on modsforClaude](https://modsforclaude.com/badge/clawd-hq.svg)](https://modsforclaude.com/mods/clawd-hq/)
[![Mentioned in Awesome Claude Code Mods](https://awesome.re/mentioned-badge.svg)](https://github.com/karanb192/awesome-claude-code-mods)

</div>

https://github.com/user-attachments/assets/e6984ab3-ad8c-42a7-a6d7-95b0bd81015b

---


```bash
claude plugin marketplace add vedant-shah/clawd-hq
claude plugin install clawd-hq@clawd-hq
```

Start a session. The office opens on its own. Type `/office-demo` for a tour of about a minute and a half.

Needs Claude Code v2.1.287 or later.

## 💡 Why

When Claude is doing a long job in your main conversation, new requests pile up behind it. To change an instruction mid-job, you stop it and say it again.

Clawd works like a good chief of staff. He finds the right person for each job and rarely does the work himself. He settles small decisions with his team, and comes to you only when he needs you.

## ✨ What it does

Clawd HQ isn't a new agent runtime. It packages Claude Code's native agents into an opinionated project workflow: delegation by default for larger jobs, model and effort sizing, quiet progress, and a live office panel.

### 1. Stays free to talk

- **Delegates by default.** Clawd hands every job that one or two tool calls can't finish to a specialist in the background. Jobs that don't depend on each other run side by side. Ask him anything while three specialists work.
- **Specialists don't stall.** They never stop mid-run for a question. They make their best call, finish the job, and list their assumptions and questions at the end for Clawd.
- **Progress in plain words.** Each brief asks the specialist to start every update with a short sentence like "Step 2 of 4: checking the tests." The office turns that into a progress bar. A specialist can also report with a step tool, but it doesn't have to.
- **Steer a running specialist.** Uses Claude Code's own agent messaging: Clawd can message any running specialist, and it picks the message up at its next step. Change or add to a brief without restarting the job.
- **One report.** Questions come to you in one box (up to four) at a pause. Quiet chat hides "finished" notices. Failures and requests for your permission or approval always show. A specialist's question goes to Clawd, who asks you.
- **Plain words.** Clawd talks in plain, short sentences, borrowing a few rules from ASD-STE100 (Simplified Technical English).

Free to talk is the aim, not a promise. Short direct jobs (a single command, a line or two) Clawd does himself, and then you wait.

### 2. Right team, right size

- **Uses what you already have.** Setup picks your team from the agents and skills you have installed, whether that's ECC or your own. You might have 200 installed, but a project realistically uses 5 to 10, and those are the team. Each brief names the installed skills that fit the job. Nothing new to download.
- **Hires, doesn't guess.** Before a new kind of job, Clawd searches every installed agent and skill and picks the best fit, saying why when none fits. An off-team skill can be hired for one job as a contractor; hire it twice and he offers to make it staff. Every hire is named. A generalist is the last resort. When the installed matches are weak or missing, he also searches the public skill registry (skills.sh) on the web, with a few plain keywords for the job. If something fits well he comes back with its name, source and install count and asks whether to install it for this job or go ahead without it. Turn the search off in Settings and he goes straight to the general-purpose agent. Nothing is installed without your yes.
- **Right-sized hires.** Each job gets the smallest model and effort that can do it well, from Haiku to Opus. Skills are attached only when they add knowledge, not process: at most two, and none for a one-file edit or a job on the smallest model.
- **Pair-ups.** Some jobs need more than one kind of specialist. They work on it together, check each other, and come back with one conclusion.
- **Lay off unused helpers.** Helpers outside the team are laid off on their own, which keeps Clawd's choices short. A card on the Office tab names who was laid off, and search brings any back. This needs Automatic setup on.
- **Edit Clawd.** Change his rules or voice in plain words, from Settings. A short set of core rules is locked in code, so no edit can remove them. One click on Reset goes back to the built-in text.

### 3. Checks, and keeps you oriented

- **You should know.** Our own check on finished work: Haiku reads the specialist's full record against its report, and speaks up only when something matters. It backs off if you ignore it. It stands in for Claude Code's built-in You should know while it's on, so you aren't told twice. Every card has **Ask Clawd**.
- **The plan.** For a job of several steps, Clawd keeps a short, ordered plan for the one goal in hand. It has an optional one-sentence summary. A step ticks itself when its specialist finishes well, and stays open if the specialist failed. When the last step is ticked, the goal closes itself as done. Ideas put off go on a "Later" list. A plan from the Planner becomes the plan, or waits as a draft while another goal is in hand. Clawd works on one goal at a time. A goal belongs to the session that started it. Another session in the same folder sees it in History, and Resume takes it over. A plan file records the session that started it, so a teammate's clone shows that goal under "Open in other sessions" in History.
- **Left undone.** Lists work that was put off, like TODOs and skipped tests. It sits in the Later fold of the Office tab, next to the plan's own put-off ideas. "Do it now" puts it in your prompt box.
- **Coffee break.** Compacts a long chat at a calm moment, never mid-build.
- **Lasting rules, on your say-so.** When you state a rule for later work ("always", "from now on"), Clawd offers it on a card. One press adds that exact line to the project's CLAUDE.md, which every specialist already reads. An answer in the question box settles only the job at hand.
- **Artifact Desk.** Every page Claude publishes on claude.ai, one click away, under Artifacts on the History tab.

Every check can be turned off in Settings. Nothing is ever sent for you. Buttons fill your prompt box; the one exception is "Add to CLAUDE.md", which writes the line you see.

## 🔁 What changes

Claude Code already runs subagents in the background, with a model and effort per agent ([docs](https://code.claude.com/docs/en/sub-agents)). Clawd HQ sets that up for you and adds the workflow around it.

| | Plain Claude Code | With Clawd HQ |
| --- | --- | --- |
| Delegation | Claude decides case by case | Larger jobs go to specialists by default |
| Choosing models | You or each agent file set them | Clawd sizes model and effort per job |
| Questions | Come as they arise | Up to four in one box, at a pause |
| Progress | Raw tool rows in the chat | Plain-words steps in a live office panel |
| Several-step jobs | Held in the chat | A short plan saved in your project, ticked as work finishes |

- Clawd does jobs that take one or two tool calls himself. Anything bigger goes to a specialist.
- Lasting rules live in your CLAUDE.md, so you aren't asked twice.

## 🧭 How Clawd runs the work

Clawd HQ follows the "elephants and goldfish" idea from Google ([paper](https://research.google/pubs/elephants-goldfish-and-the-new-golden-age-of-software-engineering/)):

- **The elephant is Clawd.** One long conversation with you holds the project's memory and decisions. He writes no code himself.
- **The goldfish are the specialists.** Each starts fresh and knows only its brief, so it has none of the chat's blind spots.
- **Fresh eyes check the plan.** For risky work, a fresh Reviewer first restates the plan in its own words. A part it can't restate is unclear and gets fixed before anyone builds.

**How a request flows**

<p align="center"><img src="docs/diagrams/flow-request.svg" alt="How a request flows: you talk to Clawd; he does jobs of one or two tool calls himself or hires a specialist sized to the job; work comes back to Clawd for checks; you get one plain report." width="560"></p>

- You only talk to Clawd. He does jobs of one or two tool calls himself and hires for the rest.
- Each hire gets a model and effort sized to the job, and a brief that names the skills that fit.
- Work comes back to Clawd first. He checks it, a small model looks for gaps, and questions wait for one box.
- You get one plain report. Quiet chat hides the noise in between.

**The ways Clawd can staff a job**

<p align="center"><img src="docs/diagrams/flow-staffing.svg" alt="The ways Clawd can staff a job: a setup scout picks the team; then a single specialist, a pair-up of author and critic, a council where you decide, or optional agent teams." width="640"></p>

- **Single specialist.** The usual case. One helper works in the background at its own desk.
- **Pair-up.** For risky or wide work. Named specialists, such as an author and a critic, message each other directly (helpers that lack Claude Code's messaging tool go through Clawd). After one round of critique, each reports to Clawd. The office shows them as one card.
- **Council.** For a hard choice that is hard to undo. Type `/office-council <question>`, or start a message with "Hold a council on:": four fresh voices answer once, without seeing each other, and Clawd sums up without being one of them. You decide. The office shows it as one Council card.
- **Agent teams.** Only when Claude Code's experimental agent-teams feature is turned on. It is off by default.

## 🏢 The office

Type `/office` to open it. The Office tab looks like this:

<p align="center"><img src="docs/screenshots/office.png" alt="An illustration of the Office tab with a plan in hand: Clawd is working, a Builder and a Reviewer work under the current step of the plan, and a Researcher works beside it, each with its model, tokens and a step-by-step progress bar" width="480"></p>

- **Clawd's card.** His status, with a green, amber or red dot. The chat's model and effort. He stays free while specialists work, and falls asleep when the office is quiet.
- **Needs you.** What waits on you: "You should know" cards, offers of a rule or of staff, the layoff notice and setup choices.
- **The plan.** The goal, with "3 of 6 done" beside it and its summary under it. The last finished step stays in view, and earlier ones fold into "N steps done". A line runs beside the steps, and each specialist sits under its step. A failed specialist shows its reason, with **Details**, and then **Retry** and **Ask Clawd**. They fill your prompt box; nothing is sent.
- **Later.** A fold of put-off work: the plan's Later ideas, then the Left undone items. Each has **Do it now** (fills your prompt box) and **Dismiss**.
- **Also at work.** Specialists under no step of the plan. With no plan, this is the whole floor: one card per specialist with its own words, model, time, tokens and a progress bar. Pair-up members share one card. The voices of a council share one card.
- **Usage.** Context, session limit and weekly limit. Amber at 70%, red at 90%.

The other tabs:

- **People.** Your team, with what each helper does and how many tokens it has used. Helpers outside the team, including ones you install later, are laid off on their own; search finds them again.
- **History.** What got done, kept in your project (see Privacy).
  - *In progress:* the goal in hand.
  - *Finished:* each goal that ended, one line. Open one for its summary, totals, steps, retries and failures, and the pages it made. A goal that was set aside has **Resume**, which fills your prompt box with its unfinished steps and never sends.
  - *Other work:* one line per run that was not part of a goal. A finished council leaves one line per voice here.
  - *Artifacts:* the Artifact Desk list.
- **Settings.** The switches, and Clawd's rules and voice.

Every helper gets its own pixel Clawd, drawn for what it does:

<p align="center">
  <img src="docs/avatars/preview.png" alt="A sheet of pixel-art Clawd avatars, one per helper, each with its own outfit, hat and tool" width="520">
</p>

<!-- SCREENSHOT: a cropped strip of the avatars, if the full sheet is too tall. -->

## 🆚 How it's different

- **Usage panels show numbers.** This one shows who is doing what, and has the numbers too.
- **Multi-session tools make you run each session.** Here the chat hands out the work.
- **Workflow kits make you drive them with commands.** Clawd picks the helper and model himself.
- **Big catalogs give you hundreds of agents.** Setup picks a small team from what you already use. Clawd searches everything installed before a new kind of job, so the team is never a ceiling.
- **One office per project.** In other offices, every hire starts with picking a repo. Here the office is the project, so you never pick one.
- **It needs nothing else.** It ships its own Planner, Builder, Reviewer and Researcher.

## 🚀 First-time setup

Setup runs on its own the first time. No questions. A card shows what it picked.

<p align="center"><img src="docs/diagrams/flow-team-pick.svg" alt="The scout reads the project, read-only, and fills the Plan, Make, Check, Find out and up to three Specialist seats." width="560"></p>

- It reads the project and lists the agents and skills you have installed, and picks the team from that list.
- It counts which helpers you used in past sessions, on this computer.
- An empty Plan, Make, Check or Find out seat gets Clawd HQ's own Planner, Builder, Reviewer or Researcher.

Type `/office-setup` to run it again. Turn off "Automatic setup" in Settings if you'd rather start it yourself.

## ⚙️ Settings

All on by default, except "Open the office at session start", which is off. Flip them in the Settings tab.

<details>
<summary>What each switch does</summary>

| Switch | When it's off |
| --- | --- |
| Clawd runs the chat | Claude behaves as usual. You keep the panel. |
| Quiet chat | The chat shows every row. |
| Automatic setup | Setup runs only when you type `/office-setup`. |
| You should know | Finished work isn't checked. Claude Code's own note works as usual. |
| Left undone check | The model check is skipped. Code markers are still read. |
| Search the public skill registry when matches are weak | Nothing is searched or sent. Clawd uses the general-purpose agent. |
| Open the office at session start (off by default) | A new session opens no panels and doesn't ask to bring Office to the front, and shows the tip "Type /office to open the office" until you have opened it once. `/office` opens them. Turn it on and the panels open at every start, with no tip. |
| Your own voice file | A path to a text file that changes Clawd's tone. Empty by default. |

Clawd's rules also reach scripted runs (`claude -p` and the Agent SDK). Turn off "Clawd runs the chat" if you don't want that.

</details>

## 🔒 Privacy

Most of it runs on your machine. Model calls use your plan.

<details>
<summary>What is sent to which model</summary>

| When | Model | What it sees |
| --- | --- | --- |
| Setup picks a team | Sonnet, read-only | Files in this project it opens (Read and Glob only, no content search; it is told to skip secret-named files and stay in the folder), plus your helpers' names and use counts. About $0.15 per project on API billing ($0.13 to $0.18 across 11 real projects). |
| Setup fallback | Opus, once | A project summary, the README, your instruction files, helper names and counts |
| Setup writes your workflow | Haiku | Your instruction files |
| You should know | Haiku | The brief, each step, and the report. Long outputs are trimmed. |
| Left undone check | Haiku | Your request and Clawd's final report |
| Coffee break | The session's model | One short question on the cached chat |
| The plan and the history | No model | Nothing is sent. They are files in your project (see "What is stored"). |
| Installed matches for a job are weak or missing | No model. Claude Code fetches up to three skills.sh search pages for the plugin | Up to three searches, each with a few plain words in the address: the keywords for the job, and when they find nothing, words from the job description. The "Search the public skill registry when matches are weak" switch in Settings turns it off. A skill is fetched from its source only if you say yes to installing it. |

Apart from these calls, the plugin opens no network connections and starts no processes. The registry search is its one web request, made through Claude Code, only when the installed matches are weak or missing and the switch is on. The job's keywords therefore go to skills.sh more often than when it ran only if nothing matched.

</details>

<details>
<summary>What is stored, and where</summary>

- **Your Claude Code config folder:** who you laid off, hire counts, the Artifact Desk list, "You should know" notes, the Left undone list, the steps of a plan the Planner wrote that is waiting for a goal to end (dropped after seven days), and short lines about plan problems that were passed over (never your words).
- **Your project's `.clawd-hq/plans/`:** the plan, one file per goal, as plain Markdown. You can commit it. A plan file in the project is read by Clawd, like CLAUDE.md: when a session starts the newest one becomes the goal in hand, and Clawd sees its title, summary, steps and Later items each time he uses the plan. Commit one only if you want your team's Clawd to see it. When a goal ends its file is emptied, and its Later items move to the Left undone list.
- **Your project's `.clawd-hq/history-<session>.jsonl`:** the audit history behind the History tab. One line per goal start and end, specialist run, tool call and model request. A tool call keeps only its name, timing and whether it worked, never its input or output. A model request keeps only token counts. The only free text is a goal's title, summary and steps, a step's Decided lines, a run's task, and an artifact's title, each cut to one line of 120 characters. Artifact links are kept too. A file rolls over at 2 MB and the old files are kept. When `.clawd-hq/.gitignore` is missing, the plugin writes it with that rule (`history*.jsonl`), which keeps these files out of git.
- **Your project's CLAUDE.md:** only the rule lines you add with "Add to CLAUDE.md".
- **Past sessions:** read on this computer. Only helper names and counts are kept.
- **Your copies of Clawd's rules and voice:** in `~/.clawd-hq/`, made only when you edit them.

</details>

## ❓ FAQ

<details>
<summary>Does it cost more?</summary>

Specialists use your plan like any Claude work. Clawd picks the smallest model for each job, so routine work often runs on Haiku. Each extra check is one small call, and each can be turned off.

</details>

<details>
<summary>Will it hide something I need?</summary>

No. Failures, stopped jobs, errors and requests for your permission or approval always show. A question from a specialist goes to Clawd, who asks you. Press `ctrl+o` for the full view.

</details>

<details>
<summary>Can I go back to plain Claude?</summary>

Yes. Turn off "Clawd runs the chat". You keep the panel.

</details>

<details>
<summary>Does it work in Cowork or Claude chat?</summary>

The panel is a mod, and mods don't run in Cowork or Chat.

</details>

<details>
<summary>How do I update?</summary>

```bash
claude plugin marketplace update clawd-hq
```

Then run `/reload-plugins` or restart Claude Code. You can turn on auto-update in `/plugin`.

</details>

## Status

Early and still changing. Please open an issue when you hit a rough edge.

## Development

From `plugins/clawd-hq`:

```bash
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc --noEmit -p .
```

Unofficial. Not made by, endorsed by, or affiliated with Anthropic. Clawd is Anthropic's mascot. MIT license, see [LICENSE](LICENSE).
