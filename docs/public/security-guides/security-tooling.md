# Security Tooling Guide

## Scope

This guide describes local security tooling used by maintainers. It is operational guidance, not a security guarantee.

## Local Security Check

Run the repository security check from the workspace root:

```powershell
pnpm security:check
```

For a full-history secret scan before release or public sync, run:

```powershell
pnpm security:check:full-history
```

## Gitleaks

This project uses [Gitleaks](https://github.com/gitleaks/gitleaks) for secret detection.

If Gitleaks is not installed, install it with your platform's trusted package manager. On Windows, maintainers may use:

```powershell
winget install --id Gitleaks.Gitleaks --exact
```

## Notes

- Local/pre-release checks can scan repository history for previously committed secrets.
- CI performs secret scanning appropriate to the checked-out commit or configured workflow range.
- Do not paste scan findings containing secrets into public issues, pull requests, or chat.
