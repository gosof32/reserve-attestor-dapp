import React, { useState } from "react";
import { EXPLORER_BASE } from "../config.js";
import Icon from "./Icons.jsx";

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

// The life of a GenLayer transaction, as shown in the toast.
export const TX_STEPS = ["signing", "pending", "accepted", "finalized"];
const STEP_LABEL = { signing: "Sign", pending: "PENDING", accepted: "ACCEPTED", finalized: "FINALIZED" };
const STEP_HINT = {
  signing: "Approve it in your wallet",
  pending: "Submitted, waiting for the validators",
  accepted: "Validators agreed; waiting for finality",
  finalized: "Done",
};

export function TxItem({ tx, onDismiss }) {
  const failed = tx.phase === "error";
  const reached = failed ? TX_STEPS.indexOf(tx.lastPhase ?? "signing") : TX_STEPS.indexOf(tx.phase);
  const done = failed || tx.phase === "finalized";
  return (
    <li className={`tx ${failed ? "tx-error" : tx.phase === "finalized" ? "tx-ok" : "tx-pending"}`} data-phase={tx.phase}>
      <div className="tx-head">
        <span className="tx-icon" aria-hidden="true">
          {failed ? <Icon name="x" size={14} strokeWidth={2.6} /> : tx.phase === "finalized" ? <Icon name="check" size={14} strokeWidth={2.6} /> : <span className="spinner" />}
        </span>
        <strong className="tx-label">{tx.label}</strong>
        {done && onDismiss && (
          <button type="button" className="icon-btn" onClick={() => onDismiss(tx.id)} aria-label="Dismiss transaction">
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      <ol className="tx-track" aria-label="Transaction progress">
        {TX_STEPS.map((s, i) => {
          const cls = i < reached || (i === reached && tx.phase === "finalized") ? "done" : i === reached ? (failed ? "fail" : "now") : "";
          return (
            <li key={s} className={cls}>
              <span className="tx-dot" aria-hidden="true" />
              <span className="tx-step">{STEP_LABEL[s]}</span>
            </li>
          );
        })}
      </ol>
      {!failed && !done && <p className="tx-msg muted">{STEP_HINT[tx.phase] ?? ""}{tx.phase !== "signing" && tx.slow ? " · an attest call reads the source, so it can take a few minutes" : ""}</p>}
      {failed && <p className="tx-msg" role="alert">{tx.message}</p>}
      {tx.phase === "finalized" && (tx.summary || tx.result?.returnValue) && <p className="tx-msg">{tx.summary ?? tx.result.returnValue}</p>}
      {tx.hash && (
        <a className="tx-hash" href={`${EXPLORER_BASE}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
          {short(tx.hash)} <Icon name="external" size={12} />
        </a>
      )}
    </li>
  );
}

// Transactions as a docked toast stack with a step tracker per transaction.
export default function TxLog({ txs }) {
  const [hidden, setHidden] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(false);
  const visible = txs.filter((t) => !hidden.has(t.id));
  if (!visible.length) return null;
  const pending = visible.filter((t) => t.phase !== "finalized" && t.phase !== "error").length;
  const dismiss = (id) => setHidden((h) => new Set(h).add(id));

  return (
    <section className={`txlog ${collapsed ? "collapsed" : ""}`} aria-label="Transactions">
      <header className="txlog-head">
        <h3>
          {pending > 0 ? <span className="spinner" aria-hidden="true" /> : <Icon name="check" size={15} />}
          Transactions <span className="count-pill">{visible.length}</span>
        </h3>
        <button type="button" className="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-label={collapsed ? "Expand transactions" : "Collapse transactions"}>
          <Icon name={collapsed ? "chevronUp" : "chevronDown"} size={16} />
        </button>
      </header>
      {!collapsed && (
        <div className="txlog-body">
          <ul>{visible.map((t) => <TxItem key={t.id} tx={t} onDismiss={dismiss} />)}</ul>
        </div>
      )}
    </section>
  );
}
