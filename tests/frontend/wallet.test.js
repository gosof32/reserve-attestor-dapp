import { describe, it, expect, vi } from "vitest";

vi.mock("genlayer-js", () => ({ createClient: vi.fn((cfg) => ({ cfg })) }));
vi.mock("genlayer-js/chains", () => ({ studionet: { id: 61999, name: "studionet" } }));

const { connectWallet, ensureStudionet, writeAndFinalize, getBalance, STUDIONET_PARAMS } = await import("../../src/lib/wallet.js");

const okReceipt = (readable) => ({
  statusName: "FINALIZED",
  resultName: "MAJORITY_AGREE",
  consensus_data: { leader_receipt: [{ execution_result: "SUCCESS", result: { status: "return", payload: { readable } } }] },
});

function provider(handlers = {}) {
  const calls = [];
  return {
    calls,
    request: vi.fn(async ({ method, params }) => {
      calls.push(method);
      if (handlers[method]) return handlers[method](params);
      if (method === "eth_requestAccounts") return ["0xAbC0000000000000000000000000000000000001"];
      if (method === "eth_chainId") return "0x1";
      return null;
    }),
  };
}

describe("Studionet chain", () => {
  it("uses chain 61999 with the public RPC", () => {
    expect(STUDIONET_PARAMS.chainId).toBe("0xf22f");
    expect(STUDIONET_PARAMS.rpcUrls).toEqual(["https://studio.genlayer.com/api"]);
    expect(STUDIONET_PARAMS.nativeCurrency.symbol).toBe("GEN");
  });
  it("does nothing when the wallet is already on Studionet", async () => {
    const p = provider({ eth_chainId: () => "0xF22F" });
    expect(await ensureStudionet(p)).toBe("already");
    expect(p.calls).toEqual(["eth_chainId"]);
  });
  it("switches when the chain is known", async () => {
    const p = provider();
    expect(await ensureStudionet(p)).toBe("switched");
    expect(p.calls).toEqual(["eth_chainId", "wallet_switchEthereumChain"]);
  });
  it("adds the chain on 4902 and then switches", async () => {
    let first = true;
    const p = provider({
      wallet_switchEthereumChain: () => {
        if (first) { first = false; const e = new Error("Unrecognized chain ID"); e.code = 4902; throw e; }
        return null;
      },
    });
    expect(await ensureStudionet(p)).toBe("added");
    expect(p.calls).toEqual(["eth_chainId", "wallet_switchEthereumChain", "wallet_addEthereumChain", "wallet_switchEthereumChain"]);
    const add = p.request.mock.calls.find(([a]) => a.method === "wallet_addEthereumChain")[0];
    expect(add.params[0].chainId).toBe("0xf22f");
  });
  it("surfaces a user rejection instead of adding the chain", async () => {
    const p = provider({ wallet_switchEthereumChain: () => { const e = new Error("User rejected"); e.code = 4001; throw e; } });
    await expect(ensureStudionet(p)).rejects.toThrow("User rejected");
    expect(p.calls).not.toContain("wallet_addEthereumChain");
  });
});

describe("connectWallet", () => {
  it("requests accounts, switches chain and builds a wallet-signed client", async () => {
    const p = provider({ eth_chainId: () => "0xf22f" });
    const make = vi.fn((cfg) => ({ cfg }));
    const w = await connectWallet(p, make);
    expect(w.address).toBe("0xAbC0000000000000000000000000000000000001");
    expect(make).toHaveBeenCalledWith({ chain: { id: 61999, name: "studionet" }, account: w.address, provider: p });
    expect(w.provider).toBe(p);
  });
  it("explains a missing wallet", async () => {
    await expect(connectWallet(null)).rejects.toThrow(/No browser wallet found/);
  });
  it("rejects an empty account list", async () => {
    await expect(connectWallet(provider({ eth_requestAccounts: () => [] }))).rejects.toThrow(/did not authorize/);
  });
});

describe("writeAndFinalize", () => {
  it("signs with the wallet client, then reports PENDING → ACCEPTED → FINALIZED", async () => {
    const walletClient = { writeContract: vi.fn(async () => "0xhash") };
    const readClient = {
      waitForTransactionReceipt: vi.fn(async ({ status }) => (status === "ACCEPTED" ? { statusName: "ACCEPTED" } : okReceipt("3"))),
    };
    const phases = [];
    const out = await writeAndFinalize({
      walletClient, readClient, address: "0xC", functionName: "attest", args: [1], value: 0n, onUpdate: (u) => phases.push(u.phase),
    });
    expect(walletClient.writeContract).toHaveBeenCalledWith({ address: "0xC", functionName: "attest", args: [1], value: 0n });
    expect(phases).toEqual(["signing", "pending", "accepted", "finalized"]);
    expect(out).toEqual({ hash: "0xhash", result: expect.objectContaining({ ok: true, returnValue: "3" }) });
  });
  it("throws the contract's revert reason", async () => {
    const walletClient = { writeContract: vi.fn(async () => "0xhash") };
    const readClient = {
      waitForTransactionReceipt: vi.fn(async ({ status }) => (status === "ACCEPTED" ? null : {
        statusName: "FINALIZED", resultName: "MAJORITY_AGREE",
        consensus_data: { leader_receipt: [{ execution_result: "ERROR", result: { status: "user_error", payload: { readable: "[FORBIDDEN] only the seller can cancel" } } }] },
      })),
    };
    await expect(writeAndFinalize({ walletClient, readClient, address: "0xC", functionName: "cancel", args: [6] })).rejects.toThrow(/\[FORBIDDEN\]/);
  });
  it("refuses to send without a wallet", async () => {
    await expect(writeAndFinalize({ walletClient: null })).rejects.toThrow(/Connect your wallet/);
  });
  it("reads a balance as BigInt", async () => {
    expect(await getBalance({ request: async () => "0x10" }, "0xA")).toBe(16n);
  });
});
