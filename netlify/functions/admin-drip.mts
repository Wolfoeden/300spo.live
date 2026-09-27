import type { Config } from "@netlify/functions";
import { DatabaseConfigError } from "../../lib/server/db";
import { dripDb, type DripReward } from "../../lib/server/drip-db";
import { gameErrorCode } from "../../lib/server/game-db";
import { runDrip } from "../../lib/server/drip-run";
import { isAuthenticated, json } from "./_shared/admin-auth.mjs";

const TX_HASH = /^[0-9a-f]{64}$/;
const UNIT = /^(lovelace|[0-9a-f]{56}([0-9a-f]{2}){0,32})$/;
const DISTRIBUTIONS = new Set(["equal", "tokens", "stake"]);
const MAX_BATCH = 40;

const parseRewards = (value: unknown): DripReward[] | null => {
  if (!Array.isArray(value) || value.length > 10) return null;
  const rewards: DripReward[] = [];
  for (const entry of value as Record<string, unknown>[]) {
    const unit = String(entry.unit ?? "").trim().toLowerCase();
    const label = String(entry.label ?? "").trim();
    const decimals = Number(entry.decimals);
    const perEpoch = String(entry.perEpoch ?? "");
    if (!UNIT.test(unit) || !label || label.length > 20 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^\d{1,18}$/.test(perEpoch)) {
      return null;
    }
    rewards.push({ unit, label, decimals, perEpoch });
  }
  return new Set(rewards.map((reward) => reward.unit)).size === rewards.length ? rewards : null;
};

const act = async (body: Record<string, unknown>) => {
  switch (body.action) {
    case "settings": {
      const rewards = parseRewards(body.rewards);
      const minTokens = /^\d{1,15}$/.test(String(body.minTokens)) ? BigInt(String(body.minTokens)) : 0n;
      const distribution = String(body.distribution);
      if (!rewards) return json({ error: "Check the reward list: unit (policy id + asset name hex), label and a whole-number amount." }, 400);
      if (minTokens <= 0n) return json({ error: "The minimum holding must be a positive whole number." }, 400);
      if (!DISTRIBUTIONS.has(distribution)) return json({ error: "Unknown distribution." }, 400);
      await dripDb.adminUpdate(body.enabled === true, minTokens, distribution as "equal", rewards);
      return json(await dripDb.adminOverview());
    }
    case "run":
      return json({ run: await runDrip("admin"), ...(await dripDb.adminOverview()) });
    case "batch":
      return json({ recipients: await dripDb.unpaidBatch(Math.min(MAX_BATCH, Math.max(1, Number(body.limit) || MAX_BATCH))) });
    case "reserve": {
      const ids = Array.isArray(body.allocationIds) ? body.allocationIds.map(Number) : [];
      const recipients = Number(body.recipients);
      if (!TX_HASH.test(String(body.txHash)) || !ids.length || ids.some((id) => !Number.isInteger(id) || id <= 0) || !(recipients > 0)) {
        return json({ error: "Invalid payout." }, 400);
      }
      await dripDb.reservePayout(String(body.txHash), ids, recipients);
      return json({ ok: true });
    }
    case "submitted":
      if (!TX_HASH.test(String(body.txHash))) return json({ error: "Invalid transaction hash." }, 400);
      await dripDb.markPayoutSubmitted(String(body.txHash));
      return json({ ok: true });
    case "release":
      if (!TX_HASH.test(String(body.txHash))) return json({ error: "Invalid transaction hash." }, 400);
      await dripDb.releasePayout(String(body.txHash));
      return json({ ok: true });
    default:
      return json({ error: "Unknown action." }, 400);
  }
};

export default async (request: Request) => {
  if (!isAuthenticated(request)) return json({ error: "Unauthorized." }, 401);
  try {
    if (request.method === "GET") return json(await dripDb.adminOverview());
    if (request.method === "POST") return await act((await request.json().catch(() => ({}))) as Record<string, unknown>);
    return json({ error: "Method not allowed." }, 405, { allow: "GET, POST" });
  } catch (error) {
    const code = gameErrorCode(error);
    if (code) return json({ error: code.replaceAll("_", " ") }, 409);
    if (error instanceof DatabaseConfigError) return json({ error: "Database is not configured." }, 503);
    console.error("[admin-drip]", error);
    return json({ error: error instanceof Error ? error.message : "Request failed." }, 500);
  }
};

export const config: Config = { path: "/api/admin/drip" };
