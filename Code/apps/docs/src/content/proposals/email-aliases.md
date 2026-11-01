# Email Aliases as a Future Proposal

## Why this moved to proposal

The mailbox aliases feature is currently too niche for the product stage we are in.

- Real usage has been low and there is no clear near-term user benefit.
- Shipping and maintaining alias providers adds implementation and testing overhead.
- Every incremental provider integration increases support complexity.

Given current priorities, we are treating aliases as a proposal instead of an active feature.

## Proposed provider

The planned provider is [Addy.io](https://addy.io/#pricing).

addy.io creates **aliases** that forward to your real inbox. Share an alias instead of your main email address - then switch one off if it leaks or starts spamming you.

## Scope of this proposal

This proposal keeps the concept documented and ready for future governance review.

Potential future scope:

- User-created forwarding aliases
- Temporary burner aliases
- Provider abstraction so we can swap alias vendors
- Alias lifecycle controls (active, paused, expired)

## What must be true before implementation

Before reactivating aliases, we should have:

- A governance process to rank feature demand against maintenance cost
- Clear adoption signals from real users
- A minimal test plan covering:
  - alias creation validation
  - forwarding destination correctness
  - provider outage handling and retries
  - permission and ownership checks

## Suggested acceptance criteria for future activation

- Governance review approves aliases as a roadmap item.
- At least one provider integration passes end-to-end tests.
- UX copy explains use cases and tradeoffs clearly.
- Ongoing maintenance ownership is assigned.

## Current status

Status: Proposal only (not active in the mailbox UI).
