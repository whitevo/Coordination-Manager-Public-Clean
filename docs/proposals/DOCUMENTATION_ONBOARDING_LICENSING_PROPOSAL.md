# Proposal: Documentation, Onboarding, and Enterprise Packaging Refresh

**Status:** Draft -- pending product review
**Author:** Copilot implementation support
**Target app:** Coordination Manager docs site, web marketing surface, and self-hosting / enterprise packaging
**Scope:** Product and documentation proposal only

---

## 1. Why this proposal now

Coordination Manager already has meaningful technical depth: shared availability
calendars, meeting coordination, agent API access, Discord workflows, guest
flows, and self-hosting potential. The current product story does not present
 that depth as clearly or as persuasively as it could.

Today, the platform has solid raw material but a weaker first-run experience in
three areas:

- **Documentation structure** is useful, but not yet shaped into a strong guided
  journey for new evaluators, operators, sponsors, and self-hosters.
- **Onboarding** explains key pieces, but it does not yet sell the value of the
  product quickly through visual walkthroughs, short setup paths, and clear
  role-based entry points.
- **Enterprise packaging** is implied by the platform's capabilities, but the
  licensing story is not yet presented in a way that makes commercial adoption,
  self-hosting, and premium support easy to understand.

This proposal recommends a structured refresh of the Document page and the
broader docs / marketing surface so Coordination Manager feels easier to adopt,
easier to trust, and easier to buy.

## 2. Reference product patterns worth learning from

LangWatch is a strong reference point for how to present a technically serious
product without making it feel heavy.

Useful patterns to learn from:

- A clear split between **what the product does**, **how to start quickly**, and
  **how to self-host or upgrade**.
- Documentation that works as both a technical reference and a conversion path.
- Product messaging that makes advanced capability feel approachable.
- A self-hosting licensing page that explains the **free baseline** and the
  **enterprise upgrade** without confusion.
- Homepage and docs surfaces that use screenshots, diagrams, and motion to make
  complex features easier to understand at a glance.
- Smart calls to action that invite teams to connect the product to their own
  workflows and agents.

The goal is **not** to clone LangWatch. The goal is to recognize a high-quality
product example and adapt the strongest structural ideas to Coordination
Manager's own identity and capabilities.

## 3. Proposed direction

Refresh the Document page and related onboarding surfaces around four pillars:

1. **Guided docs structure** that moves users from overview to first success.
2. **Role-based onboarding** for organizers, community operators, developers,
   and self-hosters.
3. **Visual product storytelling** with screenshots, diagrams, short videos, and
   motion-driven feature tours.
4. **Clear enterprise packaging** that explains what is free, what is
   self-hostable, and what premium licensing would add.

## 4. Requirements for the Document page refresh

The Document page should become a product-facing hub, not only a documentation
index.

### 4.1 Information architecture requirements

- Add a top-level **hero section** that states what Coordination Manager is in
  one sentence, who it is for, and the fastest next step.
- Add distinct entry paths for:
  - Community organizer
  - Developer / agent builder
  - Self-hosting team
  - Sponsor / enterprise evaluator
- Reorganize the page into a clear sequence:
  - Overview
  - Product capabilities
  - Quick start
  - Integration / agent setup
  - Self-hosting
  - Pricing / licensing
  - Trust / security / governance
- Add a persistent secondary navigation or section index so users can jump
  through longer onboarding content quickly.
- Surface proposal and roadmap material as supporting decision content, not as
  the primary first-run path.

### 4.2 Onboarding requirements

- Add a **first 5 minutes** path for new users.
- Add a **bring your own agent** setup banner or callout that highlights the
  existing Agent API and custom workflow potential.
- Provide copy and UI for three onboarding motions:
  - Create a calendar
  - Connect an agent or integration
  - Self-host your own instance
- Add role-based checklists so different users are not forced through the same
  setup journey.
- Add short outcome-driven guides such as:
  - Schedule your first multi-party meeting
  - Publish availability for a group
  - Create an agent-assisted scheduling workflow
  - Connect Discord distribution
- Add clearer CTAs between docs and product surfaces so reading naturally leads
  to trying the platform.

### 4.3 Content and media requirements

