import type { Config } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, isRewardAddress } from "../../lib/cardano/address";
import { DatabaseConfigError } from "../../lib/server/db";
import { dripDb, type DripReward } from "../../lib/server/drip-db";
import { gameDb, gameErrorCode } from "../../lib/server/game-db";
import { runDrip } from "../../lib/server/drip-run";
import { koios } from "../../lib/server/koios";
import { isAuthenticated, json } from "./_shared/admin-auth.mjs";

const TX_HASH = /^[0-9a-f]{64}$/;
const UNIT = /^(lovelace|[0-9a-f]{56}([0-9a-f]{2}){0,32})$/;
const DISTRIBUTIONS = new Set(["equal", "tokens", "stake"]);
const MAX_BATCH = 40;
const LOVELACE_PER_ADA = 1_000_000n;

const parseRewards = (value: unknown): DripReward[] | null => {
  if (!Array.isArray(value) || value.length > 20) return null;
  const rewards: DripReward[] = [];
  for (const entry of value as Record<string, unknown>[]) {
    const unit = String(entry.unit ?? "").trim().toLowerCase();
    const label = String(entry.label ?? "").trim();
    const decimals = Number(entry.decimals);
    const perEpoch = String(entry.perEpoch ?? "");
    const tier = Number(entry.tier);
    const distribution = String(entry.distribution);
    if (!UNIT.test(unit) || !label || label.length > 20 || !Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^\d{1,18}$/.test(perEpoch)) {
      return null;
    }
    if (![0, 1, 2].includes(tier) || !DISTRIBUTIONS.has(distribution)) return null;
    rewards.push({ unit, label, decimals, perEpoch, tier: tier as DripReward["tier"], distribution: distribution as DripReward["distribution"] });
  }
  return new Set(rewards.map((reward) => `${reward.unit} ${reward.tier}`)).size === rewards.length ? rewards : null;
};

/** Whole ADA from the form in lovelace; null unless a positive whole number. */
const adaToLovelace = (value: unknown) => {
  const text = String(value ?? "").replace(/[\s,]/g, "");
  return /^\d{1,12}$/.test(text) && BigInt(text) > 0n ? BigInt(text) * LOVELACE_PER_ADA : null;
};

const parseExcluded = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || value.length > 50) return null;
  const stakes = new Set<string>();
  for (const entry of value) {
    try {
      const bytes = addressBytesFromWallet(String(entry).trim());
      const stake = addressToBech32(bytes);
      if (!isRewardAddress(bytes) || !stake.startsWith("stake1")) return null;
      stakes.add(stake);
    } catch {
      return null;
    }
  }
  return [...stakes];
};

type TreasuryAsset = { policy_id: string; asset_name: string | null; decimals: number | null; quantity: string };

/** Fungible tokens the treasury holds, offered as holder rewards in the admin. */
const treasuryTokens = async () => {
  const address = (await gameDb.watcherState()).treasuryAddress;
  if (!address) return { address: null, tokens: [] };
  const assets = await koios<TreasuryAsset[]>("address_assets", { _addresses: [address] });
  const tokens = assets
    .filter((asset) => BigInt(asset.quantity) > 1n)
    .map((asset) => {
      const name = Buffer.from(asset.asset_name ?? "", "hex").toString("utf8");
      return {
        unit: asset.policy_id + (asset.asset_name ?? ""),
        label: /^[\x20-\x7e]{1,20}$/.test(name) ? name : `${asset.policy_id.slice(0, 8)}…`,
        decimals: asset.decimals ?? 0,
        quantity: asset.quantity,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  return { address, tokens };
};

const act = async (body: Record<string, unknown>) => {
  switch (body.action) {
    case "settings": {
      const rewards = parseRewards(body.rewards);
      const minTokens = /^\d{1,15}$/.test(String(body.minTokens)) ? BigInt(String(body.minTokens)) : 0n;
      const tier1Lovelace = adaToLovelace(body.tier1Ada);
      const tier2Lovelace = adaToLovelace(body.tier2Ada);
      const excluded = parseExcluded(body.excluded);
      if (!rewards) {
        return json({ error: "Check the reward list: unit (policy id + asset name hex), label, a whole-number amount, tier and split — each unit once per tier." }, 400);
      }
      if (minTokens <= 0n) return json({ error: "The minimum holding must be a positive whole number." }, 400);
      if (!tier1Lovelace || !tier2Lovelace || tier2Lovelace <= tier1Lovelace) {
        return json({ error: "Tier thresholds must be whole ADA amounts, the second above the first." }, 400);
      }
      if (!excluded) return json({ error: "Excluded wallets must be stake1… addresses." }, 400);
      await dripDb.adminUpdate({ enabled: body.enabled === true, minTokens, tier1Lovelace, tier2Lovelace, excluded, rewards });
      return json(await dripDb.adminOverview());
    }
    case "treasury":
      return json(await treasuryTokens());
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
