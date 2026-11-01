import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Boxes,
  Rocket,
  Key,
  Calendar,
  CalendarSearch,
  Users,
  Megaphone,
  MessageCircle,
  Code2,
  GraduationCap,
  Video,
  Network,
  Scale,
  ShieldCheck,
  Shield,
  FileText,
  Lock,
  Bot,
  Sparkles,
  Clock3,
  CalendarDays,
  Gauge,
  Palette,
  LayoutGrid,
  ShieldAlert,
  ListChecks,
} from 'lucide-react'

export type SectionId = 'general' | 'api' | 'guides' | 'legal' | 'proposals' | 'design' | 'risk' | 'marketing'

export interface SectionLink {
  label: string
  path: string
  description: string
  icon: LucideIcon
}

export interface SectionLandingPageData {
  title: string
  eyebrow: string
  summary: string
  intro: string
  links: SectionLink[]
  previewTitle: string
  previewBullets: string[]
}

export interface SectionNavItem {
  id: SectionId
  title: string
  path: string
  description: string
  icon: LucideIcon
}

export interface OverviewCapability {
  title: string
  description: string
  path?: string
  href?: string
  action?: 'open-ai-search'
  icon: LucideIcon
  previewTitle: string
  previewBullets: string[]
  previewImage?: string
  previewImageAlt?: string
  accentClass: string
}

export const sectionNavigation: SectionNavItem[] = [
  {
    id: 'general',
    title: 'General',
    path: '/section/general',
    description: 'Product overview, workshops, architecture, setup, and authentication.',
    icon: BookOpen,
  },
  {
    id: 'api',
    title: 'API Reference',
    path: '/section/api',
    description: 'Calendars, meetings, announcements, feedback, and integrations.',
    icon: Boxes,
  },
  {
    id: 'guides',
    title: 'Guides',
    path: '/section/guides',
    description: 'Examples, integration guides, workshops, and contributor resources.',
    icon: Rocket,
  },
  {
    id: 'design',
    title: 'Design',
    path: '/section/design',
    description: 'Design tokens, component anatomy, and UI change governance.',
    icon: Palette,
  },
  {
    id: 'legal',
    title: 'Legal',
    path: '/section/legal',
    description: 'Policy, governance, and compliance documentation.',
    icon: Shield,
  },
  {
    id: 'risk',
    title: 'Risk & Ethics',
    path: '/section/risk',
    description: 'AI risk framework adoption and the live risk register.',
    icon: ShieldAlert,
  },
  {
    id: 'proposals',
    title: 'Proposals',
    path: '/section/proposals',
    description: 'Draft proposals for product and platform direction.',
    icon: FileText,
  },
  {
    id: 'marketing',
    title: 'Marketing',
    path: '/section/marketing',
    description: 'Product directory listings and external product pages to keep up to date.',
    icon: Megaphone,
  },
]

