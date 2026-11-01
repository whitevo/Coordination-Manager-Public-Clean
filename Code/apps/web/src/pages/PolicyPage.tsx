import { Link } from 'react-router-dom'

export default function PolicyPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-4 bg-background text-foreground min-h-screen">
      <div className="mb-8">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Home
        </Link>
      </div>

      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold mb-2">Policy Information</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Effective Date: February 7, 2026 &middot; Last Updated: June 7, 2026
        </p>

        <hr className="my-6" />

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Scope</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This page summarizes platform policy commitments for the hosted Coordination Manager service.
            It covers data handling principles, security posture, and legal references for users and administrators.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Core Principles</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Data minimization and purpose-limited processing for scheduling workflows.</li>
            <li>No sale of personal data and no advertising tracker integrations.</li>
            <li>Open-source transparency for public components and policy revision history.</li>
            <li>Account deletion controls for user-managed data removal.</li>
            <li>Abuse-prevention controls, including rate limits and captcha where appropriate.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Authoritative Policy Documents</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            These documents are the definitive legal sources for policy terms:
          </p>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>
              <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
            </li>
            <li>
              <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link>
            </li>
            <li>
              <Link to="/email-abuse" className="text-primary hover:underline">Email Abuse Policy</Link>
            </li>
            <li>
              <Link to="/trademark" className="text-primary hover:underline">Trademark Policy</Link>
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Contact</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            For policy questions: <a href="mailto:privacy@coordinationmanager.com" className="text-primary hover:underline">privacy@coordinationmanager.com</a>
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mt-2">
            For legal/trademark inquiries: <a href="mailto:legal@coordinationmanager.com" className="text-primary hover:underline">legal@coordinationmanager.com</a>
          </p>
        </section>
      </article>
    </div>
  )
}
