import { allocate, eligibleWallets, type Delegator, type Holder } from "../drip/allocate";
import { REQUIRED_CONFIRMATIONS } from "../game/treasury";
import { POOL_ID, TOKEN_300 } from "../site";
import { dripDb } from "./drip-db";
import { koios } from "./koios";

// A built payout whose transaction is still not on chain this long after it
// was reserved can no longer land (its TTL is one hour): release it.
const PAYOUT_EXPIRY_MS = 2 * 60 * 60 * 1000;
const PAGE = 1000;
// Scheduled functions may run 30 s, so Koios gets more time than in request handlers.
const KOIOS_TIMEOUT_MS = 15_000;

const paged = async <T>(path: string) => {
  const rows: T[] = [];
  for (let offset = 0; offset < 20 * PAGE; offset += PAGE) {
    const page = await koios<T[]>(`${path}&offset=${offset}&limit=${PAGE}`, undefined, KOIOS_TIMEOUT_MS);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
};

/** Confirms payouts that are on chain and releases those that expired. */
export const settlePayouts = async (now = Date.now()) => {
  const pending = await dripDb.pendingPayouts();
  if (!pending.length) return { confirmed: 0, released: 0, waiting: 0 };
  const statuses = await koios<{ tx_hash: string; num_confirmations: number | null }[]>("tx_status", {
    _tx_hashes: pending.map((payout) => payout.txHash),
  }, KOIOS_TIMEOUT_MS);
  const confirmations = new Map(statuses.map((status) => [status.tx_hash, status.num_confirmations ?? 0]));
  const outcome = { confirmed: 0, released: 0, waiting: 0 };
  for (const payout of pending) {
    const depth = confirmations.get(payout.txHash) ?? 0;
    if (depth >= REQUIRED_CONFIRMATIONS) {
      await dripDb.confirmPayout(payout.txHash, null);
      outcome.confirmed += 1;
    } else if (depth === 0 && now - new Date(payout.createdAt).getTime() > PAYOUT_EXPIRY_MS) {
      await dripDb.releasePayout(payout.txHash);
      outcome.released += 1;
    } else {
      outcome.waiting += 1;
    }
  }
  return outcome;
};

/** Takes this epoch's snapshot once: eligible wallets and their shares. */
export const takeSnapshot = async () => {
  const config = await dripDb.config();
  if (!config.enabled) return { snapshot: "disabled" as const };
  const [tip] = await koios<{ epoch_no: number }[]>("tip", undefined, KOIOS_TIMEOUT_MS);
  const epoch = Number(tip.epoch_no);
  if (config.lastSnapshotEpoch !== null && config.lastSnapshotEpoch >= epoch) return { snapshot: "done" as const, epoch };

  const [holders, delegators] = await Promise.all([
    paged<Holder>(`asset_addresses?_asset_policy=${TOKEN_300.policyId}&_asset_name=${TOKEN_300.assetNameHex}`),
    paged<Delegator>(`pool_delegators?_pool_bech32=${POOL_ID}`),
  ]);
  const wallets = eligibleWallets(holders, delegators, BigInt(config.minTokens));
  const allocations = allocate(
    wallets,
    config.rewards.map((reward) => ({ unit: reward.unit, perEpoch: BigInt(reward.perEpoch) })),
    config.distribution,
  );
  const summary = {
    holders: new Set(holders.map((holder) => holder.stake_address ?? holder.payment_address)).size,
    delegators: delegators.length,
    eligible: wallets.length,
    distribution: config.distribution,
    minTokens: config.minTokens,
    budgets: Object.fromEntries(config.rewards.map((reward) => [reward.label, reward.perEpoch])),
  };
  const recorded = await dripDb.recordSnapshot(epoch, summary, allocations);
  return { snapshot: recorded, epoch, eligible: wallets.length, allocations: allocations.length };
};

/** One drip run: settle payouts, then snapshot the epoch if due. Always records its outcome. */
export const runDrip = async (source: "schedule" | "admin") => {
  const run: Record<string, unknown> = { source };
  try {
    run.payouts = await settlePayouts();
    Object.assign(run, await takeSnapshot());
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
  }
  await dripDb.recordRun(run).catch((error) => console.error("[drip] could not record run", error));
  return run;
};
