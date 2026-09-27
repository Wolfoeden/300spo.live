import type { Config } from "@netlify/functions";
import { gameDb } from "../../lib/server/game-db";
import { scanTreasury } from "../../lib/server/game-scan";

// Credits game deposits: scans the treasury address every two minutes.
// Scheduled functions run only on the published production deploy. Every run
// records its outcome in game.settings, which /admin/ shows as "Last scan".
export default async () => {
  let result: Record<string, unknown>;
  try {
    result = { ...(await scanTreasury(20_000)) };
  } catch (error) {
    console.error("[game-watcher] scan failed", error);
    result = { error: error instanceof Error ? error.message : String(error) };
  }
  await gameDb.recordScan({ source: "schedule", ...result }).catch((error) => console.error("[game-watcher] could not record scan", error));
};

export const config: Config = { schedule: "*/2 * * * *" };
