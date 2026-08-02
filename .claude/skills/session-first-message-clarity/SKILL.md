---
name: session-first-message-clarity
description: Validate the first user message in a session for sufficiency, ask focused clarifying questions when needed, and return a formalized implementation-ready request before coding.
---

# session-first-message-clarity

## Purpose

Ensure each session starts with clear intent and sufficient implementation detail.
Before writing code, convert the first user message into a formalized request
with explicit scope, constraints, and acceptance criteria.

## When to Use

- First substantive user message in a new session
- Multi-part feature requests with ambiguous scope
- Requests missing success criteria, target location, or constraints

Skip this flow when:
- The user asks a pure factual question
- The user asks for a trivial one-line operation (time/date/version)
- The user explicitly requests immediate quick-fix execution

## Workflow

1. Parse the first message into units (goal, context, constraints, ask).
2. Check sufficiency:
   - Is the target area identified?
   - Is expected behavior clear?
   - Are constraints and non-goals present?
   - Is validation or acceptance criteria stated?
3. If details are missing, ask up to 3 focused clarification questions.
4. Produce a formalized request block:
   - Objective
   - As-Is
   - To-Be
   - Scope (in/out)
   - Risks/assumptions
   - Acceptance checks
5. Offer explicit next actions:
   - Approve and start implementation
   - Refine requirements
   - Quick start with listed assumptions

## Outputs

- Clarity check verdict: sufficient or needs-clarification
- Formalized implementation request in markdown
- 1-3 decision-changing questions if required
- Next-action options for user confirmation

## Constraints

- Keep questions decision-changing and specific
- Do not ask more than 3 clarification questions
- Do not invent missing facts
- Use ASCII-safe text only
- Keep the response skimmable and action-oriented

## Self-Validation

### Trigger Indicators
- [ ] This is the first substantive user message of the session
- [ ] The request implies implementation work

### Completion Markers
- [ ] Sufficiency check completed
- [ ] Formalized request returned
- [ ] Clarifying questions limited to 3 max
- [ ] Next action choices provided

### Quality Signals
- [ ] Scope boundaries are explicit
- [ ] Acceptance checks are testable
- [ ] Assumptions are clearly labeled