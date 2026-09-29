"use client";

import { useEffect, useState } from "react";
import { fetchChain } from "@/lib/chain-client";
import { formatUnits, type Distribution, type Tier } from "@/lib/drip/allocate";
import { formatTokenAmount } from "@/lib/format";
import { Check, Spinner } from "../icons";
import { InfoBubble } from "../info-bubble";
import { DelegateButton } from "../wallet/delegation";
import { useWallet } from "../wallet/wallet-provider";

type Reward = { unit: string; label: string; decimals: number; perEpoch: string; tier: Tier; distribution: Distribution };
type Config = { enabled: boolean; minTokens: number; tier1Lovelace: number; tier2Lovelace: number; rewards: Reward[] };
type Total = { unit: string; claimable: string | null; pending: string | null; paid: string | null };
type DripStatus = {
  config: Config;
  lastSnapshot: { epoch: number; eligible: number } | null;
  includedInLastSnapshot: boolean;
  tierInLastSnapshot: Tier | null;
  totals: Total[];
};
type Account = { delegatedTo300: { pool: boolean }; totalLovelace?: string };

const SPLIT: Record<Distribution, string> = {
  equal: "equal share",
  tokens: "by 300 held",
  stake: "by ADA delegated",
};
const ada = (lovelace: number) => `${formatTokenAmount(BigInt(Math.floor(lovelace / 1_000_000)))} ADA`;
const amount = (value: string | null) => BigInt(value ?? "0");

/**
 * The drip: three tiers, which one the connected wallet reaches, and what it
 * can claim. Without a wallet it shows the rules and asks to connect.
 */
