import type { Allocation, Distribution } from "../drip/allocate";
import type { PayoutRecipient } from "../drip/payout";
import { asJson, database as db, result as one } from "./db";

export type DripReward = { unit: string; label: string; decimals: number; perEpoch: string };
export type DripConfig = {
  enabled: boolean;
  minTokens: number;
  distribution: Distribution;
  lastSnapshotEpoch: number | null;
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
  unpaidBatch: (limit: number) => one<PayoutRecipient[]>(db()`select drip.unpaid_batch(${limit}::integer) as result`),
  reservePayout: (txHash: string, allocationIds: number[], recipients: number) =>
    db()`select drip.reserve_payout(${txHash}, ${allocationIds.map(String)}::bigint[], ${recipients}::integer)`,
  markPayoutSubmitted: (txHash: string) => db()`select drip.mark_payout_submitted(${txHash})`,
  confirmPayout: (txHash: string, blockHeight: number | null) => db()`select drip.confirm_payout(${txHash}, ${blockHeight}::bigint)`,
  releasePayout: (txHash: string) => db()`select drip.release_payout(${txHash})`,
  pendingPayouts: () => one<{ txHash: string; status: string; createdAt: string }[]>(db()`select drip.pending_payouts() as result`),
  adminOverview: () => one<Record<string, unknown>>(db()`select drip.admin_overview() as result`),
  adminUpdate: (enabled: boolean, minTokens: bigint, distribution: Distribution, rewards: DripReward[]) =>
    db()`select drip.admin_update(${enabled}, ${minTokens.toString()}::bigint, ${distribution}, ${asJson(rewards)})`,
};
