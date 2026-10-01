import type { Config } from "@netlify/functions";
import { shortenAddress } from "../../lib/cardano/address";
import { DatabaseConfigError } from "../../lib/server/db";
import { gameDb } from "../../lib/server/game-db";
import { json } from "./_shared/wallet-auth";

const LIMIT = 100;

// Public: the jackpot, the loss board and the countdown for the rewards page.
// The CDN may keep an answer for a minute. Wallets leave the server shortened
// only.
export default async (request: Request) => {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { allow: "GET" });
  try {
    const board = await gameDb.lossBoard(LIMIT);
    return json(
      { ...board, rows: board.rows.map((row) => ({ ...row, wallet: shortenAddress(row.wallet, 10, 6) })) },
      200,
      { "cache-control": "public, max-age=30", "netlify-cdn-cache-control": "public, s-maxage=60, stale-while-revalidate=30" },
    );
  } catch (error) {
    if (error instanceof DatabaseConfigError) return json({ error: "not_configured" }, 503);
    console.error("[rewards]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = { path: "/api/rewards" };
