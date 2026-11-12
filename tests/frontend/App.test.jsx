// UI tests for the whole app with every network edge mocked: no wallet, no RPC, no fetch leaves the test.
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App, { DEMO_FEEDS } from "../../src/App.jsx";
import { STATUSES } from "../../src/lib/attestor.js";

const ADDR = "0x" + "a1".repeat(20);
const USER = "0x" + "b2".repeat(20);
const HASH = "0x" + "c3".repeat(32);
const fx = (n) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", n), "utf8");

const goTo = (url) => window.history.replaceState(null, "", url);

// A chain-mode feed built from demo feed #1, attested long enough ago that the cooldown is over.
const chainFeed = () => ({ ...DEMO_FEEDS[0], demo_note: undefined, last_attested_at: "2026-01-01T00:00:00Z" });

function chainProps(over = {}) {
  return {
    contractAddress: ADDR,
    readClient: {},
    connect: vi.fn(async () => ({ address: USER, client: { tag: "wallet" } })),
    readFeeds: vi.fn(async () => [chainFeed()]),
    readStats: vi.fn(async () => ({ feeds: 1, by: { FULLY_BACKED: 1 } })),
    readFeed: vi.fn(async (_c, _a, id) => ({ ...chainFeed(), id })),
    writeTx: vi.fn(),
    fetchImpl: vi.fn(async () => { throw new Error("unexpected fetch"); }),
    ...over,
  };
}

beforeEach(() => goTo("/"));

