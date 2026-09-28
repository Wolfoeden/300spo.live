import type { Config, Context } from "@netlify/functions";
import { DatabaseConfigError } from "../../lib/server/db";
import { gameDb, gameErrorCode } from "../../lib/server/game-db";
import { checkDepositTx } from "../../lib/server/game-scan";
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
  if (action === "race" && request.method === "GET") {
    const count = Number(new URL(request.url).searchParams.get("count") ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 4) return json({ error: "invalid_request" }, 400);
    return json(count === 1 ? await gameDb.racePreview(wallet) : await gameDb.racePreviews(wallet, count));
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
