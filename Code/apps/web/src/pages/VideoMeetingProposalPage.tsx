import { Link } from 'react-router-dom'

export default function VideoMeetingProposalPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-4 bg-background text-foreground min-h-screen">
      <div className="mb-8">
        <Link to="/settings" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          &larr; Back to Settings
        </Link>
      </div>

      <article className="prose prose-gray max-w-none">
        <h1 className="text-3xl font-bold mb-2">Proposal: Video Meeting + Modular Recording Toolkit</h1>
        <p className="text-sm text-muted-foreground mb-2">
          Status: Draft &middot; pending community approval &middot; Author: Whitey
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          Let groups meet and record directly inside Coordination Manager, without bouncing to Zoom or Google Meet.
        </p>

        <hr className="my-6" />

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">1. Motivation</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Coordination Manager already helps groups find a time to meet. The natural next step is to let them
            actually meet -- inside the platform -- and to record those meetings for later reference. The same
            recording primitives are reusable across the portfolio: solo tutorial recordings, a "record your screen"
            feedback widget, and async meeting follow-ups attached to a calendar slot.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">2. Two deliverables, shared plumbing</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li><strong>Primary -- Video Meeting</strong> built on self-hosted Jitsi Meet + Jibri (server-side recording).</li>
            <li><strong>Secondary -- In-app Screen Recorder</strong> built on getDisplayMedia + MediaRecorder, packaged for reuse in any app.</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mt-3">
            They ship as pnpm-workspace packages (<code>@coord/video-meeting</code>, <code>@coord/screen-recorder</code>)
            sharing a common <code>@coord/recordings-shared</code> for upload helpers, Supabase types, and storage layout.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">3. Why Jitsi</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Mature open source, no per-minute fees, full data control.</li>
            <li>Official React SDK exposes a meeting component plus an event/command API.</li>
            <li>Jibri provides battle-tested server-side recording (headless Chrome + ffmpeg).</li>
            <li>JWT "secure domain" auth integrates cleanly with our Supabase-issued identity.</li>
          </ul>
          <p className="text-sm text-muted-foreground leading-relaxed mt-3">
            Limitations to flag: each Jibri instance records one meeting at a time (horizontal scaling needed for
            concurrent recordings), and Jibri runs on its own VM with non-trivial CPU/disk needs.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">4. Recording tiers (all optional)</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li><strong>Server (Jibri)</strong> -- default for scheduled multi-party meetings; the source of truth.</li>
            <li><strong>Cloud</strong> -- a watcher uploads finished recordings to Supabase Storage with a metadata row.</li>
            <li><strong>Local (browser MediaRecorder)</strong> -- optional fallback that degrades gracefully if it fails.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">5. Security and privacy</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>JWT minted only after Supabase session verification; short-lived (slot duration + grace).</li>
            <li>Recording requires explicit host action and a consent banner shown to all participants.</li>
            <li>Storage RLS: participants read only recordings for meetings they were invited to.</li>
            <li>No raw UUIDs in shareable URLs -- nanoid hashes, consistent with calendar URLs.</li>
            <li>Default 90-day retention (configurable) and a "delete my recording" endpoint.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">6. Estimated cost</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li><strong>Infrastructure:</strong> ~$15-40 / mo for 2 small VPS while in beta.</li>
            <li><strong>Agent dev:</strong> a few hundred USD of tokens spread across phases.</li>
            <li><strong>Human time:</strong> ~1-2 weeks calendar time (mostly review + Phase 0 DevOps).</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">7. Decision requested</h2>
          <ul className="text-sm text-muted-foreground mt-2 list-disc list-inside space-y-1">
            <li>Approve as written (Video Meeting + Screen Recorder).</li>
            <li>Approve only the primary Video Meeting deliverable for now.</li>
            <li>Approve only the secondary Screen Recorder deliverable for now.</li>
            <li>Defer / request changes.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-3">Feedback</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Have thoughts on this proposal? Share them via the{' '}
            <Link to="/feedback" className="text-primary hover:underline">feedback page</Link> or email{' '}
            <a href="mailto:hello@coordinationmanager.com" className="text-primary hover:underline">hello@coordinationmanager.com</a>.
          </p>
        </section>
      </article>
    </div>
  )
}
