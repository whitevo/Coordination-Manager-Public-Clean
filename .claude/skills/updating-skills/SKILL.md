---
name: updating-skills
description: Routes new instructions, guidelines, research, or examples into the right Coordination Manager skill -- an edit to an existing SKILL.md, a new reference file, a description change, or a new skill -- while keeping skills within the skill spec. Use when the user says to remember something in a skill, add a rule or pattern to a skill, incorporate docs or notes into the skillset, or asks which skill some new guidance belongs in.
---

# updating-skills

For quick, single-skill content updates in `.claude/skills/`. Measured,
multi-round training of these skills is done separately by the maintainer, not here.

**1. Split the input** into units: a rule ("always/never/when X do Y"), a
procedure, reference material (tables, API details, examples), or a trigger
(new phrasing users say). Mixed input is routed unit by unit.

**2. Find the home.** If the user named a skill, use it. Otherwise list the
candidates and pick by description:
```bash
pwsh -File .claude/skills/updating-skills/scripts/build-skill-listing.ps1 -SkillsDir .claude/skills
```
If two skills fit equally, ask. If none fits and the unit is a self-contained
procedure with its own triggers, propose a new skill.

**3. Route each unit.**

| Unit | Goes to |
|------|---------|
| Trigger phrasing, new use case | `description` (third person, what + when) |
| Rule Claude must follow every time | SKILL.md, inside the workflow step it governs |
| Procedure for a common case | SKILL.md workflow |
| Procedure for a rare branch | `references/{topic}.md`, linked with "when to read" |
| Lookup material, long examples, API detail | `references/{topic}.md` |
| Deterministic, fragile operation | `scripts/` + one line saying to run it |
| Self-contained new workflow | new skill from [assets/skill-template.md](assets/skill-template.md) |
| Repo-wide convention for every task | CLAUDE.md or `.claude/rules/`, not a skill |

Before adding, cut: does Claude already know this? Is it already in the skill,
CLAUDE.md, or `.claude/rules/` in other words? Prefer replacing a vaguer line
over adding a new one. If SKILL.md would pass 500 lines, move the least-used
section to a reference file. Keep text ASCII-safe (no smart quotes or em dashes).

**4. Apply safely.**
- Skill **has an eval suite** (the maintainer's training workflow measures
  changes before they go live): do not edit the live skill. Write the proposed
  change (exact before/after) and say it should go through that training
  workflow.
- Skill **has no eval suite**: show the exact before/after for every file and
  ask before editing the live skill.

Either way, quote the exact lines you add or change. When you add a reference
file, also quote the SKILL.md line that links to it and says when to read it.
When you add, rename, or remove a skill, also update the skills table in
CLAUDE.md.

**5. Lint** the edited skill (loop until 0 errors; on a proposal you are
waiting to apply, say lint will run after the edit):
```bash
pwsh -File .claude/skills/updating-skills/scripts/lint-skill.ps1 -Path .claude/skills/<skill>
```

Report: each unit, where it went, the exact lines, lint result, and whether
the skill needs an eval to cover the change.
