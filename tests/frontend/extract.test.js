// The browser port of the contract's reading rules, checked against the same real source bodies
// (tests/fixtures, fetched 2026-11-12) and the same expected numbers as the contract's own tests.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  anchoredValues, classify, fmtMicro, htmlToText, jsonGet, numToMicro, parseAsof, parseDateText, parseJsonExact,
  parseSnippet, readSource,
} from "../../src/lib/extract.js";
import { PRESETS } from "../../src/lib/attestor.js";

// Resolve from the project root: under the jsdom environment import.meta.url is not a file: URL.
const fx = (n) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", n), "utf8");
const NOW = new Date("2026-11-12T10:00:00Z");
const cfgOf = (asset, over = {}) => {
  const f = PRESETS.find((p) => p.form.asset === asset).form;
  return { ...f, reserves_decimals: 0, liabilities_decimals: 0, min_ratio_bps: Number(f.min_ratio_bps), max_age_hours: Number(f.max_age_hours), ...over };
};
const read = (body, cfg) => {
  const r = readSource(body, cfg);
  return { r, c: classify(r, cfg.min_ratio_bps, cfg.max_age_hours, NOW) };
};

describe("real sources (same numbers as the contract tests)", () => {
  it.each([
    ["USDB", "bridge_usdb.json", "64207984.97", "64106445.97", 10015, "2026-11-12T09:50:35Z"],
    ["TUSD", "ledgerlens_trueusd.json", "501928900.88", "494515082.75", 10149, "2026-11-12T09:52:36Z"],
    ["SPYx", "xstocks_spyx.json", "97653.998564", "97488.777516", 10016, "2026-11-12T09:40:26Z"],
  ])("%s", (asset, file, reserves, liabilities, ratio, asOf) => {
    const { r, c } = read(fx(file), cfgOf(asset));
    expect(r.ok).toBe(true);
    expect(fmtMicro(r.reserves)).toBe(reserves);
    expect(fmtMicro(r.liabilities)).toBe(liabilities);
    expect(r.as_of).toBe(asOf);
    expect(c).toEqual({ status: "FULLY_BACKED", ratio_bps: ratio, error: "" });
  });

  it("Tether nested paths and epoch as-of", () => {
    const cfg = { ...cfgOf("USDB"), reserves_field: "data.usdt.total_assets", liabilities_field: "data.usdt.total_liabilities", asof_field: "data.usdt.id", max_age_hours: 72 };
    const { r, c } = read(fx("tether_transparency.json"), cfg);
    expect(fmtMicro(r.reserves)).toBe("181345865229.9862");
    expect(fmtMicro(r.liabilities)).toBe("175878916674.156852");
    expect(r.as_of).toBe("2026-11-11T23:30:00Z");
    expect(c.ratio_bps).toBe(10310);
  });

  it("Ripple HTML: the amount after each label and the MDY as-of", () => {
    const { r, c } = read(fx("ripple_rlusd.html"), cfgOf("RLUSD"));
    expect(r.ok).toBe(true);
    expect(r.reserves).toBe(2_748_000_000n * 1_000_000n);
    expect(r.liabilities).toBe(2_632_900_000n * 1_000_000n);
    expect(r.as_of).toBe("2026-11-05T00:00:00Z");
    expect(r.evidence).toContain("$2,748.0M");
    expect(c).toEqual({ status: "FULLY_BACKED", ratio_bps: 10437, error: "" });
  });

  it("Ripple under a 72 h policy is STALE", () => {
    const { c } = read(fx("ripple_rlusd.html"), cfgOf("RLUSD", { max_age_hours: 72 }));
    expect(c.status).toBe("STALE");
  });

  it("an injected second label with another amount is refused", () => {
    const page = fx("ripple_rlusd.html").replace("</body>", "<div>RLUSD Reserve Funds $9,999.0B</div></body>");
    const { r, c } = read(page, cfgOf("RLUSD"));
    expect(r.ok).toBe(false);
    expect(c.status).toBe("UNVERIFIABLE");
    expect(c.error).toMatch(/conflicting amounts/);
  });

  it("script text is not page text", () => {
    const page = fx("ripple_rlusd.html").replace("</body>", '<script>x="RLUSD Reserve Funds $1.0M"</script></body>');
    expect(read(page, cfgOf("RLUSD")).c.status).toBe("FULLY_BACKED");
  });

  it("Circle's JS-rendered page has labels but no numbers", () => {
    const cfg = { ...cfgOf("RLUSD"), reserves_field: "Total Reserves", liabilities_field: "In circulation", date_order: "" };
    const { c } = read(fx("circle_transparency.txt"), cfg);
    expect(c.status).toBe("UNVERIFIABLE");
  });
});

