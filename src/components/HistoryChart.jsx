import React, { useEffect, useRef, useState } from "react";
import { STATUS_TONE, pct, when } from "../lib/attestor.js";

// Backing ratio over time (one point per attestation), with the feed's minimum as a dashed line.
// Unverifiable attestations have no ratio and are drawn as ticks on the baseline.
// Renders at the container's real width so text stays at its true size on phones and desktops.
function useWidth(fallback) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export default function HistoryChart({ history, minBps, height = 220 }) {
  const [ref, width] = useWidth(640);
  const pts = [...(history ?? [])].sort((a, b) => a.attested_at.localeCompare(b.attested_at));
  if (pts.length === 0) return <p className="muted small" ref={ref}>No attestations yet.</p>;
  const pad = { l: 74, r: 14, t: 14, b: 30 }; // room for "100.29 %" at 11px mono
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const ratios = pts.filter((p) => p.ratio_bps > 0).map((p) => p.ratio_bps);
  let lo = Math.min(minBps, ...ratios), hi = Math.max(minBps, ...ratios);
  const span = Math.max(hi - lo, 40);
  lo -= span * 0.35; hi += span * 0.35;
  const t0 = new Date(pts[0].attested_at).getTime(), t1 = new Date(pts.at(-1).attested_at).getTime();
  const x = (p) => pad.l + (t1 === t0 ? W / 2 : ((new Date(p.attested_at).getTime() - t0) / (t1 - t0)) * W);
  const y = (bps) => pad.t + H - ((bps - lo) / (hi - lo)) * H;
  const good = pts.filter((p) => p.ratio_bps > 0);
  const path = good.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(p.ratio_bps).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  return (
    <figure className="chart" ref={ref}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Backing ratio over ${pts.length} attestations`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{pct(t)}</text>
          </g>
        ))}
        <line x1={pad.l} x2={width - pad.r} y1={y(minBps)} y2={y(minBps)} className="min-line" />
        <text x={width - pad.r} y={y(minBps) - 6} textAnchor="end" className="axis min-label">min {pct(minBps)}</text>
        {path && <path d={path} className="ratio-line" />}
        {pts.map((p) => (p.ratio_bps > 0
          ? <circle key={p.n} cx={x(p)} cy={y(p.ratio_bps)} r="4.5" className={`pt tone-${STATUS_TONE[p.status]}`}><title>{`#${p.n} ${p.status} ${pct(p.ratio_bps)} · ${when(p.attested_at)}`}</title></circle>
          : <rect key={p.n} x={x(p) - 2} y={pad.t + H - 10} width="4" height="10" className="pt tone-void"><title>{`#${p.n} ${p.status} · ${when(p.attested_at)}`}</title></rect>))}
        <text x={pad.l} y={height - 8} className="axis">{when(pts[0].attested_at)}</text>
        {t1 !== t0 && <text x={width - pad.r} y={height - 8} textAnchor="end" className="axis">{when(pts.at(-1).attested_at)}</text>}
      </svg>
    </figure>
  );
}
