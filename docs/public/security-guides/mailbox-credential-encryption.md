# Mailbox Credential Encryption Guide

## Scope

This guide explains how mailbox OAuth credentials are protected before database storage. Its purpose is clarity and oversight for this control area, not independent cryptographic certification.

## Controls

- Mailbox credentials are encrypted server-side before persistence.
- The vault uses authenticated encryption with AES-256-GCM.
- Encryption keys are supplied through server environment configuration rather than source code.
- Credential reads and updates are restricted to the account owner through authenticated API paths.
- Synthetic credentials can be used in tests without exposing customer data.

## Implementation References

- [Encryption-key validation](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-credentials.ts#L32-L42)
- [AES-256-GCM encryption](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-credentials.ts#L44-L51)
- [AES-256-GCM decryption](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-credentials.ts#L53-L65)
- [Encrypted credential persistence and retrieval](https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/Code/apps/api/src/services/mailbox-credentials.ts#L67-L82)
- [Mailbox architecture and data-security boundaries](/docs/guides/mailbox-architecture)

The docs site resolves these repository links by environment: localhost opens the private repository, and the public docs site opens the public-clean repository.

## Limits

Publishing algorithms and tests does not publish encryption keys or prove the security of the deployment secret store. Production key custody and rotation records remain private operational records.