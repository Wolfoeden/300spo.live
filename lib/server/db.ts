import postgres from "postgres";

// One pooled connection as the `game_api` role, which may only execute the
// game.* and drip.* functions from supabase/migrations. Transaction-mode
// pooling: no prepared statements.
let client: postgres.Sql | null = null;

export class DatabaseConfigError extends Error {}

export const database = () => {
  if (client) return client;
  const url = process.env.GAME_DATABASE_URL ?? globalThis.Netlify?.env.get("GAME_DATABASE_URL");
  if (!url) throw new DatabaseConfigError("GAME_DATABASE_URL is not set");
  // Netlify stops functions after 10 s; slow local networks can raise this via GAME_DB_CONNECT_TIMEOUT.
  const connectTimeout = Number(process.env.GAME_DB_CONNECT_TIMEOUT ?? 7);
  client = postgres(url, { ssl: "require", prepare: false, max: 1, idle_timeout: 20, connect_timeout: connectTimeout });
  return client;
};

/** Runs `select <fn>(...) as result` and returns the jsonb result. */
export const result = async <T>(query: Promise<postgres.RowList<postgres.Row[]>>) => (await query)[0]?.result as T;

export const asJson = (value: unknown) => database().json(value as postgres.JSONValue);
