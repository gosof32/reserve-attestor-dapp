import React, { useState } from "react";
import { LIMITS, STATUS_HINT, ago, exact, feedStatus, pct, when } from "../lib/attestor.js";
import { RatioBar, StatusBadge } from "./Status.jsx";
import HistoryChart from "./HistoryChart.jsx";
import Preview from "./Preview.jsx";
import CopyButton from "./CopyButton.jsx";
import Icon from "./Icons.jsx";

export function cooldownLeft(feed, now) {
  if (!feed.last_attested_at) return 0;
  const left = new Date(feed.last_attested_at).getTime() + LIMITS.minAttestIntervalS * 1000 - now;
  return Math.max(0, Math.ceil(left / 1000));
}

export default function FeedDetail({ feed, now, onAttest, canWrite, blockReason, busy, demo, fetchImpl }) {
  const [showPreview, setShowPreview] = useState(false);
  if (!feed) return <div className="panel skeleton tall" aria-hidden="true" />;
  const status = feedStatus(feed);
  const latest = feed.latest;
  const good = feed.last_good;
  const shown = latest?.status === "UNVERIFIABLE" ? good : latest;
  const wait = cooldownLeft(feed, now);
  const previewCfg = {
    issuer: feed.issuer, asset: feed.asset, source_url: feed.source_url, kind: feed.kind, reserves_field: feed.reserves_field,
    liabilities_field: feed.liabilities_field, asof_field: feed.asof_field, date_order: feed.date_order,
    reserves_decimals: String(feed.reserves_decimals), liabilities_decimals: String(feed.liabilities_decimals),
    min_ratio_bps: String(feed.min_ratio_bps), max_age_hours: String(feed.max_age_hours),
  };
  const attestDisabled = busy || !canWrite || feed.paused || wait > 0;

  return (
    <article className="detail" aria-label={`Feed ${feed.id}`}>
      <a href="#/" className="back small"><Icon name="arrowLeft" size={15} />All feeds</a>
      <header className="detail-head panel">
        <div className="detail-title">
          <span className="asset big">{feed.asset}</span>
          <div>
            <h1>{feed.issuer}</h1>
            <p className="muted small mono break">Feed #{feed.id} · <a href={feed.source_url} target="_blank" rel="noreferrer">{feed.source_host}</a> · {feed.kind}</p>
          </div>
          <StatusBadge status={status} size="lg" />
        </div>
        <p className="muted">{STATUS_HINT[status]}{latest?.error ? ` Reason: ${latest.error}.` : ""}</p>
        {feed.demo_note && <p className="notice demo small"><strong>Demo data.</strong> {feed.demo_note}</p>}

        <div className="figures">
          <div className="fig"><span className="k">Backing ratio</span><span className="v mono">{shown?.ratio_bps ? pct(shown.ratio_bps) : "—"}</span></div>
          <div className="fig"><span className="k">Reserves</span><span className="v mono">{exact(shown?.reserves ?? "")}</span></div>
          <div className="fig"><span className="k">Liabilities</span><span className="v mono">{exact(shown?.liabilities ?? "")}</span></div>
          <div className="fig"><span className="k">Report as-of</span><span className="v mono">{shown?.as_of ? when(shown.as_of) : "—"}</span><span className="sub muted small">{shown?.as_of ? ago(shown.as_of, now) : ""}</span></div>
        </div>
        <RatioBar ratioBps={shown?.ratio_bps ?? 0} minBps={feed.min_ratio_bps} status={shown?.status ?? status} />

        <div className="actions row gap wrap">
          <button type="button" className="btn primary" onClick={() => onAttest(feed)} disabled={attestDisabled}>
            <Icon name="refresh" size={16} />Attest now
          </button>
          <button type="button" className="btn ghost" onClick={() => setShowPreview((s) => !s)} aria-expanded={showPreview}>
            <Icon name="eye" size={16} />{showPreview ? "Hide preview" : "Preview the source"}
          </button>
          <span className="muted small">
            {demo ? blockReason : feed.paused ? "Paused by its owner." : wait > 0 ? `Next attestation possible in ${Math.ceil(wait / 60)} min.` : !canWrite ? blockReason : "Anyone can attest. Validators fetch the source and must agree."}
          </span>
        </div>
        {showPreview && <Preview initial={previewCfg} compact fetchImpl={fetchImpl} />}
      </header>

      <section className="panel">
        <h2><Icon name="chart" size={18} /> Backing ratio history</h2>
        <HistoryChart history={feed.history} minBps={feed.min_ratio_bps} />
        <div className="table-wrap">
          <table className="history">
            <thead><tr><th>#</th><th>Status</th><th>Ratio</th><th>Reserves</th><th>Liabilities</th><th>As-of</th><th>Attested</th></tr></thead>
            <tbody>
              {(feed.history ?? []).map((h) => (
                <tr key={h.n}>
                  <td className="mono">{h.n}</td>
                  <td><StatusBadge status={h.status} size="sm" /></td>
                  <td className="mono">{h.ratio_bps ? pct(h.ratio_bps) : "—"}</td>
                  <td className="mono">{exact(h.reserves)}</td>
                  <td className="mono">{exact(h.liabilities)}</td>
                  <td className="mono">{h.as_of ? when(h.as_of) : "—"}</td>
                  <td className="mono" title={h.error || undefined}>{when(h.attested_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {latest?.evidence && (
          <p className="evidence small"><span className="muted">Evidence (latest): </span><code>{latest.evidence}</code></p>
        )}
      </section>

      <section className="panel">
        <h2><Icon name="hash" size={18} /> Feed configuration</h2>
        <dl className="kv">
          <dt>Source</dt><dd className="mono break">{feed.source_url} <CopyButton text={feed.source_url} label="Copy" /></dd>
          <dt>{feed.kind === "json" ? "Reserves path" : "Reserves label"}</dt><dd className="mono">{feed.reserves_field}{feed.reserves_decimals ? ` ÷ 10^${feed.reserves_decimals}` : ""}</dd>
          <dt>{feed.kind === "json" ? "Liabilities path" : "Liabilities label"}</dt><dd className="mono">{feed.liabilities_field}{feed.liabilities_decimals ? ` ÷ 10^${feed.liabilities_decimals}` : ""}</dd>
          <dt>{feed.kind === "json" ? "As-of path" : "As-of label"}</dt><dd className="mono">{feed.asof_field}{feed.date_order ? ` (${feed.date_order})` : ""}</dd>
          <dt>Policy</dt><dd>minimum {pct(feed.min_ratio_bps)} · report at most {feed.max_age_hours} h old</dd>
          <dt>Counters</dt><dd>{feed.attest_count} attestations · {feed.consecutive_failures} failures in a row · source v{feed.source_version} · policy v{feed.policy_version}</dd>
          <dt>Owner</dt><dd className="mono break">{feed.owner}</dd>
        </dl>
        <p className="muted small">Other contracts: <code>is_backed({feed.id}, max_age_hours)</code> or <code>get_backing({feed.id})</code>.{demo ? " (Demo feed ids are illustrative.)" : ""}</p>
      </section>
    </article>
  );
}
