import { createHmac, timingSafeEqual } from "node:crypto";
import { clearSessionCookie, readSession } from "./wallet-auth.ts";

// Admin access: a wallet sign-in (CIP-30 signData, see wallet-auth) from one of
// the stake or payment addresses in ADMIN_WALLETS. The older password login
// stays available only while ADMIN_PASSWORD is set.
const WALLET_ADMIN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const COOKIE_NAME = "spo_admin_session";
const tokenFor = (password) => createHmac("sha256", password).update("300spo-admin-v1").digest("hex");

const adminPassword = () => Netlify.env.get("ADMIN_PASSWORD");
const adminWallets = () =>
  (Netlify.env.get("ADMIN_WALLETS") || "")
    .split(",")
    .map((wallet) => wallet.trim())
    .filter(Boolean);

// Wallet sessions use a SameSite=Lax cookie, so state-changing admin requests
// must also come from this origin.
const sameOriginWrite = (request) => {
  if (["GET", "HEAD"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

/** The admin wallet behind this request's wallet session, if any. */
export const adminWallet = (request) => {
  const session = readSession(request);
  if (!session || !adminWallets().includes(session.identity)) return null;
  return Date.now() - session.iat <= WALLET_ADMIN_MAX_AGE_MS ? session.identity : null;
};

const passwordSession = (request) => {
  const expected = adminPassword();
  if (!expected) return false;
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const supplied = Buffer.from(decodeURIComponent(match[1]));
  const token = Buffer.from(tokenFor(expected));
  return supplied.length === token.length && timingSafeEqual(supplied, token);
};

export const isConfigured = () => Boolean(adminPassword()) || adminWallets().length > 0;
export const passwordLoginEnabled = () => Boolean(adminPassword());
export const isAuthenticated = (request) => sameOriginWrite(request) && (adminWallet(request) !== null || passwordSession(request));
export const passwordMatches = (password) => {
  const expected = adminPassword();
  if (!expected || typeof password !== "string") return false;
  const supplied = Buffer.from(password);
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
};
export const sessionCookie = (request) => `${COOKIE_NAME}=${tokenFor(adminPassword())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
export const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
export const clearWalletCookie = (request) => clearSessionCookie(request);
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