describe("statuses", () => {
  const usdb = (over) => JSON.stringify({ ...JSON.parse(fx("bridge_usdb.json")), ...over });
  it.each([
    [{ total_reserve_amount: "60000000" }, "UNDER_COLLATERALIZED", ""],
    [{ total_onchain_amount: "0" }, "UNVERIFIABLE", "liabilities are zero"],
    [{ total_onchain_amount: "-1" }, "UNVERIFIABLE", "negative amount"],
    [{ total_reserve_amount: "64207984970000" }, "UNVERIFIABLE", "check units"],
    [{ total_reserve_amount: true }, "UNVERIFIABLE", "not a number"],
    [{ last_updated: "2026-11-12T12:00:00Z" }, "UNVERIFIABLE", "future"],
    [{ last_updated: "2026-11-11T09:00:00Z" }, "STALE", ""],
    [{ last_updated: "05/06/2026" }, "UNVERIFIABLE", "ambiguous"],
  ])("%j -> %s", (over, status, err) => {
    const { c } = read(usdb(over), cfgOf("USDB"));
    expect(c.status).toBe(status);
    expect(c.error).toContain(err);
  });

  it("not JSON", () => {
    expect(read("<html>down</html>", cfgOf("USDB")).c.error).toContain("not JSON");
  });

  it("decimals scale base units", () => {
    const { r } = read(usdb({ total_onchain_amount: "64106445970000" }), cfgOf("USDB", { liabilities_decimals: 6 }));
    expect(fmtMicro(r.liabilities)).toBe("64106445.97");
  });
});

describe("helpers", () => {
  it.each([
    ["1", 0, 1_000_000n], ["0.0000019", 0, 1n], ["1,234.5", 0, 1_234_500_000n], ["1.5E3", 0, 1_500_000_000n],
    ["2500000", 6, 2_500_000n], ["1000000000000000000", 18, 1_000_000n], ["+7", 0, 7_000_000n],
  ])("numToMicro(%s, %i)", (t, d, m) => expect(numToMicro(t, d)).toEqual({ micro: m, error: "" }));

  it.each(["", "abc", "1.2.3", "--1", "0x10", "1e"])("numToMicro rejects %j", (t) => expect(numToMicro(t, 0).micro).toBeNull());

  it.each([
    ["As of 11/05/2026", "MDY", "2026-11-05"], ["As of 11/05/2026", "DMY", "2026-05-11"], ["as at 25.10.2026", "", "2026-10-25"],
    ["Report date: October 31, 2026", "", "2026-10-31"], ["Updated 3rd Nov 2026", "", "2026-11-03"], ["Sept. 30, 2026", "", "2026-09-30"],
    ["2026-11-05T10:20:00Z", "", "2026-11-05"],
  ])("parseDateText(%s, %s)", (t, o, iso) => expect(parseDateText(t, o).ts.toISOString().slice(0, 10)).toBe(iso));

  it.each([
    ["1794474000", "2026-11-12T09:00:00.000Z"], ["1794474000000", "2026-11-12T09:00:00.000Z"], ["2026-11-12", "2026-11-12T00:00:00.000Z"],
    ["2026-11-12T16:00:00+07:00", "2026-11-12T09:00:00.000Z"], ["2026-11-12T09:00:00", "2026-11-12T09:00:00.000Z"],
  ])("parseAsof(%s)", (v, iso) => expect(parseAsof(v, "").ts.toISOString()).toBe(iso));

  it("parseAsof rejects non-dates", () => {
    expect(parseAsof(true).error).toBe("as-of is not a date");
    expect(parseAsof(null).error).toBe("as-of is not a date");
  });

  it("parseJsonExact keeps number text exact", () => {
    expect(parseJsonExact('{"a": 501928900.88, "b": [1e3, "x"], "c": true}')).toEqual({ a: "501928900.88", b: ["1e3", "x"], c: true });
  });

  it("jsonGet", () => {
    const doc = { a: { b: [{ c: "1" }, { c: "2" }] } };
    expect(jsonGet(doc, "a.b[1].c")).toEqual({ value: "2", found: true });
    expect(jsonGet(doc, "a.b.0.c")).toEqual({ value: "1", found: true });
    expect(jsonGet(doc, "a.b[5].c").found).toBe(false);
  });

  it("parseSnippet units", () => {
    expect(parseSnippet("$1.5B").micro).toBe(1_500_000_000n * 1_000_000n);
    expect(parseSnippet("€980K").micro).toBe(980_000n * 1_000_000n);
    expect(parseSnippet("$1M and $2M").error).toMatch(/exactly one/);
    expect(parseSnippet("-$5M").error).toMatch(/negative/);
  });

  it("anchoredValues skips footnotes and years", () => {
    expect(anchoredValues("Total Reserves 1 as of 2026 $1,000.5M other", "Total Reserves").map((v) => v.micro)).toEqual([1_000_500_000n * 1_000_000n]);
  });

  it("htmlToText strips scripts, styles and comments", () => {
    expect(htmlToText("<style>x{}</style><p>A&amp;B&nbsp;<!-- $9B --><b>$1M</b></p>")).toBe("A&B $1M");
  });
});