export function DripCard({ className = "" }: { className?: string }) {
  const { wallet, balance } = useWallet();
  const stake = wallet?.networkId === 1 ? (wallet.stakeAddress ?? null) : null;
  const [rules, setRules] = useState<Config | null>(null);
  const [status, setStatus] = useState<DripStatus | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/offers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { drip?: Config } | null) => active && data?.drip && setRules(data.drip))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!stake) return;
    let active = true;
    fetchChain<DripStatus>(`/api/drip/status?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setStatus(data),
      () => undefined,
    );
    fetchChain<Account>(`/api/chain/account?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setAccount(data),
      () => active && setAccount(null),
    );
    return () => {
      active = false;
    };
  }, [stake]);

  const config = (stake && status?.config) || rules;
  const minTokens = BigInt(config?.minTokens ?? 3_000_000);
  const tier1 = config?.tier1Lovelace ?? 10_000_000_000;
  const tier2 = config?.tier2Lovelace ?? 100_000_000_000;
  const holds = stake && balance ? balance.token300 >= minTokens : null;
  const delegated = stake && account ? account.delegatedTo300.pool : null;
  const lovelace = Number(account?.totalLovelace ?? 0);
  // The tier this wallet reaches right now; the snapshot at the next epoch decides.
  const reached: Tier | -1 | null =
    holds === null || delegated === null ? null : !holds ? -1 : delegated && lovelace >= tier2 ? 2 : delegated && lovelace >= tier1 ? 1 : 0;
  const tiers: { tier: Tier; name: string; requirement: string; fallback: string }[] = [
    { tier: 0, name: "Holder", requirement: `Hold ${formatTokenAmount(minTokens)} 300`, fallback: "300 and meme coins from the treasury" },
    { tier: 1, name: "Staker", requirement: `Hold 300 and delegate ${ada(tier1)}`, fallback: "ADA, NIGHT and REALFI" },
    { tier: 2, name: "Staker+", requirement: `Hold 300 and delegate ${ada(tier2)}`, fallback: "A larger share of ADA, NIGHT and REALFI" },
  ];

  return (
    <section className={`rounded-3xl border border-line p-6 sm:p-8 ${className}`}>
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
                Eligibility is checked at the start of each epoch (about 5 days) and rewards add up. Claim them here with one signed message;
                claimed rewards are sent to your wallet with the next payout.
              </span>
            </InfoBubble>
          </h2>
        </div>
        {config && !config.enabled && <span className="rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">Starting soon</span>}
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
              {tier === 1 && delegated !== true && (
                <DelegateButton target="pool" className="btn btn-gold mt-auto self-start !px-4 !py-2 text-xs">
                  Delegate to 300
                </DelegateButton>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-2xl border border-gold/30 bg-gold/[0.05] p-4 sm:p-5">
        <RewardsPanel />
      </div>
    </section>
  );
}

const TIER_NAMES = ["Holder", "Staker", "Staker+"] as const;

/** What the connected wallet has earned in the drip, and the claim for it. */
export function RewardsPanel() {
  const { wallet, balance, auth, signIn, openDialog } = useWallet();
  const stake = wallet?.networkId === 1 ? (wallet.stakeAddress ?? null) : null;
  const [status, setStatus] = useState<DripStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    if (!stake) return;
    let active = true;
    fetchChain<DripStatus>(`/api/drip/status?stake=${encodeURIComponent(stake)}`).then(
      (data) => active && setStatus(data),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [stake]);

  const byUnit = new Map(status?.config.rewards.map((reward) => [reward.unit, reward]));
  const totals = (status?.totals ?? []).filter((total) => byUnit.has(total.unit));
  const claimable = totals.filter((total) => amount(total.claimable) > 0n);
  const minTokens = BigInt(status?.config.minTokens ?? 3_000_000);
  const short = balance && status ? balance.token300 < minTokens : false;

  const claim = async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      // Claiming needs the wallet session of this wallet: one signed message, no transaction.
      const post = () => fetch("/api/drip/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{}", credentials: "same-origin" });
      if (auth.status !== "signed-in" || auth.identity !== stake) await signIn();
      let response = await post();
      if (response.status === 401) {
        // The session ran out since the page loaded.
        await signIn();
        response = await post();
      }
      const data = (await response.json().catch(() => ({}))) as DripStatus & { error?: string };
      if (!response.ok) throw new Error(data.error === "not_signed_in" ? "Sign the message in your wallet to claim." : "Claiming failed. Try again.");
      setStatus(data);
      setClaimed(true);
    } catch (cause) {
      setClaimError(cause instanceof Error ? cause.message : "Claiming failed. Try again.");
    } finally {
      setClaiming(false);
    }
  };

  if (!wallet) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted">Connect your wallet to see what you have earned and claim it.</p>
        <button className="btn btn-gold !px-4 !py-2 text-sm" onClick={() => openDialog(() => undefined)}>
          Connect wallet
        </button>
      </div>
    );
  }
  if (!stake) return <p className="text-sm text-muted">Switch your wallet to Cardano mainnet to see your drip rewards.</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">Your rewards</p>
        {claimable.length > 0 && (
          <button className="btn btn-gold !px-4 !py-2 text-sm" onClick={claim} disabled={claiming}>
            {claiming && <Spinner size={14} />}
            {claiming ? "Check your wallet…" : "Claim rewards"}
          </button>
        )}
      </div>
      {totals.length ? (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
          {totals.map((total) => {
            const reward = byUnit.get(total.unit)!;
            return (
              <div key={total.unit} className="glass rounded-2xl p-3 text-sm">
                <p className="font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint">{reward.label}</p>
                <p className="mt-1">
                  <span className="text-lg font-semibold text-text">{formatUnits(amount(total.claimable), reward.decimals)}</span> to claim
                </p>
                {amount(total.pending) > 0n && <p className="text-muted">{formatUnits(amount(total.pending), reward.decimals)} on the way</p>}
                <p className="text-muted">{formatUnits(amount(total.paid), reward.decimals)} received</p>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">
          {short
            ? `This wallet holds ${formatTokenAmount(balance!.token300)} 300 — ${formatTokenAmount(minTokens - balance!.token300)} more to join the drip.`
            : "Nothing earned yet. Rewards are added with the snapshot at the start of each epoch."}
        </p>
      )}
      {claimed && !claimError && (
        <p className="mt-3 flex items-center gap-2 text-sm text-positive">
          <Check size={14} /> Claimed. Your rewards are sent to your wallet with the next payout.
        </p>
      )}
      {claimError && <p className="mt-3 text-sm text-danger">{claimError}</p>}
      {status?.lastSnapshot && (
        <p className="mt-3 text-xs text-faint">
          Epoch {status.lastSnapshot.epoch}: {status.lastSnapshot.eligible} wallets in the drip
          {status.includedInLastSnapshot ? ` — including this one (${TIER_NAMES[status.tierInLastSnapshot ?? 0]}).` : "."}
        </p>
      )}
      {failed && <p className="mt-3 text-sm text-danger">Drip status is unavailable right now.</p>}
    </div>
  );
}
