import { Link } from "react-router";
import { Card, CardContent } from "./components/ui/card";
import { demandHref, ROUTES } from "./routing";
import { formatUsd0, type DemandView } from "./contract";
import { deriveGlobalAnalytics } from "./analytics";

const STATUS_COLORS: Record<string, string> = {
  OPEN: "#5b8c32",
  SUBMITTED: "#aa8f50",
  READY: "#192800",
  EXPIRED: "#a56b43",
  REJECTED: "#ae5e4d",
  FULFILLED: "#7b9d58",
  CLOSED: "#7b8768",
  UNKNOWN: "#98a18b",
};

type AnalyticsDashboardProps = {
  board: DemandView[];
  loading: boolean;
  loadError: boolean;
  contractConfigured: boolean;
};

export function AnalyticsDashboard({ board, loading, loadError, contractConfigured }: AnalyticsDashboardProps) {
  const analytics = deriveGlobalAnalytics(board, BigInt(Math.floor(Date.now() / 1000)));

  return (
    <section className="panel analytics-panel" aria-labelledby="analytics-title">
      <header className="analytics-header">
        <div>
          <p className="analytics-kicker">Public on-chain overview</p>
          <h1 id="analytics-title">Analytics</h1>
          <p>Current request status and escrow across X Layer</p>
        </div>
        <span className="analytics-source">Full request board</span>
      </header>

      {!contractConfigured ? (
        <div className="analytics-state" role="alert">Analytics are unavailable because the demand contract is not configured</div>
      ) : loading && board.length === 0 ? (
        <div className="analytics-loading" role="status">
          <span>Loading the public market snapshot…</span>
          <div className="analytics-loading-kpis"><i /><i /><i /><i /></div>
          <div className="analytics-loading-panels"><i /><i /></div>
        </div>
      ) : loadError && board.length === 0 ? (
        <div className="analytics-state analytics-state-error" role="alert">
          Could not read the request board from X Layer. Use Refresh data to try again.
        </div>
      ) : (
        <>
          {loadError && <p className="analytics-stale" role="status">Showing the last successful request snapshot. The latest refresh failed</p>}

          <div className="analytics-kpis">
            <MetricCard label="Total requests" value={analytics.totalRequests.toLocaleString()} detail="Unique on-chain demand IDs" />
            <MetricCard label="Requests fulfilled" value={analytics.fulfilledRequests.toLocaleString()} detail="Current fulfilled status, counted once per request" />
            <MetricCard label="Escrow locked" value={formatUsd0(analytics.escrowLocked)} unit="USD₮0" detail="Current committed balances across all requests" />
            <MetricCard label="Builder payouts" value="Unavailable" detail="Complete fulfillment events are not indexed" unavailable />
          </div>

          <div className="analytics-chart-grid">
            <Card className="analytics-card">
              <div className="analytics-card-heading">
                <div>
                  <h2>Request status</h2>
                  <p>Current effective status for every request</p>
                </div>
              </div>
              <CardContent className="analytics-status-content">
                {analytics.totalRequests === 0 ? (
                  <p className="analytics-empty">No on-chain requests yet</p>
                ) : (
                  <StatusDonut counts={analytics.statusCounts} total={analytics.totalRequests} />
                )}
              </CardContent>
            </Card>

            <Card className="analytics-card">
              <div className="analytics-card-heading">
                <div>
                  <h2>Current escrow by request</h2>
                  <p>Largest remaining committed balances</p>
                </div>
              </div>
              <CardContent className="analytics-escrow-content">
                {analytics.escrowByRequest.length === 0 ? (
                  <p className="analytics-empty">No escrow is currently locked</p>
                ) : (
                  <EscrowBars requests={analytics.escrowByRequest} />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="analytics-lower-grid">
            <Card className="analytics-card">
              <div className="analytics-card-heading">
                <div>
                  <h2>Recently fulfilled requests</h2>
                  <p>Sorted by request ID; fulfillment times are not indexed</p>
                </div>
              </div>
              <CardContent className="analytics-recent-content">
                {analytics.recentlyFulfilled.length === 0 ? (
                  <p className="analytics-empty">No requests have been fulfilled yet</p>
                ) : (
                  <ul className="analytics-recent-list">
                    {analytics.recentlyFulfilled.map((demand) => (
                      <li key={demand.demandId.toString()}>
                        <Link to={demandHref(demand.demandId)} state={{ from: ROUTES.analytics.href }}>
                          <span className="analytics-request-id">#{demand.demandId.toString()}</span>
                          <strong>{demand.capability.trim() || "Capability not provided"}</strong>
                          <span className="analytics-fulfilled-tag">Fulfilled</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="analytics-card analytics-history-card">
              <div className="analytics-card-heading">
                <div>
                  <h2>Settlement history</h2>
                  <p>Historical payouts and refunds</p>
                </div>
                <span className="analytics-unavailable-tag">Unavailable</span>
              </div>
              <CardContent>
                <div className="analytics-history-state">
                  <strong>Complete event history is not indexed</strong>
                  <p>This page reports current request state only. It does not estimate builder payouts from escrow balances</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

function MetricCard({ label, value, unit, detail, unavailable = false }: { label: string; value: string; unit?: string; detail: string; unavailable?: boolean }) {
  return (
    <Card className="analytics-kpi">
      <CardContent className="analytics-kpi-content">
        <span className="analytics-kpi-label">{label}</span>
        <span className={"analytics-kpi-value" + (unavailable ? " is-unavailable" : "")}>
          {value}{unit && <small>{unit}</small>}
        </span>
        <span className="analytics-kpi-detail">{detail}</span>
      </CardContent>
    </Card>
  );
}

function StatusDonut({ counts, total }: { counts: { status: string; count: number }[]; total: number }) {
  let offset = 0;
  return (
    <div className="analytics-status-chart">
      <figure className="analytics-donut-figure">
        <svg viewBox="0 0 120 120" role="img" aria-label={`${total} requests by current effective status`}>
          <circle className="analytics-donut-track" cx="60" cy="60" r="44" pathLength="100" />
          {counts.map(({ status, count }) => {
            const percentage = count / total * 100;
            const segmentOffset = offset;
            offset += percentage;
            return (
              <circle
                key={status}
                className="analytics-donut-segment"
                cx="60"
                cy="60"
                r="44"
                pathLength="100"
                stroke={STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN}
                strokeDasharray={`${percentage} ${100 - percentage}`}
                strokeDashoffset={-segmentOffset}
              />
            );
          })}
          <text className="analytics-donut-total" x="60" y="58" textAnchor="middle">{total.toLocaleString()}</text>
          <text className="analytics-donut-caption" x="60" y="72" textAnchor="middle">requests</text>
        </svg>
      </figure>
      <ul className="analytics-status-legend">
        {counts.map(({ status, count }) => (
          <li key={status}>
            <span className="analytics-status-dot" style={{ backgroundColor: STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN }} />
            <span>{status}</span>
            <strong>{count.toLocaleString()}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EscrowBars({ requests }: { requests: DemandView[] }) {
  const maxEscrow = requests[0]?.committed ?? 0n;
  return (
    <ol className="analytics-escrow-list">
      {requests.map((demand) => {
        const width = maxEscrow === 0n ? 0 : Number(demand.committed * 1_000_000n / maxEscrow) / 10_000;
        return (
          <li key={demand.demandId.toString()}>
            <Link to={demandHref(demand.demandId)} state={{ from: ROUTES.analytics.href }}>
              <span className="analytics-escrow-label">
                <strong>#{demand.demandId.toString()}</strong>
                <span>{demand.capability.trim() || "Capability not provided"}</span>
              </span>
              <span className="analytics-bar-track" aria-hidden="true"><span style={{ width: `${width}%` }} /></span>
              <span className="analytics-bar-value">{formatUsd0(demand.committed)} <small>USD₮0</small></span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
