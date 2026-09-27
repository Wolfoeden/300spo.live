// Connects as game_api through the Supabase pooler and checks its privileges:
//   node scripts/db-smoke.mjs [host]
import { readFileSync } from "node:fs";
import postgres from "postgres";

const password = process.env.GAME_DB_PASSWORD ?? readFileSync(".env.local", "utf8").match(/GAME_DB_PASSWORD=(\S+)/)?.[1];
const hosts = process.argv[2] ? [process.argv[2]] : ["aws-0-eu-west-1.pooler.supabase.com", "aws-1-eu-west-1.pooler.supabase.com"];

for (const host of hosts) {
  const sql = postgres({
    host,
    port: 6543,
    database: "postgres",
    username: "game_api.uhxwaonnkvicfekzefbn",
    password,
    ssl: "require",
    prepare: false,
    max: 1,
    connect_timeout: 8,
  });
  try {
    const [who] = await sql`select current_user as role, (select game.watcher_state()) as state`;
    let tableAccess = "denied";
    await sql`select count(*) from game.accounts`.then(() => (tableAccess = "ALLOWED"), () => {});
    console.log(JSON.stringify({ host, ok: true, role: who.role, state: who.state, tableAccess }));
  } catch (error) {
    console.log(JSON.stringify({ host, ok: false, error: error.message }));
  } finally {
    await sql.end({ timeout: 2 });
  }
}
