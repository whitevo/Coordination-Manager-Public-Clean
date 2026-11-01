import { useEffect } from 'react'

const CANONICAL_TERMS_URL = '/docs/legal/terms-of-service'

export default function TermsOfServicePage() {
  useEffect(() => {
    window.location.replace(CANONICAL_TERMS_URL)
  }, [])

  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center min-h-screen">
      <h1 className="text-2xl font-semibold mb-3">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Redirecting to the canonical terms source.
      </p>
      <a href={CANONICAL_TERMS_URL} className="text-primary hover:underline">
        Continue to /docs/legal/terms-of-service
      </a>
    </div>
  )
}
