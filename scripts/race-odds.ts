// Prints the odds table for game.race_odds (one row per track pattern):
//   tsx scripts/race-odds.ts > odds.sql
import { allPatterns, patternOdds } from "../lib/game/card-race";

const rows = allPatterns().map((pattern) => `('${pattern}', array[${patternOdds(pattern).join(", ")}])`);
console.log(`insert into game.race_odds (pattern, odds_bps) values\n  ${rows.join(",\n  ")};`);