export const sectionLandingPages: Record<SectionId, SectionLandingPageData> = {
  general: {
    title: 'General Documentation',
    eyebrow: 'Start here',
    summary: 'The best place to orient yourself before digging into the API or governance docs.',
    intro: 'This section groups the pages that explain what Coordination Manager is, how it is structured, and how to get a key into the system safely.',
    links: [
      {
        label: 'Overview',
        path: '/overview',
        description: 'High-level summary, capabilities, and recommended entry points.',
        icon: BookOpen,
      },
      {
        label: 'Workshops',
        path: '/workshops',
        description: 'Coordination sessions and planning materials.',
        icon: GraduationCap,
      },
      {
        label: 'Architecture',
        path: '/architecture',
        description: 'How the web app, API, and integrations fit together.',
        icon: Boxes,
      },
      {
        label: 'Getting Started',
        path: '/getting-started',
        description: 'Create an API key and make your first request.',
        icon: Rocket,
      },
      {
        label: 'Authentication',
        path: '/authentication',
        description: 'Bearer tokens, scopes, and error handling basics.',
        icon: Key,
      },
      {
        label: 'Limits',
        path: '/limits',
        description: 'AI usage quotas, API rate limits, and mailbox operational limits.',
        icon: Gauge,
      },
    ],
    previewTitle: 'General docs snapshot',
    previewBullets: [
      'Platform overview and entry points',
      'Architecture and deployment context',
      'Setup, auth, and quick-start guidance',
      'AI usage quotas and API rate limits',
    ],
  },
  api: {
    title: 'API Reference',
    eyebrow: 'Tooling and data',
    summary: 'Endpoints for calendars, events, meetings, announcements, Discord, mailbox, and feedback.',
    intro: 'These pages document the core API surfaces that agents and integrations use to work with schedules, events, mail, and user workflows.',
    links: [
      {
        label: 'Calendars',
        path: '/api/calendars',
        description: 'Coordinate availability and manage shared calendars.',
        icon: Calendar,
      },
      {
        label: 'Calendar Sources',
        path: '/api/calendar-sources',
        description: 'Read events from connected Google Calendars and feeds.',
        icon: CalendarSearch,
      },
      {
        label: 'Meetings',
        path: '/api/meetings',
        description: 'Create meeting drafts and inspect overlap-based scheduling.',
        icon: Users,
      },
      {
        label: 'Announcements',
        path: '/api/announcements',
        description: 'Draft announcement templates and poll-based posts.',
        icon: Megaphone,
      },
      {
        label: 'Discord',
        path: '/api/discord',
        description: 'Inspect linked servers, channels, and DM-ready members.',
        icon: MessageCircle,
      },
      {
        label: 'Mailbox',
        path: '/api/mailbox',
        description: 'Sync Gmail and Outlook mail, manage drafts, and automate inbox actions.',
        icon: MessageCircle,
      },
      {
        label: 'Feedback',
        path: '/api/feedback',
        description: 'Capture and review product feedback from users and agents.',
        icon: Code2,
      },
    ],
    previewTitle: 'API surface snapshot',
    previewBullets: [
      'Calendars, meetings, and events',
      'Announcements, Discord, mailbox, and feedback',
      'Agent-friendly read/write workflows',
    ],
  },
  guides: {
    title: 'Guides',
    eyebrow: 'How to use it',
    summary: 'Examples, rollout context, workshops, and integration walkthroughs for operators and contributors.',
    intro: 'The guides section collects the pages that help users understand how to apply the product in the real world.',
    links: [
      {
        label: 'Examples',
        path: '/examples',
        description: 'Python, JavaScript, and cURL examples for common tasks.',
        icon: Code2,
      },
      {
        label: 'Zoom Integration',
        path: '/zoom',
        description: 'How the video meeting integration works.',
        icon: Video,
      },
      {
        label: 'Zoom Review',
        path: '/zoom-review',
        description: 'Marketplace test plan and reviewer landing page.',
        icon: CalendarDays,
      },
      {
        label: 'Coordination Frameworks',
        path: '/coordination-frameworks',
        description: 'Decision-making and collaboration patterns.',
        icon: Network,
      },
      {
        label: 'Mailbox Architecture Guide',
        path: '/guides/mailbox-architecture',
        description: 'Unified inbox sync model, data model, and security notes for the mailbox feature.',
        icon: MessageCircle,
      },
      {
        label: 'Testing Guide',
        path: '/guides/testing',
        description: 'Testing architecture, execution workflows, and suite coverage across the monorepo.',
        icon: ListChecks,
      },
      {
        label: 'UI State and Refresh Reliability',
        path: '/guides/ui-state-reconciliation',
        description: 'Collection ownership, guarded reads, motion contracts, and migration limits.',
        icon: ListChecks,
      },
      {
        label: 'Discord Guardian',
        path: '/guides/discord-guardian',
        description: 'Configure message scanning, moderation actions, and the user appeal process.',
        icon: ShieldAlert,
      },
    ],
    previewTitle: 'Guides snapshot',
    previewBullets: [
      'Examples and rollout guidance',
      'Workshop and review materials',
      'Integration walkthroughs and frameworks',
      'Mailbox architecture and API surface',
    ],
  },
  legal: {
    title: 'Legal',
    eyebrow: 'Policies and governance',
    summary: 'Privacy, terms, security, code of conduct, and contributor agreements.',
    intro: 'These documents define how the project is governed and how user data is handled across the platform.',
    links: [
      {
        label: 'Privacy Policy',
        path: '/legal/privacy-policy',
        description: 'What data is collected, why it is used, and how it is protected.',
        icon: ShieldCheck,
      },
      {
        label: 'Terms of Service',
        path: '/legal/terms-of-service',
        description: 'Usage terms and platform responsibilities.',
        icon: Scale,
      },
      {
        label: 'Security Policy',
        path: '/legal/security-policy',
        description: 'Security reporting and vulnerability handling process.',
        icon: Shield,
      },
      {
        label: 'Code of Conduct',
        path: '/legal/code-of-conduct',
        description: 'Community standards for contributors and users.',
        icon: FileText,
      },
      {
        label: 'Contributor CLA',
        path: '/legal/cla',
        description: 'Contribution agreement for code and documentation changes.',
        icon: Lock,
      },
      {
        label: 'Trademark Policy',
        path: '/legal/trademark-policy',
        description: 'Brand and trademark usage guidance.',
        icon: Shield,
      },
    ],
    previewTitle: 'Legal snapshot',
    previewBullets: [
      'Privacy, terms, and security',
      'Contributor and trademark guidance',
      'Governance and conduct standards',
    ],
  },
  proposals: {
    title: 'Proposals',
    eyebrow: 'Draft ideas',
    summary: 'Community proposals that describe future platform directions before implementation.',
    intro: 'The proposals section now includes the full set of draft documents so the docs navigation stays in sync with the proposal folder.',
    links: [
      {
        label: 'Video Meeting + Recording',
        path: '/proposals/video-meeting',
        description: 'Video meeting expansion and recording notes.',
        icon: Video,
      },
      {
        label: 'Data Privacy + Encryption',
        path: '/proposals/data-privacy',
        description: 'Data handling and encryption planning.',
        icon: ShieldCheck,
      },
      {
        label: 'Open Source Security Improvement',
        path: '/proposals/open-source-security',
        description: 'Standards-first security artifacts and SBOM planning.',
        icon: Lock,
      },
      {
        label: 'Email Aliases (Deferred)',
        path: '/proposals/email-aliases',
        description: 'Deferred from active delivery and tracked as a governance proposal.',
        icon: Lock,
      },
    ],
    previewTitle: 'Proposal snapshot',
    previewBullets: [
      'Four proposal documents',
      'Security, privacy, and video meeting ideas',
      'Draft-only material for review, including deferred mailbox aliases',
    ],
  },
  design: {
    title: 'Design System',
    eyebrow: 'UI contract',
    summary: 'The canonical vocabulary, design tokens, component anatomy, and governance workflow behind the web app UI.',
    intro: 'Design consistency lives in Git, not in memory. These pages describe the written contract every UI change follows; new tokens, variants, and animations are proposed and reviewed first.',
    links: [
      {
        label: 'Design System',
        path: '/design/system',
        description: 'Tokens, canonical vocabulary, page composition, and the change-proposal workflow.',
        icon: Palette,
      },
      {
        label: 'Component Catalog',
        path: '/design/catalog',
        description: 'Every component variant rendered live -- search, filter, and compare defaults vs drift.',
        icon: LayoutGrid,
      },
    ],
    previewTitle: 'Design snapshot',
    previewBullets: [
      'HSL token contract with user theme overlays',
      'Canonical component vocabulary and anatomy',
      'Review-first workflow for visual changes, validated with Playwright',
    ],
  },
  risk: {
    title: 'Risk & Ethics',
    eyebrow: 'Accountability',
    summary: 'How we assess and monitor product and AI risk -- a lightweight adoption of the AISSAE framework.',
    intro: 'Coordination Manager uses AI for context and routing only, under human supervision. These pages document the framework subset we adopted, our classification profile, and the live risk register with scores and mitigations.',
    links: [
      {
        label: 'AI Risk Framework',
        path: '/risk/framework',
        description: 'What we took from AISSAE, what we skipped, and how scoring works.',
        icon: ShieldAlert,
      },
      {
        label: 'Risk Register',
        path: '/risk/register',
        description: 'Twelve tracked risks across six domains, with impact/likelihood matrix and mitigations.',
        icon: ListChecks,
      },
    ],
    previewTitle: 'Risk snapshot',
    previewBullets: [
      'AISSAE taxonomy subset, six applicable domains',
      'Supervised, static, non-persistent AI profile',
      'Live register scored 2x(I+L) + (IxL)',
      'Acceptable / Managed / Blocked zones with mitigations',
    ],
  },
  marketing: {
    title: 'Marketing',
    eyebrow: 'Product visibility',
    summary: 'Keep track of external product directory listings and where to review them.',
    intro: 'This tracker records product listing pages so they can be revisited and updated as the product changes.',
    links: [
      {
        label: 'Product Directory Listings',
        path: '/marketing',
        description: 'Review the product directories where Coordination Manager is listed.',
        icon: Megaphone,
      },
    ],
    previewTitle: 'Marketing snapshot',
    previewBullets: [
      'External product directory links',
      'Listing status and review notes',
      'A single place to add future product pages',
    ],
  },
}

