# Proposal: Open Source Security Improvement (Standards-First)

**Status:** Draft -- pending community review
**Author:** Tevo + Copilot implementation support
**Target app:** Coordination Manager
**Scope:** Planning only (Phase 2 proposal), no immediate rollout commitment

---

## 1. Why this proposal now

Current controls are already strong for the current usage stage:

- CI quality gate (typecheck, lint, tests, audit)
- CodeQL analysis (non-blocking by design)
- Dependency review on pull requests
- Gitleaks for secret scanning
- pnpm supply-chain hardening controls in workspace config

This proposal focuses on the next meaningful improvement for open-source trust:

- standard machine-readable security artifacts
- better interoperability across scanners and hosts
- lower triage friction as the project grows from about 5 monthly users toward 100 users

---

## 2. Proposed direction

Adopt a standards-first security artifact model before adding more heavy scanners.

Primary standards:

- CycloneDX for SBOM generation and exchange
- Optional secondary export to SPDX in release processes later
- SARIF for static/security finding exchange where supported

Required references:

- OWASP CycloneDX project: https://owasp.org/www-project-cyclonedx/
- CycloneDX specification overview: https://cyclonedx.org/specification/overview/

---

## 3. What we would use CycloneDX for

If adopted, CycloneDX would be generated in CI for the monorepo and attached as a build artifact (and later as a release artifact).

Primary use cases:

1. Dependency inventory baseline
2. Version-to-version drift tracking
3. Faster vulnerability impact checks when advisories are published
4. Better incident response and disclosure support for open-source consumers
5. Foundation for future automation (policy checks, provenance, and remediation planning)

---

## 4. Why standard formats are good security practice

Using standard formats is a control decision, not just a tooling preference.

Benefits:

1. Portability
   - Findings and inventories are not locked to one vendor workflow.

2. Repeatability
   - The same artifact can be analyzed in different tools and compared over time.

3. Auditability
   - Community reviewers can inspect security outputs consistently.

4. Operational continuity
   - If one scanner changes licensing or quality, artifact contracts stay stable.

5. Lower triage cost
   - Teams can normalize data instead of hand-mapping custom output formats.

---

## 5. Risk reduction compared with the current situation

Current state is healthy but mostly scanner-run centric. Standard artifacts reduce these specific risks:

1. Reduced blind spot risk
   - Today: a tool run may pass/fail, but long-lived inventory evidence can be fragmented.
   - With CycloneDX: every build can produce a stable component inventory.

2. Reduced supply-chain uncertainty
   - Today: dependency posture is visible through audits and review actions.
   - With CycloneDX: exact component and version graph is captured for downstream verification.

3. Reduced incident response time
   - Today: answering "where are we affected" can require repeated local scans.
   - With CycloneDX artifacts: historical build snapshots support faster impact analysis.

4. Reduced migration risk
   - Today: workflow behavior is coupled to current scanner set.
   - With standard formats: scanner replacement has lower process disruption.

5. Reduced governance friction for OSS users
   - Today: external users trust process descriptions.
   - With published artifacts: external users can verify with their own tooling.

---

## 6. Optional runtime testing: ZAP and Nuclei

Question raised: are ZAP and Nuclei overkill right now?

Short answer: for current scale, always-on deep runtime scanning is likely overkill; targeted and scheduled usage can still add value.

### What each tool adds

1. OWASP ZAP
   - Broad DAST baseline against running app/API behavior
   - Helps detect runtime issues not visible in static analysis

2. Nuclei
   - Fast template-driven exposure checks
   - Useful for recurring known-risk checks and regression sweeps

### Suggested posture for current stage

- Keep both as optional in this proposal
- If enabled, run only on schedule or before major releases (not every PR)
- Start with low-noise templates and baseline scans only

### Estimated maintenance and cost impact (optional)

1. Infrastructure cost
   - Usually near zero direct license cost (open source tools)
   - CI minutes and compute usage increase

2. Team cost
   - Initial tuning and false-positive triage effort
   - Ongoing template/rule maintenance and endpoint targeting updates

3. Delivery cost
   - Longer security job times
   - Potential release friction if gates are too strict too early

Recommendation at this time:

- Keep ZAP/Nuclei optional and non-blocking unless incidents or drift trends justify stronger enforcement.

---

## 7. Proposed phased adoption (proposal-only)

1. Phase A (low friction)
   - Add CycloneDX SBOM generation in CI
   - Store SBOM artifact per run
   - Keep non-blocking while baseline is established

2. Phase B (governance uplift)
   - Add release-time SBOM publication
   - Add periodic drift summary using SBOM deltas

3. Phase C (optional runtime layer)
   - Pilot ZAP baseline and limited Nuclei templates on schedule
   - Review noise, findings quality, and maintenance burden after 4-8 weeks

---

## 8. Decision request

- [ ] Approve this standards-first security proposal
- [ ] Approve only CycloneDX artifact generation for now
- [ ] Keep ZAP/Nuclei optional for future revisit
- [ ] Request revisions before community review
