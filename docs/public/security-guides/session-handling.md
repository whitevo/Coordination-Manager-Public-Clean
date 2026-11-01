# Session Handling Guide

## Scope

This guide explains how Coordination Manager handles browser-side sessions. Its purpose is clarity and oversight for this control area, not independent assurance or certification.

## Controls

- Authentication state is managed through the application authentication service.
- Browser session data uses `sessionStorage` rather than persistent local storage.
- Logout clears the active session and legacy Supabase session entries.
- OAuth return handling is kept separate from the normal authenticated application state.

## Implementation References

- [`clearOAuthReturnState()` and stale-session cleanup](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/web/src/lib/auth-service.ts#L48-L61)
- [`signOut()` and browser session clearing](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/web/src/lib/auth-service.ts#L224-L250)
- [Authentication service](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/web/src/lib/auth-service.ts)

The docs site resolves these repository links by environment: localhost opens the private repository, and the public docs site opens the public-clean repository.

## Customer Verification

Customers can inspect the linked authentication service implementation and review browser storage behavior in developer tools during login and logout. A future public guide update should also include a sanitized automated test summary using synthetic accounts.

## Limits

Browser storage behavior does not prove that the identity provider, deployment environment, or every server-side authorization path is secure. Those areas require separate review.
