---
name: supply-chain-security
description: Governs dependency and CI supply-chain security for the pnpm monorepo - pnpm audit, allowBuilds and blockExoticSubdeps, SHA-pinned GitHub Actions, SBOM generation, OpenSSF Scorecard, and compromised-package response. Use when adding or updating dependencies, editing GitHub Actions workflows, handling Dependabot or vulnerability alerts, preparing release SBOMs, or reviewing pnpm security config. Not for workflow structure or CodeQL YAML (use github-workflow), or gitleaks and secret rotation (use security-hardening).
---

# supply-chain-security

Pick the task: audit, configure, add dependency, CI hardening, SBOM, or advisory response.

## Workflow

1. **Audit**: the blocking CI gate is the OSV check in `scripts/security-check.ps1` (`ci.yml`, high/critical; also `pnpm security:check` / `security:premerge` locally and inside `pnpm verify:release`). `pnpm audit` is a local aid and runs weekly non-blocking in `security-drift-weekly.yml`. Dependency-review is advisory only.
2. **Configure**: all pnpm settings live in `Code/pnpm-workspace.yaml` (pnpm 11+ ignores the
   `"pnpm"` field of `package.json`). Verify `allowBuilds` (deny-by-default install-script allowlist;
   replaced `onlyBuiltDependencies`) and `blockExoticSubdeps: true`.
   `minimumReleaseAgeExclude` entries are temporary security exceptions; remove each after its
   review date (comment beside it). `minimumReleaseAge: 4320` in `pnpm-workspace.yaml` makes pnpm ignore versions younger than 3 days
   (worm defense); an exact pin or override to a fresher version fails, so pick an older patched one.
   Never use `dangerouslyAllowAllBuilds`. Keep pnpm up to date for integrity-hashing fixes.
3. **Add dependency**: check package health (maintenance, downloads, transitive deps), verify no
   suspicious postinstall scripts, run `pnpm why <package>` to understand the dep tree. Document every
   `overrides` entry (`Code/pnpm-workspace.yaml`, ~30 entries) with reason and review date in `docs/private/DEPENDENCY_OVERRIDE_RATIONALE.md`; remove overrides the upgraded tree no longer needs. Update commands only: monorepo-conventions.
4. **CI hardening** (`.github/workflows/*.yml`): pin every action to a full commit SHA (never a tag; take current SHAs from the workflow files, and add a version comment on update), keep minimal token permissions. Workflow structure, CodeQL and fork-PR / `pull_request_target` rules: github-workflow `references/ci-workflows.md`.
5. **SBOM**: generate CycloneDX JSON with `npx @cyclonedx/cyclonedx-npm@<pinned-version>` (pin the version; no SBOM tooling or workflow exists in the repo yet) and include it in release artifacts.
6. **Advisory response**: follow the incident checklist (check exposure, pin safe version, audit lockfile,
   rotate credentials if needed) and record it in the team security channel. Rotation specifics: security-hardening.
7. **Scorecard**: run OpenSSF Scorecard manually (no Scorecard workflow exists in `.github/workflows/`). Weekly review cadence: security-hardening.

Done when: no exotic subdependency sources in the lockfile, all actions SHA-pinned, Dependabot alerts at
zero or documented overrides, Scorecard stable or improving.

## References

- [references/security-reference.md](references/security-reference.md) - read for exact pnpm settings, SHA-pin policy pointers, SBOM commands, the incident response checklist, and the habits table
