---
name: prompt-enhancement-agent
description: Turns an ambiguous or multi-part Coordination Manager request into an implementation-ready plan -- checks whether scope, target, constraints, and acceptance criteria are clear, asks up to 3 decision-changing questions, and for feature requests maps the prompt onto real files with As-Is/To-Be, cross-page dependencies, test gaps, and next-step choices. Use when the request is ambiguous or has several parts whose scope is unclear, or when the user asks for a plan, scaffold, or breakdown before work starts. Not for clear single tasks (start the work directly), single-file fixes, factual questions, slash commands, deploys, env/config edits, or pasted AI feedback improvement blocks (use ai-feedback-loop).
---

# prompt-enhancement-agent

Clear, well-specified tasks go straight to work: no questions, no plan, no
menu. Skip this skill for factual questions, slash commands, deploys, env/config
edits, and a single named file with one change. Run it only when the request is
ambiguous or multi-part, or the user asks for a plan or scaffold.

## 1. Clarity check

Split the message into units (goal, context, location, As-Is critique, To-Be
spec, constraint, question). Check:
- Is the target area identified?
- Is the expected behaviour clear?
- Are constraints and non-goals stated?
- Are acceptance checks stated?

Verdict: **sufficient** or **needs clarification**. Never invent missing facts.
- **Sufficient and no plan requested:** stop here and do the work. Do not ask
  questions or show a menu.
- **Needs clarification:** ask at most 3 decision-changing questions, most
  likely answer first.

## 2. Pick the path

Score the message with [references/classifier.md](references/classifier.md).
- **Feature score >= 0.6, or the user asked for a plan/scaffold:** full
  scaffolding (step 3).
- **Otherwise:** quick path. Return a short formalized request (objective,
  scope in/out, assumptions, acceptance checks) plus any questions from step 1,
  then stop.

## 3. Full scaffolding

Do at least 3 passes. Sentences are often out of order, and each pass adds
context from the others.

1. **Surface parse.** Tag each unit and extract the entities it names (pages,
   sections, components, data types).
2. **Link to code.** Resolve a URL to its page component (routes are in
   `Code/apps/web/src/App.tsx`). Map each named feature to real files with
   grep/glob. Note existing patterns that already do something similar.
3. **Dependencies.** Find every page or component that reuses an affected
   component. Surface hidden assumptions and edge cases. Propose 1-2
   alternatives. Flag backward-compatibility risks.
4. **As-Is / To-Be.** Build both from verified file contents: current
   location, behaviour, schema, and styling, against the proposed changes and
   the file list.
5. **Tests.** Grep existing tests that cover the touched components. List
   what exists and what is missing (unit, integration, e2e, a11y).
6. **Render** with [references/output-template.md](references/output-template.md).
   Keep three things visibly separate: the user's own sentences (quoted), your
   inference, and the decisions only the user can make. When a component is
   shared, list the affected pages with localhost URLs.

## 4. Next steps

Show the Decisions and Next Steps menu only when the verdict is **needs
clarification** or the user asked for a plan. Offer explicit choices: Agree and
start, Customize, Quick fix with the listed assumptions, or Different approach.
When the user agrees, hand off to the owning skill:

| Change type | Skill |
|-------------|-------|
| React components, pages, hooks, routes, data fetching | react-frontend |
| Which component, variant, color token, motion, overlay layer | design-system (with react-frontend for UI work) |
| Mobile or touch behaviour | mobile-ux |
| API endpoints, middleware | express-api |
| Schema, migrations, RLS | supabase-database |
| Calendar, availability, meetings | coordination-calendar |
| Mailbox sync, rules, AI drafts, MailboxPage | mailbox-feature |
| Side panels, Assistance dropdown | side-panel-design |
| Auth flows | authentication-system |
| Discord bot, guardian | discord-integration |
| New or changed tests | testing-strategy |

Ops and config requests (deploy, env vars, CI, security, dependencies) use
their own skill directly and are not scaffolded.
