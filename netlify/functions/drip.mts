import type { Config, Context } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, isRewardAddress } from "../../lib/cardano/address";
import { DatabaseConfigError } from "../../lib/server/db";
import { dripDb } from "../../lib/server/drip-db";
import { json, readSession } from "./_shared/wallet-auth";

// GET status is public and read-only: the drip settings and one wallet's
// allocations, all derived from public chain data. POST claim needs the wallet
// session; it marks the wallet's earned rewards for the next payout.
const status = async (request: Request) => {
  let stake: string;
  try {
    const bytes = addressBytesFromWallet(new URL(request.url).searchParams.get("stake") ?? "");
    if (!isRewardAddress(bytes)) throw new Error("not a stake address");
    stake = addressToBech32(bytes);
  } catch {
    return json({ error: "invalid_stake_address" }, 400);
  }
  return json(await dripDb.statusFor(stake), 200, { "cache-control": "no-store" });
};

const claim = async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden_origin" }, 403);
  const session = readSession(request);
  if (!session) return json({ error: "not_signed_in" }, 401);
  if (!session.identity.startsWith("stake1")) return json({ error: "invalid_stake_address" }, 400);
  return json({ ...(await dripDb.claim(session.identity)), ...(await dripDb.statusFor(session.identity)) });
};

export default async (request: Request, context: Context) => {
  try {
    if (context.params.action === "status" && request.method === "GET") return await status(request);
    if (context.params.action === "claim" && request.method === "POST") return await claim(request);
    return json({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof DatabaseConfigError) return json({ error: "not_configured" }, 503);
    console.error("[drip]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = { path: "/api/drip/:action" };
