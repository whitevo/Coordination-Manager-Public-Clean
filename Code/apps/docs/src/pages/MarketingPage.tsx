import { ExternalLink } from 'lucide-react'

interface ProductListing {
  site: string
  url: string
  status: string
  lastReviewed: string
  notes: string
}

const productListings: ProductListing[] = [
  {
    site: 'SaaSHub',
    url: 'https://www.saashub.com/coordination-manager',
    status: 'Listed',
    lastReviewed: 'Not recorded',
    notes: 'Review the listing periodically to keep product information current.',
  },
]

export function MarketingPage() {
  return (
    <div className="prose-docs">
      <p className="text-xs uppercase tracking-[0.2em] text-brand-400 font-semibold mb-2 not-prose">
        Product visibility
      </p>
      <h1>Product Directory Listings</h1>
      <p>
        A record of external product pages where Coordination Manager is listed.
        Check these pages periodically and update the records as listings change.
      </p>

      <div className="not-prose space-y-4">
        {productListings.map((listing) => (
          <article
            key={listing.site}
            className="rounded-xl border border-surface-700 bg-surface-800/40 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-100">{listing.site}</h2>
                <p className="mt-1 text-sm text-gray-400">{listing.notes}</p>
              </div>
              <span className="rounded-full border border-brand-500/30 bg-brand-600/10 px-3 py-1 text-xs font-medium text-brand-300">
                {listing.status}
              </span>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Last reviewed</dt>
                <dd className="mt-1 text-gray-300">{listing.lastReviewed}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-gray-500">Listing</dt>
                <dd className="mt-1">
                  <a
                    href={listing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-brand-300 hover:text-brand-200"
                  >
                    View {listing.site} page
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <p className="mt-6 text-sm text-gray-500">
        To track another product page, add it to the listings on this page.
      </p>
    </div>
  )
}
