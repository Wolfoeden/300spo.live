import type { Config } from "@netlify/functions";
import { DatabaseConfigError } from "../../lib/server/db";
import { dripDb } from "../../lib/server/drip-db";
import { json } from "./_shared/wallet-auth";

// Public: the drip tiers and the starting-credit offer, for pages without a
// connected wallet (landing page, delegation dialog). Cached briefly at the edge.
export default async () => {
  try {
    return json(await dripDb.offers(), 200, {
      "cache-control": "public, max-age=60",
      "netlify-cdn-cache-control": "public, durable, max-age=60, stale-while-revalidate=300",
    });
  } catch (error) {
    if (error instanceof DatabaseConfigError) return json({ error: "not_configured" }, 503);
    console.error("[offers]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = { path: "/api/offers" };
