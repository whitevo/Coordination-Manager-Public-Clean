import { Callout } from '../components/Callout'
import { Link } from 'react-router-dom'

export function LimitsPage() {
  return (
    <div className="prose-docs">
      <h1>Limits</h1>
      <p className="text-lg text-gray-400 mb-8">
        Coordination Manager is open-source, so the limits applied to accounts are documented
        here rather than left as a surprise. Limits exist to keep the service usable for everyone
        and to bound the cost of AI/provider calls made on your behalf -- not to restrict what you
        can build. If you self-host, every limit below is a value in the source you can change.
      </p>

      <Callout variant="info" title="Why these exist">
        Most limits below are per-user daily quotas (AI assistant usage) or per-socket-address
        rate limits (API request bursts). Rate limits use the raw TCP socket address rather than
        client-supplied headers, so they cannot be bypassed by spoofing an <code>X-Forwarded-For</code> header.
      </Callout>

      <h2>AI Assistant Daily Limits</h2>
      <p>
        Every AI-assisted feature (compose help, calendar/availability suggestions, mailbox
        automation, announcements) draws from a per-user <strong>daily</strong> prompt budget that
        resets at midnight UTC. Budgets are tracked per account tier and per feature category, so
        heavy use of one AI feature never crowds out your quota for another.
      </p>

      <table>
        <thead>
          <tr>
            <th>Account type</th>
            <th>Chat / assistant prompts per day</th>
            <th>Mailbox email assessments per day</th>
            <th>Mailbox AI drafts per day</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Traveler (guest, no account)</td><td>2</td><td>20</td><td>5</td></tr>
          <tr><td>Verified (signed in)</td><td>10</td><td>300</td><td>50</td></tr>
          <tr><td>Admin</td><td>200</td><td>3,000</td><td>500</td></tr>
        </tbody>
      </table>

      <p>
        <strong>Why mailbox assessments get a much larger budget:</strong> the interactive chat
        limit exists to bound direct, user-typed prompts to the AI. Mailbox "Assessment Check"
        automation is different -- it is a feature you configure once (a context + intent per
        rule), and it then runs a small, cheap, structured scoring call per matching email. Since
        that usage is bounded by your own mailbox volume and rule design rather than open-ended
        chat, it gets a much larger daily allowance so automation rules keep working across a busy
        inbox instead of running out early in the day.
      </p>

      <Callout variant="warning" title="Per-run assessment cap">
        Independent of the daily budget, a single automation run (previewing or executing rules)
        evaluates at most <strong>25 AI assessment calls</strong> before it stops scoring further
        messages in that run. This bounds the cost and latency of any one click, regardless of how
        much daily budget remains.
      </Callout>

      <p>
        <strong>Mailbox AI drafts</strong> cover two features: the automation "Prompt internal AI
        assistant" action (which drafts a reply and saves it to your Drafts for review -- it never
        sends anything) and the manual "AI: Suggest reply" button in the compose panel. These calls
        generate full reply text rather than a single score, so the budget sits between chat and
        mailbox assessments. A single automation run also caps at <strong>15 AI draft calls</strong>,
        independent of the daily budget above.
      </p>

      <h2>API Rate Limits</h2>
      <p>
        On top of daily AI quotas, the API applies request-rate limits per feature area. These
        protect shared infrastructure (the database, outbound email/Discord/Zoom calls, and
        upstream AI providers) from being overwhelmed by any single client. All windows are rolling
        15-minute windows unless noted otherwise.
      </p>

      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>Limit</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Global (every request)</td><td>1,200 requests / 15 min</td></tr>
          <tr><td>Authentication (login, wallet, logout, account)</td><td>120 requests / 15 min</td></tr>
          <tr><td>AI chat / assistant endpoints</td><td>480 requests / 15 min</td></tr>
          <tr><td>Mailbox (general read/write)</td><td>600 requests / 15 min</td></tr>
          <tr><td>Mailbox account import / sync</td><td>20 requests / 15 min</td></tr>
          <tr><td>Mailbox send (drafts)</td><td>40 requests / 15 min</td></tr>
          <tr><td>Mailbox automation run / bulk action</td><td>60 requests / 15 min</td></tr>
          <tr><td>Mailbox AI draft suggestion (compose panel)</td><td>30 requests / 15 min</td></tr>
          <tr><td>Announcements send</td><td>80 requests / 15 min</td></tr>
          <tr><td>Discord key generation</td><td>20 requests / hour</td></tr>
          <tr><td>Discord channel lookups</td><td>60 requests / 15 min</td></tr>
          <tr><td>Zoom meeting creation</td><td>20 requests / 15 min</td></tr>
          <tr><td>Time management endpoints</td><td>240 requests / 15 min</td></tr>
          <tr><td>Connection invite generation</td><td>20 requests / hour</td></tr>
          <tr><td>Feedback submission</td><td>240 requests / 15 min</td></tr>
        </tbody>
      </table>

      <p>
        These numbers are set in <code>Code/apps/api/src/config/rate-limiters.ts</code> and are
        deliberately generous relative to normal interactive use (they are sized around real
        multi-tab usage, not a single click), so you should only ever see a 429 response if
        something is misbehaving or automating requests faster than a person would.
      </p>

      <h2>Mailbox Feature Limits</h2>
      <p>
        The mailbox feature applies a few additional structural limits, independent of AI usage
        and request rate:
      </p>

      <table>
        <thead>
          <tr>
            <th>Limit</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Automation rules per user</td><td>50</td></tr>
          <tr><td>Messages evaluated per automation run</td><td>500</td></tr>
          <tr><td>AI assessment calls per automation run</td><td>25</td></tr>
          <tr><td>AI draft calls per automation run</td><td>15</td></tr>
          <tr><td>Automation cascade passes (chained "receive action" rules)</td><td>5</td></tr>
          <tr><td>Bulk-action steps per mass-action request</td><td>20</td></tr>
          <tr><td>Messages returned per inbox page request</td><td>1,000</td></tr>
          <tr><td>Attachment download size</td><td>25 MB</td></tr>
        </tbody>
      </table>

      <Callout variant="info" title="These are safety rails, not product ceilings">
        None of the mailbox limits above are meant to cap how useful automation can be day to day
        -- they exist so one rule (or one run) cannot accidentally loop, runaway-score an entire
        mailbox in a single request, or download something unbounded. If you find a limit that
        gets in the way of a legitimate workflow, write feedback,  request support or create a pull request.
      </Callout>

      <p>
        See <Link to="/architecture">Architecture</Link> for how rate limiting fits into the rest
        of the request pipeline, or <Link to="/authentication">Authentication</Link> for API key
        scopes if you are integrating as an agent.
      </p>
    </div>
  )
}
