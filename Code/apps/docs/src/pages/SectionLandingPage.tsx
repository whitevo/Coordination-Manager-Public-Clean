import { Link, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { sectionLandingPages, type SectionId } from '../docs-content'

const DEFAULT_SECTION: SectionId = 'general'

function isSectionId(value: string | undefined): value is SectionId {
  return value === 'general' || value === 'api' || value === 'guides' || value === 'legal' || value === 'proposals'
}

export function SectionLandingPage() {
  const { sectionId } = useParams()
  const key = isSectionId(sectionId) ? sectionId : DEFAULT_SECTION
  const section = sectionLandingPages[key]

  return (
    <div className="prose-docs">
      <div className="flex items-center justify-between gap-4 mb-6 not-prose">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-400 font-semibold mb-2">{section.eyebrow}</p>
          <h1 className="mb-3">{section.title}</h1>
          <p className="text-lg text-gray-400 max-w-3xl">{section.summary}</p>
        </div>
        <Link
          to="/overview"
          className="hidden md:inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-700 text-sm text-gray-300 hover:text-white hover:border-brand-600/50 transition-colors"
        >
          Back to overview
          <ArrowRight className="w-4 h-4 rotate-180" />
        </Link>
      </div>

      <div className="space-y-4 not-prose">
        <p className="text-sm text-gray-400 leading-6">{section.intro}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {section.links.map((item) => {
            const Icon = item.icon

            return (
              <Link
                key={item.path}
                to={item.path}
                className="group border border-surface-700 rounded-xl p-4 bg-surface-800/40 hover:border-brand-600/50 hover:bg-surface-800/70 transition-all"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-brand-400"><Icon className="w-4 h-4" /></span>
                  <h3 className="text-sm font-semibold text-gray-100 group-hover:text-white">{item.label}</h3>
                </div>
                <p className="text-xs text-gray-400 leading-5">{item.description}</p>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
