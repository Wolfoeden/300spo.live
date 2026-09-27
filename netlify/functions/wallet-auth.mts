import type { Config, Context } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, ownerKeyHash } from "../../lib/cardano/address";
import { verifyDataSignature } from "../../lib/cardano/cose";
import {
  NotConfiguredError,
  challengeMessage,
  clearSessionCookie,
  issueChallenge,
  issueSession,
  json,
  openChallenge,
  readSession,
  sessionCookie,
} from "./_shared/wallet-auth";

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

const challenge = async (request: Request) => {
  const { address } = await readBody(request);
  let bytes: Uint8Array;
  try {
    bytes = addressBytesFromWallet(String(address ?? ""));
  } catch {
    return json({ error: "invalid_address" }, 400);
  }
  if (!ownerKeyHash(bytes)) return json({ error: "unsupported_address" }, 400);
  return json(issueChallenge(addressToBech32(bytes)));
};

const verify = async (request: Request) => {
  const body = await readBody(request);
  const claims = openChallenge(body.challenge);
  if (!claims) return json({ error: "challenge_expired" }, 400);

  try {
    const { address, payload } = verifyDataSignature({ signature: String(body.signature ?? ""), key: String(body.key ?? "") });
    const identity = addressToBech32(address);
    if (identity !== claims.address) return json({ error: "address_mismatch" }, 401);
    if (new TextDecoder().decode(payload) !== challengeMessage(claims)) return json({ error: "message_mismatch" }, 401);

    const session = issueSession(identity);
    return json({ identity, expiresAt: session.claims.exp }, 200, { "set-cookie": sessionCookie(request, session.token) });
  } catch (error) {
    if (error instanceof NotConfiguredError) throw error;
    return json({ error: "invalid_signature", message: error instanceof Error ? error.message : undefined }, 401);
  }
};

export default async (request: Request, context: Context) => {
  const action = context.params.action;
  try {
    if (action === "session" && request.method === "GET") {
      const session = readSession(request);
      return session ? json({ identity: session.identity, expiresAt: session.exp }) : json({ identity: null }, 401);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
    if (action === "challenge") return await challenge(request);
    if (action === "verify") return await verify(request);
    if (action === "logout") return json({ identity: null }, 200, { "set-cookie": clearSessionCookie(request) });
    return json({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof NotConfiguredError) {
      console.error(`[wallet-auth] ${error.message}`);
      return json({ error: "not_configured" }, 503);
    }
    console.error("[wallet-auth]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = {
  path: "/api/wallet-auth/:action",
};
