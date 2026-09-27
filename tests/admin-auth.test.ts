import { beforeEach, describe, expect, it } from "vitest";
import { addressToBech32 } from "../lib/cardano/address";
import { createTestWallet } from "./helpers/test-wallet";

const ORIGIN = "https://300spo.live";
const env = new Map<string, string>();
(globalThis as unknown as { Netlify: unknown }).Netlify = { env: { get: (key: string) => env.get(key) } };

const admin = createTestWallet();
const stranger = createTestWallet();

const signIn = async (wallet: ReturnType<typeof createTestWallet>) => {
  const { default: walletAuth } = await import("../netlify/functions/wallet-auth.mts");
  const post = (action: string, body: unknown) =>
    walletAuth(
      new Request(`${ORIGIN}/api/wallet-auth/${action}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) }),
      { params: { action } } as never,
    );
  const { challenge, message } = await (await post("challenge", { address: addressToBech32(wallet.rewardAddress) })).json();
  const verified = await post("verify", { challenge, ...wallet.signData(wallet.rewardAddress, new TextEncoder().encode(message)) });
  return (verified.headers.get("set-cookie") ?? "").split(";")[0];
};

type Handler = (request: Request) => Promise<Response>;

const adminSession = async (cookie: string, init: RequestInit = {}) => {
  // @ts-expect-error -- plain JS Netlify function without type declarations
  const { default: handler } = (await import("../netlify/functions/admin-session.mjs")) as { default: Handler };
  return handler(new Request(`${ORIGIN}/api/admin/session`, { ...init, headers: { cookie, ...(init.headers as Record<string, string>) } }));
};

describe("wallet admin access", () => {
  beforeEach(() => {
    env.clear();
    env.set("WALLET_SESSION_SECRET", "test-secret-with-at-least-32-characters!!");
    env.set("ADMIN_WALLETS", ` ${addressToBech32(admin.rewardAddress)} , addr1qunused`);
  });

  it("admits the configured wallet and nobody else", async () => {
    const adminState = await (await adminSession(await signIn(admin))).json();
    expect(adminState).toMatchObject({ authenticated: true, wallet: addressToBech32(admin.rewardAddress), passwordLogin: false });
    const strangerState = await (await adminSession(await signIn(stranger))).json();
    expect(strangerState).toMatchObject({ authenticated: false, wallet: null });
  });

  it("expires wallet admin access after 12 hours", async () => {
    const { issueSession, SESSION_COOKIE } = await import("../netlify/functions/_shared/wallet-auth");
    const { token } = issueSession(addressToBech32(admin.rewardAddress), Date.now() - 13 * 60 * 60 * 1000);
    const state = await (await adminSession(`${SESSION_COOKIE}=${encodeURIComponent(token)}`)).json();
    expect(state.authenticated).toBe(false);
  });

  it("rejects cross-site writes even with the admin's cookie", async () => {
    const { default: adminGame } = await import("../netlify/functions/admin-game.mts");
    const cookie = await signIn(admin);
    const response = await adminGame(
      new Request(`${ORIGIN}/api/admin/game`, { method: "POST", headers: { cookie, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses password login once ADMIN_PASSWORD is removed", async () => {
    const response = await adminSession("", { method: "POST", body: JSON.stringify({ password: "anything" }) });
    expect(response.status).toBe(403);
    env.set("ADMIN_PASSWORD", "fallback-password");
    const accepted = await adminSession("", { method: "POST", body: JSON.stringify({ password: "fallback-password" }) });
    expect(accepted.status).toBe(200);
  });

  it("signs out of both sessions", async () => {
    const response = await adminSession(await signIn(admin), { method: "DELETE" });
    const cookies: string[] = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith("spo_admin_session=;"))).toBe(true);
    expect(cookies.some((cookie) => cookie.startsWith("spo_wallet_session=;"))).toBe(true);
  });
});
