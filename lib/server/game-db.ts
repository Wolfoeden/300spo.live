import { asJson, database as db, result as one } from "./db";

/** Errors raised by the game.* and drip.* functions (`raise exception '<code>'`). */
export const GAME_ERRORS = new Set([
  "game_disabled",
  "amount_too_small",
  "too_many_open_deposits",
  "deposit_not_found",
  "tx_already_used",
  "insufficient_balance",
  "transfer_not_found",
  "allocation_taken",
  "invalid_bet",
  "invalid_choice",
  "invalid_client_seed",
  "invalid_bet_limits",
  "game_not_found",
]);

export const gameErrorCode = (error: unknown) =>
  error instanceof Error && GAME_ERRORS.has(error.message) ? error.message : null;

export type GameState = {
  enabled: boolean;
  minDeposit: number;
  treasuryAddress: string | null;
  bets: { min: number; max: number; step: number };
  games: { id: string; name: string; outcomes: number; payoutBps: number; enabled: boolean }[];
  balance: number;
  deposits: { reference: string; requested: number; received: number | null; status: string; note: string | null; txHash: string | null; createdAt: string }[];
  rounds: {
    id: number;
    game: string;
    bet: number;
    choice: number;
    outcome: number;
    payout: number;
    nonce: number;
    serverSeedHash: string;
    clientSeed: string;
    createdAt: string;
  }[];
};

export type PlayResult = {
  roundId: number;
  game: string;
  bet: number;
  choice: number;
  outcome: number;
  win: boolean;
  payout: number;
  balance: number;
  nonce: number;
  serverSeedHash: string;
  clientSeed: string;
};

export type Fairness = {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string; lastNonce: number; revealedAt: string }[];
};

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
  rejectDeposit: (reference: string, txHash: string, note: string) => db()`select game.reject_deposit(${reference}::uuid, ${txHash}, ${note})`,
  recordUnmatched: (txHash: string, quantity: bigint, blockHeight: number) =>
    db()`select game.record_unmatched(${txHash}, ${quantity.toString()}::bigint, ${blockHeight}::bigint)`,
  watcherState: () => one<{ treasuryAddress: string | null; scannedBlockHeight: number }>(db()`select game.watcher_state() as result`),
  setScannedBlockHeight: (treasury: string, height: number) => db()`select game.set_scanned_block_height(${treasury}, ${height}::bigint)`,
  recordScan: (scan: Record<string, unknown>) => db()`select game.record_scan(${asJson(scan)})`,
  play: (wallet: string, game: string, bet: bigint, choice: number) =>
    one<PlayResult>(db()`select game.play(${wallet}, ${game}, ${bet.toString()}::bigint, ${choice}::integer) as result`),
  fairness: (wallet: string) => one<Fairness>(db()`select game.fairness(${wallet}) as result`),
  rotateSeed: (wallet: string, clientSeed: string | null) => one<Fairness>(db()`select game.rotate_seed(${wallet}, ${clientSeed}) as result`),
  adminOverview: () => one<Record<string, unknown>>(db()`select game.admin_overview() as result`),
  adminUpdateSettings: (
    enabled: boolean,
    bets: { min: bigint; max: bigint; step: bigint },
    minDeposit: bigint,
    treasury: string | null,
  ) =>
    db()`select game.admin_update_settings(${enabled}, ${bets.min.toString()}::bigint, ${bets.max.toString()}::bigint,
      ${bets.step.toString()}::bigint, ${minDeposit.toString()}::bigint, ${treasury})`,
  adminUpdateGame: (id: string, enabled: boolean, payoutBps: number) =>
    db()`select game.admin_update_game(${id}, ${enabled}, ${payoutBps}::integer)`,
  adminAdjust: (wallet: string, delta: bigint, note: string) =>
    db()`select game.admin_adjust(${wallet}, ${delta.toString()}::bigint, ${note}) as result`,
  adminAssignUnmatched: (txHash: string, wallet: string) => db()`select game.admin_assign_unmatched(${txHash}, ${wallet}) as result`,
};
