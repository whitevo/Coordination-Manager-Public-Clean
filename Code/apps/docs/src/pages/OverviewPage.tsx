import { useRef, useState } from 'react'
import type { FocusEvent, MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ShieldCheck, Scale, Shield, FileText } from 'lucide-react'
import { Callout } from '../components/Callout'
import { overviewCapabilities, sectionNavigation } from '../docs-content'

type OverlaySide = 'left' | 'right'

interface HoverPreviewState {
  src: string
  alt: string
  top: number
  left: number
  right: number
  maxHeight: number
  side: OverlaySide
}

export function OverviewPage() {
  const [hoverPreview, setHoverPreview] = useState<HoverPreviewState | null>(null)
  const capabilityGridRef = useRef<HTMLDivElement | null>(null)

  const openAiSearch = () => {
    window.dispatchEvent(new CustomEvent('docs-open-ai-search'))
  }

  const openHoverPreview = (
    event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>,
    image: string,
    alt: string,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const gridRect = capabilityGridRef.current?.getBoundingClientRect()
    if (!gridRect) {
      return
    }

    const gap = 8
    const minPreviewWidth = 220
    const maxTop = 96
    const gridMidpoint = gridRect.left + gridRect.width / 2
    const isLeftColumn = rect.left + rect.width / 2 < gridMidpoint
    const side: OverlaySide = isLeftColumn ? 'left' : 'right'
    const overlayTop = Math.floor(Math.max(maxTop, rect.top))
    const overlayMaxHeight = Math.max(220, Math.floor(window.innerHeight - overlayTop - 12))

    const leftEdge = side === 'left' ? 0 : Math.floor(gridRect.right + gap)
    const rightEdge = side === 'left'
      ? Math.floor(window.innerWidth - gridRect.left + gap)
      : 0

    // If the preferred side is too narrow, fall back to the other side.
    const preferredWidth = window.innerWidth - leftEdge - rightEdge
    const useFallback = preferredWidth < minPreviewWidth
    const finalSide: OverlaySide = useFallback ? (side === 'left' ? 'right' : 'left') : side

    const finalLeft = finalSide === 'left' ? 0 : Math.floor(gridRect.right + gap)
    const finalRight = finalSide === 'left'
      ? Math.floor(window.innerWidth - gridRect.left + gap)
      : 0

    setHoverPreview({
      src: image,
      alt,
      top: overlayTop,
      left: Math.max(0, finalLeft),
      right: Math.max(0, finalRight),
      maxHeight: overlayMaxHeight,
      side: finalSide,
    })
  }

  const closeHoverPreview = () => {
    setHoverPreview(null)
  }

  return (
    <div className="prose-docs">
      <h1>Coordination Manager</h1>
      <p className="text-lg text-gray-400 mb-8">
        An open-source platform for collaborative scheduling, meeting coordination, and
        community announcements -- with an API that AI agents can use to interact with
        the Coordination Manager tool.
      </p>

      <Callout variant="tip" title="Agent API available">
        Coordination Manager provides an Agent API so that AI agents and automation workflows
        can read calendars, submit availability, draft meetings, read Google Calendar events,
        and prepare announcements -- with human-in-the-loop before executive decision-making.
      </Callout>

      <h2>What is Coordination Manager?</h2>
      <p>
        Coordination Manager is a web-based platform designed to streamline event coordination for
        distributed teams and communities. Originally built for the SingularityNET Ambassador Program,
        it automates notifications, integrates with Google Calendar and Discord, and provides an
        accessible interface for event management.
      </p>

      <h2>Key Capabilities</h2>
      <div ref={capabilityGridRef} className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 not-prose">
        {overviewCapabilities.map((capability) => {
          const Icon = capability.icon
          const className = `group border rounded-xl p-4 bg-surface-800/50 hover:bg-surface-800/80 transition-all text-left border-surface-700 ${capability.accentClass}`
          const href = capability.href ?? capability.path ?? '/overview'

          const previewEnterProps = capability.previewImage
            ? {
                onMouseEnter: (event: MouseEvent<HTMLElement>) =>
                  openHoverPreview(
                    event,
                    capability.previewImage as string,
                    capability.previewImageAlt ?? `${capability.title} preview`,
                  ),
                onFocus: (event: FocusEvent<HTMLElement>) =>
                  openHoverPreview(
                    event,
                    capability.previewImage as string,
                    capability.previewImageAlt ?? `${capability.title} preview`,
                  ),
                onMouseLeave: closeHoverPreview,
                onBlur: closeHoverPreview,
              }
            : {
                onMouseLeave: closeHoverPreview,
                onBlur: closeHoverPreview,
              }

          if (capability.action === 'open-ai-search') {
            return (
              <button
                key={capability.title}
                type="button"
                onClick={openAiSearch}
                {...previewEnterProps}
                className={className}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-5 h-5 text-brand-400" />
                  <h3 className="text-sm font-semibold text-gray-100">{capability.title}</h3>
                </div>
                <p className="text-sm text-gray-400">{capability.description}</p>
              </button>
            )
          }

          if (capability.href) {
            return (
              <a
                key={capability.title}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...previewEnterProps}
                className={className}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-5 h-5 text-brand-400" />
                  <h3 className="text-sm font-semibold text-gray-100">{capability.title}</h3>
                </div>
                <p className="text-sm text-gray-400">{capability.description}</p>
              </a>
            )
          }

          return (
            <Link
              key={capability.title}
              to={href}
              {...previewEnterProps}
              className={className}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-5 h-5 text-brand-400" />
                <h3 className="text-sm font-semibold text-gray-100">{capability.title}</h3>
              </div>
              <p className="text-sm text-gray-400">{capability.description}</p>
            </Link>
          )
        })}
      </div>

      {hoverPreview ? (
        <div
          className="pointer-events-none fixed z-[60]"
          style={{
            top: hoverPreview.top,
            left: hoverPreview.left,
            right: hoverPreview.right,
          }}
        >
          <div className="rounded-xl border border-surface-700 bg-surface-900/95 shadow-2xl shadow-black/40 overflow-hidden">
            <img
              src={hoverPreview.src}
              alt={hoverPreview.alt}
              className="block w-full h-auto object-contain bg-surface-900"
              style={{ maxHeight: `${hoverPreview.maxHeight}px` }}
            />
          </div>
        </div>
      ) : null}

      <h2>Browse by category</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8 not-prose">
        {sectionNavigation.map((section) => {
          const Icon = section.icon

          return (
            <Link
              key={section.id}
              to={section.path}
              className="group border border-surface-700 rounded-xl p-4 bg-surface-800/40 hover:border-brand-600/50 hover:bg-surface-800/70 transition-all"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-brand-400"><Icon className="w-4 h-4" /></span>
                <h3 className="text-sm font-semibold text-gray-100 group-hover:text-white">{section.title}</h3>
              </div>
              <p className="text-xs text-gray-400 leading-5">{section.description}</p>
            </Link>
          )
        })}
      </div>

      <h2>Who is this for?</h2>
      <ul>
        <li>
          <strong>Agent developers</strong> -- use the Agent API to read coordination data and
          draft meeting or announcement content from your own agent or workflow.
        </li>
        <li>
          <strong>Community managers</strong> -- coordinate availability across time zones
          and push announcements to Discord channels.
        </li>
        <li>
          <strong>Platform integrators</strong> -- read availability data via REST and build
          custom dashboards or embed calendars in your app.
        </li>
      </ul>

      <h2>Quick Links</h2>
      <div className="flex flex-col gap-2 not-prose">
        {quickLinks.map((link) => (
          <Link
            key={link.path}
            to={link.path}
            className="flex items-center justify-between px-4 py-3 border border-surface-700 rounded-lg hover:border-brand-600/50 hover:bg-surface-800/50 transition-colors group"
          >
            <div>
              <p className="text-sm font-medium text-gray-200 group-hover:text-white">{link.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{link.sublabel}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-brand-400 transition-colors" />
          </Link>
        ))}
      </div>

      <h2>Legal & Governance</h2>
      <p>
        These documents define how the project is governed, how user data is handled,
        and the terms that protect both contributors and operators.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 not-prose">
        {legalLinks.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className="flex items-start justify-between gap-3 px-4 py-3 border border-surface-700 rounded-lg hover:border-brand-600/50 hover:bg-surface-800/50 transition-colors group"
          >
            <div className="flex items-start gap-3">
              <span className="text-brand-400 mt-0.5">{item.icon}</span>
              <div>
                <p className="text-sm font-medium text-gray-200 group-hover:text-white">{item.label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{item.sublabel}</p>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-brand-400 transition-colors mt-0.5" />
          </Link>
        ))}
      </div>
    </div>
  )
}

