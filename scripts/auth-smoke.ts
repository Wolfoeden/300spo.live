// End-to-end check of /api/wallet-auth and /api/game against a deployed site with a throwaway key:
//   tsx scripts/auth-smoke.ts https://300spo.live
import { addressToBech32, bytesToHex } from "../lib/cardano/address";
import { createTestWallet } from "../tests/helpers/test-wallet";

const base = process.argv[2] ?? "https://300spo.live";
const wallet = createTestWallet();
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });

const challengeResponse = await post("/api/wallet-auth/challenge", { address: bytesToHex(wallet.rewardAddress) });
const { challenge, message } = (await challengeResponse.json()) as { challenge: string; message: string };
console.log("challenge", challengeResponse.status);

const verifyResponse = await post("/api/wallet-auth/verify", { challenge, ...wallet.signData(wallet.rewardAddress, new TextEncoder().encode(message)) });
const cookie = (verifyResponse.headers.get("set-cookie") ?? "").split(";")[0];
console.log("verify", verifyResponse.status, await verifyResponse.text());

const session = await fetch(`${base}/api/wallet-auth/session`, { headers: { cookie } });
const body = (await session.json()) as { identity: string | null };
console.log("session", session.status, body.identity === addressToBech32(wallet.rewardAddress) ? "identity matches" : body);

// Game API with the same session: reads the (empty) balance from the database.
for (let run = 1; run <= 3; run += 1) {
  const started = Date.now();
  const state = await fetch(`${base}/api/game/state`, { headers: { cookie } });
  const data = (await state.json()) as { balance?: number; enabled?: boolean; error?: string };
  console.log(`game state #${run}`, state.status, JSON.stringify({ balance: data.balance, enabled: data.enabled, error: data.error }), `${Date.now() - started} ms`);
}
