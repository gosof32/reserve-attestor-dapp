import { describe, it, expect } from "vitest";
import {
  EMPTY_FORM, PRESETS, ago, compact, exact, normalizeFeed, parseRoute, pct, readFeed, readFeeds, readStats, summarizeAttest,
  validateFeed,
} from "../../src/lib/attestor.js";

const usdb = PRESETS[0].form;
const errorsFor = (over) => validateFeed({ ...usdb, ...over }).errors;

describe("validateFeed mirrors create_feed", () => {
  it("accepts every real preset and builds create_feed args in contract order", () => {
    for (const p of PRESETS) expect(validateFeed(p.form).ok).toBe(true);
    expect(validateFeed(PRESETS[2].form).args).toEqual([
      "Ripple (Standard Custody)", "RLUSD", "https://ripple.com/solutions/stablecoin/transparency/", "html",
      "RLUSD Reserve Funds", "Total Circulating RLUSD", "As of", "MDY", 0, 0, 10000, 336,
    ]);
  });

  it("normalizes like the contract", () => {
    const v = validateFeed({ ...usdb, issuer: "  Bridge   (Stripe) ", kind: "JSON", date_order: "mdy" });
    expect(v.args.slice(0, 4)).toEqual(["Bridge (Stripe)", "USDB", usdb.source_url, "json"]);
    expect(v.args[7]).toBe("MDY");
  });

  it("rejects an empty form field by field", () => {
    const e = validateFeed(EMPTY_FORM).errors;
    expect(Object.keys(e).sort()).toEqual(["asof_field", "asset", "issuer", "liabilities_field", "reserves_field", "source_url"]);
  });

  it.each([
    [{ issuer: "B" }, "issuer"],
    [{ asset: "US DB" }, "asset"],
    [{ asset: "A".repeat(21) }, "asset"],
    [{ source_url: "http://a.com/x" }, "source_url"],
    [{ source_url: "https://user@evil.com/x" }, "source_url"],
    [{ source_url: "https://localhost/x" }, "source_url"],
    [{ source_url: "https://127.0.0.1/x" }, "source_url"],
    [{ source_url: "https://a.com/" + "x".repeat(300) }, "source_url"],
    [{ kind: "xml" }, "kind"],
    [{ date_order: "YMD" }, "date_order"],
    [{ reserves_field: "a..b" }, "reserves_field"],
    [{ asof_field: "x[y]" }, "asof_field"],
    [{ liabilities_field: "total_reserve_amount" }, "liabilities_field"],
    [{ reserves_decimals: "37" }, "reserves_decimals"],
    [{ liabilities_decimals: "-1" }, "liabilities_decimals"],
    [{ min_ratio_bps: "999" }, "min_ratio_bps"],
    [{ min_ratio_bps: "30001" }, "min_ratio_bps"],
    [{ min_ratio_bps: "1.5" }, "min_ratio_bps"],
    [{ max_age_hours: "0" }, "max_age_hours"],
    [{ max_age_hours: "9601" }, "max_age_hours"],
  ])("%j -> %s", (over, field) => {
    expect(Object.keys(errorsFor(over))).toEqual([field]);
  });

  it("html rules", () => {
    const rl = PRESETS[2].form;
    expect(validateFeed({ ...rl, reserves_decimals: "6" }).errors.reserves_decimals).toMatch(/use 0/);
    expect(validateFeed({ ...rl, liabilities_field: "rlusd reserve funds" }).errors.liabilities_field).toMatch(/differ/);
    expect(validateFeed({ ...rl, asof_field: "A" }).errors.asof_field).toMatch(/label/);
    expect(validateFeed({ ...rl, reserves_field: "Reserve funds (USD)" }).ok).toBe(true); // labels need not be paths
  });
});

describe("normalize and read", () => {
  const raw = new Map(Object.entries({
    id: 3n, owner: "0xA", issuer: "Bridge", asset: "USDB", min_ratio_bps: 10000n, max_age_hours: 24n, paused: false,
    latest: new Map(Object.entries({ n: 2n, status: "UNVERIFIABLE", error: "could not fetch the source", ratio_bps: 0n })),
    last_good: new Map(Object.entries({ n: 1n, status: "FULLY_BACKED", reserves: "10", liabilities: "9", ratio_bps: 11111n })),
  }));

  it("normalizes Maps and BigInts from genlayer-js", () => {
    const f = normalizeFeed(raw);
    expect(f.id).toBe(3);
    expect(f.min_ratio_bps).toBe(10000);
    expect(f.latest.status).toBe("UNVERIFIABLE");
    expect(f.last_good.ratio_bps).toBe(11111);
    expect(normalizeFeed({ latest: {} }).latest).toBeNull();
  });

  it("readFeeds pages through list_feeds, readFeed adds history, readStats", async () => {
    const calls = [];
    const client = {
      readContract: async ({ functionName, args }) => {
        calls.push([functionName, args]);
        if (functionName === "list_feeds") return args[0] === 0 ? Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) : [{ id: 51 }];
        if (functionName === "get_feed") return raw;
        if (functionName === "get_history") return [new Map(Object.entries({ n: 2n, status: "UNVERIFIABLE" }))];
        if (functionName === "get_stats") return new Map(Object.entries({ feeds: 4n, by_latest_status: { FULLY_BACKED: 3 } }));
        throw new Error(functionName);
      },
    };
    expect((await readFeeds(client, "0xC")).length).toBe(51);
    expect(calls.slice(0, 2)).toEqual([["list_feeds", [0, 50]], ["list_feeds", [50, 50]]]);
    const f = await readFeed(client, "0xC", 3);
    expect(f.history.map((h) => h.n)).toEqual([2]);
    expect(calls).toContainEqual(["get_history", [3, 0, 30]]);
    expect(await readStats(client, "0xC")).toEqual({ feeds: 4, by: { FULLY_BACKED: 3 } });
  });
});

describe("formatting and routes", () => {
  it("formats", () => {
    expect(pct(10015)).toBe("100.15 %");
    expect(compact("64207984.97")).toBe("64.21M");
    expect(compact("181345865229.9862")).toBe("181.3B");
    expect(compact("")).toBe("—");
    expect(exact("64207984.97")).toBe("64,207,984.97");
    expect(ago("2026-11-12T09:00:00Z", Date.parse("2026-11-12T10:00:00Z"))).toBe("60 min ago");
    expect(ago("")).toBe("never");
  });

  it("summarizes an attest return value", () => {
    expect(summarizeAttest(JSON.stringify({ status: "FULLY_BACKED", ratio_bps: 10015 }))).toBe("Fully backed · 100.15 %");
    expect(summarizeAttest({ status: "UNVERIFIABLE", ratio_bps: 0, error: "could not fetch the source" })).toBe("Unverifiable · could not fetch the source");
    expect(summarizeAttest("plain text")).toBe("plain text");
  });

  it("parses routes", () => {
    expect(parseRoute("#/feed/12")).toEqual({ name: "feed", id: 12 });
    expect(parseRoute("#/create")).toEqual({ name: "create" });
    expect(parseRoute("#/preview?demo=1")).toEqual({ name: "preview" });
    expect(parseRoute("#/how")).toEqual({ name: "how" });
    expect(parseRoute("")).toEqual({ name: "feeds" });
    expect(parseRoute("#/nope")).toEqual({ name: "feeds" });
  });
});