const quickLinks = [
  { path: '/getting-started', label: 'Getting Started', sublabel: 'Set up your API key and make your first request in 5 minutes' },
  { path: '/api/calendars', label: 'Calendars & Availability', sublabel: 'Create calendars, submit availability, read participants' },
  { path: '/api/calendar-sources', label: 'Calendar Sources', sublabel: 'Read events from integrated Google Calendars (read-only)' },
  { path: '/api/meetings', label: 'Meetings', sublabel: 'Create meeting drafts and list scheduled meetings' },
  { path: '/api/announcements', label: 'Announcements', sublabel: 'Draft announcement templates with optional poll support' },
  { path: '/api/discord', label: 'Discord', sublabel: 'List servers, channels, and DM-eligible members' },
  { path: '/api/feedback', label: 'Feedback', sublabel: 'Submit and list feedback' },
  { path: '/examples', label: 'Code Examples', sublabel: 'Python, cURL, and JavaScript examples for common workflows' },
]

const legalLinks = [
  {
    path: '/legal/privacy-policy',
    label: 'Privacy Policy',
    sublabel: 'What data is collected, why, and how it is protected.',
    icon: <ShieldCheck className="w-4 h-4" />,
  },
  {
    path: '/legal/terms-of-service',
    label: 'Terms of Service',
    sublabel: 'Usage terms, platform boundaries, and responsibilities.',
    icon: <Scale className="w-4 h-4" />,
  },
  {
    path: '/legal/security-policy',
    label: 'Security Policy',
    sublabel: 'Security reporting process and vulnerability handling.',
    icon: <Shield className="w-4 h-4" />,
  },
  {
    path: '/legal/code-of-conduct',
    label: 'Code of Conduct',
    sublabel: 'Community standards for contributors and participants.',
    icon: <FileText className="w-4 h-4" />,
  },
]
