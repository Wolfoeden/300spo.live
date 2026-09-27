"use client";

import { useCallback, useEffect, useState } from "react";
import { bytesToHex } from "@/lib/cardano/address";
import { assembleSignedTx, parseUtxo, type Utxo } from "@/lib/cardano/tx";
import { loadProtocolParams, transactionErrorMessage, type TxStage } from "@/lib/chain-client";
import { formatUnits, parseUnits, type Distribution } from "@/lib/drip/allocate";
import { buildPayout, type PayoutRecipient } from "@/lib/drip/payout";
import { formatAdaExact } from "@/lib/format";
import { ArrowUpRight, Check, Close, Plus, Spinner } from "../icons";
import { useWallet } from "../wallet/wallet-provider";

type Reward = { unit: string; label: string; decimals: number; perEpoch: string };
type Overview = {
  config: { enabled: boolean; minTokens: number; distribution: Distribution; lastSnapshotEpoch: number | null; rewards: Reward[] };
  lastRunAt: string | null;
  lastRunResult: Record<string, unknown> | null;
  snapshots: { epoch: number; taken_at: string; holders: number; delegators: number; eligible: number; distribution: string }[];
  unpaid: { unit: string; amount: string; wallets: number }[];
  payouts: { tx_hash: string; status: string; recipients: number; created_at: string; confirmed_at: string | null }[];
};
type RewardRow = { unit: string; label: string; decimals: string; amount: string };

const DISTRIBUTIONS: { value: Distribution; label: string }[] = [
  { value: "equal", label: "Equal share per wallet" },
  { value: "tokens", label: "By 300 tokens held" },
  { value: "stake", label: "By ADA delegated" },
];

