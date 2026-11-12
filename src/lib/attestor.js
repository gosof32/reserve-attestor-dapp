// Contract constants, form validation, normalization of view results and read helpers, mirrored
// from contracts/reserve_attestor.py (gosof32/genlayer-reserve-atterstor) so the UI only offers
// what the contract accepts. Everything here is pure except the read* helpers.

// ---------- contract constants (keep in sync with reserve_attestor.py)

export const LIMITS = {
  issuerMin: 2,
  issuerMax: 60,
  fieldMax: 120,
  urlMax: 300,
  maxDecimals: 36,
  minRatioBps: [1000, 30000],
  maxAgeHours: [1, 24 * 400],
  historyLimit: 30,
  maxFeedsPerOwner: 25,
  minAttestIntervalS: 300,
  toleranceBps: 50,
  asofToleranceS: 3600,
};

export const STATUSES = ["FULLY_BACKED", "UNDER_COLLATERALIZED", "STALE", "UNVERIFIABLE"];

export const STATUS_TEXT = {
  FULLY_BACKED: "Fully backed",
  UNDER_COLLATERALIZED: "Under-collateralized",
  STALE: "Stale report",
  UNVERIFIABLE: "Unverifiable",
  NEVER: "Not attested yet",
};

export const STATUS_HINT = {
  FULLY_BACKED: "Reserves cover liabilities at or above the feed's minimum ratio, and the report is recent.",
  UNDER_COLLATERALIZED: "Reserves are below the feed's minimum ratio.",
  STALE: "The numbers were verified, but the report is older than the feed allows.",
  UNVERIFIABLE: "Validators could not get verified numbers from the source (unreachable, changed, bad numbers or a failed check).",
  NEVER: "Nobody has called attest on this feed yet.",
};

export const STATUS_TONE = {
  FULLY_BACKED: "good",
  UNDER_COLLATERALIZED: "bad",
  STALE: "warn",
  UNVERIFIABLE: "void",
  NEVER: "idle",
};

