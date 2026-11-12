// Reserve Attestor contract on GenLayer Studionet.
// Not deployed yet: set VITE_CONTRACT_ADDRESS once you have deployed contracts/reserve_attestor.py
// from gosof32/genlayer-reserve-atterstor. With no address the app shows a "not deployed" state and
// can browse clearly labeled demo data instead.
export const CONTRACT_ADDRESS = (import.meta.env?.VITE_CONTRACT_ADDRESS ?? "").trim();
export const NETWORK = "studionet";
export const CHAIN_ID = 61999;
export const RPC_URL = "https://studio.genlayer.com/api";
export const EXPLORER_BASE = "https://explorer-studio.genlayer.com";
export const STUDIO_URL = "https://studio.genlayer.com";
export const CONTRACT_REPO = "https://github.com/gosof32/genlayer-reserve-atterstor";
export const APP_REPO = "https://github.com/gosof32/reserve-attestor-dapp";