- Introduce more **screenshots** of major features across the homepage and docs.
- Introduce short **screen-recorded videos** for onboarding flows.
  Coordination Manager already has meaningful technical depth: shared availability
  calendars, meeting coordination, [Agent API access](https://coordinationmanager.com/docs/getting-started),
  Discord workflows, guest flows, and self-hosting potential. The current product
  story does not present that depth as clearly or as persuasively as it could.
- Add lightweight annotated feature visuals for:
  - Calendar creation
  - Availability collection
  - Meeting proposal workflow
  - Agent API usage
  [LangWatch](https://github.com/langwatch/langwatch) is a strong reference point
  for how to present a technically serious product without making it feel heavy.
  - Discord / communication workflows
  distinct from generic booking and calendar tools.
  - A [self-hosting licensing page](https://langwatch.ai/docs/self-hosting/licensing)
    that explains the **free baseline** and the **enterprise upgrade** without
    confusion.
### 4.4 Marketing appeal requirements

- Shift the docs landing tone from mostly reference-oriented to **product plus
  proof**.
- Show what the platform looks like before asking people to read implementation
  detail.
- Add animated or staged feature reveals on the homepage and docs landing pages.
  [docs overview](https://coordinationmanager.com/docs/overview),
  [getting started guide](https://coordinationmanager.com/docs/getting-started),
  [authentication guide](https://coordinationmanager.com/docs/authentication), and
  [roadmap page](https://coordinationmanager.com/docs/roadmap).
- Highlight the strongest product differentiators earlier:
    existing [Agent API](https://coordinationmanager.com/docs/getting-started)
    and custom workflow potential.
  - Human-in-the-loop workflows
    - Schedule your first multi-party meeting
    - Publish availability for a group
    - Create an agent-assisted scheduling workflow
    - Connect Discord distribution
## 5. Requirements for enterprise licensing and self-hosting presentation

Coordination Manager should present a simple and credible licensing model that
  [Getting Started](https://coordinationmanager.com/docs/getting-started) page,
  the [Authentication](https://coordinationmanager.com/docs/authentication) page,
  and the [API reference](https://coordinationmanager.com/docs/api/calendars).
supports adoption without weakening the open product story.
### 5.1 Baseline product requirements

- Keep the core product usable without an enterprise license.
- Keep self-hosting available as a first-class option.
- Make it clear that a paid license is for **enterprise capabilities and support**,
- Explain what remains unlimited or self-managed on a self-hosted deployment.

Define a premium package around capabilities that enterprises already expect,
such as:

  [overview](https://coordinationmanager.com/docs/overview),
  [architecture](https://coordinationmanager.com/docs/architecture),
  [getting started](https://coordinationmanager.com/docs/getting-started), and
  [meetings API documentation](https://coordinationmanager.com/docs/api/meetings).
- SSO / identity federation
- SCIM or managed user provisioning

  Where possible, those proof points should deep-link into supporting material
  such as the [security policy](https://coordinationmanager.com/docs/legal/security-policy),
  [privacy policy](https://coordinationmanager.com/docs/legal/privacy-policy), and
  [open source security proposal](https://coordinationmanager.com/docs/proposals/open-source-security).
- Audit logs and export
- Premium support and response commitments
- Governance and compliance-oriented reporting
- Optional enterprise-only workflow controls or analytics

These features are the most natural candidates for commercial packaging because
they serve organizational governance rather than the baseline scheduling value.

  This page should also link outward to the closest reference examples for buyers
  who want to understand the model quickly, such as LangWatch's
  [Editions and licensing](https://langwatch.ai/docs/self-hosting/licensing)
  page, while keeping Coordination Manager's own scope and product language clear.
### 5.3 Licensing page requirements

- Create a dedicated docs page that explains:
  - What users get for free
  - What self-hosting includes
  - What an enterprise license unlocks
  - How activation works
  - What happens on expiry or downgrade
- Use plain language and avoid making self-hosting look restricted or punitive.
- Include FAQ items for common buyer concerns:
  - Can we use this commercially without a license?
  - What does the enterprise tier actually add?
  - Does self-hosting report usage back to Coordination Manager?
  - How is support handled?
- Link licensing directly from self-hosting and setup guides.

## 6. Suggested structure for the refreshed docs landing experience

Recommended page order:

1. Hero with one-line value proposition and two primary CTAs.
2. Visual product strip with screenshots or looping product clips.
3. Role-based entry cards.
4. Quick start section.
5. Feature tour with visual panels.
6. Bring-your-own-agent banner.
7. Self-hosting and licensing summary.
8. Security / trust / governance summary.
9. Deep documentation links.

This sequence should let a user understand the product before being asked to
consume the reference material.

## 7. Implementation requirements by phase

### Phase 1 -- Content strategy

- Define the core messaging hierarchy.
- Audit the current docs pages for overlap, missing entry points, and weak CTAs.
- Decide the enterprise packaging boundaries before writing the licensing page.

### Phase 2 -- Docs IA and copy

- Rewrite the Document page structure around onboarding and conversion.
- Add dedicated self-hosting and licensing sections.
- Add role-based quick-start content.

### Phase 3 -- Visual asset production

- Capture product screenshots.
- Produce short onboarding clips.
- Create diagrams for agent setup and scheduling workflows.

### Phase 4 -- UI implementation

- Upgrade the docs landing page and homepage with stronger visual presentation.
- Add media sections that load efficiently on desktop and mobile.
- Add reusable CTA components for setup, self-hosting, and agent onboarding.

### Phase 5 -- Validation

- Test whether a new user can understand the product within 60 seconds.
- Test whether a developer can find the Agent API setup path quickly.
- Test whether a sponsor or enterprise evaluator can understand the licensing
  model without a live explanation.

## 8. Acceptance checks

This proposal should be considered successful if the refresh results in:

- A clearer explanation of what Coordination Manager is and why it is different.
- Faster onboarding for first-time users and developers.
- A stronger self-hosting and enterprise story.
- Better visual communication through screenshots and video.
- Improved marketing appeal without weakening documentation quality.
- A docs experience that can support community growth and sponsor conversations.

## 9. Open questions

1. Should enterprise licensing be seat-based, organization-based, or support-plan
   based?
2. Which enterprise features are acceptable to commercialize without weakening
   the open-source value proposition?
3. Should the docs landing page and homepage share the same visual assets, or
   should each have distinct media tailored to its audience?
4. Which onboarding flow should be prioritized first: organizer, agent builder,
   or self-hoster?
5. Do we want video assets produced in-house first, or should the initial pass
   rely on screenshots and diagrams?

## 10. Decision requested

- Approve the docs / onboarding / licensing refresh as a product-direction
  proposal.
- Approve the creation of a dedicated self-hosting and enterprise licensing page.
- Approve a media-first onboarding pass with screenshots and short videos.
- Request revisions before implementation.

---

### References

- LangWatch repository: <https://github.com/langwatch/langwatch>
- LangWatch licensing example: <https://langwatch.ai/docs/self-hosting/licensing>