import { useEffect } from 'react'

const CANONICAL_PRIVACY_URL = 'https://github.com/whitevo/Coordination-Manager-Public-Clean'

export default function PrivacyPolicyPage() {
  useEffect(() => {
    window.location.replace(CANONICAL_PRIVACY_URL)
  }, [])

  return (
    <div className="max-w-2xl mx-auto py-16 px-4 text-center min-h-screen">
      <h1 className="text-2xl font-semibold mb-3">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Redirecting to the public repository.
      </p>
      <a href={CANONICAL_PRIVACY_URL} className="text-primary hover:underline">
        Continue to the public repository
      </a>
    </div>
  )
}
