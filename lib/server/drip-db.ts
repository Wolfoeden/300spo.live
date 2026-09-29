import type { Allocation, Distribution, Tier } from "../drip/allocate";
import type { PayoutRecipient } from "../drip/payout";
import { asJson, database as db, result as one } from "./db";

// Postgres type id of `text`, so an empty exclusion list still binds as text[].
const TEXT_OID = 25;

export type DripReward ={ unit: string; label: string; decimals: number; perEpoch: string; tier: Tier; distribution: Distribution };
export type DripConfig = {
  enabled: boolean;
  minTokens: number;
  tier1Lovelace: number;
  tier2Lovelace: number;
  excluded: string[];
  lastSnapshotEpoch: number | null;
  rewards: DripReward[];
};
export type DripSettings = {
  enabled: boolean;
  minTokens: bigint;
  tier1Lovelace: bigint;
  tier2Lovelace: bigint;
  excluded: string[];
  rewards: DripReward[];
};

export const dripDb = {
  config: () => one<DripConfig>(db()`select drip.config() as result`),
  recordSnapshot: (epoch: number, summary: Record<string, unknown>, allocations: Allocation[]) =>
    one<"recorded" | "exists">(
      db()`select drip.record_snapshot(${epoch}::integer, ${asJson(summary)}, ${asJson(
        allocations.map((allocation) => ({ ...allocation, amount: allocation.amount.toString(), tokens: allocation.tokens.toString() })),
      )}) as result`,
    ),
  recordRun: (run: Record<string, unknown>) => db()`select drip.record_run(${asJson(run)})`,
  statusFor: (stake: string) => one<Record<string, unknown>>(db()`select drip.status_for(${stake}) as result`),
  claim: (stake: string) => one<{ claimed: number }>(db()`select drip.claim(${stake}) as result`),
  /** What the site shows without a wallet: the drip rules and the starting-credit offer. */
  offers: () =>
    one<{ drip: Record<string, unknown>; welcome: { enabled: boolean; amount: number } }>(
      db()`select jsonb_build_object('drip', drip.config() - 'excluded' - 'lastSnapshotEpoch', 'welcome', game.welcome_offer()) as result`,
    ),
  unpaidBatch: (limit: number) => one<PayoutRecipient[]>(db()`select drip.unpaid_batch(${limit}::integer) as result`),
  reservePayout: (txHash: string, allocationIds: number[], recipients: number) =>
    db()`select drip.reserve_payout(${txHash}, ${allocationIds.map(String)}::bigint[], ${recipients}::integer)`,
  markPayoutSubmitted: (txHash: string) => db()`select drip.mark_payout_submitted(${txHash})`,
  confirmPayout: (txHash: string, blockHeight: number | null) => db()`select drip.confirm_payout(${txHash}, ${blockHeight}::bigint)`,
  releasePayout: (txHash: string) => db()`select drip.release_payout(${txHash})`,
  pendingPayouts: () => one<{ txHash: string; status: string; createdAt: string }[]>(db()`select drip.pending_payouts() as result`),
  adminOverview: () => one<Record<string, unknown>>(db()`select drip.admin_overview() as result`),
  adminUpdate: (settings: DripSettings) =>
    db()`select drip.admin_update(${settings.enabled}, ${settings.minTokens.toString()}::bigint, ${settings.tier1Lovelace.toString()}::bigint,
      ${settings.tier2Lovelace.toString()}::bigint, ${db().array(settings.excluded, TEXT_OID)}::text[], ${asJson(settings.rewards)})`,
};
