import { useEffect } from 'react'

const CANONICAL_TRADEMARK_URL = '/docs/legal/trademark-policy'

export default function TrademarkPolicyPage() {
  useEffect(() => {
    window.location.replace(CANONICAL_TRADEMARK_URL)
  }, [])

  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center min-h-screen">
      <h1 className="text-2xl font-semibold mb-3">Trademark Policy</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Redirecting to the canonical trademark policy source.
      </p>
      <a href={CANONICAL_TRADEMARK_URL} className="text-primary hover:underline">
        Continue to /docs/legal/trademark-policy
      </a>
    </div>
  )
}
