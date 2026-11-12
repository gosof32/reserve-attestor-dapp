import React, { useState } from "react";
import { PRESETS, exact, pct, validateFeed, when } from "../lib/attestor.js";
import { classify, fmtMicro, readSource } from "../lib/extract.js";
import SNAPSHOTS from "../demo/snapshots.json";
import { StatusBadge } from "./Status.jsx";
import Icon from "./Icons.jsx";

export const corsMessage = (host) =>
  `Your browser blocked the read: ${host} does not send an Access-Control-Allow-Origin header, so a web page on another site is not allowed to fetch it. ` +
  "This only limits browsers. GenLayer validators fetch the source from their own servers, where CORS does not apply.";

// Runs the contract's reading rules in the browser on a live fetch (or a captured snapshot).
export async function runPreview({ cfg, fetchImpl, useSnapshot = false, now = new Date() }) {
  const host = new URL(cfg.source_url).host;
  let body, from;
  if (useSnapshot) {
    const snap = SNAPSHOTS[cfg.source_url];
    if (!snap) return { error: "No captured copy of this source is bundled with the app." };
    body = snap.body;
    from = `captured copy from ${when(snap.captured_at)}`;
  } else {
    let res;
    try {
      res = await fetchImpl(cfg.source_url, { headers: { Accept: cfg.kind === "json" ? "application/json" : "text/html" } });
    } catch {
      return { cors: true, error: corsMessage(host), snapshot: Boolean(SNAPSHOTS[cfg.source_url]) };
    }
    if (!res.ok) return { error: `The source answered HTTP ${res.status}. Validators would record UNVERIFIABLE.` };
    body = await res.text();
    from = `live fetch, ${when(now.toISOString())}`;
  }
  const reading = readSource(body, cfg);
  const verdict = classify(reading, cfg.min_ratio_bps, cfg.max_age_hours, now);
  return { reading, verdict, from, bytes: body.length };
}

export default function Preview({ initial, fetchImpl = (...a) => fetch(...a), compact = false }) {
  const [form, setForm] = useState(initial ?? PRESETS[1].form);
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const v = validateFeed(form);

  const go = async (useSnapshot = false) => {
    if (!v.ok) return;
    const [, , source_url, kind, reserves_field, liabilities_field, asof_field, date_order, rd, ld, min_ratio_bps, max_age_hours] = v.args;
    const cfg = { source_url, kind, reserves_field, liabilities_field, asof_field, date_order, reserves_decimals: rd, liabilities_decimals: ld, min_ratio_bps, max_age_hours };
    setBusy(true);
    setOut(await runPreview({ cfg, fetchImpl, useSnapshot }));
    setBusy(false);
  };

  return (
    <section className={`panel preview ${compact ? "compact" : ""}`} aria-label="Live preview">
      {!compact && (
        <>
          <h2><Icon name="eye" size={20} /> What would validators read?</h2>
          <p className="muted lead">Fetches the source from your browser and applies the contract's own reading rules (paths, exact decimals, labels, dates, status). Nothing is signed or sent on-chain.</p>
          <div className="preset-row" role="group" aria-label="Real sources">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className={`chip ${form.source_url === p.form.source_url ? "on" : ""}`} onClick={() => { setForm(p.form); setOut(null); }}>{p.label}</button>
            ))}
          </div>
        </>
      )}
      <dl className="cfg mono small">
        <dt>source</dt><dd className="break">{form.source_url}</dd>
        <dt>{form.kind === "json" ? "paths" : "labels"}</dt><dd className="break">{form.reserves_field} / {form.liabilities_field} / {form.asof_field}</dd>
      </dl>
      <div className="row gap">
        <button type="button" className="btn primary sm" onClick={() => go(false)} disabled={busy || !v.ok}>
          <Icon name="play" size={14} />{busy ? "Reading…" : "Fetch live"}
        </button>
        <button type="button" className="btn ghost sm" onClick={() => go(true)} disabled={busy || !v.ok}>Use captured copy</button>
      </div>
      {out && <PreviewResult out={out} kind={form.kind} onSnapshot={() => go(true)} />}
    </section>
  );
}

function PreviewResult({ out, kind, onSnapshot }) {
  if (out.error) {
    return (
      <div className={`notice ${out.cors ? "warn" : "bad"}`} role="status">
        <p>{out.error}</p>
        {out.cors && out.snapshot && <button type="button" className="btn ghost xs" onClick={onSnapshot}>Read the captured copy instead</button>}
      </div>
    );
  }
  const { reading, verdict } = out;
  return (
    <div className="preview-out" role="status">
      <div className="row gap wrap"><StatusBadge status={verdict.status} /><span className="muted small">{out.from} · {out.bytes.toLocaleString("en-US")} bytes</span></div>
      {reading.ok ? (
        <dl className="kv">
          <dt>Reserves</dt><dd className="mono">{exact(fmtMicro(reading.reserves))}</dd>
          <dt>Liabilities</dt><dd className="mono">{exact(fmtMicro(reading.liabilities))}</dd>
          <dt>Ratio</dt><dd className="mono">{pct(verdict.ratio_bps)}</dd>
          <dt>Report as-of</dt><dd className="mono">{when(reading.as_of)}</dd>
          <dt>Evidence</dt><dd className="mono break small">{reading.evidence}</dd>
        </dl>
      ) : (
        <p className="notice bad">{verdict.error}</p>
      )}
      {reading.ok && verdict.error && <p className="notice bad">{verdict.error}</p>}
      {kind === "html" && (
        <p className="muted small">HTML sources: validators ask an LLM to quote the amount after each label, then the contract checks the quote is on the page, right after its label, and that every occurrence of the label shows the same amount. Above is the amount that check expects.</p>
      )}
    </div>
  );
}
