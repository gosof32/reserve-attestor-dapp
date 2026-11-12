import React, { useState } from "react";
import { EMPTY_FORM, LIMITS, PRESETS, pct, validateFeed } from "../lib/attestor.js";
import Icon from "./Icons.jsx";

const FIELD_HELP = {
  json: {
    reserves_field: "JSON path to the reserves amount, e.g. total_reserve_amount or data.usdt.total_assets",
    liabilities_field: "JSON path to tokens outstanding / liabilities",
    asof_field: "JSON path to the report time (ISO 8601, Unix seconds or ms)",
  },
  html: {
    reserves_field: "Label printed right before the reserves amount, e.g. RLUSD Reserve Funds",
    liabilities_field: "Label printed right before the circulating amount",
    asof_field: "Label of the report-date line, e.g. As of",
  },
};

function Field({ name, label, form, set, errors, touched, help, children, wide = false, ...input }) {
  const err = touched && errors[name];
  return (
    <label className={`field ${wide ? "span-2" : ""} ${err ? "invalid" : ""}`}>
      <span className="label">{label}</span>
      {children ?? (
        <input name={name} value={form[name]} onChange={(e) => set(name, e.target.value)} aria-invalid={Boolean(err)}
          aria-describedby={`${name}-help`} autoComplete="off" spellCheck="false" {...input} />
      )}
      <span id={`${name}-help`} className={err ? "err" : "help"}>{err || help}</span>
    </label>
  );
}

export default function CreateFeed({ onSubmit, canWrite, blockReason, busy }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [touched, setTouched] = useState(false);
  const { ok, errors, args } = validateFeed(form);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const help = FIELD_HELP[form.kind === "html" ? "html" : "json"];
  const p = { form, set, errors, touched };

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (ok && canWrite) onSubmit(args);
  };

  return (
    <form className="panel create" onSubmit={submit} noValidate aria-label="Create a feed">
      <h2><Icon name="plus" size={20} /> New attestation feed</h2>
      <p className="muted lead">Point the registry at a public proof-of-reserves source. Anyone can attest it afterwards. The form applies the contract's own rules, so what you submit is what <code>create_feed</code> accepts.</p>
      <div className="preset-row" role="group" aria-label="Fill from a real source">
        <span className="muted small">Fill from a real source:</span>
        {PRESETS.map((pr) => <button key={pr.label} type="button" className="chip" onClick={() => { setForm(pr.form); setTouched(true); }}>{pr.label}</button>)}
      </div>

      <div className="form-grid">
        <Field name="issuer" label="Issuer" help="Who publishes the reserves (2-60 characters)" {...p} />
        <Field name="asset" label="Asset" help="Ticker, e.g. USDB" {...p} />
        <Field name="source_url" label="Source URL" help="Public https URL; a validator does a plain GET" wide {...p} />
        <Field name="kind" label="Kind" help={form.kind === "html" ? "Page text, located by an LLM and verified by the contract" : "Parsed deterministically, no model"} {...p}>
          <select name="kind" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="json">json</option>
            <option value="html">html</option>
          </select>
        </Field>
        <Field name="date_order" label="Date order" help="How to read 01/02/2026 dates" {...p}>
          <select name="date_order" value={form.date_order} onChange={(e) => set("date_order", e.target.value)}>
            <option value="">unambiguous only</option>
            <option value="MDY">MDY (US)</option>
            <option value="DMY">DMY</option>
          </select>
        </Field>
        <Field name="reserves_field" label={form.kind === "html" ? "Reserves label" : "Reserves path"} help={help.reserves_field} {...p} />
        <Field name="liabilities_field" label={form.kind === "html" ? "Liabilities label" : "Liabilities path"} help={help.liabilities_field} {...p} />
        <Field name="asof_field" label={form.kind === "html" ? "As-of label" : "As-of path"} help={help.asof_field} {...p} />
        <Field name="reserves_decimals" label="Reserves decimals" help="Divide by 10^n (base units)" inputMode="numeric" {...p} />
        <Field name="liabilities_decimals" label="Liabilities decimals" help="0 for human amounts" inputMode="numeric" {...p} />
        <Field name="min_ratio_bps" label="Minimum ratio (bps)" help={/^\d+$/.test(form.min_ratio_bps) ? `${pct(Number(form.min_ratio_bps))} · range 1000-30000` : "10000 = 100 %"} inputMode="numeric" {...p} />
        <Field name="max_age_hours" label="Max report age (h)" help={`1-${LIMITS.maxAgeHours[1]}; older reports are STALE`} inputMode="numeric" {...p} />
      </div>

      {touched && !ok && <p className="notice bad" role="alert">Fix the highlighted fields. The contract would reject this feed.</p>}
      {!canWrite && <p className="notice warn">{blockReason}</p>}
      <div className="row gap wrap">
        <button className="btn primary" type="submit" disabled={busy || !canWrite}><Icon name="plus" size={16} />Create feed</button>
        <span className="muted small">Free: create_feed moves no money. One transaction, signed in your wallet.</span>
      </div>
    </form>
  );
}