const HOST_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const URL_RE = /^https:\/\/([A-Za-z0-9.-]+)(\/[^\s<>"'\\@#]*)?$/;
const PATH_RE = /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+|\[\d{1,4}\])*$/;
const ASSET_RE = /^[A-Za-z0-9][A-Za-z0-9.$_-]{0,19}$/;
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const squash = (s) => String(s ?? "").split(/\s+/).filter(Boolean).join(" ");

// ---------- form validation (same rules, same order as create_feed)

export const EMPTY_FORM = {
  issuer: "", asset: "", source_url: "", kind: "json", reserves_field: "", liabilities_field: "", asof_field: "",
  date_order: "", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "24",
};

export function validateFeed(form) {
  const errors = {};
  const issuer = squash(form.issuer);
  if (issuer.length < LIMITS.issuerMin || issuer.length > LIMITS.issuerMax) errors.issuer = "2-60 characters";
  const asset = String(form.asset ?? "").trim();
  if (!ASSET_RE.test(asset)) errors.asset = "A ticker: 1-20 letters/digits (. $ _ - allowed)";
  const url = String(form.source_url ?? "").trim();
  const m = URL_RE.exec(url);
  if (url.length > LIMITS.urlMax) errors.source_url = "At most 300 characters";
  else if (!m) errors.source_url = "A plain https URL (no user@, no #fragment)";
  else if (!HOST_RE.test(m[1].toLowerCase())) errors.source_url = "Use a public host name (no IPs, no localhost)";
  const kind = String(form.kind ?? "").trim().toLowerCase();
  if (!["json", "html"].includes(kind)) errors.kind = "json or html";
  const dateOrder = String(form.date_order ?? "").trim().toUpperCase();
  if (!["", "MDY", "DMY"].includes(dateOrder)) errors.date_order = "MDY, DMY or empty";
  const fields = {};
  for (const name of ["reserves_field", "liabilities_field", "asof_field"]) {
    const v = squash(form[name]);
    fields[name] = v;
    if (v.length < 1 || v.length > LIMITS.fieldMax) errors[name] = "1-120 characters";
    else if (kind === "json" && !PATH_RE.test(v)) errors[name] = "A JSON path like data.usdt.total_assets or holdings[0].quantity";
    else if (kind === "html" && v.length < 2) errors[name] = "The label text shown on the page";
  }
  if (!errors.reserves_field && !errors.liabilities_field) {
    if (kind === "html" && fields.reserves_field.toLowerCase() === fields.liabilities_field.toLowerCase()) errors.liabilities_field = "Must differ from the reserves label";
    if (kind === "json" && fields.reserves_field === fields.liabilities_field) errors.liabilities_field = "Must differ from the reserves path";
  }
  const ints = {};
  for (const name of ["reserves_decimals", "liabilities_decimals", "min_ratio_bps", "max_age_hours"]) {
    const s = String(form[name] ?? "").trim();
    ints[name] = /^-?\d+$/.test(s) ? Number(s) : NaN;
  }
  for (const name of ["reserves_decimals", "liabilities_decimals"]) {
    if (!(ints[name] >= 0 && ints[name] <= LIMITS.maxDecimals)) errors[name] = "0-36";
    else if (kind === "html" && ints[name] !== 0) errors[name] = "HTML pages show human amounts: use 0";
  }
  const [rlo, rhi] = LIMITS.minRatioBps;
  if (!(ints.min_ratio_bps >= rlo && ints.min_ratio_bps <= rhi)) errors.min_ratio_bps = "1000-30000 (10000 = 100 %)";
  const [alo, ahi] = LIMITS.maxAgeHours;
  if (!(ints.max_age_hours >= alo && ints.max_age_hours <= ahi)) errors.max_age_hours = `${alo}-${ahi} hours`;
  const ok = Object.keys(errors).length === 0;
  const args = ok
    ? [issuer, asset, url, kind, fields.reserves_field, fields.liabilities_field, fields.asof_field, dateOrder,
      ints.reserves_decimals, ints.liabilities_decimals, ints.min_ratio_bps, ints.max_age_hours]
    : null;
  return { ok, errors, args };
}

// Presets: the real sources the contract was built against (docs/sources.md).
export const PRESETS = [
  { label: "Bridge USDB (JSON)", form: { issuer: "Bridge (Stripe)", asset: "USDB", source_url: "https://transparency.bridge.xyz/v0/stablecoins/usdb", kind: "json", reserves_field: "total_reserve_amount", liabilities_field: "total_onchain_amount", asof_field: "last_updated", date_order: "", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "24" } },
  { label: "TrueUSD real-time (JSON)", form: { issuer: "TrueUSD (Chainlink PoR via LedgerLens)", asset: "TUSD", source_url: "https://api.real-time-reserves.ledgerlens.io/v1/chainlink/proof-of-reserves/TrueUSD", kind: "json", reserves_field: "totalTrust", liabilities_field: "totalToken", asof_field: "updatedAt", date_order: "", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "24" } },
  { label: "Ripple RLUSD (HTML)", form: { issuer: "Ripple (Standard Custody)", asset: "RLUSD", source_url: "https://ripple.com/solutions/stablecoin/transparency/", kind: "html", reserves_field: "RLUSD Reserve Funds", liabilities_field: "Total Circulating RLUSD", asof_field: "As of", date_order: "MDY", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "336" } },
  { label: "xStocks SPYx (JSON)", form: { issuer: "Backed / xStocks", asset: "SPYx", source_url: "https://api.xstocks.fi/api/v2/public/proof-of-reserves/SPYx", kind: "json", reserves_field: "sharesHeld", liabilities_field: "circulatingSupply", asof_field: "timestamp", date_order: "", reserves_decimals: "0", liabilities_decimals: "0", min_ratio_bps: "10000", max_age_hours: "48" } },
];

// ---------- calldata normalization (genlayer-js may return Maps and BigInts)

export function plain(v) {
  if (v instanceof Map) return Object.fromEntries([...v.entries()].map(([k, x]) => [k, plain(x)]));
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

const num = (x) => Number(x ?? 0);
const str = (x) => (x == null ? "" : String(x));

export function normalizeAttestation(raw) {
  const a = plain(raw) ?? {};
  if (!a || !a.status) return null;
  return {
    n: num(a.n), status: str(a.status), reserves: str(a.reserves), liabilities: str(a.liabilities),
    ratio_bps: num(a.ratio_bps), as_of: str(a.as_of), age_hours: num(a.age_hours), attested_at: str(a.attested_at),
    error: str(a.error), evidence: str(a.evidence), evidence_hash: str(a.evidence_hash),
    min_ratio_bps: num(a.min_ratio_bps), max_age_hours: num(a.max_age_hours), source_version: num(a.source_version),
    policy_version: num(a.policy_version), attestor: str(a.attestor),
  };
}

export function normalizeFeed(raw) {
  const f = plain(raw) ?? {};
  const out = {};
  for (const k of ["owner", "issuer", "asset", "source_url", "source_host", "kind", "reserves_field", "liabilities_field",
    "asof_field", "date_order", "created_at", "last_attested_at"]) out[k] = str(f[k]);
  for (const k of ["id", "reserves_decimals", "liabilities_decimals", "min_ratio_bps", "max_age_hours", "source_version",
    "policy_version", "attest_count", "consecutive_failures"]) out[k] = num(f[k]);
  out.paused = Boolean(f.paused);
  out.latest = normalizeAttestation(f.latest);
  out.last_good = normalizeAttestation(f.last_good);
  out.history = Array.isArray(f.history) ? f.history.map(normalizeAttestation).filter(Boolean) : undefined;
  return out;
}

export const feedStatus = (f) => f?.latest?.status ?? "NEVER";

// ---------- formatting

export const pct = (bps) => `${(Number(bps) / 100).toFixed(2)} %`;

export function compact(amount) {
  const v = Number(amount);
  if (!Number.isFinite(v) || amount === "") return "—";
  const abs = Math.abs(v);
  const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [d, u] of units) if (abs >= d) return `${(v / d).toFixed(abs / d >= 100 ? 1 : 2)}${u}`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function exact(amount) {
  const s = String(amount ?? "");
  if (!/^\d+(\.\d+)?$/.test(s)) return s || "—";
  const [w, f] = s.split(".");
  return BigInt(w).toLocaleString("en-US") + (f ? `.${f}` : "");
}

export function ago(iso, now = Date.now()) {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 0) return "in the future";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const when = (iso) => (iso ? iso.replace("T", " ").replace(/:\d{2}(\.\d+)?Z$/, " UTC") : "—");

// ---------- routes

export function parseRoute(hash) {
  const h = String(hash ?? "").replace(/^#/, "").split("?")[0];
  let m;
  if ((m = /^\/feed\/(\d+)$/.exec(h))) return { name: "feed", id: Number(m[1]) };
  if (h === "/create") return { name: "create" };
  if (h === "/preview") return { name: "preview" };
  if (h === "/how") return { name: "how" };
  return { name: "feeds" };
}

// ---------- reads (contract views)

const call = (client, address, functionName, args = []) => client.readContract({ address, functionName, args });

export async function readFeeds(client, address) {
  const out = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const page = plain(await call(client, address, "list_feeds", [offset, 50])) ?? [];
    out.push(...page.map(normalizeFeed));
    if (page.length < 50) break;
  }
  return out;
}

export async function readFeed(client, address, id) {
  const [feed, history] = await Promise.all([
    call(client, address, "get_feed", [id]),
    call(client, address, "get_history", [id, 0, LIMITS.historyLimit]),
  ]);
  const f = normalizeFeed(feed);
  f.history = (plain(history) ?? []).map(normalizeAttestation).filter(Boolean);
  return f;
}

export async function readStats(client, address) {
  const s = plain(await call(client, address, "get_stats", [])) ?? {};
  return { feeds: num(s.feeds), by: s.by_latest_status ?? {} };
}

export function summarizeAttest(returnValue) {
  if (!returnValue) return "";
  try {
    const r = typeof returnValue === "string" ? JSON.parse(returnValue) : returnValue;
    if (r?.status) return `${STATUS_TEXT[r.status] ?? r.status}${r.ratio_bps ? ` · ${pct(r.ratio_bps)}` : ""}${r.error ? ` · ${r.error}` : ""}`;
  } catch {
    // fall through: the receipt only carried a readable string
  }
  return String(returnValue).slice(0, 200);
}
