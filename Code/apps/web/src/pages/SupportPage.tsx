import { Link } from 'react-router-dom'
import { Clock, Mail, MessageSquare, BookOpen, Headphones, LifeBuoy, ExternalLink, Shield, AlertCircle } from 'lucide-react'

export default function SupportPage() {
  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-info-subtle mb-4">
          <LifeBuoy className="w-7 h-7 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Support Center</h1>
        <p className="text-muted-foreground text-lg">
          We're here to help. Find the support you need below.
        </p>
      </div>

      {/* Hours & SLA */}
      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <Clock className="w-5 h-5 text-info" />
            <h2 className="font-semibold text-base">Hours of Operation</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Daily: 9:00 AM - 6:00 PM (UTC)
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Including weekends
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3 mb-3">
            <AlertCircle className="w-5 h-5 text-warning" />
            <h2 className="font-semibold text-base">First Response SLA</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We aim to respond to all support requests within <strong className="text-foreground">48 hours</strong>.
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Critical issues are prioritized for faster response.
          </p>
        </div>
      </div>

      {/* Support Channels */}
      <h2 className="text-xl font-semibold mb-4">Contact Support</h2>
      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        {/* Create a Support Case */}
        <Link
          to="/feedback?tab=support"
          className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 hover:border-info-muted hover:shadow-md transition-all"
        >
          <div className="shrink-0 w-10 h-10 rounded-lg bg-info-subtle flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-medium text-sm group-hover:text-info transition-colors">
              Create a Support Case
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Submit a detailed support request and track its progress.
            </p>
          </div>
        </Link>

        {/* Email Support */}
        <a
          href="mailto:support@coordinationmanager.com"
          className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 hover:border-success-muted hover:shadow-md transition-all"
        >
          <div className="shrink-0 w-10 h-10 rounded-lg bg-success-subtle flex items-center justify-center">
            <Mail className="w-5 h-5 text-success" />
          </div>
          <div>
            <h3 className="font-medium text-sm group-hover:text-success transition-colors">
              Email Support
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              support@coordinationmanager.com
            </p>
          </div>
        </a>

        {/* Knowledge Base / Docs */}
        <a
          href="https://coordinationmanager.com/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 hover:border-feature-support-muted hover:shadow-md transition-all"
        >
          <div className="shrink-0 w-10 h-10 rounded-lg bg-feature-support-subtle flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-feature-support" />
          </div>
          <div>
            <h3 className="font-medium text-sm group-hover:text-feature-support transition-colors flex items-center gap-1">
              Knowledge Base
              <ExternalLink className="w-3 h-3" />
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Browse guides, FAQs, and documentation.
            </p>
          </div>
        </a>

        {/* Live Support (Discord) */}
        <a
          href="https://discord.gg/8ywJuK7ruY"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 hover:border-feature-chat-muted hover:shadow-md transition-all"
        >
          <div className="shrink-0 w-10 h-10 rounded-lg bg-feature-chat-subtle flex items-center justify-center">
            <Headphones className="w-5 h-5 text-feature-chat" />
          </div>
          <div>
            <h3 className="font-medium text-sm group-hover:text-feature-chat transition-colors flex items-center gap-1">
              Live Community Support
              <ExternalLink className="w-3 h-3" />
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Join the Catalyst Swarm Discord for real-time assistance from the community.
            </p>
          </div>
        </a>
      </div>

      {/* Additional Info */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-3">
          <Shield className="w-5 h-5 text-muted-foreground" />
          <h2 className="font-semibold text-base">Security & Privacy</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          For security vulnerabilities or privacy concerns, please contact us directly at{' '}
          <a
            href="mailto:security@coordinationmanager.com"
            className="text-primary hover:underline"
          >
            security@coordinationmanager.com
          </a>.
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link to="/privacy" className="text-primary hover:underline">
            Privacy Policy
          </Link>
          <Link to="/terms" className="text-primary hover:underline">
            Terms of Service
          </Link>
        </div>
      </div>
    </div>
  )
}
