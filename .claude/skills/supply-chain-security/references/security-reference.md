# Supply Chain Security Reference

## Contents
- pnpm Configuration
- GitHub Actions Security
- SBOM Generation
- Incident Response (Compromised Package)
- Ongoing Habits

## pnpm Configuration

### Required settings (in `Code/pnpm-workspace.yaml`; pnpm 11+ ignores the `"pnpm"` field of `package.json`):

```yaml
blockExoticSubdeps: true
allowBuilds:
  esbuild: true
  chacha-native: true
```

- **allowBuilds**: Deny-by-default allowlist of packages that may run install scripts
  (postinstall, preinstall); replaced `onlyBuiltDependencies` in pnpm 11. Limits blast
  radius of supply-chain attacks.
- **blockExoticSubdeps**: Prevents transitive dependencies from pulling packages
  from git URLs, direct tarball URLs, or other untrusted locations.
- **minimumReleaseAge** (`Code/pnpm-workspace.yaml`, minutes; 4320 = 3 days): new
  versions are not resolved until they are 3 days old, so a hijacked release is
  usually unpublished before it can land in the lockfile.

### Override pattern for transitive vulns:

```yaml
# Code/pnpm-workspace.yaml
overrides:
  "vulnerable-package@<2.0.1": "2.0.1"
```

## GitHub Actions Security

- Pin every action to a 40-hex commit SHA, never a mutable tag. Current SHAs: copy from `.github/workflows/*.yml` (see github-workflow `references/ci-workflows.md`). Verify pins when updating CI.
- Token permissions, CodeQL workflow YAML, and fork-PR rules (`pull_request` vs `pull_request_target`, two-workflow pattern): github-workflow `references/ci-workflows.md`.

## SBOM Generation

```bash
# Using CycloneDX (recommended for npm/pnpm ecosystems)
npx @cyclonedx/cyclonedx-npm --output-file sbom.json --output-format json
```

- Pin the `@cyclonedx/cyclonedx-npm` version in the command (npx otherwise fetches latest)
- Formats: CycloneDX (JSON/XML) or SPDX
- Include in release artifacts alongside the build
- SLSA Level 1+: locked dependencies (`--frozen-lockfile`), provenance metadata

## Incident Response (Compromised Package)

1. Check exposure: `pnpm why <package>`
2. Pin to known-good version via `overrides` in `Code/pnpm-workspace.yaml`
3. Verify integrity: `pnpm install --frozen-lockfile`
4. Check for postinstall scripts in the compromised package
5. Rotate credentials if package could access env vars during install
6. Update lockfile once patched version available
7. Document incident and response

## Ongoing Habits

| Habit | Frequency |
|-------|-----------|
| Run the audit | Every CI run (OSV check via `scripts/security-check.ps1`, blocking) |
| Update dependencies | Monthly (patch), quarterly (minor/major) |
| Regenerate SBOM | Each release |
| Review pnpm overrides | Monthly (remove stale overrides) |
| Check OpenSSF Scorecard | Manual; no workflow in repo |
| Verify action SHA pins | When updating CI workflows |

Weekly Dependabot and Scorecard review cadence: security-hardening.
