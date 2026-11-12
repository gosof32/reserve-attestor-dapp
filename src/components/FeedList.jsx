import React from "react";
import { ago, compact, feedStatus, pct } from "../lib/attestor.js";
import { RatioBar, StatusBadge } from "./Status.jsx";
import Icon from "./Icons.jsx";

export function FeedCard({ feed, now }) {
  const status = feedStatus(feed);
  const shown = feed.latest?.status === "UNVERIFIABLE" ? feed.last_good : feed.latest;
  return (
    <a className={`feed-card ${feed.paused ? "paused" : ""}`} href={`#/feed/${feed.id}`} aria-label={`Feed ${feed.id}: ${feed.asset}, ${status}`}>
      <div className="feed-top">
        <span className="asset">{feed.asset}</span>
        <StatusBadge status={status} />
      </div>
      <p className="issuer">{feed.issuer}</p>
      <div className="feed-figures">
        <div><span className="k">Ratio</span><span className="v mono">{shown?.ratio_bps ? pct(shown.ratio_bps) : "—"}</span></div>
        <div><span className="k">Reserves</span><span className="v mono">{compact(shown?.reserves ?? "")}</span></div>
        <div><span className="k">Liabilities</span><span className="v mono">{compact(shown?.liabilities ?? "")}</span></div>
      </div>
      <RatioBar ratioBps={shown?.ratio_bps ?? 0} minBps={feed.min_ratio_bps} status={shown?.status ?? status} />
      <div className="feed-foot muted small">
        <span><Icon name="globe" size={13} /> {feed.source_host} · {feed.kind}</span>
        <span>{feed.latest ? `report ${ago(feed.latest.as_of || feed.latest.attested_at, now)}` : "never attested"}</span>
      </div>
      {feed.paused && <span className="paused-tag">Paused</span>}
    </a>
  );
}

export default function FeedList({ feeds, stats, now, filter, setFilter }) {
  if (!feeds) return <div className="grid">{[1, 2, 3].map((i) => <div key={i} className="feed-card skeleton" aria-hidden="true" />)}</div>;
  const counts = { ALL: feeds.length };
  for (const f of feeds) counts[feedStatus(f)] = (counts[feedStatus(f)] ?? 0) + 1;
  const shown = filter === "ALL" ? feeds : feeds.filter((f) => feedStatus(f) === filter);
  const chips = [["ALL", "All"], ["FULLY_BACKED", "Backed"], ["UNDER_COLLATERALIZED", "Under"], ["STALE", "Stale"], ["UNVERIFIABLE", "Unverifiable"]];
  return (
    <section aria-label="Feeds">
      <div className="filters" role="group" aria-label="Filter by status">
        {chips.map(([k, label]) => (
          <button key={k} type="button" className={`chip ${filter === k ? "on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label} <span className="count">{counts[k] ?? 0}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <Icon name="inbox" size={28} />
          <p>{feeds.length === 0 ? "No feeds registered yet. Create the first one." : "No feed has this status."}</p>
          {feeds.length === 0 && <a className="btn primary sm" href="#/create"><Icon name="plus" size={15} />New feed</a>}
        </div>
      ) : (
        <div className="grid">{shown.map((f) => <FeedCard key={f.id} feed={f} now={now} />)}</div>
      )}
      {stats && <p className="muted small stats-line">{stats.feeds} feeds on this contract.</p>}
    </section>
  );
}
