# Roadmap

Ideas and follow-ups for Clawd HQ that are not built yet. Nothing here is promised, and the order can change. Finished items move to the [CHANGELOG](CHANGELOG.md).

## Next up

- **Budgets for specialists.** Give each job a token budget (set by Clawd from how big the job is) and let you set a ceiling for the session or the day in Settings. Show a live meter on each specialist's card. At 80% the specialist is told to wrap up and report; at 100% Clawd asks you whether to give it more or stop it. Count in tokens, with a rough dollar figure for people paying per use. Hard stops come later, if ever.
  - First, research: can the plugin read a specialist's token use while it runs, send a running specialist a message or stop it, and is Claude Code adding its own spending limits?
- **Several plan changes in one call.** Let the `plan` tool take a list of operations (add, move, split, drop) so Clawd reshapes a plan in one step instead of several.

## Ideas

- **A council verdict card.** In the desktop app, show a council's four positions side by side, where they split, the strongest dissent and Clawd's recommendation as one inline card. Fall back to text elsewhere.
- **A goal-finished card.** When a goal closes, one small inline card: steps done, specialists used, retries and failures, tokens spent, what was skipped. Pairs well with budgets.
- **A budget alert card**, with **Give it more** and **Stop it** buttons, if budgets ship.
- **Translated panels.** Clawd already replies in your language; the panels are still English only ([#10](https://github.com/vedant-shah/clawd-hq/issues/10)).
- **Sharper README diagrams.** Archify can also export SVG; swap the PNG diagrams for SVGs that stay crisp at any size.

## Small fixes

- **Decided lines wrap** instead of being cut off mid-sentence on the Office tab.
- **A failed or stopped hand-back** also tries to close a goal that was waiting on it. Today the goal closes only at Clawd's next plan call.
- **Windows path tests** fail and block CI ([#8](https://github.com/vedant-shah/clawd-hq/issues/8)).
- **The bold-to-weight change** in the panels, which needs a newer minimum Claude Code version ([#7](https://github.com/vedant-shah/clawd-hq/issues/7)).

## To check later

- **Code Mode.** On Claude Code 2.1.330, Clawd HQ logs each call inside a Code Mode script, for the main chat and for specialists. Still unconfirmed: that the panel's live progress and the long-turn checks move as they should, and why a specialist launched from a script showed as "unknown". Retest with a single copy of the plugin loaded once Code Mode leaves experimental, or if someone reports a problem.
- **Two real sessions in one folder**, side by side, to confirm each keeps its own goal outside the tests.
