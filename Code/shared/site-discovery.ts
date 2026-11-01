export const SITE_ORIGIN = 'https://coordinationmanager.com'
export const SITE_NAME = 'Coordination Manager'
export const SITE_TAGLINE = 'Plan your time, coordinate meetings, manage conversations, and support your community.'
export const SITE_DESCRIPTION = `${SITE_TAGLINE} Shared calendars, mailbox, distribution, and an Agent API.`
export const SOCIAL_IMAGE_PATH = '/og-image-current.png'
export const PRIVATE_PAGE_DESCRIPTION = 'Coordination Manager account or interactive page.'

export interface DiscoveryPage {
  path: string
  title: string
  description: string
}

export const WEB_PAGES: DiscoveryPage[] = [
  { path: '/', title: SITE_NAME, description: SITE_DESCRIPTION },
  { path: '/calendars', title: 'Coordination Calendars', description: 'Explore public coordination calendars and find shared availability for group meetings.' },
  { path: '/events-calendar', title: 'Public Events', description: 'Discover public events and meetings across coordination calendars.' },
  { path: '/time-management', title: 'Time Management', description: 'Plan your own schedule with time items and calendar views in Coordination Manager.' },
  { path: '/support', title: 'Support', description: 'Find help and support resources for Coordination Manager.' },
  { path: '/privacy', title: 'Privacy Policy', description: 'Read how Coordination Manager handles personal information and privacy.' },
  { path: '/terms', title: 'Terms of Service', description: 'Read the terms for using Coordination Manager.' },
  { path: '/policy', title: 'Platform Policy', description: 'Read Coordination Manager platform policies and governance information.' },
  { path: '/trademark', title: 'Trademark Policy', description: 'Read the guidelines for using Coordination Manager names and trademarks.' },
]

export const DOCS_PAGES: DiscoveryPage[] = [
  { path: '/docs/overview', title: 'Product Overview and Documentation', description: SITE_DESCRIPTION },
  { path: '/docs/getting-started', title: 'Agent API Getting Started', description: 'Create an Agent API key and make your first Coordination Manager API request.' },
  { path: '/docs/authentication', title: 'API Authentication', description: 'Learn about Agent API authentication, scopes, and authorization requirements.' },
  { path: '/docs/limits', title: 'Usage Limits', description: 'Understand AI usage quotas, API rate limits, and mailbox operational limits.' },
  { path: '/docs/api/calendars', title: 'Calendars API', description: 'Learn how agents and integrations work with coordination calendars and availability.' },
  { path: '/docs/api/calendar-sources', title: 'Calendar Sources API', description: 'Learn how integrations read connected Google Calendars and calendar feeds.' },
  { path: '/docs/api/meetings', title: 'Meetings API', description: 'Learn how agents prepare meeting drafts and work with meeting coordination.' },
  { path: '/docs/api/announcements', title: 'Announcements API', description: 'Learn how agents prepare announcements for message distribution.' },
  { path: '/docs/api/mailbox', title: 'Mailbox API', description: 'Learn about connected Gmail and Outlook accounts, mailbox conversations, drafts, and automation rules.' },
  { path: '/docs/api/discord', title: 'Discord API', description: 'Learn about Coordination Manager Discord integration endpoints.' },
  { path: '/docs/examples', title: 'Agent API Examples', description: 'Explore examples for integrating agents and automation with Coordination Manager.' },
]

export const PUBLIC_PAGES = [...WEB_PAGES, ...DOCS_PAGES]
export const CAPABILITIES = [
  'Plan personal schedules with time management tools.',
  'Share availability and coordinate group meetings.',
  'Discover public events and coordination calendars.',
  'Connect Gmail or Outlook to manage mailbox conversations, invitations, drafts, and reviewed automation rules (sign-in required).',
  'Prepare and distribute messages across connected channels (sign-in and configured integrations required).',
  'Use contextual AI assistance and documented Agent API workflows, subject to access scopes, limits, and human approval requirements.',
  'Connect calendar sources and Discord integrations where configured and authorized.',
  'Configure Discord Guardian moderation tools for communities you manage (authorized access required).',
]

export function normalizeDiscoveryPath(path: string): string {
  return path === '/' ? path : path.replace(/\/+$/, '')
}

export function findDiscoveryPage(path: string): DiscoveryPage | undefined {
  const normalized = normalizeDiscoveryPath(path)
  return PUBLIC_PAGES.find(page => page.path === normalized)
}

export function pageTitle(page: DiscoveryPage): string {
  return page.path === '/' ? SITE_NAME : `${page.title} | ${SITE_NAME}`
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character)
}

