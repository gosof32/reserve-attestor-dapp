import React from "react";
import { STATUS_HINT, STATUS_TEXT, STATUS_TONE, pct } from "../lib/attestor.js";
import Icon from "./Icons.jsx";

const ICON = { FULLY_BACKED: "shield", UNDER_COLLATERALIZED: "alert", STALE: "clock", UNVERIFIABLE: "ban", NEVER: "clock" };

export function StatusBadge({ status = "NEVER", size = "md" }) {
  return (
    <span className={`badge tone-${STATUS_TONE[status] ?? "idle"} badge-${size}`} title={STATUS_HINT[status]} data-status={status}>
      <Icon name={ICON[status] ?? "clock"} size={size === "lg" ? 16 : 13} strokeWidth={2.2} />
      {STATUS_TEXT[status] ?? status}
    </span>
  );
}

// Horizontal gauge: 90 % .. 110 % around the feed's minimum ratio, with the minimum marked.
export function RatioBar({ ratioBps, minBps, status }) {
  const lo = Math.min(9000, minBps - 1000), hi = Math.max(11000, minBps + 1000);
  const clamp = (v) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  const has = ratioBps > 0 && status !== "UNVERIFIABLE";
  return (
    <div className="ratio" role="img" aria-label={has ? `Ratio ${pct(ratioBps)}, minimum ${pct(minBps)}` : `No ratio, minimum ${pct(minBps)}`}>
      <div className="ratio-track">
        {has && <div className={`ratio-fill tone-${STATUS_TONE[status] ?? "idle"}`} style={{ width: `${clamp(ratioBps)}%` }} />}
        <div className="ratio-min" style={{ left: `${clamp(minBps)}%` }} />
      </div>
      <div className="ratio-scale mono"><span>{pct(lo)}</span><span>min {pct(minBps)}</span><span>{pct(hi)}</span></div>
    </div>
  );
}
