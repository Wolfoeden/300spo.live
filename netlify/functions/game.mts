import type { Config, Context } from "@netlify/functions";
import { DatabaseConfigError } from "../../lib/server/db";
import { gameDb, gameErrorCode } from "../../lib/server/game-db";
import { checkDepositTx } from "../../lib/server/game-scan";
import { tableName } from "../../lib/server/handles";
import { claimWelcome } from "../../lib/server/welcome";
import { json, readSession } from "./_shared/wallet-auth";

// Player API for the game balance. Every call needs the wallet session from
// /api/wallet-auth; the session's wallet is the account.
const GAME_ID = /^[a-z0-9-]{1,32}$/;
const TX_HASH = /^[0-9a-f]{64}$/;
const REFERENCE = /^[0-9a-f-]{36}$/;
const MAX_DEPOSIT = 10_000_000_000n;

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
};

const sameOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

const handle = async (request: Request, action: string, wallet: string) => {
  if (action === "state" && request.method === "GET") return json({ wallet, ...(await gameDb.state(wallet)) });
  if (action === "fairness" && request.method === "GET") return json(await gameDb.fairness(wallet));
  if (action === "chicken" && request.method === "GET") return json(await gameDb.chickenState(wallet));
  // Blackjack: looking at a table also keeps the seat and moves the table past due deadlines.
  if (action === "blackjack" && request.method === "GET") {
    const table = Number(new URL(request.url).searchParams.get("table") ?? 1);
    if (!Number.isInteger(table) || table < 1 || table > 99) return json({ error: "invalid_request" }, 400);
    return json(await gameDb.bjEnter(table, wallet));
  }
  // Poker: behind the room code; looking at the table keeps the seat, like blackjack.
  if (action === "poker" && request.method === "GET") {
    const table = Number(new URL(request.url).searchParams.get("table") ?? 1);
    if (!Number.isInteger(table) || table < 1 || table > 99) return json({ error: "invalid_request" }, 400);
    return json(await gameDb.pkEnter(table, wallet));
  }
  if (action === "race" && request.method === "GET") {
    // With ?count the deals come as a list (the race table); without it, the single preview of older clients.
    const param = new URL(request.url).searchParams.get("count");
    const count = Number(param ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 4) return json({ error: "invalid_request" }, 400);
    return json(param === null ? await gameDb.racePreview(wallet) : await gameDb.racePreviews(wallet, count));
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
  if (!sameOrigin(request)) return json({ error: "forbidden_origin" }, 403);
  const body = await readBody(request);

  if (action === "deposit") {
    let amount: bigint;
    try {
      amount = BigInt(String(body.amount ?? ""));
    } catch {
      return json({ error: "invalid_amount" }, 400);
    }
    if (amount <= 0n || amount > MAX_DEPOSIT) return json({ error: "invalid_amount" }, 400);
    return json(await gameDb.openDeposit(wallet, amount));
  }

  if (action === "deposit-submitted") {
    const reference = String(body.reference ?? "");
    const txHash = String(body.txHash ?? "");
    if (!REFERENCE.test(reference) || !TX_HASH.test(txHash)) return json({ error: "invalid_request" }, 400);
    await gameDb.markDepositSubmitted(wallet, reference, txHash);
    return json({ ok: true });
  }

  if (action === "deposit-check") {
    const deposit = await gameDb.depositTx(wallet, String(body.reference ?? ""));
    if (!deposit?.txHash) return json({ error: "deposit_not_found" }, 404);
    if (deposit.status === "confirmed") return json({ status: "confirmed", confirmations: null });
    const result = await checkDepositTx(deposit.txHash).catch(() => null);
    if (!result) return json({ status: "pending", confirmations: null });
    return json({ status: result.credited ? "confirmed" : "pending", confirmations: result.confirmations });
  }

  if (action === "play") {
    const game = String(body.game ?? "");
    const choice = Number(body.choice);
    const bet = /^\d{1,12}$/.test(String(body.bet)) ? BigInt(String(body.bet)) : null;
    if (!GAME_ID.test(game) || bet === null || !Number.isInteger(choice)) return json({ error: "invalid_request" }, 400);
    if (game === "card-race") {
      // The race the player saw: its nonce and server seed hash from /api/game/race.
      const nonce = Number(body.nonce);
      const serverSeedHash = String(body.serverSeedHash ?? "");
      if (!Number.isInteger(nonce) || !/^[0-9a-f]{64}$/.test(serverSeedHash)) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.playRace(wallet, bet, choice, nonce, serverSeedHash));
    }
    return json(await gameDb.play(wallet, game, bet, choice));
  }

  if (action === "play-races") {
    // 4× mode: one pick per deal shown (-1 = skipped), same bet on each.
    const bet = /^\d{1,12}$/.test(String(body.bet)) ? BigInt(String(body.bet)) : null;
    const choices = Array.isArray(body.choices) ? body.choices.map(Number) : [];
    const nonce = Number(body.nonce);
    const serverSeedHash = String(body.serverSeedHash ?? "");
    const valid =
      bet !== null &&
      choices.length >= 1 &&
      choices.length <= 4 &&
      choices.every((choice) => Number.isInteger(choice) && choice >= -1 && choice <= 3) &&
      Number.isInteger(nonce) &&
      /^[0-9a-f]{64}$/.test(serverSeedHash);
    if (!valid) return json({ error: "invalid_request" }, 400);
    return json(await gameDb.playRaceMulti(wallet, bet, choices, nonce, serverSeedHash));
  }

  if (action === "play-stakes") {
    // Chips on lanes: four amounts per race shown (♠ ♥ ♦ ♣), 0 = no chip; the database checks the bet rules.
    const stakes = Array.isArray(body.stakes) ? body.stakes.map((stake: unknown) => String(stake)) : [];
    const nonce = Number(body.nonce);
    const serverSeedHash = String(body.serverSeedHash ?? "");
    const valid =
      stakes.length >= 4 &&
      stakes.length <= 16 &&
      stakes.length % 4 === 0 &&
      stakes.every((stake: string) => /^\d{1,12}$/.test(stake)) &&
      Number.isInteger(nonce) &&
      /^[0-9a-f]{64}$/.test(serverSeedHash);
    if (!valid) return json({ error: "invalid_request" }, 400);
    return json(await gameDb.playRaceStakes(wallet, stakes.map(BigInt), nonce, serverSeedHash));
  }

  if (action.startsWith("blackjack-")) {
    const table = Number(body.table);
    if (!Number.isInteger(table) || table < 1 || table > 99) return json({ error: "invalid_request" }, 400);
    if (action === "blackjack-sit") {
      const seat = Number(body.seat);
      if (!Number.isInteger(seat) || seat < 1 || seat > 7) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.bjSit(table, seat, wallet, await tableName(wallet)));
    }
    // An account may hold several seats: leave and bet take one seat, or without it all of them.
    const seat = body.seat === undefined || body.seat === null ? null : Number(body.seat);
    if (seat !== null && (!Number.isInteger(seat) || seat < 1 || seat > 7)) return json({ error: "invalid_request" }, 400);
    if (action === "blackjack-leave") return json(await gameDb.bjLeave(table, wallet, seat));
    if (action === "blackjack-bet") {
      const bet = body.bet === null ? null : /^\d{1,12}$/.test(String(body.bet)) ? BigInt(String(body.bet)) : undefined;
      if (bet === undefined) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.bjBet(table, wallet, bet, seat));
    }
    if (action === "blackjack-act") {
      const move = String(body.move ?? "");
      if (!["hit", "stand", "double", "split"].includes(move)) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.bjAct(table, wallet, move));
    }
    return json({ error: "not_found" }, 404);
  }

  if (action === "poker-unlock") {
    const code = String(body.code ?? "").trim();
    if (!/^[0-9A-Za-z]{1,32}$/.test(code)) return json({ error: "wrong_code" }, 403);
    const result = await gameDb.pkUnlock(wallet, code);
    if (result.ok) return json({ ok: true });
    return json({ error: result.error ?? "wrong_code" }, result.error === "too_many_attempts" ? 429 : 403);
  }

  if (action.startsWith("poker-")) {
    const table = Number(body.table);
    if (!Number.isInteger(table) || table < 1 || table > 99) return json({ error: "invalid_request" }, 400);
    const amount = (value: unknown) => (/^\d{1,12}$/.test(String(value)) ? BigInt(String(value)) : null);
    if (action === "poker-sit") {
      const seat = Number(body.seat);
      const buyIn = amount(body.buyIn);
      if (!Number.isInteger(seat) || seat < 1 || seat > 6 || buyIn === null) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.pkSit(table, seat, wallet, await tableName(wallet), buyIn));
    }
    if (action === "poker-chips") {
      const chips = amount(body.amount);
      if (chips === null) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.pkAddChips(table, wallet, chips));
    }
    if (action === "poker-sit-out") return json(await gameDb.pkSitOut(table, wallet, body.out === true));
    if (action === "poker-leave") return json(await gameDb.pkLeave(table, wallet));
    if (action === "poker-act") {
      const move = String(body.move ?? "");
      if (!["fold", "check", "call", "raise", "allin"].includes(move)) return json({ error: "invalid_request" }, 400);
      const to = move === "raise" ? amount(body.amount) : null;
      if (move === "raise" && to === null) return json({ error: "invalid_request" }, 400);
      return json(await gameDb.pkAct(table, wallet, move, to));
    }
    return json({ error: "not_found" }, 404);
  }

  if (action === "chicken-start") {
    const bet = /^\d{1,12}$/.test(String(body.bet)) ? BigInt(String(body.bet)) : null;
    const hazards = Number(body.hazards);
    if (bet === null || ![1, 3, 5, 10].includes(hazards)) return json({ error: "invalid_request" }, 400);
    return json(await gameDb.chickenStart(wallet, bet, hazards));
  }

  if (action === "chicken-step" || action === "chicken-collect") {
    const round = Number(body.round);
    if (!Number.isSafeInteger(round) || round < 1) return json({ error: "invalid_request" }, 400);
    return json(action === "chicken-step" ? await gameDb.chickenStep(wallet, round) : await gameDb.chickenCollect(wallet, round));
  }

  if (action === "welcome") return json(await claimWelcome(wallet));

  if (action === "seed") {
    const clientSeed = body.clientSeed === undefined || body.clientSeed === "" ? null : String(body.clientSeed);
    return json(await gameDb.rotateSeed(wallet, clientSeed));
  }

  return json({ error: "not_found" }, 404);
};

export default async (request: Request, context: Context) => {
  const session = readSession(request);
  if (!session) return json({ error: "not_signed_in" }, 401);
  try {
    return await handle(request, context.params.action, session.identity);
  } catch (error) {
    const code = gameErrorCode(error);
    if (code) return json({ error: code }, code === "deposit_not_found" ? 404 : 409);
    if (error instanceof DatabaseConfigError) {
      console.error(`[game] ${error.message}`);
      return json({ error: "not_configured" }, 503);
    }
    console.error("[game]", error);
    return json({ error: "internal_error" }, 500);
  }
};

export const config: Config = { path: "/api/game/:action" };
