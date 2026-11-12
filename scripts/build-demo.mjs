// Builds src/demo/demo-data.json: the dApp's "demo data" mode.
//
// Every number comes from a real response body fetched on 2026-11-12 (tests/fixtures/*, captured
// with curl, and docs/samples.jsonl, repeated plain GETs of the JSON sources). Each reading is run
// through src/lib/extract.js (the port of the contract's extraction and _classify rules) at the
// time it was fetched. Nothing here is an on-chain attestation; the UI labels it as demo data.
//
//   node scripts/build-demo.mjs

import fs from "node:fs";
import { classify, fmtMicro, readSource } from "../src/lib/extract.js";
import { PRESETS } from "../src/lib/attestor.js";

const fx = (n) => fs.readFileSync(new URL(`../tests/fixtures/${n}`, import.meta.url), "utf8");
const samples = fs.readFileSync(new URL("../docs/samples.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const OWNER = "0x0000000000000000000000000000000000000000";
const preset = (asset) => PRESETS.find((p) => p.form.asset === asset).form;
const cfgOf = (form) => ({ ...form, reserves_decimals: Number(form.reserves_decimals), liabilities_decimals: Number(form.liabilities_decimals), min_ratio_bps: Number(form.min_ratio_bps), max_age_hours: Number(form.max_age_hours) });

// fixture capture time (docs/sources.md)
const FIXTURE_AT = "2026-11-12T09:52:40Z";

function attestation(n, cfg, body, at) {
  const reading = readSource(body, cfg);
  const now = new Date(at);
  const c = classify(reading, cfg.min_ratio_bps, cfg.max_age_hours, now);
  return {
    n, status: c.status,
    reserves: reading.ok ? fmtMicro(reading.reserves) : "", liabilities: reading.ok ? fmtMicro(reading.liabilities) : "",
    ratio_bps: reading.ok ? c.ratio_bps : 0, as_of: reading.ok ? reading.as_of : "",
    age_hours: reading.ok ? Math.floor((now - new Date(reading.as_of)) / 3600_000) : 0,
    attested_at: at.replace(/\.\d+Z$/, "Z"), error: c.error, evidence: reading.evidence ?? "",
    evidence_hash: "", min_ratio_bps: cfg.min_ratio_bps, max_age_hours: cfg.max_age_hours, source_version: 1, policy_version: 1, attestor: OWNER,
  };
}

const jsonBody = (asset, s) => {
  switch (asset) {
    case "USDB": case "mUSD": return JSON.stringify({ last_updated: s.as_of, total_onchain_amount: s.liabilities, total_reserve_amount: s.reserves });
    case "TUSD": return JSON.stringify({ totalTrust: s.reserves, totalToken: s.liabilities, updatedAt: s.as_of });
    case "SPYx": return JSON.stringify({ sharesHeld: s.reserves, circulatingSupply: s.liabilities, timestamp: s.as_of });
    case "USDT": return JSON.stringify({ data: { usdt: { total_assets: s.reserves, total_liabilities: s.liabilities, id: s.as_of } } });
    default: throw new Error(asset);
  }
};

function feed(id, form, history, note) {
  const cfg = cfgOf(form);
  const hist = history.map((h, i) => ({ ...h, n: i + 1 }));
  const latest = hist.at(-1) ?? null;
  const good = [...hist].reverse().find((h) => h.status !== "UNVERIFIABLE") ?? null;
  let fails = 0;
  for (const h of [...hist].reverse()) { if (h.status === "UNVERIFIABLE") fails++; else break; }
  return {
    id, owner: OWNER, ...cfg, source_host: new URL(cfg.source_url).host, paused: false, created_at: FIXTURE_AT,
    source_version: 1, policy_version: 1, attest_count: hist.length, consecutive_failures: fails,
    last_attested_at: latest?.attested_at ?? "", latest, last_good: good, history: [...hist].reverse(), demo_note: note,
  };
}

function seriesFor(asset, cfg, fixtureName, fixtureAt = FIXTURE_AT) {
  const out = [attestation(0, cfg, fx(fixtureName), fixtureAt)];
  for (const s of samples.filter((x) => x.asset === asset)) out.push(attestation(0, cfg, jsonBody(asset, s), s.fetched_at));
  return out;
}

const usdb = preset("USDB"), tusd = preset("TUSD"), rlusd = preset("RLUSD"), spyx = preset("SPYx");
const musdStrict = { ...usdb, issuer: "Bridge (Stripe) · strict 100.5 % policy", asset: "mUSD", source_url: "https://transparency.bridge.xyz/v0/stablecoins/musd", min_ratio_bps: "10050" };
const rlusd72 = { ...rlusd, issuer: "Ripple (Standard Custody) · 72 h policy", max_age_hours: "72" };
const usdt = { issuer: "Tether", asset: "USDT", source_url: "https://app.tether.to/transparency.json", kind: "json", reserves_field: "data.usdt.total_assets", liabilities_field: "data.usdt.total_liabilities", asof_field: "data.usdt.id", date_order: "", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "72" };
const circle = { issuer: "Circle (JS-rendered page)", asset: "USDC", source_url: "https://www.circle.com/transparency", kind: "html", reserves_field: "Total Reserves", liabilities_field: "In circulation", asof_field: "As of", date_order: "", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "336" };

const feeds = [
  feed(1, usdb, seriesFor("USDB", cfgOf(usdb), "bridge_usdb.json"), "Bridge's issuer API. Readings: the curl fixture plus repeated GETs on 2026-11-12."),
  feed(2, tusd, seriesFor("TUSD", cfgOf(tusd), "ledgerlens_trueusd.json"), "TrueUSD real-time attestation. Its updatedAt is the response time."),
  feed(3, rlusd, [attestation(0, cfgOf(rlusd), fx("ripple_rlusd.html"), FIXTURE_AT)], "HTML page. Figures are the amounts printed after each label; validators would have an LLM quote them and the contract verify them."),
  feed(4, spyx, seriesFor("SPYx", cfgOf(spyx), "xstocks_spyx.json"), "SPY shares held at the custodian vs SPYx tokens outstanding."),
  feed(5, usdt, seriesFor("USDT", cfgOf(usdt), "tether_transparency.json"), "As-of read from data.usdt.id, assumed to be a Unix timestamp (undocumented)."),
  feed(6, musdStrict, seriesFor("mUSD", cfgOf(musdStrict), "bridge_musd.json"), "Same real numbers as Bridge's mUSD, under a stricter 100.5 % minimum: shows UNDER_COLLATERALIZED."),
  feed(7, rlusd72, [attestation(0, cfgOf(rlusd72), fx("ripple_rlusd.html"), FIXTURE_AT)], "Same Ripple page under a 72 h maximum age: the 11/05 report is STALE."),
  feed(8, circle, [attestation(0, cfgOf(circle), fx("circle_transparency.txt"), "2026-11-12T10:08:40Z")], "Circle renders its figures with JavaScript, so a validator's GET sees labels without numbers: UNVERIFIABLE."),
];

const by = {};
for (const f of feeds) by[f.latest.status] = (by[f.latest.status] ?? 0) + 1;
const out = { generated_from: "tests/fixtures + docs/samples.jsonl (real responses, 2026-11-12)", captured_until: samples.at(-1).fetched_at, stats: { feeds: feeds.length, by }, feeds };
fs.mkdirSync(new URL("../src/demo/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../src/demo/demo-data.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
for (const f of feeds) console.log(f.id, f.asset.padEnd(6), f.latest.status.padEnd(22), f.latest.ratio_bps, f.history.length, f.latest.error);

// Snapshots for the preview's "read the captured copy" fallback (sources that block browser CORS).
import { htmlToText } from "../src/lib/extract.js";
const snap = {
  "https://transparency.bridge.xyz/v0/stablecoins/usdb": { captured_at: "2026-11-12T09:52:40Z", body: fx("bridge_usdb.json") },
  "https://transparency.bridge.xyz/v0/stablecoins/musd": { captured_at: "2026-11-12T09:52:40Z", body: fx("bridge_musd.json") },
  "https://api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD": { captured_at: "2026-11-12T09:52:40Z", body: fx("ledgerlens_trueusd.json") },
  "https://api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx": { captured_at: "2026-11-12T09:52:40Z", body: fx("xstocks_spyx.json") },
  "https://ripple.com/solutions/stablecoin/transparency/": { captured_at: "2026-11-12T09:52:40Z", body: htmlToText(fx("ripple_rlusd.html")), stripped: true },
};
fs.writeFileSync(new URL("../src/demo/snapshots.json", import.meta.url), JSON.stringify(snap) + "\n");
console.log("snapshots", Object.keys(snap).length, JSON.stringify(snap).length, "bytes");
