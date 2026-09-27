import type { Config } from "@netlify/functions";
import { runDrip } from "../../lib/server/drip-run";

// Hourly: confirms or releases pending payouts and takes the epoch snapshot
// once per epoch. Each run's outcome is stored in drip.settings for /admin/drip/.
export default async () => {
  await runDrip("schedule");
};

export const config: Config = { schedule: "17 * * * *" };
