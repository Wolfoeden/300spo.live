import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "spo_wallet_session";
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Purpose = "challenge" | "session";

export type ChallengeClaims = { purpose: "challenge"; address: string; nonce: string; iat: number; exp: number };
export type SessionClaims = { purpose: "session"; identity: string; iat: number; exp: number };

export class NotConfiguredError extends Error {}

const secret = () => {
  const value = Netlify.env.get("WALLET_SESSION_SECRET");
  if (!value || value.length < 32) throw new NotConfiguredError("WALLET_SESSION_SECRET is missing or shorter than 32 characters");
  return value;
};

const mac = (purpose: Purpose, body: string) => createHmac("sha256", secret()).update(`${purpose}.${body}`).digest("base64url");

const sign = (claims: ChallengeClaims | SessionClaims) => {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${mac(claims.purpose, body)}`;
};

const open = <T extends ChallengeClaims | SessionClaims>(token: unknown, purpose: T["purpose"]): T | null => {
  if (typeof token !== "string") return null;
  const [body, tag, extra] = token.split(".");
  if (!body || !tag || extra !== undefined) return null;
  const expected = Buffer.from(mac(purpose, body));
  const supplied = Buffer.from(tag);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return claims.purpose === purpose && typeof claims.exp === "number" && claims.exp > Date.now() ? claims : null;
  } catch {
    return null;
  }
};

/** The exact text the wallet shows and signs. Rebuilt from the claims on verify. */
export const challengeMessage = (claims: ChallengeClaims) =>
  [
    "300spo.live asks you to confirm that you control this wallet.",
    "Signing is free and does not move any funds.",
    "",
    `Address: ${claims.address}`,
    `Nonce: ${claims.nonce}`,
    `Issued at: ${new Date(claims.iat).toISOString()}`,
    `Expires at: ${new Date(claims.exp).toISOString()}`,
  ].join("\n");

export const issueChallenge = (address: string, now = Date.now()) => {
  const claims: ChallengeClaims = {
    purpose: "challenge",
    address,
    nonce: randomBytes(16).toString("hex"),
    iat: now,
    exp: now + CHALLENGE_TTL_MS,
  };
  return { challenge: sign(claims), message: challengeMessage(claims), expiresAt: claims.exp };
};

export const openChallenge = (token: unknown) => open<ChallengeClaims>(token, "challenge");

export const issueSession = (identity: string, now = Date.now()) => {
  const claims: SessionClaims = { purpose: "session", identity, iat: now, exp: now + SESSION_TTL_MS };
  return { token: sign(claims), claims };
};

export const readSession = (request: Request) => {
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? open<SessionClaims>(decodeURIComponent(match[1]), "session") : null;
};

const secureFlag = (request: Request) => (new URL(request.url).protocol === "https:" ? "; Secure" : "");

export const sessionCookie = (request: Request, token: string) =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secureFlag(request)}`;

export const clearSessionCookie = (request: Request) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag(request)}`;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
