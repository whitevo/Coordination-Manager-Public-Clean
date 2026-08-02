import claMarkdown from '../../../../CLA.md?raw'
import codeOfConductMarkdown from '../../../../CODE_OF_CONDUCT.md?raw'
import securityPolicyMarkdown from '../../../../SECURITY.md?raw'
import trademarkPolicyMarkdown from '../../../../TRADEMARKS.md?raw'
import privacyPolicyMarkdown from '../../../../docs/public/PRIVACY_POLICY.md?raw'
import termsOfServiceMarkdown from '../../../../docs/public/TERMS_OF_SERVICE.md?raw'
import proposalVideoMeetingMarkdown from './content/proposals/video-meeting.md?raw'
import proposalDataPrivacyMarkdown from './content/proposals/data-privacy.md?raw'
import proposalOpenSourceSecurityMarkdown from './content/proposals/open-source-security.md?raw'

export type MarkdownSection = 'Legal' | 'Proposals'

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
]

export const markdownRoutesBySection = {
  Legal: markdownRoutes.filter(route => route.section === 'Legal'),
  Proposals: markdownRoutes.filter(route => route.section === 'Proposals'),
}
