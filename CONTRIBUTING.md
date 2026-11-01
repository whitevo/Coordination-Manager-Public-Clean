# Contributing to Coordination Manager

Thanks for your interest in contributing! Coordination Manager is an open-source project maintained by Voltaire Swarm OÜ under the MIT License.

This document covers how to propose changes, what we expect from contributors, and the legal terms under which contributions are accepted.

---

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful, be constructive, and assume good faith.

---

## Ways to Contribute

- **Report bugs** -- open an issue using the bug template.
- **Suggest features** -- open an issue using the feature template; bigger ideas can also start as a Discussion.
- **Improve documentation** -- typo fixes, clarifications, translations.
- **Submit code** -- bug fixes, refactors, new features (see workflow below).
- **Triage** -- comment on existing issues, reproduce reports, propose labels.

If you are unsure whether something is in scope, open a Discussion first.

---

## Development Workflow

### 1. Find or open an issue

For anything beyond a trivial fix, open or claim an issue before you start coding. This avoids duplicated work and lets maintainers flag scope or design concerns early.

### 2. Fork and branch

- Fork the repository.
- Create a topic branch off `main`: `git checkout -b fix/short-description` or `feat/short-description`.
- Keep changes focused -- one logical change per PR.

### 3. Set up locally

The project is a pnpm monorepo. From the `Code/` directory:

```
pnpm install
pnpm dev
```

See the README for environment variable setup.

### 4. Follow the project conventions

- **TypeScript strict mode** across all packages; no `any`.
- **Function components + hooks** on the frontend (React 19, TailwindCSS).
- **async/await** for asynchronous code.
- **Input validation at the API boundary** using the sanitize helpers.
- **ASCII-safe text** in source files (no smart quotes or em dashes).
- **No secrets** in commits, ever.
- **Vite config compatibility**: use `import.meta.dirname` and explicit `.ts`
  extensions for local TypeScript imports in configs and their dependencies.
  Shared discovery code has its own ESM boundary in `Code/shared/package.json`;
  keep it compatible with Vite's native config loader.

Run before pushing:

```
pnpm lint
pnpm typecheck
pnpm test
```

### 5. Open a pull request

- Use a clear title and fill in the PR template.
- Link the issue your PR addresses.
- Describe what changed and why, plus any user-visible impact.
- Keep PRs reasonably small; large PRs may be asked to split.
- Be ready to iterate on review feedback.

### 6. Sign the CLA

Before your first contribution is merged you must sign the [Contributor License Agreement](CLA.md). Our PR bot will prompt you; signing is a one-time action that covers all your future contributions to this project.

---

## Contributor License Agreement (CLA)

We use a CLA so the project can stay healthy long-term, including the ability to relicense or to offer commercial terms for the same code without re-contacting every contributor.

In short, by signing the CLA you:

- Retain copyright in your contribution.
- Grant Voltaire Swarm OÜ a broad, perpetual, royalty-free licence to use, modify, and distribute it (including under future licences chosen by the project).
- Confirm that you have the right to make the contribution and that it does not knowingly infringe anyone else's rights.

The full text is in [CLA.md](CLA.md). If you are contributing on behalf of an employer, you must have authority to bind them.

---

## Reporting Security Issues

**Do not open public issues for security vulnerabilities.** Follow the process in [SECURITY.md](SECURITY.md).

---

## Trademarks

The names "Coordination Manager" and "Voltaire Swarm" are trademarks of Voltaire Swarm OÜ. The MIT license covers source code only -- it does not grant rights to use these names in your own products, services, or domain names. See [TRADEMARKS.md](TRADEMARKS.md).

---

## Governance

Decisions are made openly on GitHub. The current governance model is documented in [GOVERNANCE.md](GOVERNANCE.md). In short: the maintainer (Voltaire Swarm OÜ) bootstraps direction, and contributors gain progressively more responsibility as they demonstrate sustained involvement.

---

## Questions

- **Discussions:** <https://github.com/whitevo/Coordination-Manager-Public-Clean/discussions>
- **Email:** tevo@coordinationmanager.com
