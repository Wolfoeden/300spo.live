import type { Config } from "@netlify/functions";
import { gameDb } from "../../lib/server/game-db";

// Moves every blackjack and poker table past its due deadlines once a minute:
// starts a round whose countdown ran out, stands (blackjack) or checks or folds
// (poker) a hand whose time is up, frees idle seats. The players' own requests do the same between these runs, so a table
// only waits for this when nobody is looking. Scheduled functions run only on
// the published production deploy.
export default async () => {
  try {
    const [row] = await gameDb.bjTickAll();
    console.log("[blackjack-tick] tables", row?.bj_tick_all ?? 0);
  } catch (error) {
    console.error("[blackjack-tick] failed", error);
  }
  try {
    const [row] = await gameDb.pkTickAll();
    console.log("[blackjack-tick] poker tables", row?.pk_tick_all ?? 0);
  } catch (error) {
    console.error("[blackjack-tick] poker failed", error);
  }
};

export const config: Config = { schedule: "* * * * *" };
