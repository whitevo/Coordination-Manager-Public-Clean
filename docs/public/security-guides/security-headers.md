# Production Security Headers Guide

## Scope

This guide explains the security headers configured for the web and API services. Header scans show the behavior of a deployed endpoint at a point in time; they are not a complete security assessment.

## Controls

- The API uses Helmet for baseline HTTP security headers.
- The frontend is configured with content-security and frame-protection controls.
- Production responses should be checked for transport, content-type, framing, and referrer protections.
- Header configuration is reviewed alongside deployment changes.

## Implementation References

- [Helmet setup and production security-header configuration](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/index.ts#L102-L119)
- [API security-header regression test](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/__tests__/public-server/server-health.test.ts#L35-L52)

The docs site resolves these repository links by environment: localhost opens the private repository, and the public docs site opens the public-clean repository.

## Customer Verification

Customers can run browser developer tools, `curl -I`, or a reputable header-scanning service against the deployed web and API endpoints. A public guide update should include the scan date, endpoint class, header names, and pass/fail results without cookies, authorization headers, or internal response data.

## Limits

A header scan verifies response headers only. It does not prove application authorization, dependency security, server configuration, or protection against all browser and network attacks.
