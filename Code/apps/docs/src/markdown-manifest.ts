import claMarkdown from '../../../../CLA.md?raw'
import codeOfConductMarkdown from '../../../../CODE_OF_CONDUCT.md?raw'
import securityPolicyMarkdown from '../../../../SECURITY.md?raw'
import trademarkPolicyMarkdown from '../../../../TRADEMARKS.md?raw'
import privacyPolicyMarkdown from '../../../../docs/public/PRIVACY_POLICY.md?raw'
import termsOfServiceMarkdown from '../../../../docs/public/TERMS_OF_SERVICE.md?raw'
import mailboxArchitectureMarkdown from '../../../../docs/public/MAILBOX_ARCHITECTURE.md?raw'
import testingGuideMarkdown from '../../../../docs/public/TESTING_GUIDE.md?raw'
import uiStateReconciliationMarkdown from '../../../../docs/public/UI_STATE_RECONCILIATION.md?raw'
import proposalVideoMeetingMarkdown from './content/proposals/video-meeting.md?raw'
import proposalDataPrivacyMarkdown from './content/proposals/data-privacy.md?raw'
import proposalOpenSourceSecurityMarkdown from '../../../../docs/proposals/OPEN_SOURCE_SECURITY_IMPROVEMENT_PROPOSAL.md?raw'
import proposalDocsOnboardingLicensingMarkdown from './content/proposals/docs-onboarding-licensing.md?raw'
import proposalEmailAliasesMarkdown from './content/proposals/email-aliases.md?raw'
import designSystemMarkdown from '../../../../docs/public/DESIGN_SYSTEM.md?raw'
import discordGuardianMarkdown from './content/guides/discord-guardian.md?raw'
import sessionHandlingGuideMarkdown from '../../../../docs/public/security-guides/session-handling.md?raw'
import oauthSecurityGuideMarkdown from '../../../../docs/public/security-guides/oauth-security.md?raw'
import mailboxCredentialEncryptionGuideMarkdown from '../../../../docs/public/security-guides/mailbox-credential-encryption.md?raw'
import securityHeadersGuideMarkdown from '../../../../docs/public/security-guides/security-headers.md?raw'
import vulnerabilityReportingGuideMarkdown from '../../../../docs/public/security-guides/vulnerability-reporting.md?raw'
import securityToolingGuideMarkdown from '../../../../docs/public/security-guides/security-tooling.md?raw'

export type MarkdownSection = 'Legal' | 'Guides' | 'Proposals' | 'Design'

export interface MarkdownRouteEntry {
  title: string
  path: string
  section: MarkdownSection
  markdown: string
}

export const markdownRoutes: MarkdownRouteEntry[] = [
  {
    title: 'Privacy Policy',
    path: '/legal/privacy-policy',
    section: 'Legal',
    markdown: privacyPolicyMarkdown,
  },
  {
    title: 'Terms of Service',
    path: '/legal/terms-of-service',
    section: 'Legal',
    markdown: termsOfServiceMarkdown,
  },
  {
    title: 'Security Policy',
    path: '/legal/security-policy',
    section: 'Legal',
    markdown: securityPolicyMarkdown,
  },
  {
    title: 'Trademark Policy',
    path: '/legal/trademark-policy',
    section: 'Legal',
    markdown: trademarkPolicyMarkdown,
  },
  {
    title: 'Contributor CLA',
    path: '/legal/cla',
    section: 'Legal',
    markdown: claMarkdown,
  },
  {
    title: 'Code of Conduct',
    path: '/legal/code-of-conduct',
    section: 'Legal',
    markdown: codeOfConductMarkdown,
  },
  {
    title: 'Mailbox Architecture Guide',
    path: '/guides/mailbox-architecture',
    section: 'Guides',
    markdown: mailboxArchitectureMarkdown,
  },
  {
    title: 'Testing Guide',
    path: '/guides/testing',
    section: 'Guides',
    markdown: testingGuideMarkdown,
  },
  {
    title: 'UI State and Refresh Reliability',
    path: '/guides/ui-state-reconciliation',
    section: 'Guides',
    markdown: uiStateReconciliationMarkdown,
  },
  {
    title: 'Discord Guardian',
    path: '/guides/discord-guardian',
    section: 'Guides',
    markdown: discordGuardianMarkdown,
  },
  {
    title: 'Session Handling Guide',
    path: '/guides/security/session-handling',
    section: 'Guides',
    markdown: sessionHandlingGuideMarkdown,
  },
  {
    title: 'OAuth Security Guide',
    path: '/guides/security/oauth-security',
    section: 'Guides',
    markdown: oauthSecurityGuideMarkdown,
  },
  {
    title: 'Mailbox Credential Encryption Guide',
    path: '/guides/security/mailbox-credential-encryption',
    section: 'Guides',
    markdown: mailboxCredentialEncryptionGuideMarkdown,
  },
  {
    title: 'Production Security Headers Guide',
    path: '/guides/security/security-headers',
    section: 'Guides',
    markdown: securityHeadersGuideMarkdown,
  },
  {
    title: 'Vulnerability Reporting Guide',
    path: '/guides/security/vulnerability-reporting',
    section: 'Guides',
    markdown: vulnerabilityReportingGuideMarkdown,
  },
  {
    title: 'Security Tooling Guide',
    path: '/guides/security/security-tooling',
    section: 'Guides',
    markdown: securityToolingGuideMarkdown,
  },
  {
    title: 'Video Meeting + Recording',
    path: '/proposals/video-meeting',
    section: 'Proposals',
    markdown: proposalVideoMeetingMarkdown,
  },
  {
    title: 'Data Privacy + Encryption',
    path: '/proposals/data-privacy',
    section: 'Proposals',
    markdown: proposalDataPrivacyMarkdown,
  },
  {
    title: 'Open Source Security Improvement',
    path: '/proposals/open-source-security',
    section: 'Proposals',
    markdown: proposalOpenSourceSecurityMarkdown,
  },
  {
    title: 'Documentation, Onboarding, and Enterprise Packaging Refresh',
    path: '/proposals/docs-onboarding-licensing',
    section: 'Proposals',
    markdown: proposalDocsOnboardingLicensingMarkdown,
  },
  {
    title: 'Email Aliases (Deferred)',
    path: '/proposals/email-aliases',
    section: 'Proposals',
    markdown: proposalEmailAliasesMarkdown,
  },
  {
    title: 'Design System',
    path: '/design/system',
    section: 'Design',
    markdown: designSystemMarkdown,
  },
]

export const markdownRoutesBySection = {
  Legal: markdownRoutes.filter(route => route.section === 'Legal'),
  Guides: markdownRoutes.filter(route => route.section === 'Guides'),
  Proposals: markdownRoutes.filter(route => route.section === 'Proposals'),
  Design: markdownRoutes.filter(route => route.section === 'Design'),
}