describe("not deployed (empty VITE_CONTRACT_ADDRESS)", () => {
  it("explains the state, reads nothing and offers demo data", async () => {
    const p = chainProps({ contractAddress: "" });
    render(<App {...p} />);
    expect(await screen.findByRole("heading", { name: "Contract not deployed yet" })).toBeInTheDocument();
    expect(screen.getByText(/not deployed yet/, { selector: ".foot span" })).toBeInTheDocument();
    expect(p.readFeeds).not.toHaveBeenCalled();
    expect(p.readStats).not.toHaveBeenCalled();
    expect(screen.queryByText("DEMO DATA")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Contract source" })).toHaveAttribute("href", "https://github.com/gosof32/genlayer-reserve-atterstor");

    await userEvent.click(screen.getByRole("button", { name: /Browse demo data/ }));
    expect(await screen.findByText("DEMO DATA")).toBeInTheDocument();
    expect(window.location.search).toBe("?demo=1");
  });

  it("blocks creating a feed", async () => {
    goTo("/#/create");
    render(<App {...chainProps({ contractAddress: "" })} />);
    expect(await screen.findByText(/Contract not deployed yet: set VITE_CONTRACT_ADDRESS/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create feed" })).toBeDisabled();
  });

  it("a feed URL shows the empty state, not a crash", async () => {
    goTo("/#/feed/3");
    render(<App {...chainProps({ contractAddress: "" })} />);
    expect(await screen.findByText(/no feeds to show/)).toBeInTheDocument();
  });
});

describe("demo mode (?demo=1)", () => {
  it("is labelled and shows all four statuses", async () => {
    goTo("/?demo=1#/");
    const p = chainProps({ contractAddress: "" });
    const { container } = render(<App {...p} />);
    expect(await screen.findByText("DEMO DATA")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/Not on-chain attestations/);
    await waitFor(() => expect(container.querySelectorAll(".feed-card").length).toBe(DEMO_FEEDS.length));
    const shown = new Set([...container.querySelectorAll(".feed-card [data-status]")].map((b) => b.dataset.status));
    for (const s of STATUSES) expect(shown).toContain(s);
    expect(p.readFeeds).not.toHaveBeenCalled();

    // the status filter narrows the grid
    await userEvent.click(screen.getByRole("button", { name: /^Unverifiable/ }));
    expect(container.querySelectorAll(".feed-card").length).toBe(1);
    expect(screen.getByRole("link", { name: /USDC, UNVERIFIABLE/ })).toBeInTheDocument();
  });

  it("feed detail is read-only and labelled", async () => {
    goTo("/?demo=1#/feed/2");
    render(<App {...chainProps({ contractAddress: "" })} />);
    expect(await screen.findByRole("article", { name: "Feed 2" })).toBeInTheDocument();
    expect(screen.getByText("Demo data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Attest now/ })).toBeDisabled();
    expect(screen.getByText(/Demo data is read-only/)).toBeInTheDocument();
  });

  it("exit demo returns to the not-deployed state", async () => {
    goTo("/?demo=1#/");
    render(<App {...chainProps({ contractAddress: "" })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Exit demo" }));
    expect(await screen.findByRole("heading", { name: "Contract not deployed yet" })).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});

describe("create feed form", () => {
  it("validates with the contract's rules before anything is signed", async () => {
    goTo("/#/create");
    const p = chainProps();
    p.writeTx.mockImplementation(async ({ onUpdate }) => {
      onUpdate({ phase: "signing" });
      onUpdate({ phase: "pending", hash: HASH });
      const result = { ok: true, returnValue: "9" };
      onUpdate({ phase: "finalized", hash: HASH, result });
      return { hash: HASH, result };
    });
    render(<App {...p} />);
    await userEvent.click(screen.getByRole("button", { name: /Connect wallet/ }));
    expect(await screen.findByTitle(USER)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Create feed" });
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(screen.getByRole("alert")).toHaveTextContent(/Fix the highlighted fields/);
    expect(screen.getByRole("textbox", { name: /Issuer/ })).toHaveAttribute("aria-invalid", "true");
    expect(p.writeTx).not.toHaveBeenCalled();

    const url = screen.getByRole("textbox", { name: /Source URL/ });
    await userEvent.type(url, "http://example.com/por");
    expect(screen.getByText("A plain https URL (no user@, no #fragment)")).toBeInTheDocument();
    await userEvent.clear(url);
    await userEvent.type(url, "https://127.0.0.1/por");
    expect(screen.getByText("Use a public host name (no IPs, no localhost)")).toBeInTheDocument();

    const ratio = screen.getByRole("textbox", { name: /Minimum ratio/ });
    await userEvent.clear(ratio);
    await userEvent.type(ratio, "500");
    expect(screen.getByText(/1000-30000/, { selector: ".err" })).toBeInTheDocument();

    // a real source preset is valid as-is and is sent as create_feed with exact args
    await userEvent.click(screen.getByRole("button", { name: "Bridge USDB (JSON)" }));
    expect(screen.queryByText(/Fix the highlighted fields/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create feed" }));
    await waitFor(() => expect(p.writeTx).toHaveBeenCalledTimes(1));
    const call = p.writeTx.mock.calls[0][0];
    expect(call.functionName).toBe("create_feed");
    expect(call.address).toBe(ADDR);
    expect(call.value).toBe(0n);
    expect(call.walletClient).toEqual({ tag: "wallet" });
    expect(call.args).toEqual(["Bridge (Stripe)", "USDB", "https://transparency.bridge.xyz/v0/stablecoins/usdb", "json",
      "total_reserve_amount", "total_onchain_amount", "last_updated", "", 0, 0, 10000, 24]);
    // the new feed id from the receipt opens its page
    await waitFor(() => expect(window.location.hash).toBe("#/feed/9"));
    await waitFor(() => expect(p.readFeed).toHaveBeenCalledWith({}, ADDR, 9));
  });

  it("needs a wallet to submit", async () => {
    goTo("/#/create");
    render(<App {...chainProps()} />);
    expect(screen.getByText("Connect a wallet to sign.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create feed" })).toBeDisabled();
  });

  it("shows a wallet error when no wallet is installed", async () => {
    render(<App {...chainProps({ connect: vi.fn(async () => { throw new Error("No browser wallet found."); }) })} />);
    await userEvent.click(screen.getByRole("button", { name: /Connect wallet/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No browser wallet found.");
  });
});

describe("attest lifecycle toast", () => {
  async function openFeedWithWallet(p) {
    goTo("/#/feed/1");
    render(<App {...p} />);
    expect(await screen.findByRole("article", { name: "Feed 1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Connect wallet/ }));
    await screen.findByTitle(USER);
  }

  it("tracks signing → PENDING → ACCEPTED → FINALIZED and shows the verdict", async () => {
    let finish;
    const gate = new Promise((r) => { finish = r; });
    const p = chainProps();
    let update;
    p.writeTx.mockImplementation(async ({ onUpdate }) => {
      update = onUpdate;
      onUpdate({ phase: "signing" });
      await gate;
      const result = { ok: true, returnValue: JSON.stringify({ status: "FULLY_BACKED", ratio_bps: 10015 }) };
      onUpdate({ phase: "finalized", hash: HASH, result });
      return { hash: HASH, result };
    });
    await openFeedWithWallet(p);
    p.readFeed.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /Attest now/ }));
    const toast = await screen.findByRole("region", { name: "Transactions" });
    const item = () => toast.querySelector("li.tx");
    expect(item()).toHaveAttribute("data-phase", "signing");
    expect(within(toast).getByText("Attest #1 USDB")).toBeInTheDocument();
    expect(within(toast).getByText("Approve it in your wallet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Attest now/ })).toBeDisabled();
    expect(p.writeTx.mock.calls[0][0]).toMatchObject({ functionName: "attest", args: [1], address: ADDR, value: 0n });

    act(() => update({ phase: "pending", hash: HASH }));
    expect(item()).toHaveAttribute("data-phase", "pending");
    expect(within(toast).getByText(/a few minutes/)).toBeInTheDocument();
    expect(within(toast).getByRole("link", { name: /0xc3c3/ })).toHaveAttribute("href", expect.stringContaining(`/tx/${HASH}`));

    act(() => update({ phase: "accepted", hash: HASH }));
    expect(item()).toHaveAttribute("data-phase", "accepted");
    expect(within(toast).getByText(/Validators agreed/)).toBeInTheDocument();

    await act(async () => { finish(); await gate; });
    await waitFor(() => expect(item()).toHaveAttribute("data-phase", "finalized"));
    expect(within(toast).getByText("Fully backed · 100.15 %")).toBeInTheDocument();
    expect(within(toast).getAllByText("FINALIZED").length).toBeGreaterThan(0);
    // the feed is re-read after finality
    await waitFor(() => expect(p.readFeed).toHaveBeenCalled());

    await userEvent.click(within(toast).getByRole("button", { name: "Dismiss transaction" }));
    expect(screen.queryByRole("region", { name: "Transactions" })).not.toBeInTheDocument();
  });

  it("shows the contract's error and where it stopped", async () => {
    const p = chainProps();
    p.writeTx.mockImplementation(async ({ onUpdate }) => {
      onUpdate({ phase: "signing" });
      onUpdate({ phase: "pending", hash: HASH });
      throw new Error("[COOLDOWN] attest again in 4 min");
    });
    await openFeedWithWallet(p);
    await userEvent.click(screen.getByRole("button", { name: /Attest now/ }));
    const toast = await screen.findByRole("region", { name: "Transactions" });
    await waitFor(() => expect(toast.querySelector("li.tx")).toHaveAttribute("data-phase", "error"));
    expect(within(toast).getByRole("alert")).toHaveTextContent("[COOLDOWN] attest again in 4 min");
    expect(toast.querySelector(".tx-track li.fail")).toHaveTextContent("PENDING");
  });

  it("a rejected signature is an error, not a stuck spinner", async () => {
    const p = chainProps();
    p.writeTx.mockImplementation(async ({ onUpdate }) => {
      onUpdate({ phase: "signing" });
      throw Object.assign(new Error("raw"), { shortMessage: "User rejected the request." });
    });
    await openFeedWithWallet(p);
    await userEvent.click(screen.getByRole("button", { name: /Attest now/ }));
    expect(await screen.findByText("User rejected the request.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Attest now/ })).toBeEnabled();
  });

  it("respects the 5 minute cooldown", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const p = chainProps({ readFeed: vi.fn(async () => ({ ...chainFeed(), last_attested_at: recent })) });
    await openFeedWithWallet(p);
    expect(screen.getByRole("button", { name: /Attest now/ })).toBeDisabled();
    expect(screen.getByText(/Next attestation possible in 4 min/)).toBeInTheDocument();
  });

  it("reports a contract read failure with a retry", async () => {
    const p = chainProps({ readFeeds: vi.fn(async () => { throw new Error("rpc down"); }) });
    render(<App {...p} />);
    expect(await screen.findByText("Could not read the contract: rpc down")).toBeInTheDocument();
    p.readFeeds.mockResolvedValueOnce([chainFeed()]);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText(/Could not read the contract/)).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Feed 1: USDB/ })).toBeInTheDocument();
  });
});

describe("live preview", () => {
  it("falls back to the captured copy when the browser blocks the read (CORS)", async () => {
    goTo("/#/preview");
    const fetchImpl = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    render(<App {...chainProps({ contractAddress: "", fetchImpl })} />);
    await userEvent.click(screen.getByRole("button", { name: "Bridge USDB (JSON)" }));
    await userEvent.click(screen.getByRole("button", { name: /Fetch live/ }));

    expect(fetchImpl).toHaveBeenCalledWith("https://transparency.bridge.xyz/v0/stablecoins/usdb", expect.objectContaining({ headers: { Accept: "application/json" } }));
    const msg = await screen.findByText(/does not send an Access-Control-Allow-Origin header/);
    expect(msg).toHaveTextContent("transparency.bridge.xyz");
    expect(msg).toHaveTextContent(/validators fetch the source from their own servers/i);

    await userEvent.click(screen.getByRole("button", { name: "Read the captured copy instead" }));
    const out = await screen.findByText(/captured copy from/);
    const result = out.closest(".preview-out");
    expect(result.querySelector("[data-status]")).not.toBeNull();
    expect(within(result).getByText("Reserves")).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads a live JSON response with the contract's rules", async () => {
    goTo("/#/preview");
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => fx("ledgerlens_trueusd.json") }));
    render(<App {...chainProps({ contractAddress: "", fetchImpl })} />);
    await userEvent.click(screen.getByRole("button", { name: /Fetch live/ }));
    const out = await screen.findByText(/live fetch/);
    const result = out.closest(".preview-out");
    expect(within(result).getByText("101.49 %")).toBeInTheDocument();
    expect(within(result).getByText(/totalTrust=501928900.88/)).toBeInTheDocument();
  });

  it("an HTTP error means UNVERIFIABLE", async () => {
    goTo("/#/preview");
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, text: async () => "" }));
    render(<App {...chainProps({ contractAddress: "", fetchImpl })} />);
    fireEvent.click(screen.getByRole("button", { name: /Fetch live/ }));
    expect(await screen.findByText(/answered HTTP 503/)).toBeInTheDocument();
  });
});
