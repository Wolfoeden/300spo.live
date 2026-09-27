import { beforeAll, describe, expect, it } from "vitest";
import { addressToBech32 } from "../lib/cardano/address";
import { createTestWallet } from "./helpers/test-wallet";

const ORIGIN = "https://300spo.live";

beforeAll(() => {
  const env = new Map([["WALLET_SESSION_SECRET", "test-secret-with-at-least-32-characters!!"]]);
  (globalThis as unknown as { Netlify: unknown }).Netlify = { env: { get: (key: string) => env.get(key) } };
});

const call = async (action: string, init: RequestInit = {}) => {
  const { default: handler } = await import("../netlify/functions/wallet-auth.mts");
  const request = new Request(`${ORIGIN}/api/wallet-auth/${action}`, {
    ...init,
    headers: { "content-type": "application/json", origin: ORIGIN, ...(init.headers as Record<string, string>) },
  });
  return handler(request, { params: { action } } as never);
};

const post = (action: string, body: unknown, headers: Record<string, string> = {}) =>
  call(action, { method: "POST", body: JSON.stringify(body), headers });

describe("wallet-auth function", () => {
  it("signs a wallet in and reads the session back", async () => {
    const wallet = createTestWallet();
    const challengeResponse = await post("challenge", { address: Buffer.from(wallet.rewardAddress).toString("hex") });
    expect(challengeResponse.status).toBe(200);
    const { challenge, message } = await challengeResponse.json();
    expect(message).toContain(addressToBech32(wallet.rewardAddress));

    const signed = wallet.signData(wallet.rewardAddress, new TextEncoder().encode(message));
    const verifyResponse = await post("verify", { challenge, ...signed });
    expect(verifyResponse.status).toBe(200);
    const cookie = verifyResponse.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);

    const session = await call("session", { headers: { cookie: cookie.split(";")[0] } });
    expect(await session.json()).toMatchObject({ identity: addressToBech32(wallet.rewardAddress) });
  });

  it("rejects a signature over a different message", async () => {
    const wallet = createTestWallet();
    const { challenge } = await (await post("challenge", { address: addressToBech32(wallet.rewardAddress) })).json();
    const signed = wallet.signData(wallet.rewardAddress, new TextEncoder().encode("something else"));
    const response = await post("verify", { challenge, ...signed });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "message_mismatch" });
  });

  it("rejects a challenge issued for another address", async () => {
    const victim = createTestWallet();
    const attacker = createTestWallet();
    const { challenge, message } = await (await post("challenge", { address: addressToBech32(victim.rewardAddress) })).json();
    const signed = attacker.signData(attacker.rewardAddress, new TextEncoder().encode(message));
    const response = await post("verify", { challenge, ...signed });
    expect(await response.json()).toMatchObject({ error: "address_mismatch" });
  });

  it("refuses cross-origin posts and unsigned sessions", async () => {
    const wallet = createTestWallet();
    const response = await post("challenge", { address: addressToBech32(wallet.rewardAddress) }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    const session = await call("session", { headers: { cookie: "spo_wallet_session=forged.token" } });
    expect(session.status).toBe(401);
  });
});
