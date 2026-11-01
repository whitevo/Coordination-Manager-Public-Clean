# OAuth Security Guide

## Scope

This guide explains the security controls in the application-owned mailbox OAuth flow. Its purpose is clarity and oversight for this control area, not a CASA report or independent assessment.

## Controls

- OAuth authorization uses the authorization-code flow.
- The application creates a signed state value tied to the requesting user and provider.
- Redirect URIs are explicit and can be configured per environment.
- Access and refresh tokens are exchanged server-side and are not exposed in application URLs.
- Provider consent and identity verification remain controlled by Google or Microsoft.

## Implementation References

- [Signed OAuth state](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-oauth.ts#L114-L125)
- [Authorization URL and explicit scopes](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-oauth.ts#L148-L176)
- [Authorization-code exchange](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-oauth.ts#L179-L248)
- [Access-token refresh](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-oauth.ts#L249-L290)

The docs site resolves these repository links by environment: localhost opens the private repository, and the public docs site opens the public-clean repository.

## Customer Verification

Customers can inspect the future public OAuth service implementation and compare the documented flow with the provider authorization request. A public flow diagram should show state creation, callback validation, code exchange, credential storage, and token refresh without exposing secrets.

## Limits

Source code and a flow diagram cannot prove that production provider-console settings match the documented configuration. Exact client configuration and redirect registrations remain private operational records.