export const overviewCapabilities: OverviewCapability[] = [
  {
    title: 'Coordination Calendars',
    description: 'Create shared calendars and capture availability across a group.',
    path: '/api/calendars',
    icon: Calendar,
    previewImage: '/docs/images/feature-portfolio/02-calendars.png',
    previewImageAlt: 'Coordination calendars page',
    previewTitle: 'Shared calendar flow',
    previewBullets: [
      'Create a shared coordination calendar',
      'Collect participant availability',
      'Compare overlap before scheduling',
    ],
    accentClass: 'border-brand-500/50',
  },
  {
    title: 'Events',
    description: 'Read integrated Google Calendar events and cross-check what is already booked.',
    path: '/api/calendar-sources',
    icon: CalendarDays,
    previewImage: '/docs/images/feature-portfolio/03-events-calendar.png',
    previewImageAlt: 'Events calendar page',
    previewTitle: 'Events view',
    previewBullets: [
      'Pull connected calendar events',
      'Use read-only event data for planning',
      'Compare external events with coordination slots',
    ],
    accentClass: 'border-cyan-500/50',
  },
  {
    title: 'Time Management',
    description: 'Open the Time Management tool to manage modes, categories, backgrounds, and schedule blocks.',
    href: 'https://coordinationmanager.com/time-management',
    icon: Clock3,
    previewImage: '/docs/images/feature-portfolio/04-time-management.png',
    previewImageAlt: 'Time management page',
    previewTitle: 'Time management workspace',
    previewBullets: [
      'Manage calendar modes and categories',
      'Work with recurring time blocks',
      'Use the full time-management workspace',
    ],
    accentClass: 'border-amber-500/50',
  },
  {
    title: 'Announcement System',
    description: 'Draft announcement templates and prepare Discord distribution safely.',
    path: '/api/announcements',
    icon: Megaphone,
    previewImage: '/docs/images/feature-portfolio/01-home.png',
    previewImageAlt: 'Coordination manager homepage',
    previewTitle: 'Announcement workflow',
    previewBullets: [
      'Create template drafts first',
      'Support polls and embeds',
      'Require a human before sending',
    ],
    accentClass: 'border-orange-500/50',
  },
  {
    title: 'Agent API',
    description: 'Give AI agents a scoped API with Bearer auth and clear permissions.',
    path: '/getting-started',
    icon: Bot,
    previewTitle: 'Agent-ready API',
    previewBullets: [
      'API key setup and scopes',
      'Read/write access boundaries',
      'Designed for automation workflows',
    ],
    accentClass: 'border-violet-500/50',
  },
  {
    title: 'Human-in-the-Loop',
    description: 'Open AI Search to inspect docs, verify actions, and keep the final decision manual.',
    action: 'open-ai-search',
    icon: Sparkles,
    previewTitle: 'AI Search side panel',
    previewBullets: [
      'Search the docs without leaving the page',
      'Keep high-risk actions under review',
      'Use the side panel for fast answers',
    ],
    accentClass: 'border-rose-500/50',
  },
]
