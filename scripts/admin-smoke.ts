// Checks on a deployed site that a wallet outside ADMIN_WALLETS gets no admin access:
//   tsx scripts/admin-smoke.ts https://300spo.live
import { addressToBech32 } from "../lib/cardano/address";
import { createTestWallet } from "../tests/helpers/test-wallet";

const base = process.argv[2] ?? "https://300spo.live";
const wallet = createTestWallet();
const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });

const { challenge, message } = (await (await post("/api/wallet-auth/challenge", { address: addressToBech32(wallet.rewardAddress) })).json()) as {
  challenge: string;
  message: string;
};
const verified = await post("/api/wallet-auth/verify", { challenge, ...wallet.signData(wallet.rewardAddress, new TextEncoder().encode(message)) });
const cookie = (verified.headers.get("set-cookie") ?? "").split(";")[0];
console.log("wallet sign-in", verified.status);

const session = await fetch(`${base}/api/admin/session`, { headers: { cookie } });
console.log("admin session for a stranger", session.status, await session.text());
for (const path of ["/api/admin/game", "/api/admin/drip", "/api/admin/content"]) {
  const response = await fetch(`${base}${path}`, { headers: { cookie } });
  console.log(path, response.status);
}
