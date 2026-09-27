import type { Config } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, isRewardAddress } from "../../lib/cardano/address";
import { DatabaseConfigError } from "../../lib/server/db";
import { dripDb } from "../../lib/server/drip-db";
import { json } from "./_shared/wallet-auth";

// Public, read-only: the drip settings and one wallet's allocations. Everything
// here is derived from public chain data, so no sign-in is required.
export default async (request: Request) => {
  let stake: string;
  try {
    const bytes = addressBytesFromWallet(new URL(request.url).searchParams.get("stake") ?? "");
    if (!isRewardAddress(bytes)) throw new Error("not a stake address");
    stake = addressToBech32(bytes);
  } catch {
    return json({ error: "invalid_stake_address" }, 400);
  }
  try {
    return json(await dripDb.statusFor(stake), 200, { "cache-control": "no-store" });
  } catch (error) {
    if (error instanceof DatabaseConfigError) return json({ error: "not_configured" }, 503);
    console.error("[drip]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = { path: "/api/drip/status" };