const call = async <T,>(body?: unknown): Promise<T> => {
  const response = await fetch("/api/admin/drip", {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (HTTP ${response.status}).`);
  return data as T;
};

const input = "w-full rounded-xl border border-line-strong bg-ink px-3 py-2 text-sm outline-none focus:border-gold";

export function DripAdmin() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await call<Overview>());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the drip.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session: { authenticated?: boolean }) => {
        if (!active) return;
        setAuthenticated(Boolean(session.authenticated));
        if (session.authenticated) void load();
      })
      .catch(() => active && setAuthenticated(false));
    return () => {
      active = false;
    };
  }, [load]);

  if (authenticated === false) {
    return (
      <Card title="Sign in first">
        <p className="text-muted">
          <a className="text-gold underline" href="/admin/login/?next=/admin/drip/">Sign in with the admin wallet</a> to manage the drip.
        </p>
      </Card>
    );
  }
  if (!overview) return <Card title="Drip">{message ? <p className="text-danger">{message}</p> : <Spinner className="text-gold" />}</Card>;

  const labels = new Map(overview.config.rewards.map((reward) => [reward.unit, reward]));
  const describe = (unit: string, amount: string | bigint) => {
    const reward = labels.get(unit);
    return reward ? `${formatUnits(BigInt(amount), reward.decimals)} ${reward.label}` : `${amount} × ${unit.slice(0, 8)}…`;
  };

  return (
    <div className="grid grid-cols-1 gap-5">
      {message && (
        <p className="flex items-center justify-between rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
          {message}
          <button onClick={() => setMessage(null)} aria-label="Dismiss">
            <Close size={14} />
          </button>
        </p>
      )}
      <Settings overview={overview} onSaved={(next) => (setOverview(next), setMessage("Drip settings saved."))} />
      <Status overview={overview} describe={describe} onRun={(next, text) => (setOverview(next), setMessage(text))} />
      <Payout overview={overview} describe={describe} onDone={load} onMessage={setMessage} />
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="glass rounded-3xl p-6 sm:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Settings({ overview, onSaved }: { overview: Overview; onSaved(next: Overview): void }) {
  const [enabled, setEnabled] = useState(overview.config.enabled);
  const [minTokens, setMinTokens] = useState(String(overview.config.minTokens));
  const [distribution, setDistribution] = useState<Distribution>(overview.config.distribution);
  const [rows, setRows] = useState<RewardRow[]>(
    overview.config.rewards.map((reward) => ({
      unit: reward.unit,
      label: reward.label,
      decimals: String(reward.decimals),
      amount: formatUnits(BigInt(reward.perEpoch), reward.decimals).replace(/,/g, ""),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (index: number, patch: Partial<RewardRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setError(null);
    const rewards = [];
    for (const row of rows) {
      const decimals = Number(row.decimals);
      const perEpoch = parseUnits(row.amount || "0", Number.isInteger(decimals) ? decimals : 0);
      if (perEpoch === null || !Number.isInteger(decimals)) return setError(`Check the amount for ${row.label || "a reward"}.`);
      rewards.push({ unit: row.unit.trim().toLowerCase(), label: row.label.trim(), decimals, perEpoch: perEpoch.toString() });
    }
    setSaving(true);
    try {
      onSaved(await call<Overview>({ action: "settings", enabled, minTokens: minTokens.replace(/[^\d]/g, ""), distribution, rewards }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Drip settings">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="flex items-center gap-3 rounded-2xl border border-line p-3 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-gold)]" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Drip enabled (snapshot every epoch)
        </label>
        <label className="text-xs text-faint">
          Minimum 300 tokens held
          <input className={`${input} mt-1`} inputMode="numeric" value={minTokens} onChange={(event) => setMinTokens(event.target.value)} />
        </label>
        <label className="text-xs text-faint">
          Split between eligible wallets
          <select className={`${input} mt-1`} value={distribution} onChange={(event) => setDistribution(event.target.value as Distribution)}>
            {DISTRIBUTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3 className="mt-6 text-sm font-semibold">Rewards per epoch (about every 5 days)</h3>
      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-1 gap-2 rounded-2xl border border-line p-3 md:grid-cols-[8rem_minmax(0,1fr)_5rem_10rem_auto] md:items-end">
            <label className="text-xs text-faint">
              Label
              <input className={`${input} mt-1`} value={row.label} onChange={(event) => update(index, { label: event.target.value })} />
            </label>
            <label className="text-xs text-faint">
              Unit (lovelace, or policy id + asset name hex)
              <input className={`${input} mt-1 font-mono`} value={row.unit} spellCheck={false} onChange={(event) => update(index, { unit: event.target.value })} />
            </label>
            <label className="text-xs text-faint">
              Decimals
              <input className={`${input} mt-1`} inputMode="numeric" value={row.decimals} onChange={(event) => update(index, { decimals: event.target.value })} />
            </label>
            <label className="text-xs text-faint">
              Per epoch
              <input className={`${input} mt-1`} inputMode="decimal" value={row.amount} onChange={(event) => update(index, { amount: event.target.value })} />
            </label>
            <button className="btn btn-ghost !px-3 !py-2 text-xs" onClick={() => setRows((current) => current.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <button className="btn btn-ghost mt-3 !px-3 !py-2 text-xs" onClick={() => setRows((current) => [...current, { unit: "", label: "", decimals: "0", amount: "0" }])}>
        <Plus size={14} /> Add reward token
      </button>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className="btn btn-gold" onClick={save} disabled={saving}>
          {saving && <Spinner size={16} />} Save drip settings
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </Card>
  );
}

const describeRun = (result: Record<string, unknown> | null) => {
  if (!result) return "never";
  if (result.error) return `failed: ${String(result.error)}`;
  if (result.snapshot === "disabled") return "drip disabled";
  if (result.snapshot === "done") return `epoch ${String(result.epoch)} already has its snapshot`;
  if (result.snapshot === "recorded") return `snapshot for epoch ${String(result.epoch)}: ${String(result.eligible)} eligible wallets`;
  return JSON.stringify(result);
};

function Status({ overview, describe, onRun }: { overview: Overview; describe(unit: string, amount: string): string; onRun(next: Overview, text: string): void }) {
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      const next = await call<Overview & { run: Record<string, unknown> }>({ action: "run" });
      onRun(next, `Run finished: ${describeRun(next.run)}.`);
    } catch (error) {
      onRun(overview, error instanceof Error ? error.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card
      title="Snapshots"
      action={
        <button className="btn btn-ghost !px-4 !py-2 text-sm" onClick={run} disabled={running}>
          {running && <Spinner size={14} />} Run now
        </button>
      }
    >
      <p className="text-sm text-muted">
        Last automatic run: {overview.lastRunAt ? new Date(overview.lastRunAt).toLocaleString() : "never"} · {describeRun(overview.lastRunResult)}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="text-xs text-faint">
            <tr>
              <th className="py-2 font-medium">Epoch</th>
              <th className="py-2 font-medium">Eligible</th>
              <th className="py-2 font-medium">300 holders</th>
              <th className="py-2 font-medium">Delegators</th>
              <th className="py-2 font-medium">Split</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {overview.snapshots.map((snapshot) => (
              <tr key={snapshot.epoch}>
                <td className="py-2 tabular-nums">{snapshot.epoch}</td>
                <td className="py-2 tabular-nums">{snapshot.eligible}</td>
                <td className="py-2 tabular-nums">{snapshot.holders}</td>
                <td className="py-2 tabular-nums">{snapshot.delegators}</td>
                <td className="py-2">{snapshot.distribution}</td>
              </tr>
            ))}
            {!overview.snapshots.length && (
              <tr>
                <td className="py-3 text-faint" colSpan={5}>
                  No snapshot yet. Enable the drip; the first run of each epoch takes one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm">
        Unpaid:{" "}
        {overview.unpaid.length
          ? overview.unpaid.map((entry) => `${describe(entry.unit, entry.amount)} (${entry.wallets} wallets)`).join(" · ")
          : "nothing"}
      </p>
    </Card>
  );
}

type Prepared = { recipients: PayoutRecipient[]; payout: ReturnType<typeof buildPayout> };

function Payout({
  overview,
  describe,
  onDone,
  onMessage,
}: {
  overview: Overview;
  describe(unit: string, amount: string | bigint): string;
  onDone(): Promise<void>;
  onMessage(text: string): void;
}) {
  const { status, wallet, getApi, openDialog } = useWallet();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const prepare = async () => {
    const api = getApi();
    if (!api || !wallet) return;
    setError(null);
    setSent(null);
    setBusy("Preparing…");
    try {
      const { recipients } = await call<{ recipients: PayoutRecipient[] }>({ action: "batch", limit: 40 });
      if (!recipients.length) {
        setPrepared(null);
        setError("Nothing to pay out.");
        return;
      }
      const [params, rawUtxos] = await Promise.all([loadProtocolParams(), api.getUtxos()]);
      const utxos = (rawUtxos ?? []).map(parseUtxo).filter((utxo): utxo is Utxo => utxo !== null);
      setPrepared({ recipients, payout: buildPayout(recipients, utxos, wallet.changeAddressHex, params) });
    } catch (cause) {
      setPrepared(null);
      setError(transactionErrorMessage(cause, "build"));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    const api = getApi();
    if (!api || !prepared) return;
    const { payout, recipients } = prepared;
    let stage: TxStage = "build";
    let reserved = false;
    setError(null);
    try {
      setBusy("Reserving rewards…");
      await call({ action: "reserve", txHash: payout.txHash, allocationIds: payout.allocationIds, recipients: recipients.length });
      reserved = true;
      stage = "sign";
      setBusy("Confirm in your wallet…");
      const witnesses = await api.signTx(bytesToHex(payout.built.unsignedTx), true);
      stage = "submit";
      setBusy("Sending…");
      await api.submitTx(bytesToHex(assembleSignedTx(payout.built.body, witnesses, payout.built.auxiliaryData)));
      await call({ action: "submitted", txHash: payout.txHash }).catch(() => null);
      setSent(payout.txHash);
      setPrepared(null);
      onMessage(`Payout to ${recipients.length} wallets sent. It is marked paid once it is 5 blocks deep.`);
      await onDone();
    } catch (cause) {
      // Not submitted: make the rewards available for the next payout again.
      if (reserved && stage !== "submit") await call({ action: "release", txHash: payout.txHash }).catch(() => null);
      setError(transactionErrorMessage(cause, stage));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Payout">
      <p className="text-sm text-muted">
        Connect the wallet that holds the rewards (ADA and tokens). It signs one transaction for up to 40 wallets; nothing is signed on the server.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status !== "connected" ? (
          <button className="btn btn-ghost" onClick={() => openDialog(() => undefined)}>
            Connect distribution wallet
          </button>
        ) : (
          <button className="btn btn-gold" onClick={prepare} disabled={Boolean(busy)}>
            {busy === "Preparing…" && <Spinner size={16} />} Prepare payout
          </button>
        )}
        {wallet && <span className="text-xs text-faint">Paying from {wallet.name}</span>}
      </div>

      {prepared && (
        <div className="mt-5 rounded-2xl border border-gold/30 bg-gold/[0.06] p-4 text-sm">
          <p className="font-medium text-text">{prepared.recipients.length} wallets</p>
          <ul className="mt-2 space-y-1 text-muted">
            {[...prepared.payout.totals].map(([unit, amount]) => (
              <li key={unit}>{describe(unit, amount)}</li>
            ))}
            {prepared.payout.topUp > 0n && <li>+ {formatAdaExact(prepared.payout.topUp)} ADA so token outputs meet Cardano&apos;s minimum</li>}
            <li>Network fee {formatAdaExact(prepared.payout.built.fee)} ADA</li>
          </ul>
          <button className="btn btn-gold mt-4" onClick={send} disabled={Boolean(busy)}>
            {busy && busy !== "Preparing…" && <Spinner size={16} />}
            {busy && busy !== "Preparing…" ? busy : "Sign and send payout"}
          </button>
        </div>
      )}
      {error && <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {sent && (
        <p className="mt-4 flex items-center gap-2 text-sm text-positive">
          <Check size={16} /> Sent.
          <a className="inline-flex items-center gap-1 underline" href={`https://cardanoscan.io/transaction/${sent}`} target="_blank" rel="noreferrer">
            Transaction <ArrowUpRight size={12} />
          </a>
        </p>
      )}

      <h3 className="mt-6 text-sm font-semibold">Recent payouts</h3>
      <ul className="mt-2 divide-y divide-line text-sm">
        {overview.payouts.map((payout) => (
          <li key={payout.tx_hash} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {payout.recipients} wallets · {new Date(payout.created_at).toLocaleString()}
            </span>
            <span className={payout.status === "confirmed" ? "text-positive" : payout.status === "failed" ? "text-danger" : "text-muted"}>
              {payout.status}
              <a className="ml-2 text-faint hover:text-text" href={`https://cardanoscan.io/transaction/${payout.tx_hash}`} target="_blank" rel="noreferrer">
                ↗
              </a>
            </span>
          </li>
        ))}
        {!overview.payouts.length && <li className="py-2 text-faint">No payouts yet.</li>}
      </ul>
    </Card>
  );
}
