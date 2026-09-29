"use client";

import { useEffect, useState } from "react";
import { fetchChain } from "@/lib/chain-client";
import { formatUnits, type Distribution, type Tier } from "@/lib/drip/allocate";
import { formatTokenAmount } from "@/lib/format";
import { Check } from "../icons";
import { InfoBubble } from "../info-bubble";
import { DelegateButton } from "../wallet/delegation";
import { useWallet } from "../wallet/wallet-provider";

type Reward = { unit: string; label: string; decimals: number; perEpoch: string; tier: Tier; distribution: Distribution };
type DripStatus = {
  config: { enabled: boolean; minTokens: number; tier1Lovelace: number; tier2Lovelace: number; rewards: Reward[] };
  lastSnapshot: { epoch: number; eligible: number } | null;
  includedInLastSnapshot: boolean;
  tierInLastSnapshot: Tier | null;
  totals: { unit: string; unpaid: string | null; paid: string | null }[];
};
type Account = { delegatedTo300: { pool: boolean }; totalLovelace?: string };

const SPLIT: Record<Distribution, string> = {
  equal: "equal share",
  tokens: "by 300 held",
  stake: "by ADA delegated",
};
const ada = (lovelace: number) => `${formatTokenAmount(BigInt(Math.floor(lovelace / 1_000_000)))} ADA`;

export function DripCard() {
  const { wallet, balance } = useWallet();
  const stake = wallet?.stakeAddress ?? null;
  const [status, setStatus] = useState<DripStatus | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!stake) return;
    let active = true;
    fetchChain<DripStatus>(`/api/drip/status?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setStatus(data),
      () => active && setFailed(true),
    );
    fetchChain<Account>(`/api/chain/account?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setAccount(data),
      () => active && setAccount(null),
    );
    return () => {
      active = false;
    };
  }, [stake]);

  if (!wallet || wallet.networkId !== 1) return null;
  if (!stake) return null;

  const config = status?.config;
  const minTokens = BigInt(config?.minTokens ?? 3_000_000);
  const tier1 = config?.tier1Lovelace ?? 10_000_000_000;
  const tier2 = config?.tier2Lovelace ?? 100_000_000_000;
  const holds = balance ? balance.token300 >= minTokens : null;
  const delegated = account ? account.delegatedTo300.pool : null;
  const lovelace = Number(account?.totalLovelace ?? 0);
  // The tier this wallet reaches right now; the snapshot at the next epoch decides.
  const reached: Tier | -1 | null =
    holds === null || delegated === null ? null : !holds ? -1 : delegated && lovelace >= tier2 ? 2 : delegated && lovelace >= tier1 ? 1 : 0;
  const byUnit = new Map(config?.rewards.map((reward) => [reward.unit, reward]));
  const totals = (status?.totals ?? []).filter((total) => byUnit.has(total.unit));

  const tiers: { tier: Tier; name: string; requirement: string; fallback: string }[] = [
    { tier: 0, name: "Holder", requirement: `Hold ${formatTokenAmount(minTokens)} 300`, fallback: "300 and meme coins from the treasury" },
    { tier: 1, name: "Staker", requirement: `Hold 300 and delegate ${ada(tier1)}`, fallback: "ADA, NIGHT and REALFI" },
    { tier: 2, name: "Staker+", requirement: `Hold 300 and delegate ${ada(tier2)}`, fallback: "A larger share of ADA, NIGHT and REALFI" },
  ];

  return (
    <section className="rounded-3xl border border-line p-6 sm:p-8 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="kicker">Drip</p>
          <h2 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            Rewards for holding and staking with 300
            <InfoBubble label="How the drip works">
              <span className="block">
                Hold 300 to earn 300 and the meme coins the treasury holds. Delegate to the 300 pool on top to earn ADA, NIGHT and REALFI; more
                delegated ADA unlocks a larger share. Each tier also receives the rewards of the tiers before it.
              </span>
              <span className="mt-2 block">
                Eligibility is checked once at the start of each epoch (about 5 days). Rewards add up and are paid out to your wallet in batches.
              </span>
            </InfoBubble>
          </h2>
        </div>
        {status && !status.config.enabled && <span className="rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">Starting soon</span>}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {tiers.map(({ tier, name, requirement, fallback }) => {
          const lines = config?.rewards.filter((reward) => reward.tier === tier) ?? [];
          const funded = lines.filter((reward) => BigInt(reward.perEpoch) > 0n);
          const met = reached === null ? null : reached >= tier;
          return (
            <div
              key={tier}
              className={`flex flex-col gap-3 rounded-2xl border p-4 text-sm ${met ? "border-positive/40 bg-positive/[0.05]" : "border-line"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-gold">{name}</p>
                {met && (
                  <span className="inline-flex items-center gap-1 text-xs text-positive">
                    <Check size={12} /> This wallet
                  </span>
                )}
              </div>
              <p className="font-medium text-text">{requirement}</p>
              {funded.length ? (
                <ul className="space-y-1 text-muted">
                  {funded.map((reward) => (
                    <li key={reward.unit} className="flex justify-between gap-2">
                      <span>
                        {reward.label} <span className="text-faint">· {SPLIT[reward.distribution]}</span>
                      </span>
                      <span className="tabular-nums text-text">{formatUnits(BigInt(reward.perEpoch), reward.decimals)}</span>
                    </li>
                  ))}
                  <li className="text-xs text-faint">per epoch, shared by all wallets in this tier</li>
                </ul>
              ) : (
                <p className="text-muted">{fallback}</p>
              )}
              {tier === 1 && delegated === false && (
                <DelegateButton target="pool" className="btn btn-gold mt-auto self-start !px-4 !py-2 text-xs">
                  Delegate to 300
                </DelegateButton>
              )}
            </div>
          );
        })}
      </div>

      {reached === -1 && (
        <p className="mt-4 text-sm text-muted">
          This wallet holds {formatTokenAmount(balance!.token300)} 300 — {formatTokenAmount(minTokens - balance!.token300)} more to join the drip.
        </p>
      )}
      {status?.lastSnapshot && (
        <p className="mt-4 text-sm text-muted">
          Epoch {status.lastSnapshot.epoch}: {status.lastSnapshot.eligible} wallets in the drip
          {status.includedInLastSnapshot ? ` — including this one (${tiers[status.tierInLastSnapshot ?? 0].name}).` : "."}
        </p>
      )}

      {totals.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {totals.map((total) => {
            const reward = byUnit.get(total.unit)!;
            return (
              <div key={total.unit} className="glass rounded-2xl p-4 text-sm">
                <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{reward.label}</p>
                <p className="mt-1">
                  <span className="text-lg font-semibold text-text">{formatUnits(BigInt(total.unpaid ?? "0"), reward.decimals)}</span> waiting
                </p>
                <p className="text-muted">{formatUnits(BigInt(total.paid ?? "0"), reward.decimals)} paid out</p>
              </div>
            );
          })}
        </div>
      )}
      {failed && <p className="mt-3 text-sm text-danger">Drip status is unavailable right now.</p>}
    </section>
  );
}
