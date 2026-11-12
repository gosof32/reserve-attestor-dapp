import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_REPO, CONTRACT_ADDRESS, CONTRACT_REPO, EXPLORER_BASE, STUDIO_URL } from "./config.js";
import { connectWallet as defaultConnect, createReadClient, writeAndFinalize as defaultWrite } from "./lib/wallet.js";
import {
  normalizeFeed, parseRoute, readFeed as defaultReadFeed, readFeeds as defaultReadFeeds, readStats as defaultReadStats,
  summarizeAttest,
} from "./lib/attestor.js";
import DEMO from "./demo/demo-data.json";
import FeedList from "./components/FeedList.jsx";
import FeedDetail from "./components/FeedDetail.jsx";
import CreateFeed from "./components/CreateFeed.jsx";
import Preview from "./components/Preview.jsx";
import TxLog, { short } from "./components/TxLog.jsx";
import Icon from "./components/Icons.jsx";

const TABS = [
  ["feeds", "Feeds", "#/"],
  ["create", "New feed", "#/create"],
  ["preview", "Live preview", "#/preview"],
  ["how", "How it works", "#/how"],
];

export const DEMO_FEEDS = DEMO.feeds.map(normalizeFeed).map((f, i) => ({ ...f, demo_note: DEMO.feeds[i].demo_note }));

const currentHash = () => (typeof window !== "undefined" ? window.location.hash : "");
const demoFromUrl = () => typeof window !== "undefined" && /[?&]demo(=1|=true)?(&|$)/.test(window.location.search + "&" + window.location.hash.split("?")[1]);
const errText = (e) => e?.shortMessage ?? e?.message ?? String(e);

