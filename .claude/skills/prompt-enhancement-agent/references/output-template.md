# Verbose Output Template

## Contents
- Template (sections: Intent Recognition, Your Goal, You Are Looking At,
  Cross-Feature Impact, Decisions I Need, Implementation Plan, Next Steps)
- Formatting Rules

Render this structure when `prompt-enhancement-agent` runs full scaffolding.
Omit the Decisions and Next Steps blocks when the verdict is sufficient and the
user did not ask for a plan.
Goal: keep it verbose but skimmable. Use formatting to separate three things:
1. USER WORDS - quote the user's own sentences (blockquotes)
2. AGENT INFERENCE - what we concluded (plain text under labelled headings)
3. REQUIRED DECISIONS - what only the user can decide (checkboxes / questions)

Collapsible sections: use `<details><summary>...</summary>` for As-Is, To-Be,
and Testing so the reply stays skimmable.

---

## Template

```
## Intent Recognition

I read your message as N units. Here is how I mapped each one:

> "<quoted user sentence 1>"
- Inferred: <intent type> -> <resolved meaning>

> "<quoted user sentence 2>"
- Inferred: <intent type> -> <resolved meaning>

(repeat per sentence/newline unit)

## Your Goal (inferred)

<one or two sentences capturing the high-level outcome, grounded in any
experience/expectation the user shared>

## You Are Looking At

- Primary page: <page> ( http://localhost:5173/<route> )
- Primary component(s): <file paths>
- Section referenced: <e.g. left sidebar Categories list>

<details><summary>As-Is (current behaviour) - click to expand</summary>

- Location: <file:line>
- Current behaviour: <what happens now>
- Schema / state: <relevant fields>
- Styling: <relevant Tailwind/HSL notes>
- Known issue (from your message): <quote the critique>

</details>

<details><summary>To-Be (proposed change) - click to expand</summary>

- <change 1>
- <change 2>
- Files to touch: <list>
- Migration needed: <yes/no + what>

</details>

## Cross-Feature Impact

<Component> is reused in these places. Should the change apply to all?

- [ ] Yes, apply everywhere (consistency)
- [ ] Only the page I mentioned
- [ ] Decide later

Review the affected pages:
- http://localhost:5173/<route-a>  (your target)
- http://localhost:5173/<route-b>
- http://localhost:5173/<route-c>

## Decisions I Need (1-3 max)

1. <decision-changing question with the most likely answer first>
2. <question>
3. <question>

<details><summary>Testing Strategy - click to expand</summary>

Existing:
- <test file> - <what it covers> (<coverage est>)

Missing:
- Unit: <helper/function>
- Integration: <interaction>
- E2E (Playwright): <user workflow>
- A11y: <contrast / focus concern>

Suggested run: pnpm test:web, pnpm test:api, or pnpm test:e2e (web)

</details>

## Implementation Plan

1. <step> (<est>)
2. <step> (<est>)
3. <step> (<est>)
Estimated total: <sum> (excluding your decisions above)

## Next Steps - pick one

- Agree & Auto-Start: I implement with the defaults shown above
- Customize: answer the decisions and I refine the plan
- Quick Fix Mode: minimal version, this page only, tests later
- Different Approach: tell me how you'd prefer it
```

---

## Formatting Rules

- Quote every user sentence you reflect; never paraphrase silently
- Label inference clearly ("Inferred:", "I concluded") so it is not mistaken for
  user intent
- Put only true either/or decisions in the Decisions block
- Keep As-Is/To-Be/Testing collapsed by default to reduce wall-of-text
- Always give localhost URLs the user can click for cross-page review
- End with the four Next Steps choices, defaults first
