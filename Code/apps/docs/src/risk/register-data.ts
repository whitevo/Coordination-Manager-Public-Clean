/**
 * Risk register data for the Risk & Ethics docs section.
 *
 * Adapted from the AISSAE (AI Safety, Security and Ethics by Design) framework,
 * https://github.com/singnet/AISSAE (Apache-2.0). We use their risk taxonomy
 * rows as prompts, their scoring formula, and their register table format.
 * We do NOT use their registry, badge, or dashboard workflow.
 */

export type RiskZone = 'green' | 'amber' | 'red'

export type RiskDomainId =
  | 'privacy'
  | 'transparency'
  | 'integrity'
  | 'fairness'
  | 'dependencies'
  | 'security'

export interface RiskDomain {
  id: RiskDomainId
  label: string
  oecdPrinciple: string
  description: string
}

export interface RiskEntry {
  id: string
  domain: RiskDomainId
  title: string
  /** 1-5 */
  impact: number
  /** 1-5 */
  likelihood: number
  mitigations: string
  /** Optional link to a proposal that would structurally lower this risk's score. */
  proposalLink?: { label: string; path: string }
  /** The AISSAE taxonomy row this risk derives from. */
  taxonomyRef: string
  familiarity: 'Known' | 'Foreseeable'
}

/** AISSAE scoring formula: 2*(Impact + Likelihood) + (Impact * Likelihood). Range 5-45. */
export function riskScore(impact: number, likelihood: number): number {
  return 2 * (impact + likelihood) + impact * likelihood
}

/** Adopted thresholds (AISSAE "moderate" base appetite): Acceptable <= 13, Managed 14-24, Blocked >= 25. */
export function riskZone(score: number): RiskZone {
  if (score >= 25) return 'red'
  if (score >= 14) return 'amber'
  return 'green'
}

export const ZONE_LABELS: Record<RiskZone, string> = {
  green: 'Acceptable',
  amber: 'Managed',
  red: 'Blocked',
}

export const ZONE_CLASSES: Record<RiskZone, string> = {
  green: 'bg-emerald-950/40 text-emerald-400 border-emerald-900/60',
  amber: 'bg-amber-950/40 text-amber-400 border-amber-900/60',
  red: 'bg-red-950/40 text-red-400 border-red-900/60',
}

export const riskDomains: RiskDomain[] = [
  {
    id: 'privacy',
    label: 'Privacy & Data Control',
    oecdPrinciple: 'Human rights and democratic values, including fairness and privacy',
    description:
      'Availability and scheduling data quietly reveals personal routines. Participants must keep sight and control of where their data goes.',
  },
  {
    id: 'transparency',
    label: 'Transparency of AI Involvement',
    oecdPrinciple: 'Transparency and explainability',
    description:
      'Users should always know when AI contributed to a suggestion, draft, or routing step, and what its limits are.',
  },
  {
    id: 'integrity',
    label: 'Information Integrity',
    oecdPrinciple: 'Robustness, security and safety',
    description:
      'AI output can be wrong or fabricated. Nothing the AI produces may reach other people without human review.',
  },
  {
    id: 'fairness',
    label: 'Fairness & Accessibility',
    oecdPrinciple: 'Human rights and democratic values, including fairness and privacy',
    description:
      'AI-assisted features must not create a two-tier product that disadvantages assistive-tech, low-bandwidth, or non-English users.',
  },
  {
    id: 'dependencies',
    label: 'External Dependencies',
    oecdPrinciple: 'Robustness, security and safety',
    description:
      'LLM providers, Supabase, Discord, Zoom, and wallet services can change or fail. Core coordination flows must survive without them.',
  },
  {
    id: 'security',
    label: 'Security & Supply Chain',
    oecdPrinciple: 'Robustness, security and safety',
    description:
      'Prompt injection, compromised dependencies, and broken authorisation are the main ways this platform could harm its users.',
  },
]

