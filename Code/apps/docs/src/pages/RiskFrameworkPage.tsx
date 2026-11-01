import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Callout } from '../components/Callout'
import { classificationProfile } from '../risk/register-data'

export function RiskFrameworkPage() {
  return (
    <div className="prose-docs">
      <h1>AI Risk Framework</h1>
      <p className="text-lg text-gray-400 mb-8">
        How Coordination Manager assesses the ethicality and risk of its AI-assisted features,
        using a deliberately small subset of the AISSAE framework.
      </p>

      <Callout variant="info" title="What AISSAE is">
        <a
          href="https://github.com/singnet/AISSAE"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1"
        >
          AISSAE (AI Safety, Security and Ethics by Design)
          <ExternalLink className="w-3.5 h-3.5" />
        </a>{' '}
        is a SingularityNET framework (Apache-2.0) that helps AI projects identify values and
        risks, score them, and track mitigations. It ships a risk taxonomy mapped to OECD AI
        principles, a scoring formula, register templates, and a public project registry.
      </Callout>

      <h2>Why only a subset</h2>
      <p>
        Our AI usage is narrow: large language models assemble context and route to existing,
        well-understood capabilities. The AI never acts on its own, never learns, and never holds
        state across sessions. That profile makes most of the AISSAE machinery -- and most of the
        AI-safety field's concerns -- a poor fit for us.
      </p>
      <p>
        The full framework assumes you are building an AI system. We are building a coordination
        platform that happens to call one. Adopting the registry, badge levels, dashboard
        automation, and nine-step workflow would be process overhead with no matching reduction in
        actual risk, so we took the parts that produce value in a day rather than a quarter.
      </p>

      <h2>What we adopted</h2>
      <table>
        <thead>
          <tr>
            <th>AISSAE asset</th>
            <th>How we use it</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Risk taxonomy (~100 risks across OECD principles)</td>
            <td>As a checklist. We selected the six domains that apply to us and derived one register entry per concrete risk.</td>
          </tr>
          <tr>
            <td>Scoring formula <code>2x(Impact + Likelihood) + (Impact x Likelihood)</code></td>
            <td>Unchanged. Scores range 5-45; we use the "moderate" zone thresholds (Acceptable &lt;= 13, Managed 14-24, Blocked &gt;= 25).</td>
          </tr>
          <tr>
            <td>Risk register format (ID, impact, likelihood, zone, mitigation)</td>
            <td>Rendered as our live <Link to="/risk/register">Risk Register</Link>.</td>
          </tr>
          <tr>
            <td>Project classification profile (purpose, environment, autonomy, ...)</td>
            <td>Recorded below as a one-time, honest statement of what our AI is and is not.</td>
          </tr>
          <tr>
            <td>Known / Foreseeable / Emergent familiarity tags</td>
            <td>Kept per risk. We track only Known and Foreseeable risks.</td>
          </tr>
        </tbody>
      </table>

      <h2>What we deliberately skipped</h2>
      <ul>
        <li><strong>Public registry and dashboard automation</strong> -- process infrastructure for a directory of AI projects; nothing here improves our users' safety.</li>
        <li><strong>Badge levels and the nine-step development workflow</strong> -- ceremony sized for dedicated AI teams.</li>
        <li><strong>Emergent / agentic risk categories</strong> -- self-modification, multi-agent colonies, runaway optimisation. Our classification below explains why these do not apply.</li>
        <li><strong>Workshop playbooks</strong> -- risk review is folded into our existing release preflight instead.</li>
      </ul>

      <h2>How proposals move risk scores</h2>
      <p>
        Proposals are not separate from risk -- they are how scores change. A proposal that lands a
        structural mitigation lowers a risk's Impact or Likelihood and moves it toward Acceptable.
        Scores in the register are always <em>current</em> (with today's mitigations), and entries
        with an active upgrade path link to the proposal that would lower them.
      </p>
      <p>
        The clearest example: user content (availability, messages, mailbox drafts) is currently
        stored as readable database rows. That means a database owner, a rogue admin, or a leaked
        backup can read it -- which is why RSK-01 and RSK-02 score Impact 3 today. The{' '}
        <Link to="/proposals/data-privacy">Data Privacy + Encryption proposal</Link> replaces
        policy-level protection ("we promise not to look") with structural protection
        ("the data is unreadable without user-held keys"). If it ships, insider access stops
        being a possible failure mode for those risks, their Impact drops, and both move to
        Acceptable. The same pattern applies to other proposals as they are adopted.
      </p>

      <h2>Classification profile</h2>
      <p>
        This is the AISSAE project classification for Coordination Manager's AI usage. It is the
        evidence for the scope decisions above.
      </p>
      <table>
        <thead>
          <tr>
            <th>Dimension</th>
            <th>Classification</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {classificationProfile.map((row) => (
            <tr key={row.dimension}>
              <td>{row.dimension}</td>
              <td><strong>{row.value}</strong></td>
              <td>{row.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Callout variant="tip" title="The short version">
        Supervised + static + no persistent memory + no autonomous action means the AI can
        embarrass us, but it cannot pursue goals. Our register therefore concentrates on privacy,
        transparency, integrity, fairness, dependencies, and supply chain -- not on control or
        alignment problems.
      </Callout>

      <h2>Review cadence</h2>
      <p>
        The register is reviewed whenever an AI-assisted feature is added or materially changed,
        and as part of the release preflight (<code>pnpm verify:release</code>). Scores reflect
        the residual risk with the listed mitigations in place, not the theoretical worst case.
        When a mitigation lands, the score drops; when a gap is found, the score rises and stays
        visible until fixed.
      </p>
    </div>
  )
}
