# Classifier and Quick Fix Mode

Used by `prompt-enhancement-agent` step 2 to decide whether to run full
scaffolding or fall back to a faster path.

## Intent Scoring

Score the message on three buckets. Use keyword presence plus structure.

### Feature / change request (run full scaffolding)
Signals (each adds ~0.2, cap 1.0):
- Verbs: add, implement, create, new, build, introduce
- Location words: section, sidebar, page, panel, calendar, button, card, modal
- Visual/behaviour words: opacity, color, hover, drag, highlight, layout, animation
- A page URL (coordinationmanager.com or localhost)
- More than one sentence or newline-separated unit
- An As-Is critique ("doesnt work", "we lost", "broken") paired with a To-Be ask

Trigger full scaffolding when score >= 0.6.

### Maintenance (conditional)
Signals: fix, bug, refactor, improve, optimize, tweak, adjust, rename.
- If scoped to one named file/component and one change: prefer Quick Fix Mode
- If it touches shared UI or behaviour: run scaffolding (it may have dependencies)

### Meta / question (skip scaffolding)
Signals: how do I, what is, explain, deploy, env, config, ci, workflow, enable,
settings, "is that it?", "was that it?".
- Answer directly or run the relevant ops skill. Do not scaffold.

## Edge Cases Observed In Real Prompts

- Mixed prompts: a GitHub-settings question plus a UI tweak in one message.
  Split by unit; scaffold only the feature unit, answer the meta unit inline.
- Out-of-order sentences: a constraint ("be careful not to discard custom info")
  may appear before the action it limits. The 3-iteration pass resolves this.
- Critique-only prompts ("we lost the background color after some changes"):
  treat the implied To-Be as "restore prior behaviour"; build As-Is from git/blame.
- Short imperative prompts ("Give the buttons the same color effect as the cards"):
  one named file and one change = no scaffold, just do it; if a shared
  component is involved, scaffold lightly.

## Quick Fix Mode

When scaffolding is skipped, say in one line that this looks like a focused
change and the full analysis is skipped. The user can reply "scaffold" anytime
to get the full intent + As-Is/To-Be breakdown.

Quick Fix Mode rules:
- Make the smallest correct change to the single named target
- Skip As-Is/To-Be, dependency scan, and test-gap analysis
- Still run existing tests/lint for the touched file before finishing
- If you discover the change is actually cross-cutting, stop and offer to scaffold
