# Proposal: Documentation, Onboarding, and Enterprise Packaging Refresh

**Status:** Draft -- pending product review
**Author:** Copilot implementation support
**Target app:** Coordination Manager docs site, web marketing surface, and self-hosting / enterprise packaging
**Scope:** Product and documentation proposal only

---

## 1. Why this proposal now

Coordination Manager already has meaningful technical depth: coordination
calendars, meeting scheduling, guest flows, an [Agent API](https://coordinationmanager.com/docs/getting-started),
Discord support, and self-hosting potential. The product story does not present
that depth as clearly or as persuasively as it could.

The opportunity is to improve three areas together:

- **Documentation structure** for clearer guided journeys.
- **Onboarding** for faster first success.
- **Enterprise packaging** for a clearer self-hosting and premium story.

## 2. Reference patterns worth learning from

[LangWatch](https://github.com/langwatch/langwatch) is a strong example of how a
technically serious product can feel easy to approach.

The useful lessons are structural:

- Clear separation between quick start, product capabilities, self-hosting, and
  licensing.
- Documentation that doubles as onboarding and conversion.
- Strong calls to action for connecting the product to a team's own agents and
  workflows.
- Licensing language that explains the free baseline and enterprise upgrade
  cleanly.
- Visual storytelling through screenshots, diagrams, and motion.

The goal is to learn from these patterns, not to copy them.

Relevant current Coordination Manager surfaces that should connect more clearly
include the [overview](https://coordinationmanager.com/docs/overview),
[getting started guide](https://coordinationmanager.com/docs/getting-started),
[authentication guide](https://coordinationmanager.com/docs/authentication),
and [roadmap](https://coordinationmanager.com/docs/roadmap).

## 3. Proposed direction

Refresh the Document page and adjacent surfaces around four pillars:

1. Guided docs structure.
2. Role-based onboarding.
3. Visual product storytelling.
4. Clear enterprise packaging.

## 4. Requirements for the Document page

### 4.1 Structure

- Add a hero with a one-line product definition and clear next steps.
- Add role-based entry paths for organizers, developers, self-hosters, and
  enterprise evaluators.
- Reorder content into: overview, capabilities, quick start, agent setup,
  self-hosting, licensing, trust.
- Add a persistent section index for long-form onboarding.

### 4.2 Onboarding

- Add a **first 5 minutes** path.
- Add a **bring your own agent** banner or CTA.
- Add outcome-based guides for creating a calendar, scheduling a meeting,
  connecting an agent, and using Discord workflows.
- Add clearer transitions from docs to product usage.

Those entry paths should deep-link into pages like
[Getting Started](https://coordinationmanager.com/docs/getting-started),
[Authentication](https://coordinationmanager.com/docs/authentication), and the
[Calendars API reference](https://coordinationmanager.com/docs/api/calendars).

### 4.3 Media and marketing

- Add more screenshots across docs and homepage.
- Add short videos for key setup and workflow paths.
- Add annotated visuals for calendar setup, availability collection, agent API
  usage, and meeting proposal workflows.
- Introduce more animated feature presentation on the homepage and docs landing
  experience.

The first media pass should support the existing
[overview](https://coordinationmanager.com/docs/overview),
[architecture](https://coordinationmanager.com/docs/architecture),
[getting started](https://coordinationmanager.com/docs/getting-started), and
[meetings API](https://coordinationmanager.com/docs/api/meetings) pages.

## 5. Requirements for licensing and self-hosting

- Keep the core product usable without an enterprise license.
- Keep self-hosting first-class.
- Make paid licensing clearly about enterprise capability and support.
- Add a dedicated licensing page that explains:
  - What is free
  - What self-hosting includes
  - What enterprise unlocks
  - How activation works
  - What happens on expiry or downgrade

The structure should learn from LangWatch's
[licensing page](https://langwatch.ai/docs/self-hosting/licensing) while staying
specific to Coordination Manager.

Suggested enterprise capabilities:

- SSO
- Advanced RBAC
- SCIM or managed provisioning
- Audit logs
- Extended retention controls
- Premium support and SLA-style response commitments

## 6. Suggested landing-page sequence

1. Hero and CTAs.
2. Visual feature strip.
3. Role-based entry cards.
4. Quick start.
5. Feature tour.
6. Bring-your-own-agent banner.
7. Self-hosting and licensing summary.
8. Security and trust summary.
9. Deep documentation links.

## 7. Acceptance checks

- New users understand the product faster.
- Developers find the Agent API path faster.
- Self-hosters can understand deployment and licensing without extra help.
- The docs and homepage communicate more value through images and video.
- The product appears more mature and enterprise-ready.

## 8. Open questions

1. What pricing shape fits best: seat-based, organization-based, or support-plan based?
2. Which enterprise features are acceptable to commercialize?
3. Which onboarding path should be prioritized first?
4. Should the first media pass use screenshots only, or include videos immediately?

## 9. Decision requested

- Approve the docs / onboarding / licensing refresh direction.
- Approve a dedicated self-hosting and licensing page.
- Approve a stronger media-first onboarding pass.
- Request revisions before implementation.

---

### References

- LangWatch repository: <https://github.com/langwatch/langwatch>
- LangWatch licensing example: <https://langwatch.ai/docs/self-hosting/licensing>