export function structuredData(page: DiscoveryPage): string {
  const websiteId = `${SITE_ORIGIN}/#website`
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': websiteId, name: SITE_NAME, url: `${SITE_ORIGIN}/`, description: SITE_DESCRIPTION, inLanguage: 'en' },
      { '@type': 'WebPage', '@id': `${SITE_ORIGIN}${page.path}#webpage`, url: `${SITE_ORIGIN}${page.path}`, name: pageTitle(page), description: page.description, isPartOf: { '@id': websiteId } },
      ...(page.path === '/' ? [{
        '@type': 'WebApplication',
        name: SITE_NAME,
        url: `${SITE_ORIGIN}/`,
        description: SITE_DESCRIPTION,
        applicationCategory: 'ProductivityApplication',
        operatingSystem: 'Web browser',
        featureList: CAPABILITIES,
      }] : []),
    ],
  }).replace(/</g, '\\u003c')
}

export function discoveryHead(page?: DiscoveryPage): string {
  const title = escapeHtml(page ? pageTitle(page) : SITE_NAME)
  const description = escapeHtml(page?.description ?? PRIVATE_PAGE_DESCRIPTION)
  const url = page ? `${SITE_ORIGIN}${page.path}` : undefined
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${page ? 'index, follow' : 'noindex, follow'}" />`,
    ...(url ? [`<link rel="canonical" href="${url}" />`] : []),
    '<link rel="alternate" type="text/plain" title="AI and agent guide" href="/llms.txt" />',
    '<link rel="sitemap" type="application/xml" href="/sitemap.xml" />',
    '<meta property="og:type" content="website" />',
    ...(url ? [`<meta property="og:url" content="${url}" />`] : []),
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${SITE_ORIGIN}${SOCIAL_IMAGE_PATH}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${escapeHtml(SITE_TAGLINE)}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${SITE_ORIGIN}${SOCIAL_IMAGE_PATH}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(SITE_TAGLINE)}" />`,
    ...(page ? [`<script id="site-structured-data" type="application/ld+json">${structuredData(page)}</script>`] : []),
  ].join('\n')
}

export function discoveryBody(page: DiscoveryPage): string {
  const links = PUBLIC_PAGES.filter(item => item.path !== page.path)
    .map(item => `<li><a href="${item.path}">${escapeHtml(item.title)}</a></li>`).join('\n')
  const features = CAPABILITIES.map(item => `<li>${escapeHtml(item)}</li>`).join('\n')
  return `<main aria-label="Public site overview">
<h1>${escapeHtml(page.title)}</h1>
<p>${escapeHtml(page.description)}</p>
${page.path === '/' || page.path === '/docs/overview' ? `<h2>Capabilities</h2><ul>${features}</ul>` : ''}
<p>Interactive tools require JavaScript. Account features require sign-in and the appropriate permissions.</p>
<nav aria-label="Public pages and documentation"><h2>Explore Coordination Manager</h2><ul>${links}</ul>
<a href="/llms.txt">AI and agent guide</a></nav>
</main>`
}

export function sitemapXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PUBLIC_PAGES.map(page => `<url><loc>${SITE_ORIGIN}${page.path}</loc></url>`).join('\n')}\n</urlset>\n`
}

export function robotsTxt(): string {
  return `User-agent: *
Allow: /
Disallow: /auth/
Disallow: /join/
Disallow: /calendar$
Disallow: /calendar/
Disallow: /meeting/
Disallow: /mailbox
Disallow: /distribute
Disallow: /announcements
Disallow: /coordinate-events
Disallow: /settings
Disallow: /setup
Disallow: /admin/
Disallow: /user-management
Disallow: /guardian
Disallow: /feedback
Disallow: /ai-feedback
Disallow: /ai-chat

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`
}

export function llmsTxt(): string {
  return `# ${SITE_NAME}

> ${SITE_TAGLINE}

Coordination Manager is a web platform for personal planning, shared availability, meeting coordination, conversations, and community workflows.

## Implemented capabilities

${CAPABILITIES.map(item => `- ${item}`).join('\n')}

## Public navigation and documentation

${PUBLIC_PAGES.map(page => `- [${page.title}](${SITE_ORIGIN}${page.path}): ${page.description}`).join('\n')}

## Agent usage and boundaries

- Start with the getting-started, authentication, limits, and API reference pages above. Use the documented API rather than scraping account interfaces.
- Agent API keys and scopes determine access. Human approval requirements apply to executive actions; do not assume autonomous sending or unrestricted access.
- Mailbox, distribution, connected calendar sources, and Discord workflows require authentication, permissions, and configured integrations.
- Calendar hashes and invitation links are not authorization. Do not enumerate or publish private calendar, meeting, invitation, mailbox, or account URLs.
- Public discovery HTML contains product descriptions and navigation, not live calendar or mailbox records. Use authorized API requests for current data.
- Draft proposals are not implemented capabilities. Do not present them as available features.
- Robots directives and this guide are discovery guidance, not permission grants or security controls.

## Discovery resources

- [Sitemap](${SITE_ORIGIN}/sitemap.xml)
- [Crawler guidance](${SITE_ORIGIN}/robots.txt)
- [Open-source code](https://github.com/whitevo/Coordination-Manager-Public-Clean)
`
}
