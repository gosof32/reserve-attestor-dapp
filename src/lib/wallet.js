import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { assertFinalizedSuccess } from "./tx.js";
import { CHAIN_ID, EXPLORER_BASE, NETWORK, RPC_URL } from "../config.js";

// Read-only client: no account, no key.
export function createReadClient() {
  return createClient({ chain: studionet });
}

export function getInjectedProvider() {
  return typeof window !== "undefined" ? window.ethereum ?? null : null;
}

// User-controlled signing: the wallet (MetaMask or any EIP-1193 wallet) holds the key and
// approves each transaction. The app never sees or stores a private key.
export async function connectWallet(provider = getInjectedProvider(), makeClient = createClient) {
  if (!provider) throw new Error("No browser wallet found. Install MetaMask (or another EIP-1193 wallet) to sign transactions.");
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error("Wallet did not authorize any account.");
  const address = accounts[0];
  await ensureStudionet(provider);
  const client = makeClient({ chain: studionet, account: address, provider });
  return { address, client, provider };
}

export const STUDIONET_PARAMS = {
  chainId: `0x${CHAIN_ID.toString(16)}`,
  chainName: "GenLayer Studionet",
  rpcUrls: [RPC_URL],
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: [EXPLORER_BASE],
};

// Adds/switches the wallet to GenLayer Studionet (chain 61999) with standard EIP-3085/3326 calls,
// so it works on MetaMask and any other EIP-1193 wallet.
export async function ensureStudionet(provider) {
  const { chainId } = STUDIONET_PARAMS;
  const current = await provider.request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === chainId.toLowerCase()) return "already";
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return "switched";
  } catch (err) {
    const code = err?.code ?? err?.data?.originalError?.code;
    if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(err?.message ?? "")) throw err;
    await provider.request({ method: "wallet_addEthereumChain", params: [STUDIONET_PARAMS] });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return "added";
  }
}

export async function getBalance(readClient, address) {
  const hex = await readClient.request({ method: "eth_getBalance", params: [address, "latest"] });
  return BigInt(hex ?? 0);
}

// Sends a write (optionally with GEN attached), signed by the user's wallet, and resolves only
// once it is FINALIZED with consensus agreement and a successful execution. Anything else throws.
// Phases reported through onUpdate: signing → pending (submitted) → accepted → finalized.
export async function writeAndFinalize({ walletClient, readClient, address, functionName, args, value = 0n, onUpdate }) {
  if (!walletClient) throw new Error("Connect your wallet first.");
  onUpdate?.({ phase: "signing" });
  const hash = await walletClient.writeContract({ address, functionName, args, value });
  onUpdate?.({ phase: "pending", hash });
  const accepted = await readClient.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 200, interval: 3000 }).catch(() => null);
  if (accepted) onUpdate?.({ phase: "accepted", hash });
  const receipt = await readClient.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 300, interval: 3000 });
  const result = assertFinalizedSuccess(receipt);
  onUpdate?.({ phase: "finalized", hash, result });
  return { hash, result };
}

export { NETWORK };
