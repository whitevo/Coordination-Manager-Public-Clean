import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import fallbackLicenseText from '../../../../../LICENSE?raw'

const LICENSE_SOURCE_URL = 'https://github.com/whitevo/Coordination-Manager-Public-Clean/blob/main/LICENSE'
const LICENSE_RAW_URL = 'https://raw.githubusercontent.com/whitevo/Coordination-Manager-Public-Clean/main/LICENSE'
const PRIVATE_REPO_URL = 'https://github.com/whitevo/Coordination-Manager'
const PUBLIC_REPO_URL = 'https://github.com/whitevo/Coordination-Manager-Public-Clean'
const LEGAL_FILE_REDIRECTS: Record<string, string> = {
  'privacy_policy.md': '/legal/privacy-policy',
  'terms_of_service.md': '/legal/terms-of-service',
  'security.md': '/legal/security-policy',
  'trademarks.md': '/legal/trademark-policy',
  'cla.md': '/legal/cla',
  'code_of_conduct.md': '/legal/code-of-conduct',
  'license': '/legal/license',
  'license.md': '/legal/license',
  'ui_state_reconciliation.md': '/guides/ui-state-reconciliation',
  'testing_guide.md': '/guides/testing',
  'mailbox_architecture.md': '/guides/mailbox-architecture',
}

function isInternalLicenseHref(href: string): boolean {
  const normalized = href.toLowerCase()
  return (
    normalized === '/legal/license' ||
    normalized === '/docs/legal/license' ||
    normalized.endsWith('/legal/license')
  )
}

function mapKnownMarkdownLink(href: string): string {
  const normalized = href.trim().toLowerCase()
  const withoutPrefix = normalized.replace(/^\.\//, '')
  return LEGAL_FILE_REDIRECTS[withoutPrefix] ?? href
}

function shouldUsePrivateRepositoryLinks(): boolean {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
}

function mapRepositoryLinkForEnvironment(href: string): string {
  const repoPattern = /^https:\/\/github\.com\/whitevo\/(Coordination-Manager|Coordination-Manager-Public-Clean)(\/.*)?$/
  const match = href.match(repoPattern)
  if (!match) return href

  const suffix = match[2] ?? ''
  const targetRepo = shouldUsePrivateRepositoryLinks() ? PRIVATE_REPO_URL : PUBLIC_REPO_URL
  return `${targetRepo}${suffix}`
}

function withDocsBase(href: string): string {
  if (!href.startsWith('/')) return href
  if (href.startsWith('/docs')) return href
  return `/docs${href}`
}

function resolveMarkdownHref(href: string): string {
  const mapped = mapRepositoryLinkForEnvironment(mapKnownMarkdownLink(href))
  return mapped.startsWith('/') ? withDocsBase(mapped) : mapped
}

interface MarkdownDocumentPageProps {
  markdown: string
}

export function MarkdownDocumentPage({ markdown }: MarkdownDocumentPageProps) {
  const [licenseModalOpen, setLicenseModalOpen] = useState(false)
  const [licenseSourceUrl, setLicenseSourceUrl] = useState<string | null>(null)
  const [licenseText, setLicenseText] = useState('')
  const [licenseLoading, setLicenseLoading] = useState(false)
  const [licenseError, setLicenseError] = useState<string | null>(null)

  const rawLicenseUrl = useMemo(() => {
    if (!licenseSourceUrl) return null

    if (isInternalLicenseHref(licenseSourceUrl)) {
      return LICENSE_RAW_URL
    }

    const blobMatch = licenseSourceUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
    if (blobMatch) {
      const [, owner, repo, branch, path] = blobMatch
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
    }

    return licenseSourceUrl
  }, [licenseSourceUrl])

  useEffect(() => {
    if (!licenseModalOpen || !rawLicenseUrl) return
    const url = rawLicenseUrl

    let cancelled = false

    async function loadLicenseText() {
      setLicenseLoading(true)
      setLicenseError(null)

      try {
        let response = await fetch(url)

        // Some repositories still use master as the default branch.
        if (!response.ok && url.includes('/main/')) {
          response = await fetch(url.replace('/main/', '/master/'))
        }

        if (!response.ok) {
          throw new Error(`Unable to load license text (${response.status})`)
        }

        const text = await response.text()
        if (!cancelled) {
          setLicenseText(text)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Unable to load license text.'
          setLicenseError(fallbackLicenseText ? null : message)
        }
      } finally {
        if (!cancelled) {
          setLicenseLoading(false)
        }
      }
    }

    void loadLicenseText()

    return () => {
      cancelled = true
    }
  }, [licenseModalOpen, rawLicenseUrl])

  useEffect(() => {
    if (!licenseModalOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setLicenseModalOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [licenseModalOpen])

  function openLicenseModal(href: string) {
    const sourceUrl = isInternalLicenseHref(href) ? LICENSE_SOURCE_URL : href
    setLicenseSourceUrl(sourceUrl)
    setLicenseText(fallbackLicenseText)
    setLicenseError(null)
    setLicenseModalOpen(true)
  }

  return (
    <div className="prose-docs">
      <article className="prose prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              const isHrefString = typeof href === 'string'
              const resolvedHref = isHrefString ? resolveMarkdownHref(href) : href
              const isInternal = typeof resolvedHref === 'string' && resolvedHref.startsWith('/')
              const isLicenseLink =
                isHrefString &&
                (String(resolvedHref).toLowerCase().includes('/license') || String(children).toLowerCase().trim() === 'license')

              if (isLicenseLink && isHrefString) {
                return (
                  <button
                    type="button"
                    onClick={() => openLicenseModal(String(resolvedHref))}
                    className="text-brand-300 hover:text-brand-200 underline underline-offset-4"
                  >
                    {children}
                  </button>
                )
              }

              if (isInternal) {
                return (
                  <a href={String(resolvedHref)} className="text-brand-300 hover:text-brand-200 underline underline-offset-4">
                    {children}
                  </a>
                )
              }

              return (
                <a
                  href={resolvedHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-300 hover:text-brand-200 underline underline-offset-4"
                >
                  {children}
                </a>
              )
            },
          }}
        >
          {markdown}
        </ReactMarkdown>
      </article>

      {licenseModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center px-4"
          onClick={() => setLicenseModalOpen(false)}
        >
          <div
            className="w-full max-w-3xl bg-surface-900 border border-surface-700 rounded-xl shadow-2xl overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-surface-700">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">License</h2>
                {licenseSourceUrl && (
                  <a
                    href={licenseSourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-brand-300 hover:text-brand-200 underline underline-offset-4"
                  >
                    View source on GitHub
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLicenseModalOpen(false)}
                className="text-gray-400 hover:text-gray-200 transition-colors"
                aria-label="Close license modal"
              >
                Close
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              {licenseLoading ? (
                <p className="text-sm text-gray-300">Loading license text...</p>
              ) : licenseError ? (
                <div className="space-y-2">
                  <p className="text-sm text-red-300">{licenseError}</p>
                  {licenseSourceUrl && (
                    <p className="text-sm text-gray-300">
                      You can still read the license directly from the source link above.
                    </p>
                  )}
                </div>
              ) : (
                <pre className="text-xs leading-6 text-gray-200 whitespace-pre-wrap">{licenseText}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
