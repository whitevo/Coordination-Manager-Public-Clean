---
name: ai-feedback-loop
description: Analyses structured AI feedback exported from the Coordination Manager Feedback page (/feedback?tab=ai or /ai-feedback) - valence and trust scores, rated AI answers, written feedback - and edits AI prompts, page context, docs, and UI copy to fix the causes. Use when the user pastes an AI FEEDBACK IMPROVEMENT REQUEST block (Copy Improvement Prompt), asks to triage AI feedback, or asks why an AI answer scored poorly and how to fix it. Not for general UI work (use design-system), new skill guidance (use updating-skills), or mailbox sync bugs (use mailbox-feature).
---

# ai-feedback-loop

Never modify the feedback database (ai_feedback table) and never fabricate feedback data,
scores, or which prompt/model produced an answer. A pasted improvement block is handled by
this skill, not prompt-enhancement-agent. Fixes to prompts, context, docs, and copy are
applied directly (no propose-first gate); report what changed.

## Input block (built by buildImprovementPrompt in Code/apps/web/src/pages/AiFeedbackPage.tsx)

Title `COORDINATION MANAGER -- AI FEEDBACK IMPROVEMENT REQUEST`, then labelled lines:
`FEEDBACK ID`, `SUBMITTED` (raw ISO timestamp), `STATUS` (open/reviewed/affirmed/resolved/dismissed),
`Valence (quality)`, `Trust (reliability)`, `Sentiment Label` (e.g. Good, middle dot U+00B7,
Trust), then sections `USER PROMPT:`, `AI ANSWER:`, `--- USER FEEDBACK ---`,
`--- ADMIN RESPONSE ---`, and a closing TASK line. Empty feedback or response is the literal
`(none)`. Use ADMIN RESPONSE as earlier triage context.

Entry sources: AiChatPage, AiGuideSidePanel (both only when the user's `sentimentToolEnabled`
setting is on), and mailbox reply feedback (user prompt starts `Mailbox AI: Suggest reply`).
The row stores no model, prompt version, or page: infer the feature from the prompt text and
do not assert which prompt ran.

## Scores

Valence (quality, y) and Trust (reliability, x) are -1..1 in 0.5 steps (-1, -0.5, 0, 0.5, 1).
Default 0 means that axis was not rated.

## Workflow

1. Parse every field above; for a batch, parse each block.
2. Classify, first match wins (sign per axis: negative < 0, zero = not rated, positive > 0):
   - Valence < 0 AND Trust < 0: CRITICAL
   - Valence < 0 AND Trust >= 0: HIGH
   - Valence >= 0 AND Trust < 0: MEDIUM
   - Valence > 0 AND Trust > 0: LOW (reinforce what worked)
   - Otherwise (includes 0/0 and one axis unrated): REVIEW
3. Diagnose by checking the answer against the prompt: accuracy, relevance, completeness,
   tone, hallucination (invented features).
4. Pick targets and edit them (all under Code/ unless noted):
   - Guide / general chat prompt: `apps/api/src/routes/ai-chat.ts` GUIDE_SYSTEM_PROMPT
   - Feature prompts in the same file (`<NAME>_SYSTEM_PROMPT`): OPERATIONAL (calendar),
     AVAILABILITY, TIME_MANAGEMENT, MAILBOX_AUTOMATION, ANNOUNCEMENT
   - Mailbox reply drafts: `apps/api/src/services/mailbox-draft.ts` (SYSTEM_PROMPT)
   - Mailbox assessment scoring: `apps/api/src/services/mailbox-assessment.ts` (not rated via
     this flow; touch only when the evidence points there)
   - Page context: `setPageContext` in CalendarPage, AnnouncementsPage, MailboxPage,
     TimeManagementPage (`apps/web/src/pages/`); shape in `contexts/AiAssistantContext.tsx`
   - Docs: `apps/docs/src/pages/*`, `apps/docs/src/components/AiSearchPanel.tsx` snippets,
     `apps/api/data/Coordination-Frameworks.md`; `docs/public/USER_GUIDE.md` (repo root) only
     for overview and AI limits
   - UI copy, labels, tooltips; API response messages in `apps/api/src/routes/*.ts`
5. Produce per entry: Priority, Root Cause, What Went Wrong, Changes made (file + what + why),
   Verification steps. Prefer minimal targeted fixes; batch entries sharing an issue. Batch input
   also gets a triage table (entry, priority, root cause).
6. Preserve existing correct behaviour in prompts. Follow the edit safety rules below.
7. For LOW entries, record what worked as a pattern; guidance for skills or CLAUDE.md goes
   through updating-skills.

## Prompt edit safety (check every edit)

- The `*_SYSTEM_PROMPT` constants are JS template literals. Inside them a backtick ends the
  string and `${` starts code: write paths and names in plain quotes, or escape as \` and \${.
- Edit inside the named constant only, with exact-match replacements (not regex scripts over
  the whole file). Afterwards re-read the constant and confirm each change sits inside it;
  if you moved text into a builder function, update every reference to the old constant.
- Run `pnpm --filter @coordination-manager/api typecheck` (from `Code/`) after editing. If you
  cannot run it, say so and list the edit as unverified -- never report a fix as applied
  without checking it landed.
- New text is ASCII only, even when the surrounding examples use arrows or em dashes: write
  `->` and `--`. Do not rewrite existing non-ASCII lines just for this.

## Related skills

- Skill or CLAUDE.md edits: updating-skills
- UI copy and components: design-system (what) and react-frontend (how)
- API routes and responses: express-api, plus `.claude/rules/security.md` (no leaking data)
- Mailbox AI drafts/assessment/automation parser: mailbox-feature
- Assistance AI panel behaviour: side-panel-design