export const riskRegister: RiskEntry[] = [
  {
    id: 'RSK-01',
    domain: 'privacy',
    title: 'Shared availability patterns reveal personal routines to anyone holding a calendar link',
    impact: 3,
    likelihood: 1,
    mitigations:
      'Hash-based calendar URLs (nanoid, never raw UUIDs); no public calendar directory; RLS on every table.',
    proposalLink: {
      label: 'Data Privacy + Encryption',
      path: '/proposals/data-privacy',
    },
    taxonomyRef: 'Privacy Violation / Data control -- "People lose sight and control of their data"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-02',
    domain: 'privacy',
    title: 'Guest (traveler) participants cannot easily review or delete the data they leave behind',
    impact: 3,
    likelihood: 3,
    mitigations:
      'Retention limits in place; self-serve deletion tracked in the linked proposal.',
    proposalLink: {
      label: 'Data Privacy + Encryption',
      path: '/proposals/data-privacy',
    },
    taxonomyRef: 'Privacy Violation / Data control -- "There is no capability for people to delete their data"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-03',
    domain: 'transparency',
    title: 'Users may not realise when AI is involved in a suggestion, draft, or routing step',
    impact: 2,
    likelihood: 3,
    mitigations:
      'AI-generated output is labelled in the UI; AI is advisory-only and every action requires human confirmation.',
    taxonomyRef: 'System Opacity & Inexplicability / System transparency -- "The role of AI in decisions/processes is not clear to users"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-04',
    domain: 'transparency',
    title: 'Silent provider model changes alter AI behaviour without users noticing',
    impact: 2,
    likelihood: 2,
    mitigations:
      'Prompts and model choices are version-controlled; AI output reviewed before rollout; features fall back to deterministic defaults.',
    taxonomyRef: 'System Opacity & Inexplicability / System transparency -- "Changes in AI capabilities are not known or recognised by users"',
    familiarity: 'Foreseeable',
  },
  {
    id: 'RSK-05',
    domain: 'integrity',
    title: 'AI summaries or drafts contain fabricated details (hallucination) in a scheduling context',
    impact: 3,
    likelihood: 2,
    mitigations:
      'AI is grounded in user-provided context only; output is saved as a draft for review and never sent or scheduled automatically.',
    taxonomyRef: 'Information Quality / Information integrity -- "AI outputs contain hallucinations or fabricated content presented as factual"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-06',
    domain: 'fairness',
    title: 'AI-assisted features are less usable for screen-reader, low-bandwidth, or non-English users',
    impact: 3,
    likelihood: 3,
    mitigations:
      'Every AI feature has a non-AI equivalent path; mobile and accessibility audits are part of the release workflow.',
    taxonomyRef: 'Discriminatory impact / Fairness and representation -- "The AI is unavailable or less accessible to a class or a group"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-07',
    domain: 'fairness',
    title: 'Timezone or language bias in suggestions disadvantages global participants',
    impact: 2,
    likelihood: 2,
    mitigations:
      'Availability is stored in UTC and overlap is computed algorithmically -- meeting-time selection is never inferred by the AI.',
    taxonomyRef: 'Discriminatory impact / Fairness and representation -- "Specific groups bear costs/risks disproportionately"',
    familiarity: 'Foreseeable',
  },
  {
    id: 'RSK-08',
    domain: 'dependencies',
    title: 'LLM provider outage or API change degrades AI-assisted features',
    impact: 2,
    likelihood: 3,
    mitigations:
      'AI features degrade gracefully; core scheduling, availability, and mailbox flows have no AI dependency.',
    taxonomyRef: 'External Interfaces / External system interfaces -- "Dependency on external systems creates single points of failure"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-09',
    domain: 'dependencies',
    title: 'A third-party service change (Supabase, Discord, Zoom, wallet) breaks a core flow',
    impact: 3,
    likelihood: 2,
    mitigations:
      'Typed API boundaries, stack health checks, and integration tests around each external service.',
    taxonomyRef: 'External Interfaces / External system interfaces -- "API changes in external systems cause unpredictable behaviour"',
    familiarity: 'Foreseeable',
  },
  {
    id: 'RSK-10',
    domain: 'security',
    title: 'Prompt injection through user-supplied text passed into AI context',
    impact: 3,
    likelihood: 2,
    mitigations:
      'Input sanitised at the API boundary; the AI has no tool execution and its output is never auto-executed; per-user daily quotas bound abuse.',
    taxonomyRef: 'External Security Threats / System security -- "External manipulation of deployed system causing harmful decisions"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-11',
    domain: 'security',
    title: 'A compromised npm dependency ships to production',
    impact: 4,
    likelihood: 2,
    mitigations:
      'pnpm audit in CI (fail on high/critical), frozen lockfiles, allowBuilds install-script allowlist, blockExoticSubdeps, 3-day minimum release age, weekly security drift report.',
    taxonomyRef: 'Supply Chain / Supply chain integrity -- "Compromised third-party components introduce vulnerabilities or backdoors"',
    familiarity: 'Known',
  },
  {
    id: 'RSK-12',
    domain: 'security',
    title: 'Broken object-level authorisation exposes another user\'s calendar or mailbox data',
    impact: 4,
    likelihood: 2,
    mitigations:
      'Server-verified identity, object-level authorisation on every endpoint, RLS on every table, recurring security hardening reviews.',
    taxonomyRef: 'External Security Threats / Data security -- "Unauthorised access to system capabilities enabling attacks"',
    familiarity: 'Known',
  },
]

/** AISSAE-style classification profile for this platform's AI usage. */
export const classificationProfile: { dimension: string; value: string; rationale: string }[] = [
  {
    dimension: 'Purpose / role',
    value: 'Finds (F), Helps (H), Explains (E)',
    rationale:
      'AI assembles context, drafts text, and explains options. It does not create artefacts, take actions, or make final decisions.',
  },
  {
    dimension: 'Environment',
    value: 'Social-facing (S)',
    rationale: 'Scheduling touches reputation and relationships between people, but never safety, health, finance, or legal outcomes.',
  },
  {
    dimension: 'Autonomy',
    value: 'Supervised (S)',
    rationale: 'A human approves every action. The AI cannot send messages, book meetings, or modify data on its own.',
  },
  {
    dimension: 'Self-learning',
    value: 'Static (S)',
    rationale: 'No fine-tuning, no memory structures, no behaviour change between requests.',
  },
  {
    dimension: 'Persistence',
    value: 'Stateful (S)',
    rationale: 'Conversation context exists within a session only; nothing carries across sessions or users.',
  },
  {
    dimension: 'Capability',
    value: 'Advanced (A)',
    rationale: 'LLM-based, so some novel failure modes (hallucination, prompt injection) apply and are tracked in the register.',
  },
  {
    dimension: 'Data sources',
    value: 'Controlled internal (I) + User-provided (U)',
    rationale: 'AI context comes from our own database and explicit user input -- never scraped or third-party-licensed data.',
  },
]
