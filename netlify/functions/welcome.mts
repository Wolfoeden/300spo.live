import type { Config } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, isRewardAddress } from "../../lib/cardano/address";
import { DatabaseConfigError } from "../../lib/server/db";
import { gameErrorCode } from "../../lib/server/game-db";
import { claimWelcome } from "../../lib/server/welcome";
import { json } from "./_shared/wallet-auth";

// Public: books the starting credit for a connected wallet's stake address as
// soon as it connects on the landing page, without a signature. The credit
// only ever lands on that stake address's own game account, which nobody but
// its owner can sign in to, and it is booked once per address.
export default async (request: Request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden_origin" }, 403);
  const body = (await request.json().catch(() => null)) as { wallet?: unknown } | null;
  let wallet: string;
  try {
    const bytes = addressBytesFromWallet(String(body?.wallet ?? "").trim());
    if (!isRewardAddress(bytes)) return json({ status: "not_delegated" });
    wallet = addressToBech32(bytes);
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  if (!wallet.startsWith("stake1")) return json({ status: "not_delegated" });
  try {
    return json(await claimWelcome(wallet));
  } catch (error) {
    const code = gameErrorCode(error);
    if (code) return json({ error: code }, 409);
    if (error instanceof DatabaseConfigError) return json({ error: "not_configured" }, 503);
    console.error("[welcome]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = { path: "/api/welcome" };
