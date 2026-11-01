import { Link } from 'react-router-dom'

export default function DataPrivacyProposalPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-4 bg-background text-foreground min-h-screen">
      <div className="mb-8">
        <Link to="/settings" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Settings
        </Link>
      </div>

      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold mb-2">Proposal: User Data Privacy + At-Rest Encryption</h1>
        <p className="text-sm text-muted-foreground mb-2">
          Status: Draft &middot; pending community / sponsor feedback &middot; Author: Whitey
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          Move toward "we cannot read your private scheduling data" -- and be honest about the cost and the
          speed trade-offs of getting there.
        </p>

        <hr className="my-6" />

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">1. Where we are today</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            Almost everything you type into Coordination Manager is stored as readable plaintext in our database.
            Data is encrypted in transit (HTTPS) and access is constrained by Row Level Security, but at rest the
            operator -- anyone with database access, a backup, or a read replica -- can read it. This includes
            calendar titles, availability, meeting details, profile fields, events, and feedback.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The only content we genuinely cannot read is your managed-wallet private key (encrypted in your browser
            with a device-local key). This is normal for most products, but "we cannot read your data" is a real
            trust and privacy selling point -- especially for a self-sovereignty-minded community.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">2. The core trade-off</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The more we encrypt so the operator cannot read it, the less the server can do with the data -- no
            server-side search, no overlap computation on ciphertext, and slower reads because every field must be
            decrypted first. The less we encrypt, the faster and more featureful the product stays, but the operator
            keeps read access. This is a spectrum, not a single switch.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">3. Three tiers</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-2">
            <li>
              <strong>Tier 1 -- Operator-held envelope encryption.</strong> Encrypt sensitive columns in the API
              before writing, with a master key in a Key Management Service (KMS). Protects against leaked dumps,
              stolen backups, and a compromised replica. Features and speed mostly preserved. The live server still
              holds the keys.
            </li>
            <li>
              <strong>Tier 2 -- Database-native (pgcrypto).</strong> Similar protection but crypto runs inside
              Postgres; simpler to adopt but breaks indexing, sorting, and search on encrypted columns.
            </li>
            <li>
              <strong>Tier 3 -- End-to-end encryption (zero-knowledge).</strong> Your browser encrypts with a key
              we never see. We genuinely cannot read it. Strongest privacy, biggest cost: no server-side search,
              keys shared out-of-band, lost key means lost data, and harder multi-device / guest flows.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">4. Recommended direction</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Adopt Tier 1 as the baseline on the highest-sensitivity fields first (feedback bodies, profile
            email/display name, meeting descriptions/links), and offer Tier 3 as an opt-in "private calendar" mode
            later -- rather than the default. Tier 1 buys most of the real-world protection at low cost and low UX
            risk; Tier 3 is the premium "we cannot read it" guarantee for users who accept the trade-offs.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">5. New components and maintenance cost</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            These are components we would start paying to run and maintain. Estimates are monthly and
            order-of-magnitude.
          </p>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Managed KMS (AWS / GCP): ~$1 per key + ~$0.03 / 10k requests, roughly $5-25/mo with data-key caching.</li>
            <li>Self-hosted Vault (alternative): ~$10-20/mo VPS, more maintenance (patching, backups, unseal keys).</li>
            <li>Key-management / key-exchange service (Tier 3): shares the API host; high security ownership.</li>
            <li>Encrypted backups / point-in-time recovery upgrade: ~$0-25/mo.</li>
            <li>Monitoring + audit log sink for every decrypt: ~$0-10/mo.</li>
            <li>Re-encryption / key-rotation jobs: compute only, but must be idempotent and safe.</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mt-3">
            <strong>Indicative totals:</strong> Tier 1 baseline ~$10-50/mo fixed plus modest agent dev cost and
            ~1 week of human review/DevOps. Tier 3 adds materially more ongoing engineering maintenance (key sharing,
            recovery, multi-device, re-encryption) -- the real cost is security ownership, not the hosting bill.
            There is also a hidden operational cost: encryption makes support and debugging harder, because we can no
            longer just look at a row to help you.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">6. Speed and experience concern</h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            This is the trade-off we want everyone to understand. Coordination Manager often loads many data points
            at once -- a calendar grid can render hundreds of availability cells, event views list many records, and
            overlap detection compares everyone's availability together. If those fields are encrypted, every one of
            them must be decrypted before it can be shown or compared.
          </p>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Slower loads on data-heavy views -- some pages may take a while before the information is available, especially large shared calendars.</li>
            <li>Loss of database-side work -- encrypted columns cannot be indexed, sorted, or searched by Postgres, so that work moves into slower application code.</li>
            <li>Batch decryption pressure -- we must use envelope encryption with cached data keys, not a key-service call per field, or both cost and latency explode.</li>
            <li>Tier 3 is heavier -- decryption happens on your device, so a low-powered device opening a big calendar can feel sluggish.</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mt-3">
            <strong>Mitigations we would build in:</strong> envelope encryption with an in-process data-key cache;
            lazy / paginated decryption (only the visible window of a calendar); keeping non-sensitive fields
            (timestamps, IDs, status) in plaintext so sorting and pagination still work; per-request caching; and
            progressive rendering so the page fills in instead of blocking. Even so, the most private configuration
            will also be the slowest -- some content-heavy pages will trade a little speed for privacy.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">7. Open questions for the community and sponsors</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Is "the operator cannot read your data" worth a slower experience on large calendars? Default-on or opt-in?</li>
            <li>Managed cloud KMS (simplest, ~$5-25/mo) vs. self-hosted Vault (more control, more maintenance)?</li>
            <li>Which fields are sensitive enough to encrypt first, and which stay plaintext for speed?</li>
            <li>For E2EE, do we accept "lost key = lost data", with an optional user-managed key backup?</li>
            <li>Free baseline (Tier 1 for everyone) plus a premium private tier (Tier 3), or one model for all?</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">8. Decision requested</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Approve Tier 1 (operator-held envelope encryption) as the baseline.</li>
            <li>Approve Tier 1 now and scope Tier 3 (E2EE opt-in) for a later phase.</li>
            <li>Approve only a scoped pilot (encrypt feedback + profile email first).</li>
            <li>Defer / request changes.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Feedback</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Have thoughts on this proposal? Share them via the{' '}
            <Link to="/feedback" className="text-primary hover:underline">feedback page</Link> or email{' '}
            <a href="mailto:privacy@coordinationmanager.com" className="text-primary hover:underline">privacy@coordinationmanager.com</a>.
          </p>
        </section>
      </article>
    </div>
  )
}
