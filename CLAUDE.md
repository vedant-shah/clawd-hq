# Clawd HQ: project instructions

## Git checkpoints

- Commit locally at every logical checkpoint: each time a piece of work passes its tests and its code review. Do not wait to be asked. Tell the user what was committed.
- One commit per piece of work. Do not let several rounds of changes pile up uncommitted.
- Never push without the user asking. This repo is public, and a push reaches everyone who installed the plugin.
- Before each commit, run the checks below and look at what is staged. No secrets, no email addresses, no local paths.
- Commit message format: `<type>: <description>` (feat, fix, refactor, docs, test, chore).

## Checks

Run inside `plugins/clawd-hq`:

```bash
claude plugin validate .
claude plugin test .
npx -y -p typescript tsc --noEmit -p .
```

Then run `claude plugin validate .` at the repo root.

## What stays out of the public repo

These are ignored by git on purpose. Do not commit them:

- `docs/handoff.md` and `docs/research/`: private working notes and research.
- `docs/*.pptx`: an outdated internal deck.
- `docs/panel/*.png` and `docs/panel/build_mock.py`: an early mockup, replaced by `docs/panel/design/`.
