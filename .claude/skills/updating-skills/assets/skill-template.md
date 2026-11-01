---
name: skill-name
description: Does X and Y for Z (third person, specific nouns, file types, tools). Use when the user asks to ..., mentions ..., or is working with ....
---

# skill-name

One line: what Claude does differently with this skill loaded.

## Workflow

Copy this checklist and track progress:

```
- [ ] 1. ...
- [ ] 2. ...
- [ ] 3. Validate (run the check, fix, repeat until it passes)
```

**1. ...** Concrete action with real paths and commands.

**2. ...**

**3. Validate.** Run `scripts/check.ps1 <args>`. If it fails, fix the reported
issue and re-run. Continue only when it passes.

## Reference

- **Topic A** (read when ...): `references/topic-a.md`

<!--
Delete this comment and anything you do not need. Rules (spec/skill-spec.md):
- Write the eval suite first: tests/evals/{scope}/{skill}.json (creating-skill-evals).
- Include only what Claude lacks. No Purpose / When to Use / Self-Validation sections.
- Under 500 lines; push detail to references/ (one level deep, TOC if > 100 lines).
- Forward slashes, ASCII only, no secrets, no machine paths.
- Pick freedom level per step: prose (many valid ways) / template (preferred pattern) / exact script (fragile).
-->
