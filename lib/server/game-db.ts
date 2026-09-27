import postgres from "postgres";

// Connects as the `game_api` role, which may only execute the game.* functions
// defined in supabase/migrations. Transaction-mode pooling: no prepared statements.
let client: postgres.Sql | null = null;

const db = () => {
  if (client) return client;
  const url = process.env.GAME_DATABASE_URL ?? globalThis.Netlify?.env.get("GAME_DATABASE_URL");
  if (!url) throw new GameConfigError("GAME_DATABASE_URL is not set");
  // Netlify stops functions after 10 s; slow local networks can raise this via GAME_DB_CONNECT_TIMEOUT.
  const connectTimeout = Number(process.env.GAME_DB_CONNECT_TIMEOUT ?? 7);
  client = postgres(url, { ssl: "require", prepare: false, max: 1, idle_timeout: 20, connect_timeout: connectTimeout });
  return client;
};

export class GameConfigError extends Error {}

/** Errors raised by the game.* functions (`raise exception '<code>'`). */
export const GAME_ERRORS = new Set([
  "game_disabled",
  "amount_too_small",
  "too_many_open_deposits",
  "deposit_not_found",
  "tx_already_used",
  "insufficient_balance",
  "transfer_not_found",
]);

export const gameErrorCode = (error: unknown) =>
  error instanceof Error && GAME_ERRORS.has(error.message) ? error.message : null;

export type GameState = {
  enabled: boolean;
  roundCost: number;
  minDeposit: number;
  treasuryAddress: string | null;
  balance: number;
  deposits: { reference: string; requested: number; received: number | null; status: string; txHash: string | null; createdAt: string }[];
  rounds: { id: number; game: string; cost: number; createdAt: string }[];
};

const one = async <T>(query: Promise<postgres.RowList<postgres.Row[]>>) => (await query)[0]?.result as T;

export const gameDb = {
  state: (wallet: string) => one<GameState>(db()`select game.state(${wallet}) as result`),
  openDeposit: (wallet: string, amount: bigint) =>
    one<{ reference: string; treasuryAddress: string; amount: number }>(db()`select game.open_deposit(${wallet}, ${amount.toString()}::bigint) as result`),
  markDepositSubmitted: (wallet: string, reference: string, txHash: string) =>
    db()`select game.mark_deposit_submitted(${wallet}, ${reference}::uuid, ${txHash})`,
  depositTx: async (wallet: string, reference: string) => {
    const state = await gameDb.state(wallet);
    return state.deposits.find((deposit) => deposit.reference === reference) ?? null;
  },
  confirmDeposit: (reference: string, txHash: string, received: bigint, blockHeight: number) =>
    one<{ status: string; wallet?: string; balance?: number }>(
      db()`select game.confirm_deposit(${reference}::uuid, ${txHash}, ${received.toString()}::bigint, ${blockHeight}::bigint) as result`,
    ),
  recordUnmatched: (txHash: string, quantity: bigint, blockHeight: number) =>
    db()`select game.record_unmatched(${txHash}, ${quantity.toString()}::bigint, ${blockHeight}::bigint)`,
  watcherState: () => one<{ treasuryAddress: string | null; scannedBlockHeight: number }>(db()`select game.watcher_state() as result`),
  setScannedBlockHeight: (treasury: string, height: number) => db()`select game.set_scanned_block_height(${treasury}, ${height}::bigint)`,
  startRound: (wallet: string, game: string) =>
    one<{ roundId: number; cost: number; balance: number }>(db()`select game.start_round(${wallet}, ${game}) as result`),
  adminOverview: () => one<Record<string, unknown>>(db()`select game.admin_overview() as result`),
  adminUpdateSettings: (enabled: boolean, roundCost: bigint, minDeposit: bigint, treasury: string | null) =>
    db()`select game.admin_update_settings(${enabled}, ${roundCost.toString()}::bigint, ${minDeposit.toString()}::bigint, ${treasury})`,
  adminAdjust: (wallet: string, delta: bigint, note: string) =>
    db()`select game.admin_adjust(${wallet}, ${delta.toString()}::bigint, ${note}) as result`,
  adminAssignUnmatched: (txHash: string, wallet: string) => db()`select game.admin_assign_unmatched(${txHash}, ${wallet}) as result`,
};