export default function App({
  contractAddress = CONTRACT_ADDRESS,
  connect = defaultConnect,
  writeTx = defaultWrite,
  readFeeds = defaultReadFeeds,
  readFeed = defaultReadFeed,
  readStats = defaultReadStats,
  readClient: injectedReadClient,
  fetchImpl,
  initialDemo,
  pollMs = 20000,
}) {
  const deployed = Boolean(contractAddress);
  const readClient = useMemo(() => injectedReadClient ?? createReadClient(), [injectedReadClient]);
  const [route, setRoute] = useState(() => parseRoute(currentHash()));
  const [demo, setDemoState] = useState(() => initialDemo ?? demoFromUrl());
  const [wallet, setWallet] = useState(null);
  const [walletError, setWalletError] = useState("");
  const [feeds, setFeeds] = useState(null);
  const [stats, setStats] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [txs, setTxs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const txId = useRef(0);

  const source = demo ? "demo" : deployed ? "chain" : "none";
  // Demo readings are from 2026-11-12; age them against that day, not the viewer's clock.
  const viewNow = source === "demo" ? new Date(DEMO.captured_until).getTime() + 60_000 : now;

  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(currentHash())); window.scrollTo?.(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setDemo = (on) => {
    setDemoState(on);
    setFeeds(null);
    setDetail(null);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      const url = new URL(window.location.href);
      if (on) url.searchParams.set("demo", "1"); else url.searchParams.delete("demo");
      window.history.replaceState(null, "", url.toString());
    }
  };

  const refresh = useCallback(async () => {
    if (source === "none") { setFeeds([]); setStats(null); setLoadError(""); return; }
    if (source === "demo") {
      setFeeds(DEMO_FEEDS);
      setStats(DEMO.stats);
      if (route.name === "feed") setDetail(DEMO_FEEDS.find((f) => f.id === route.id) ?? "missing");
      setLoadError("");
      return;
    }
    try {
      if (route.name === "feed") setDetail(await readFeed(readClient, contractAddress, route.id));
      else if (route.name === "feeds") {
        const [list, s] = await Promise.all([readFeeds(readClient, contractAddress), readStats(readClient, contractAddress)]);
        setFeeds(list);
        setStats(s);
      }
      setLoadError("");
    } catch (e) {
      const msg = errText(e);
      if (route.name === "feed" && /NOT_FOUND|unknown feed/i.test(msg)) setDetail("missing");
      else setLoadError(`Could not read the contract: ${msg}`);
    }
  }, [source, route.name, route.id, readClient, contractAddress, readFeed, readFeeds, readStats]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); if (source === "chain") refresh(); }, pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs, source]);

  const go = (hash) => {
    if (typeof window !== "undefined") window.location.hash = hash;
    setRoute(parseRoute(hash));
  };

  const handleConnect = async () => {
    setWalletError("");
    try { setWallet(await connect()); } catch (e) { setWallet(null); setWalletError(errText(e)); }
  };

  const patchTx = (id, patch) => setTxs((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const blockReason = source === "demo"
    ? "Demo data is read-only. Switch demo off and point the app at a deployed contract to sign."
    : !deployed ? "Contract not deployed yet: set VITE_CONTRACT_ADDRESS to send transactions." : !wallet ? "Connect a wallet to sign." : "";
  const canWrite = source === "chain";

  // Sends a write signed by the user's wallet and tracks it PENDING → ACCEPTED → FINALIZED.
  const run = async (label, functionName, args, { summarize, slow = false } = {}) => {
    const id = ++txId.current;
    if (!wallet) {
      setTxs((all) => [{ id, label, phase: "error", message: "Connect your wallet to sign this transaction. Reading works without one." }, ...all]);
      return null;
    }
    setTxs((all) => [{ id, label, phase: "signing", slow }, ...all]);
    setBusy(true);
    let last = "signing";
    try {
      const out = await writeTx({
        walletClient: wallet.client, readClient, address: contractAddress, functionName, args, value: 0n,
        onUpdate: (u) => {
          last = u.phase;
          const patch = { ...u };
          if (u.phase === "finalized" && summarize) patch.summary = summarize(u.result?.returnValue);
          patchTx(id, patch);
        },
      });
      await refresh();
      return out ?? {};
    } catch (e) {
      patchTx(id, { phase: "error", lastPhase: last, message: errText(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const onAttest = (feed) => run(`Attest #${feed.id} ${feed.asset}`, "attest", [feed.id], { summarize: summarizeAttest, slow: true });
  const onCreate = async (args) => {
    const out = await run(`Create feed: ${args[1]}`, "create_feed", args);
    const newId = Number(out?.result?.returnValue);
    if (out) go(Number.isInteger(newId) && newId > 0 ? `#/feed/${newId}` : "#/");
  };

  const tabKey = route.name === "feed" ? "feeds" : route.name;
  const shownDetail = detail && detail !== "missing" && detail.id === route.id ? detail : null;

  return (
    <div className="app">
      <div className="bg-fx" aria-hidden="true" />
      <header className="top">
        <a href="#/" className="brand" aria-label="Reserve Attestor home">
          <span className="logo"><Icon name="logo" size={22} strokeWidth={2} /></span>
          <span className="brand-text">
            <span className="brand-name">Reserve Attestor</span>
            <span className="brand-sub">proof of reserves · GenLayer</span>
          </span>
        </a>
        <nav className="tabs" aria-label="Sections">
          {TABS.map(([k, label, href]) => (
            <a key={k} href={href} className={tabKey === k ? "on" : ""} aria-current={tabKey === k ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <div className="wallet">
          {wallet ? (
            <span className="pill addr" title={wallet.address}><span className="live-dot" aria-hidden="true" />{short(wallet.address)}</span>
          ) : (
            <button className="btn primary sm" onClick={handleConnect}><Icon name="wallet" size={16} />Connect wallet</button>
          )}
        </div>
      </header>
      {walletError && <p className="banner error" role="alert">{walletError}</p>}
      {source === "demo" && (
        <div className="banner demo" role="note">
          <span><strong>DEMO DATA</strong> · real readings of real sources captured on 2026-11-12, scored with the contract's rules in your browser. Not on-chain attestations.</span>
          <button type="button" className="btn ghost xs" onClick={() => setDemo(false)}>Exit demo</button>
        </div>
      )}

      {route.name === "feeds" && (
        <section className="hero">
          <h1>Is it really backed? <span className="accent">Ask the validators.</span></h1>
          <p className="lead muted">Each feed points at an issuer's own proof-of-reserves source. On <code>attest</code>, GenLayer validators fetch it, extract reserves, liabilities and the report date, and must agree within 0.5 %. Contracts read the verdict with <code>is_backed(feed, max_age)</code>.</p>
          {stats && <StatsStrip stats={stats} />}
        </section>
      )}

      <main className="layout">
        {loadError && (
          <div className="notice bad" role="alert"><span>{loadError}</span> <button className="btn ghost xs" onClick={refresh}>Retry</button></div>
        )}
        {route.name === "feeds" && source === "none" && <NotDeployed onDemo={() => setDemo(true)} />}
        {route.name === "feeds" && source !== "none" && <FeedList feeds={feeds} stats={source === "chain" ? stats : null} now={viewNow} filter={filter} setFilter={setFilter} />}
        {route.name === "feed" && (
          detail === "missing" || (source === "none")
            ? <div className="empty"><Icon name="inbox" size={28} /><p>{source === "none" ? "Contract not deployed yet, so there are no feeds to show." : `Feed #${route.id} does not exist.`}</p><a className="btn ghost sm" href="#/">Back to feeds</a></div>
            : <FeedDetail feed={shownDetail} now={viewNow} onAttest={onAttest} canWrite={canWrite && Boolean(wallet)} blockReason={blockReason} busy={busy} demo={source === "demo"} fetchImpl={fetchImpl} />
        )}
        {route.name === "create" && <CreateFeed onSubmit={onCreate} canWrite={canWrite && Boolean(wallet)} blockReason={blockReason} busy={busy} />}
        {route.name === "preview" && <Preview fetchImpl={fetchImpl} />}
        {route.name === "how" && <HowItWorks />}
      </main>

      <footer className="foot muted small">
        <span>Contract: {deployed ? <a href={`${EXPLORER_BASE}/address/${contractAddress}`} target="_blank" rel="noreferrer" className="mono">{short(contractAddress)}</a> : "not deployed yet"}</span>
        <span><a href={CONTRACT_REPO} target="_blank" rel="noreferrer">Contract source</a> · <a href={APP_REPO} target="_blank" rel="noreferrer">App source</a></span>
        {!demo && <button type="button" className="linklike" onClick={() => setDemo(true)}>Demo data</button>}
      </footer>
      <TxLog txs={txs} />
    </div>
  );
}

function StatsStrip({ stats }) {
  const by = stats.by ?? {};
  const items = [["Feeds", stats.feeds], ["Backed", by.FULLY_BACKED ?? 0], ["Under", by.UNDER_COLLATERALIZED ?? 0], ["Stale", by.STALE ?? 0], ["Unverifiable", by.UNVERIFIABLE ?? 0]];
  return (
    <dl className="stats" aria-label="Registry stats">
      {items.map(([k, v]) => <div key={k} className="stat"><dt>{k}</dt><dd className="mono">{v}</dd></div>)}
    </dl>
  );
}

function NotDeployed({ onDemo }) {
  return (
    <section className="panel not-deployed" aria-label="Contract not deployed">
      <span className="nd-icon"><Icon name="inbox" size={30} /></span>
      <h2>Contract not deployed yet</h2>
      <p className="muted">This app reads a Reserve Attestor contract on GenLayer Studionet. No address is configured (<code>VITE_CONTRACT_ADDRESS</code> is empty), so there are no feeds to read and nothing to sign.</p>
      <ol className="steps">
        <li>Deploy <code>contracts/reserve_attestor.py</code> in <a href={STUDIO_URL} target="_blank" rel="noreferrer">GenLayer Studio</a> (no constructor arguments).</li>
        <li>Create feeds with <code>create_feed</code> (the four real sources are in the <a href={CONTRACT_REPO} target="_blank" rel="noreferrer">contract README</a>) and call <code>attest</code>.</li>
        <li>Set <code>VITE_CONTRACT_ADDRESS</code> and redeploy this app.</li>
      </ol>
      <div className="row gap wrap center">
        <button type="button" className="btn primary" onClick={onDemo}><Icon name="sparkle" size={16} />Browse demo data</button>
        <a className="btn ghost" href="#/preview"><Icon name="eye" size={16} />Try the live preview</a>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="panel how" aria-label="How it works">
      <h2>How it works</h2>
      <ol className="flow">
        <li><strong>Register a feed.</strong> Issuer, asset, the public source URL, where the reserves, liabilities and report date are (JSON paths or page labels), a minimum ratio and a maximum report age.</li>
        <li><strong>Anyone calls <code>attest</code>.</strong> The leader validator fetches the source. JSON is parsed by contract code with exact decimals; for HTML an LLM quotes the amounts and the contract checks each quote is on the page right after its label, with every occurrence of the label agreeing.</li>
        <li><strong>Validators re-read and vote.</strong> They accept if reserves and liabilities are each within 0.5 %, the as-of within an hour, and the computed status is identical. If nobody can read the source, they agree on <em>Unverifiable</em>.</li>
        <li><strong>The contract decides the status.</strong> Ratio = reserves × 10000 ÷ liabilities. Old report → <em>Stale</em>; below the minimum → <em>Under-collateralized</em>; else <em>Fully backed</em>. History keeps the last 30.</li>
        <li><strong>Other contracts read it.</strong> <code>is_backed(feed_id, max_age_hours)</code>, <code>meets(feed_id, min_ratio_bps, max_age_hours)</code> or <code>get_backing(feed_id)</code>.</li>
      </ol>
      <h3>Statuses</h3>
      <ul className="legend">
        <li><span className="badge tone-good">Fully backed</span> ratio ≥ minimum and the report is recent</li>
        <li><span className="badge tone-bad">Under-collateralized</span> ratio below the minimum</li>
        <li><span className="badge tone-warn">Stale report</span> verified numbers, report older than the feed allows</li>
        <li><span className="badge tone-void">Unverifiable</span> no verified numbers: unreachable, changed page, bad or negative numbers, zero liabilities, a units mismatch or a failed injection check</li>
      </ul>
      <p className="muted small">Wallet transactions go to GenLayer Studionet (chain 61999); the app adds the network to MetaMask if needed and never sees a private key.</p>
    </section>
  );
}
