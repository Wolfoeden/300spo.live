import type { Config } from "@netlify/functions";
import { scanTreasury } from "../../lib/server/game-scan";

// Credits game deposits: scans the treasury address every two minutes.
// Scheduled functions run only on the published production deploy.
export default async () => {
  try {
    const result = await scanTreasury(20_000);
    console.log("[game-watcher]", JSON.stringify(result));
  } catch (error) {
    console.error("[game-watcher] scan failed", error);
  }
};

export const config: Config = { schedule: "*/2 * * * *" };
