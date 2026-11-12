// A line-by-line JavaScript port of the reading and status rules in contracts/reserve_attestor.py
// (gosof32/genlayer-reserve-atterstor). The dApp uses it for the live preview ("what validators
// would read") and the demo data. The contract stays the source of truth; tests/frontend/
// extract.test.js checks this port against the same real fixtures the contract tests use.

export const MICRO = 1_000_000n;
export const MAX_AMOUNT_MICRO = 10n ** 15n * MICRO;
export const MAX_RATIO_BPS = 1_000_000n;
export const FUTURE_SKEW_MS = 3600_000;
export const ANCHOR_WINDOW = 300;

const NUM_RE = /^\+?(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d{1,2}))?$/;
const AMOUNT_SRC = String.raw`(?<![\w/.,])(US\$|USD|[$€£¥])?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?(thousand|million|billion|trillion|bn|mn|k|m|b|t)?(?![\w/])`;
export const amountRe = () => new RegExp(AMOUNT_SRC, "gi");
const UNIT_POW = { "": 0, k: 3, thousand: 3, m: 6, mn: 6, million: 6, b: 9, bn: 9, billion: 9, t: 12, trillion: 12 };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const NUM_DATE_RE = /(?<!\d)(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?!\d)/;
const MDY_NAME_RE = new RegExp(MONTH + String.raw`\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})`, "i");
const DMY_NAME_RE = new RegExp(String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+` + MONTH + String.raw`,?\s+(\d{4})`, "i");

const pow10 = (n) => 10n ** BigInt(n);

// ---------- numbers

export function numToMicro(text, decimals = 0) {
  const s = String(text).trim().replace(/[,_]/g, "");
  if (s.startsWith("-")) return { micro: null, error: "negative amount" };
  const m = NUM_RE.exec(s);
  if (!m) return { micro: null, error: "not a number" };
  const ip = m[1], fp = m[2] ?? "", ex = Number(m[3] ?? 0);
  const digits = BigInt(ip + fp);
  const shift = ex - fp.length - decimals + 6;
  const micro = shift >= 0 ? digits * pow10(shift) : digits / pow10(-shift);
  if (micro > MAX_AMOUNT_MICRO) return { micro: null, error: "amount implausibly large (check decimals)" };
  return { micro, error: "" };
}

export function fmtMicro(micro) {
  const v = BigInt(micro);
  const whole = v / MICRO;
  const frac = (v % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

function amountToMicro(m) {
  const ip = m[2].replace(/,/g, "");
  const fp = m[3] ?? "";
  const shift = UNIT_POW[(m[4] ?? "").toLowerCase()] - fp.length + 6;
  const digits = BigInt(ip + fp);
  return shift >= 0 ? digits * pow10(shift) : digits / pow10(-shift);
}

const isStrong = (m) => Boolean(m[1] || m[4] || m[2].includes(",") || m[3]);

export function parseSnippet(snippet) {
  const s = String(snippet ?? "").split(/\s+/).filter(Boolean).join(" ");
  if (!s || s.length > 60) return { micro: null, error: "amount snippet missing or too long" };
  if (/[-(−]/.test(s)) return { micro: null, error: "negative amount" };
  const found = [...s.matchAll(amountRe())];
  if (found.length !== 1) return { micro: null, error: "snippet must contain exactly one amount" };
  const micro = amountToMicro(found[0]);
  if (micro > MAX_AMOUNT_MICRO) return { micro: null, error: "amount implausibly large" };
  return { micro, error: "" };
}

// ---------- dates

const utc = (y, m, d, hh = 0, mm = 0, ss = 0) => {
  if (m < 1 || m > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d && hh < 24 && mm < 60 && ss < 60 ? t : null;
};

const monthIndex = (name) => {
  const key = name.toLowerCase().replace(/\.$/, "").slice(0, 3);
  return MONTHS.findIndex((full) => full.startsWith(key)) + 1;
};

function fromIso(s) {
  let v = String(s).trim().replace("Z", "+00:00");
  if (!/[+-]\d{2}:\d{2}$/.test(v) && /T|\s\d{2}:/.test(v)) v += "+00:00";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += "T00:00:00+00:00";
  const t = new Date(v.replace(" ", "T"));
  return Number.isNaN(t.getTime()) ? null : t;
}

export function parseDateText(text, dateOrder = "") {
  const s = String(text ?? "").split(/\s+/).filter(Boolean).join(" ");
  let m = ISO_DATE_RE.exec(s);
  if (m) {
    let ts = null;
    if (m[4] !== undefined) ts = fromIso(s.slice(m.index)) ?? utc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0));
    else ts = utc(+m[1], +m[2], +m[3]);
    return ts ? { ts, error: "" } : { ts: null, error: "invalid date" };
  }
  if ((m = MDY_NAME_RE.exec(s))) {
    const ts = utc(+m[3], monthIndex(m[1]), +m[2]);
    return ts ? { ts, error: "" } : { ts: null, error: "invalid date" };
  }
  if ((m = DMY_NAME_RE.exec(s))) {
    const ts = utc(+m[3], monthIndex(m[2]), +m[1]);
    return ts ? { ts, error: "" } : { ts: null, error: "invalid date" };
  }
  if ((m = NUM_DATE_RE.exec(s))) {
    const a = +m[1], b = +m[2], y = +m[3];
    let ts;
    if (dateOrder === "MDY") ts = utc(y, a, b);
    else if (dateOrder === "DMY") ts = utc(y, b, a);
    else if (a > 12 && b <= 12) ts = utc(y, b, a);
    else if (b > 12 && a <= 12) ts = utc(y, a, b);
    else if (a === b) ts = utc(y, a, b);
    else return { ts: null, error: "ambiguous numeric date; set date_order to MDY or DMY" };
    return ts ? { ts, error: "" } : { ts: null, error: "invalid date" };
  }
  return { ts: null, error: "no date found" };
}

export function parseAsof(value, dateOrder = "") {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "object") {
    return { ts: null, error: "as-of is not a date" };
  }
  const s = String(value).trim();
  if (/^\d{10}(\.\d+)?$/.test(s)) return { ts: new Date(Number(s.split(".")[0]) * 1000), error: "" };
  if (/^\d{13}$/.test(s)) return { ts: new Date(Math.floor(Number(s) / 1000) * 1000), error: "" };
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s)) {
    const t = fromIso(s);
    if (t) return { ts: t, error: "" };
  }
  return parseDateText(s, dateOrder);
}

export const isoSeconds = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");

// ---------- sources

// JSON with every number kept as exact text (the contract uses parse_float=str / parse_int=str).
export function parseJsonExact(body) {
  const quoted = String(body).replace(/("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (all, str, num) => (str ? str : `"${num}"`));
  return JSON.parse(quoted);
}

export function jsonGet(doc, path) {
  let cur = doc;
  for (const tok of String(path).match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    if (tok.startsWith("[")) {
      const i = Number(tok.slice(1, -1));
      if (!Array.isArray(cur) || i >= cur.length) return { value: undefined, found: false };
      cur = cur[i];
    } else if (cur && typeof cur === "object" && !Array.isArray(cur) && Object.prototype.hasOwnProperty.call(cur, tok)) {
      cur = cur[tok];
    } else if (Array.isArray(cur) && /^\d+$/.test(tok) && Number(tok) < cur.length) {
      cur = cur[Number(tok)];
    } else return { value: undefined, found: false };
  }
  return { value: cur, found: true };
}

export function htmlToText(raw) {
  return String(raw)
    .replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#36;/g, "$")
    .replace(/&#(\d{1,6});/g, (_, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : " "))
    .split(/\s+/).filter(Boolean).join(" ");
}

export function anchoredValues(page, label) {
  const low = page.toLowerCase(), lab = label.toLowerCase();
  const out = [];
  let pos = low.indexOf(lab);
  while (pos >= 0) {
    const start = pos + lab.length;
    const win = page.slice(start, start + ANCHOR_WINDOW);
    for (const m of win.matchAll(amountRe())) {
      if (isStrong(m)) { out.push({ micro: amountToMicro(m), snippet: m[0].trim(), at: start + m.index }); break; }
    }
    pos = low.indexOf(lab, pos + 1);
  }
  return out;
}

const fail = (error) => ({ ok: false, error: error.slice(0, 160), reserves: 0n, liabilities: 0n, as_of: "", evidence: "" });

export function readJson(body, cfg) {
  let doc;
  try { doc = parseJsonExact(body); } catch { return fail("source is not JSON"); }
  const fig = {};
  for (const [key, path, dec] of [["reserves", cfg.reserves_field, cfg.reserves_decimals], ["liabilities", cfg.liabilities_field, cfg.liabilities_decimals]]) {
    const { value, found } = jsonGet(doc, path);
    if (!found) return fail(`${key}: path ${path} not found`);
    if (value === null || typeof value === "object" || typeof value === "boolean") return fail(`${key}: value at ${path} is not a number`);
    const { micro, error } = numToMicro(String(value), Number(dec) || 0);
    if (micro === null) return fail(`${key}: ${error}`);
    fig[key] = { micro, raw: `${path}=${String(value).slice(0, 40)}` };
  }
  const { value, found } = jsonGet(doc, cfg.asof_field);
  if (!found) return fail(`as-of: path ${cfg.asof_field} not found`);
  const { ts, error } = parseAsof(value, cfg.date_order);
  if (!ts) return fail(`as-of: ${error}`);
  return { ok: true, error: "", reserves: fig.reserves.micro, liabilities: fig.liabilities.micro, as_of: isoSeconds(ts),
    evidence: `${fig.reserves.raw} | ${fig.liabilities.raw} | ${cfg.asof_field}=${String(value).slice(0, 40)}` };
}

// HTML without a model: the browser cannot run the validators' LLM, so the preview shows the
// amount the contract's anchoring check expects after each label (the model must quote that one).
export function readHtmlAnchored(body, cfg) {
  const page = htmlToText(body);
  if (!page) return fail("source page is empty");
  const fig = {};
  for (const [key, label] of [["reserves", cfg.reserves_field], ["liabilities", cfg.liabilities_field]]) {
    if (!page.toLowerCase().includes(label.toLowerCase())) return fail(`label not on the page: ${label.slice(0, 40)}`);
    const vals = anchoredValues(page, label);
    const distinct = new Set(vals.map((v) => v.micro));
    if (distinct.size > 1) return fail(`${key}: label is followed by conflicting amounts`);
    if (!vals.length) return fail(`${key}: no amount follows the label`);
    fig[key] = vals[0];
  }
  const lab = cfg.asof_field.toLowerCase();
  const i = page.toLowerCase().indexOf(lab);
  if (i < 0) return fail("as-of label not on the page");
  const asofText = page.slice(i, i + 80);
  const { ts, error } = parseDateText(asofText, cfg.date_order);
  if (!ts) return fail(`as-of: ${error}`);
  return { ok: true, error: "", reserves: fig.reserves.micro, liabilities: fig.liabilities.micro, as_of: isoSeconds(ts),
    evidence: `${fig.reserves.snippet} | ${fig.liabilities.snippet} | ${asofText.slice(0, 40)}`, page };
}

export function readSource(body, cfg) {
  return cfg.kind === "html" ? readHtmlAnchored(body, cfg) : readJson(body, cfg);
}

// ---------- status (contract _classify)

export function classify(reading, minRatioBps, maxAgeHours, now = new Date()) {
  if (!reading.ok) return { status: "UNVERIFIABLE", ratio_bps: 0, error: reading.error || "unreadable source" };
  const res = BigInt(reading.reserves), liab = BigInt(reading.liabilities);
  if (liab <= 0n) return { status: "UNVERIFIABLE", ratio_bps: 0, error: "liabilities are zero" };
  const ratio = (res * 10000n) / liab;
  if (ratio > MAX_RATIO_BPS) return { status: "UNVERIFIABLE", ratio_bps: 0, error: "ratio implausibly high (check units / decimals)" };
  const asOf = new Date(reading.as_of).getTime();
  const r = Number(ratio);
  if (asOf > now.getTime() + FUTURE_SKEW_MS) return { status: "UNVERIFIABLE", ratio_bps: r, error: "report dated in the future" };
  if (now.getTime() - asOf > maxAgeHours * 3600_000) return { status: "STALE", ratio_bps: r, error: "" };
  return { status: r >= minRatioBps ? "FULLY_BACKED" : "UNDER_COLLATERALIZED", ratio_bps: r, error: "" };
}
