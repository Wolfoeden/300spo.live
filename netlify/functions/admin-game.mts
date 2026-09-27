import type { Config } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, isRewardAddress } from "../../lib/cardano/address";
import { DatabaseConfigError } from "../../lib/server/db";
import { gameDb, gameErrorCode } from "../../lib/server/game-db";
import { scanTreasury } from "../../lib/server/game-scan";
import { isAuthenticated, json } from "./_shared/admin-auth.mjs";

const TX_HASH = /^[0-9a-f]{64}$/;

const toBigInt = (value: unknown) => {
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
};

/** Normalises a mainnet address: `payment` accepts addr1 only, `wallet` also stake1 accounts. */
const mainnetAddress = (value: unknown, kind: "payment" | "wallet") => {
  try {
    const bytes = addressBytesFromWallet(String(value ?? "").trim());
    const bech32 = addressToBech32(bytes);
    if (kind === "payment") return !isRewardAddress(bytes) && bech32.startsWith("addr1") ? bech32 : null;
    return bech32.startsWith("stake1") || bech32.startsWith("addr1") ? bech32 : null;
  } catch {
    return null;
  }
};

const act = async (body: Record<string, unknown>) => {
  switch (body.action) {
    case "settings": {
      const roundCost = toBigInt(body.roundCost);
      const minDeposit = toBigInt(body.minDeposit);
      const treasury = body.treasuryAddress ? mainnetAddress(body.treasuryAddress, "payment") : null;
      if (!roundCost || roundCost <= 0n || !minDeposit || minDeposit <= 0n) return json({ error: "Amounts must be positive whole numbers." }, 400);
      if (body.treasuryAddress && !treasury) return json({ error: "The treasury must be a Cardano mainnet payment address (addr1…)." }, 400);
      if (body.enabled === true && !treasury) return json({ error: "Set a treasury address before enabling deposits." }, 400);
      await gameDb.adminUpdateSettings(body.enabled === true, roundCost, minDeposit, treasury);
      return json(await gameDb.adminOverview());
    }
    case "adjust": {
      const wallet = mainnetAddress(body.wallet, "wallet");
      const delta = toBigInt(body.delta);
      if (!wallet || !delta) return json({ error: "Enter a wallet and a non-zero amount." }, 400);
      await gameDb.adminAdjust(wallet, delta, String(body.note ?? "").slice(0, 200) || "manual adjustment");
      return json(await gameDb.adminOverview());
    }
    case "assign": {
      const wallet = mainnetAddress(body.wallet, "wallet");
      if (!wallet || !TX_HASH.test(String(body.txHash))) return json({ error: "Enter the transfer and a wallet." }, 400);
      await gameDb.adminAssignUnmatched(String(body.txHash), wallet);
      return json(await gameDb.adminOverview());
    }
    case "scan": {
      const scan = await scanTreasury(7_000);
      await gameDb.recordScan({ source: "admin", ...scan });
      return json({ scan, ...(await gameDb.adminOverview()) });
    }
    default:
      return json({ error: "Unknown action." }, 400);
  }
};

export default async (request: Request) => {
  if (!isAuthenticated(request)) return json({ error: "Unauthorized." }, 401);
  try {
    if (request.method === "GET") return json(await gameDb.adminOverview());
    if (request.method === "POST") return await act((await request.json().catch(() => ({}))) as Record<string, unknown>);
    return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  } catch (error) {
    const code = gameErrorCode(error);
    if (code) return json({ error: code.replaceAll("_", " ") }, 409);
    if (error instanceof DatabaseConfigError) return json({ error: "Game database is not configured." }, 503);
    console.error("[admin-game]", error);
    return json({ error: error instanceof Error ? error.message : "Request failed." }, 500);
  }
};

export const config: Config = { path: "/api/admin/game" };
