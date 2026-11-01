import { Link } from 'react-router-dom'
import { Callout } from '../components/Callout'
import {
  riskDomains,
  riskRegister,
  riskScore,
  riskZone,
  ZONE_CLASSES,
  ZONE_LABELS,
  type RiskZone,
} from '../risk/register-data'

function ZoneBadge({ zone }: { zone: RiskZone }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold ${ZONE_CLASSES[zone]}`}
    >
      {ZONE_LABELS[zone]}
    </span>
  )
}

export function RiskRegisterPage() {
  // 5x5 matrix: rows are impact 5..1, columns are likelihood 1..5.
  const matrixRows = [5, 4, 3, 2, 1].map((impact) => ({
    impact,
    cells: [1, 2, 3, 4, 5].map((likelihood) => {
      const score = riskScore(impact, likelihood)
      return {
        likelihood,
        score,
        zone: riskZone(score),
        risks: riskRegister.filter((r) => r.impact === impact && r.likelihood === likelihood),
      }
    }),
  }))

  return (
    <div className="prose-docs">
      <h1>Risk Register</h1>
      <p className="text-lg text-gray-400 mb-8">
        The live assessment of product and AI-related risks, derived from the AISSAE risk
        taxonomy and scored with their formula. See{' '}
        <Link to="/risk/framework">AI Risk Framework</Link> for how and why we adopted it.
      </p>

      {/* 5x5 matrix */}
      <h2>Impact / Likelihood Matrix</h2>
      <p>
        Every risk is scored by multiplying its two ratings into one number. The matrix below is
        the map: rows are Impact, columns are Likelihood, and each cell shows the resulting score.
        Risk IDs are pinned where they currently land.
      </p>

      <div className="not-prose mb-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-surface-700 bg-surface-800/40 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">The two ratings</h3>
          <dl className="space-y-2 text-sm text-gray-400">
            <div>
              <dt className="font-semibold text-gray-200">Impact (I) -- how bad if it happens</dt>
              <dd className="text-xs leading-5">
                1 = barely noticeable, 3 = users are harmed or data is misused, 5 = severe breach
                of trust or data loss.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-200">Likelihood (L) -- how likely to happen</dt>
              <dd className="text-xs leading-5">
                1 = rare in practice, 3 = plausibly occurs within a year, 5 = expected to happen
                regularly.
              </dd>
            </div>
          </dl>
        </div>
        <div className="rounded-xl border border-surface-700 bg-surface-800/40 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Score and Zone</h3>
          <p className="mb-2 text-xs leading-5 text-gray-400">
            The score combines the two ratings: <code>2x(I + L) + (IxL)</code>, so it ranges from 5
            (trivial) to 45 (severe). <strong className="text-gray-200">Higher is worse.</strong>{' '}
            The zone is the score translated into an action:
          </p>
          <div className="space-y-1.5 text-xs">
            <p className="flex items-center gap-2">
              <ZoneBadge zone="green" />
              <span className="text-gray-400">Score 5-13 -- acceptable, keep mitigations running.</span>
            </p>
            <p className="flex items-center gap-2">
              <ZoneBadge zone="amber" />
              <span className="text-gray-400">Score 14-24 -- managed, but monitored each release.</span>
            </p>
            <p className="flex items-center gap-2">
              <ZoneBadge zone="red" />
              <span className="text-gray-400">Score 25-45 -- blocks release until mitigated down.</span>
            </p>
          </div>
        </div>
      </div>

      <div className="not-prose mb-10 overflow-x-auto">
        <div className="inline-block">
          {/* Likelihood axis label across the top -- likelihood grows left to right */}
          <div className="flex">
            <div className="w-12" />
            <div className="flex-1 pb-1 text-center text-[10px] uppercase tracking-wider text-gray-500">
              Likelihood &rarr;
            </div>
          </div>
          <div className="flex">
            {/* Impact axis label down the side -- impact grows bottom to top */}
            <div className="flex w-4 items-center justify-center">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 [writing-mode:vertical-rl] rotate-180">
                Impact &uarr;
              </span>
            </div>
            <div>
              <div className="flex">
                <div className="w-8" />
                {[1, 2, 3, 4, 5].map((l) => (
                  <div key={l} className="flex h-6 w-24 items-end justify-center pb-1 text-xs text-gray-500">
                    {l}
                  </div>
                ))}
              </div>
              {matrixRows.map((row) => (
                <div key={row.impact} className="flex">
                  <div className="flex w-8 items-center justify-end pr-2 text-xs text-gray-500">{row.impact}</div>
                  {row.cells.map((cell) => (
                    <div
                      key={cell.likelihood}
                      className={`m-0.5 flex h-14 w-24 flex-col items-center justify-center rounded border px-1 text-[11px] ${ZONE_CLASSES[cell.zone]}`}
                      title={`Impact ${row.impact}, Likelihood ${cell.likelihood}: score ${cell.score} (${ZONE_LABELS[cell.zone]})`}
                    >
                      <span className="font-semibold">{cell.score}</span>
                      {cell.risks.length > 0 && (
                        <span className="flex flex-wrap items-center justify-center gap-x-1.5 text-center leading-tight">
                          {cell.risks.map((risk) => (
                            <a
                              key={risk.id}
                              href={`#${risk.id}`}
                              className="underline decoration-current/40 underline-offset-2 hover:decoration-current"
                            >
                              {risk.id}
                            </a>
                          ))}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 pl-12 text-xs text-gray-500">
            Impact increases upward, likelihood increases rightward. Top-right cells are the
            highest scores.
          </p>
        </div>
      </div>

      {/* Register grouped by domain */}
      <h2>Register by Domain</h2>
      <p>
        Six domains were selected from the AISSAE taxonomy as applicable to this platform. Each
        entry links back to the taxonomy row it derives from.
      </p>

      {riskDomains.map((domain) => {
        const entries = riskRegister.filter((r) => r.domain === domain.id)
        if (entries.length === 0) return null
        return (
          <div key={domain.id} className="not-prose mb-8">
            <div className="mb-3">
              <h3 className="text-lg font-semibold text-white">{domain.label}</h3>
              <p className="text-xs text-gray-500">OECD principle: {domain.oecdPrinciple}</p>
              <p className="mt-1 text-sm text-gray-400">{domain.description}</p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-surface-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-700 bg-surface-800/60 text-left text-xs uppercase tracking-wider text-gray-500">
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Risk</th>
                    <th className="px-3 py-2 text-center" title="Impact: how bad if it happens (1-5)">Impact</th>
                    <th className="px-3 py-2 text-center" title="Likelihood: how likely to happen (1-5)">Likely</th>
                    <th className="px-3 py-2 text-center" title="Score: 2x(I+L) + (IxL), higher is worse">Score</th>
                    <th className="px-3 py-2 text-center" title="Zone: the action level for the score">Zone</th>
                    <th className="px-3 py-2">Key mitigations</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((risk) => {
                    const score = riskScore(risk.impact, risk.likelihood)
                    const zone = riskZone(score)
                    return (
                      <tr key={risk.id} id={risk.id} className="scroll-mt-24 border-b border-surface-800 align-top last:border-0 target:bg-brand-600/10">
                        <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-400">{risk.id}</td>
                        <td className="px-3 py-3">
                          <p className="text-gray-200">{risk.title}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            Taxonomy: {risk.taxonomyRef} ({risk.familiarity})
                          </p>
                        </td>
                        <td className="px-3 py-3 text-center text-gray-300">{risk.impact}</td>
                        <td className="px-3 py-3 text-center text-gray-300">{risk.likelihood}</td>
                        <td className="px-3 py-3 text-center font-semibold text-gray-100">{score}</td>
                        <td className="px-3 py-3 text-center"><ZoneBadge zone={zone} /></td>
                        <td className="px-3 py-3 text-xs leading-5 text-gray-400">
                          {risk.mitigations}
                          {risk.proposalLink && (
                            <>
                              {' '}
                              Upgrade path:{' '}
                              <Link
                                to={risk.proposalLink.path}
                                className="text-brand-400 underline decoration-brand-400/40 underline-offset-2 hover:text-brand-300"
                              >
                                {risk.proposalLink.label}
                              </Link>
                              {' '}-- would structurally lower this risk's score if shipped.
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      <Callout variant="info" title="Reading the scores">
        Scores are residual -- they assume the listed mitigations are in place. Managed means the
        mitigation must keep working and is checked each release; anything landing Blocked stops a
        release until it is scored back down. Entries with an "Upgrade path" link point to a
        proposal that would structurally lower their score if shipped. The register is
        source-controlled in <code>Code/apps/docs/src/risk/register-data.ts</code> and reviewed at
        release preflight.
      </Callout>

      <p className="text-sm text-gray-500">
        Taxonomy rows and scoring formula adapted from the{' '}
        <a href="https://github.com/singnet/AISSAE" target="_blank" rel="noopener noreferrer">
          AISSAE framework
        </a>{' '}
        (SingularityNET, Apache-2.0).
      </p>
    </div>
  )
}
