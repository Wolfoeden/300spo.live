"use client";

import { useEffect, useState } from "react";
import { fetchChain } from "@/lib/chain-client";
import { formatUnits } from "@/lib/drip/allocate";
import { formatTokenAmount } from "@/lib/format";
import { Check, Close } from "../icons";
import { DelegateButton } from "../wallet/delegation";
import { useWallet } from "../wallet/wallet-provider";

type Reward = { unit: string; label: string; decimals: number; perEpoch: string };
type DripStatus = {
  config: { enabled: boolean; minTokens: number; distribution: "equal" | "tokens" | "stake"; rewards: Reward[] };
  lastSnapshot: { epoch: number; eligible: number } | null;
  includedInLastSnapshot: boolean;
  totals: { unit: string; unpaid: string | null; paid: string | null }[];
};

const SPLIT = {
  equal: "shared equally between eligible wallets",
  tokens: "shared by the amount of 300 each eligible wallet holds",
  stake: "shared by the ADA each eligible wallet delegates",
} as const;

export function DripCard() {
  const { wallet, balance } = useWallet();
  const stake = wallet?.stakeAddress ?? null;
  const [status, setStatus] = useState<DripStatus | null>(null);
  const [delegated, setDelegated] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!stake) return;
    let active = true;
    fetchChain<DripStatus>(`/api/drip/status?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setStatus(data),
      () => active && setFailed(true),
    );
    fetchChain<{ delegatedTo300: { pool: boolean } }>(`/api/chain/account?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setDelegated(data.delegatedTo300.pool),
      () => active && setDelegated(null),
    );
    return () => {
      active = false;
    };
  }, [stake]);

  if (!wallet || wallet.networkId !== 1) return null;
  if (!stake) return null;

  const minTokens = BigInt(status?.config.minTokens ?? 3_000_000);
  const holds = balance ? balance.token300 >= minTokens : null;
  const rewards = status?.config.rewards.filter((reward) => BigInt(reward.perEpoch) > 0n) ?? [];
  const byUnit = new Map(status?.config.rewards.map((reward) => [reward.unit, reward]));
  const totals = (status?.totals ?? []).filter((total) => byUnit.has(total.unit));

  return (
    <section className="rounded-3xl border border-line p-6 sm:p-8 lg:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="kicker">Drip</p>
          <h2 className="mt-2 text-2xl font-semibold">Rewards for holding and staking with 300</h2>
        </div>
        {status && !status.config.enabled && <span className="rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">Starting soon</span>}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Requirement
          met={holds}
          title={`Hold at least ${formatTokenAmount(minTokens)} 300 tokens`}
          detail={balance ? `This wallet holds ${formatTokenAmount(balance.token300)}.` : "Reading your wallet…"}
        />
        <Requirement
          met={delegated}
          title="Delegate to the 300 stake pool"
          detail={delegated === false ? "Your ADA stays in your wallet." : delegated ? "Delegated." : "Checking…"}
          action={
            delegated === false ? (
              <DelegateButton target="pool" className="btn btn-gold !px-4 !py-2 text-xs">
                Delegate
              </DelegateButton>
            ) : null
          }
        />
      </div>

      <p className="mt-5 text-sm text-muted">
        {rewards.length
          ? `Every epoch (about 5 days): ${rewards.map((reward) => `${formatUnits(BigInt(reward.perEpoch), reward.decimals)} ${reward.label}`).join(" + ")}, ${SPLIT[status!.config.distribution]}.`
          : "Reward amounts are announced when the drip starts: ADA, NIGHT and partner tokens."}{" "}
        Eligibility is checked once at the start of each epoch; rewards are paid out in batches.
      </p>

      {status?.lastSnapshot && (
        <p className="mt-2 text-sm text-muted">
          Epoch {status.lastSnapshot.epoch}: {status.lastSnapshot.eligible} eligible wallets
          {status.includedInLastSnapshot ? " — including this one." : "."}
        </p>
      )}

      {totals.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

function Requirement({ met, title, detail, action }: { met: boolean | null; title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-line p-4">
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
          met === true ? "bg-positive/15 text-positive" : met === false ? "bg-danger/10 text-danger" : "bg-white/5 text-faint"
        }`}
      >
        {met === false ? <Close size={12} /> : <Check size={12} />}
      </span>
      <div className="flex-1 text-sm">
        <p className="font-medium text-text">{title}</p>
        <p className="text-muted">{detail}</p>
      </div>
      {action}
    </div>
  );
}
