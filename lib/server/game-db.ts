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
  "race_changed",
  "invalid_request",
  "round_open",
  "round_not_open",
]);

export const gameErrorCode = (error: unknown) =>
  error instanceof Error && GAME_ERRORS.has(error.message) ? error.message : null;

export type GameState = {
  enabled: boolean;
  minDeposit: number;
  treasuryAddress: string | null;
  bets: { min: number; max: number; step: number };
  games: { id: string; name: string; kind: "pick" | "race"; outcomes: number; payoutBps: number; enabled: boolean }[];
  balance: number;
  welcome: { enabled: boolean; amount: number; claimed: boolean };
  deposits: { reference: string; requested: number; received: number | null; status: string; note: string | null; txHash: string | null; createdAt: string }[];
  rounds: {
    id: number;
    game: string;
    bet: number;
    choice: number;
    outcome: number;
    payout: number;
    oddsBps: number | null;
    nonce: number;
    serverSeedHash: string;
    clientSeed: string;
    createdAt: string;
  }[];
};

/** The next card race for a wallet: face-up track and odds per suit (♠ ♥ ♦ ♣). */
export type RacePreview = { nonce: number; serverSeedHash: string; track: number[]; odds: number[] };

/** The next few races at once (4× mode); deal i uses nonce `nonce + i`. */
export type RacePreviews = { nonce: number; serverSeedHash: string; deals: { track: number[]; odds: number[] }[] };

/** A chicken round as the player may see it (the car's lane only once it is over). */
export type ChickenRound = {
  id: number;
  bet: number;
  hazards: number;
  lanes: number;
  step: number;
  status: "open" | "lost" | "collected";
  payout: number;
  nonce: number;
  serverSeedHash: string;
  clientSeed: string;
  crashLane: number | null;
  multipliers: number[];
  balance?: number;
};
export type ChickenState = { open: ChickenRound | null; difficulties: { hazards: number; lanes: number; multipliers: number[] }[] };

/** Result of a 4× round: one entry per deal, null where the player skipped it. */
export type MultiRaceResult = { results: (PlayResult | null)[]; balance: number; serverSeedHash: string; clientSeed: string };

/** One race with chips on one or more lanes: a round per staked lane. */
export type StakedRace = {
  outcome: number;
  nonce: number;
  rounds: { roundId: number; choice: number; bet: number; win: boolean; payout: number }[];
  race: { track: number[]; draws: number[]; odds: number[] };
};
export type StakedRacesResult = { results: (StakedRace | null)[]; balance: number; serverSeedHash: string; clientSeed: string };

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
  /** Card race only: the track, the cards turned until the finish and the odds shown. */
  race?: { track: number[]; draws: number[]; odds: number[] };
};

export type Fairness = {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string; lastNonce: number; revealedAt: string }[];
};

/** What each player has lost (every stake that did not come back), counted up to `asOf` (the start of the UTC day). */
export type LossBoard = {
  asOf: string;
  nextAt: string;
  revealAt: string | null;
  /** Every stake lost so far, live. */
  jackpot: number;
  total: number;
  players: number;
  rows: { wallet: string; lost: number; rounds: number }[];
};

/** `not_eligible` covers the unpublished ADA minimum; callers must not explain it. */
export type WelcomeClaim =
  | { status: "granted"; amount: number; total: number; balance: number }
  | { status: "claimed" | "not_eligible" | "disabled" };

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
  racePreview: (wallet: string) => one<RacePreview>(db()`select game.race_preview(${wallet}) as result`),
  racePreviews: (wallet: string, count: number) => one<RacePreviews>(db()`select game.race_previews(${wallet}, ${count}::integer) as result`),
  playRaceMulti: (wallet: string, bet: bigint, choices: number[], nonce: number, serverSeedHash: string) =>
    one<MultiRaceResult>(
      db()`select game.play_race_multi(${wallet}, ${bet.toString()}::bigint, ${choices}::integer[], ${nonce}::integer, ${serverSeedHash}) as result`,
    ),
  playRaceStakes: (wallet: string, stakes: bigint[], nonce: number, serverSeedHash: string) =>
    one<StakedRacesResult>(
      db()`select game.play_race_stakes(${wallet}, ${stakes.map(String)}::bigint[], ${nonce}::integer, ${serverSeedHash}) as result`,
    ),
  playRace: (wallet: string, bet: bigint, choice: number, nonce: number, serverSeedHash: string) =>
    one<PlayResult>(
      db()`select game.play_race(${wallet}, ${bet.toString()}::bigint, ${choice}::integer, ${nonce}::integer, ${serverSeedHash}) as result`,
    ),
  chickenState: (wallet: string) => one<ChickenState>(db()`select game.chicken_state(${wallet}) as result`),
  chickenStart: (wallet: string, bet: bigint, hazards: number) =>
    one<ChickenRound>(db()`select game.chicken_start(${wallet}, ${bet.toString()}::bigint, ${hazards}::integer) as result`),
  chickenStep: (wallet: string, round: number) => one<ChickenRound>(db()`select game.chicken_step(${wallet}, ${round}::bigint) as result`),
  chickenCollect: (wallet: string, round: number) => one<ChickenRound>(db()`select game.chicken_collect(${wallet}, ${round}::bigint) as result`),
  claimWelcome: (wallet: string, lovelace: bigint, pool: boolean) =>
    one<WelcomeClaim>(db()`select game.claim_welcome(${wallet}, ${lovelace.toString()}::bigint, ${pool}::boolean) as result`),
  logWelcomeAttempt: (wallet: string, status: string, pool: boolean, drep: boolean, lovelace: bigint | null) =>
    db()`select game.log_welcome_attempt(${wallet}, ${status}, ${pool}::boolean, ${drep}::boolean, ${lovelace === null ? null : lovelace.toString()}::bigint)`,
  fairness: (wallet: string) => one<Fairness>(db()`select game.fairness(${wallet}) as result`),
  lossBoard: (limit: number) => one<LossBoard>(db()`select game.loss_board(${limit}::integer) as result`),
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
  adminUpdateWelcome: (enabled: boolean, amount: bigint, poolAmount: bigint, minLovelace: bigint) =>
    db()`select game.admin_update_welcome(${enabled}, ${amount.toString()}::bigint, ${poolAmount.toString()}::bigint, ${minLovelace.toString()}::bigint)`,
};
