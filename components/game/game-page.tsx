"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { addressBytesFromWallet, bytesToHex } from "@/lib/cardano/address";
import { assembleSignedTx, buildTransaction, ttlFromNow, minAdaForOutput, parseUtxo, type ProtocolParams, type TxOutput, type Utxo } from "@/lib/cardano/tx";
import { loadProtocolParams, transactionErrorMessage, type TxStage } from "@/lib/chain-client";
import { formatAdaExact, formatTokenAmount } from "@/lib/format";
import { depositMetadata } from "@/lib/game/treasury";
import { TOKEN_300 } from "@/lib/site";
import { ArrowUpRight, Check, Shield, Spinner, WalletIcon } from "../icons";
import { useWallet } from "../wallet/wallet-provider";

const UNIT_300 = TOKEN_300.policyId + TOKEN_300.assetNameHex;
const GAME_ID = "placeholder";
const POLL_MS = 20_000;

type GameState = {
  wallet: string;
  enabled: boolean;
  roundCost: number;
  minDeposit: number;
  treasuryAddress: string | null;
  balance: number;
  deposits: { reference: string; requested: number; received: number | null; status: "open" | "submitted" | "confirmed"; txHash: string | null; createdAt: string }[];
  rounds: { id: number; game: string; cost: number; createdAt: string }[];
};

const API_ERRORS: Record<string, string> = {
  game_disabled: "Deposits and rounds are paused right now.",
  amount_too_small: "That amount is below the minimum deposit.",
  insufficient_balance: "Not enough game balance for a round. Deposit more 300 first.",
  too_many_open_deposits: "Too many unfinished deposits. Let the pending ones confirm first.",
  not_configured: "The game is not configured yet.",
  not_signed_in: "Your wallet session expired. Verify your wallet again.",
};

class ApiError extends Error {}

const api = async <T,>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(API_ERRORS[data.error ?? ""] ?? `Request failed (HTTP ${response.status}).`);
  return data as T;
};

export function GamePage() {
  const { status, wallet, balance, auth, openDialog, signIn } = useWallet();
  const [state, setState] = useState<GameState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const signedIn = auth.status === "signed-in";

  const refresh = useCallback(async () => {
    try {
      setState(await api<GameState>("/api/game/state"));
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the game balance.");
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    // Loading the balance is the external system; state updates when it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [signedIn, refresh]);

  // While a deposit waits for confirmations, ask the server to check it.
  const pending = state?.deposits.filter((deposit) => deposit.status === "submitted") ?? [];
  const pendingKey = pending.map((deposit) => deposit.reference).join(",");
  useEffect(() => {
    if (!pendingKey) return;
    const timer = window.setInterval(async () => {
      for (const reference of pendingKey.split(",")) await api("/api/game/deposit-check", { reference }).catch(() => null);
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [pendingKey, refresh]);

  return (
    <div className="container-site pb-24 pt-28 sm:pt-32">
      <div className="max-w-2xl">
        <p className="kicker">300 game</p>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.02] tracking-[-0.03em] sm:text-6xl">
          Play with <span className="text-gold-gradient">300.</span>
        </h1>
        <p className="mt-5 text-lg text-muted">
          Deposit 300 tokens as game credit and spend them on rounds. There are no winnings and no withdrawals — the tokens are simply used up
          by playing.
        </p>
      </div>

      <div className="mt-12">
        {status !== "connected" || !wallet ? (
          <Gate
            icon={<WalletIcon className="text-gold" />}
            title="Connect your wallet"
            text="Your game balance belongs to the wallet you connect."
            action={
              <button className="btn btn-gold" onClick={() => openDialog(() => undefined)} disabled={status === "connecting" || status === "detecting"}>
                Connect wallet
              </button>
            }
          />
        ) : wallet.networkId !== 1 ? (
          <Gate icon={<Shield className="text-warning" />} title="Switch to mainnet" text="The 300 token and the game run on Cardano mainnet." />
        ) : !signedIn ? (
          <Gate
            icon={<Shield className="text-gold" />}
            title="Verify your wallet"
            text="Sign a free message so the game knows this balance is yours. No transaction, no fees."
            action={
              <button className="btn btn-gold" onClick={signIn} disabled={auth.status === "signing"}>
                {auth.status === "signing" ? <Spinner size={16} /> : null}
                {auth.status === "signing" ? "Check your wallet…" : "Verify wallet"}
              </button>
            }
            error={auth.error}
          />
        ) : !state ? (
          <Gate icon={<Spinner className="text-gold" />} title="Loading your game balance…" text={loadError ?? ""} />
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
            <BalanceCard state={state} walletTokens={balance?.token300 ?? null} />
            <DepositCard state={state} walletTokens={balance?.token300 ?? null} onDeposited={refresh} />
            <RoundCard state={state} onPlayed={refresh} />
            <History state={state} />
          </div>
        )}
      </div>
    </div>
  );
}

function Gate({ icon, title, text, action, error }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode; error?: string | null }) {
  return (
    <div className="glass flex max-w-xl flex-col items-start gap-4 rounded-3xl p-6 sm:p-8">
      <span className="grid size-11 place-items-center rounded-2xl bg-gold/10">{icon}</span>
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {text && <p className="mt-1 text-muted">{text}</p>}
      </div>
      {action}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function BalanceCard({ state, walletTokens }: { state: GameState; walletTokens: bigint | null }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-gold/25 bg-gradient-to-br from-gold/[0.12] via-panel to-panel p-6 sm:p-8">
      <p className="kicker">Game balance</p>
      <p className="mt-3 text-5xl font-semibold tabular-nums tracking-tight">
        {formatTokenAmount(BigInt(state.balance))} <span className="text-gold-gradient">300</span>
      </p>
      <p className="mt-2 text-sm text-muted">
        One round costs {formatTokenAmount(BigInt(state.roundCost))} tokens · {Math.floor(state.balance / state.roundCost)} rounds left
      </p>
      <div className="mt-6 border-t border-line pt-4 text-sm text-muted">
        In your wallet: {walletTokens === null ? "–" : `${formatTokenAmount(walletTokens)} tokens`}
      </div>
      {!state.enabled && (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Deposits and rounds are paused right now.</p>
      )}
    </section>
  );
}

type DepositPhase =
  | { name: "idle" }
  | { name: "working"; step: string }
  | { name: "submitted"; txHash: string }
  | { name: "error"; message: string };

function DepositCard({ state, walletTokens, onDeposited }: { state: GameState; walletTokens: bigint | null; onDeposited(): Promise<void> }) {
  const { wallet, getApi, refreshBalance } = useWallet();
  const [amount, setAmount] = useState(String(state.minDeposit));
  const [accepted, setAccepted] = useState(false);
  const [phase, setPhase] = useState<DepositPhase>({ name: "idle" });
  const [params, setParams] = useState<ProtocolParams | null>(null);
  const [paramsFailed, setParamsFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadProtocolParams().then(
      (loaded) => active && setParams(loaded),
      () => active && setParamsFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const parsed = /^\d{1,13}$/.test(amount.trim()) ? BigInt(amount.trim()) : null;
  const tooSmall = parsed !== null && parsed < BigInt(state.minDeposit);
  const tooLarge = parsed !== null && walletTokens !== null && parsed > walletTokens;
  const treasury = state.treasuryAddress;
  const minAda =
    params && treasury && parsed
      ? minAdaForOutput({ address: addressBytesFromWallet(treasury), value: { lovelace: 0n, assets: new Map([[UNIT_300, parsed]]) } }, params)
      : null;
  const busy = phase.name === "working";
  const canDeposit = state.enabled && !!treasury && parsed !== null && !tooSmall && !tooLarge && accepted && !!params && !busy;

  const deposit = async () => {
    const api30 = getApi();
    if (!api30 || !wallet || !treasury || !params || parsed === null) return;
    let stage: TxStage = "build";
    try {
      setPhase({ name: "working", step: "Preparing your deposit…" });
      const intent = await api<{ reference: string; treasuryAddress: string }>("/api/game/deposit", { amount: parsed.toString() });
      const payment: TxOutput = { address: addressBytesFromWallet(intent.treasuryAddress), value: { lovelace: 0n, assets: new Map([[UNIT_300, parsed]]) } };
      payment.value.lovelace = minAdaForOutput(payment, params);
      const utxos = ((await api30.getUtxos()) ?? []).map(parseUtxo).filter((utxo): utxo is Utxo => utxo !== null);
      const built = buildTransaction({
        utxos,
        changeAddress: addressBytesFromWallet(wallet.changeAddressHex),
        outputs: [payment],
        metadata: depositMetadata(intent.reference),
        params,
        ttl: ttlFromNow(),
      });
      stage = "sign";
      setPhase({ name: "working", step: "Confirm the transaction in your wallet…" });
      const witnesses = await api30.signTx(bytesToHex(built.unsignedTx), true);
      stage = "submit";
      setPhase({ name: "working", step: "Sending…" });
      const txHash = await api30.submitTx(bytesToHex(assembleSignedTx(built.body, witnesses, built.auxiliaryData)));
      await api("/api/game/deposit-submitted", { reference: intent.reference, txHash }).catch(() => null);
      setPhase({ name: "submitted", txHash });
      void refreshBalance();
      await onDeposited();
    } catch (error) {
      setPhase({ name: "error", message: error instanceof ApiError ? error.message : transactionErrorMessage(error, stage) });
    }
  };

  const quickAmounts = [state.minDeposit, 3_000, 30_000, 300_000].filter((value, index, all) => all.indexOf(value) === index && value >= state.minDeposit);

  return (
    <section className="glass rounded-3xl p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Deposit 300 tokens</h2>
      <p className="mt-1 text-sm text-muted">Credited after about 2–4 minutes, once the transfer is 5 blocks deep.</p>

      <label className="mt-5 block text-xs text-faint" htmlFor="deposit-amount">
        Amount
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id="deposit-amount"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^\d]/g, ""))}
          className="w-full rounded-2xl border border-line-strong bg-ink px-4 py-3 text-lg tabular-nums outline-none focus:border-gold"
          disabled={busy}
        />
        {walletTokens !== null && walletTokens > 0n && (
          <button className="btn btn-ghost !px-4" onClick={() => setAmount(walletTokens.toString())} disabled={busy}>
            Max
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {quickAmounts.map((value) => (
          <button
            key={value}
            onClick={() => setAmount(String(value))}
            disabled={busy}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-gold/40 hover:text-text"
          >
            {formatTokenAmount(BigInt(value))}
          </button>
        ))}
      </div>
      {tooSmall && <p className="mt-2 text-xs text-danger">Minimum deposit: {formatTokenAmount(BigInt(state.minDeposit))} tokens.</p>}
      {tooLarge && <p className="mt-2 text-xs text-danger">Your wallet holds less than that.</p>}

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Network fee about 0.2 ADA. Cardano requires {minAda ? `${formatAdaExact(minAda)} ADA` : "about 1.2 ADA"} to travel with the tokens to the
        game treasury.
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3 text-sm">
        <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-gold)]" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span className="text-muted">I understand that game credit can only be spent on rounds here. It cannot be withdrawn or refunded.</span>
      </label>

      <button className="btn btn-gold mt-4 w-full" onClick={deposit} disabled={!canDeposit}>
        {busy ? <Spinner size={16} /> : null}
        {busy ? phase.step : parsed ? `Deposit ${formatTokenAmount(parsed)} tokens` : "Deposit"}
      </button>

      {paramsFailed && !params && <p className="mt-3 text-sm text-danger">Could not load Cardano network parameters. Reload the page to try again.</p>}
      {phase.name === "error" && <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{phase.message}</p>}
      {phase.name === "submitted" && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-positive/30 bg-positive/10 p-3 text-sm text-positive">
          <Check size={16} /> Sent. Your balance updates once the transfer is confirmed.
          <a className="inline-flex items-center gap-1 underline" href={`https://cardanoscan.io/transaction/${phase.txHash}`} target="_blank" rel="noreferrer">
            Transaction <ArrowUpRight size={12} />
          </a>
        </p>
      )}
    </section>
  );
}

function RoundCard({ state, onPlayed }: { state: GameState; onPlayed(): Promise<void> }) {
  const [phase, setPhase] = useState<{ name: "idle" } | { name: "playing" } | { name: "played"; roundId: number } | { name: "error"; message: string }>({
    name: "idle",
  });
  const canPlay = state.enabled && state.balance >= state.roundCost && phase.name !== "playing";

  const play = async () => {
    setPhase({ name: "playing" });
    try {
      const result = await api<{ roundId: number }>("/api/game/round", { game: GAME_ID });
      setPhase({ name: "played", roundId: result.roundId });
      await onPlayed();
    } catch (error) {
      setPhase({ name: "error", message: error instanceof Error ? error.message : "The round could not start." });
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border border-line bg-night p-6 sm:p-8 lg:col-span-2">
      <div aria-hidden="true" className="grid-backdrop absolute inset-0 opacity-60" />
      <div className="relative grid grid-cols-1 items-center gap-8 md:grid-cols-[auto_1fr]">
        <div className="mx-auto size-40 [perspective:800px]">
          <motion.div
            key={phase.name === "played" ? phase.roundId : "idle"}
            initial={phase.name === "played" ? { rotateY: 0 } : false}
            animate={phase.name === "played" ? { rotateY: 720 } : { rotateY: 0 }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="size-full"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/300-logo.jpg" alt="" className="size-full rounded-full shadow-[0_20px_60px_-15px_rgba(233,180,76,0.7)] ring-1 ring-gold/40" />
          </motion.div>
        </div>
        <div>
          <p className="kicker">Game</p>
          <h2 className="mt-2 text-2xl font-semibold">The first 300 game is being designed.</h2>
          <p className="mt-2 text-muted">
            Until it launches, a round only proves the mechanics: it deducts {formatTokenAmount(BigInt(state.roundCost))} tokens from your game balance.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button className="btn btn-gold" onClick={play} disabled={!canPlay}>
              {phase.name === "playing" ? <Spinner size={16} /> : null}
              Start round · {formatTokenAmount(BigInt(state.roundCost))} tokens
            </button>
            <AnimatePresence mode="wait">
              {phase.name === "played" && (
                <motion.span key={phase.roundId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-sm text-positive">
                  Round #{phase.roundId} started.
                </motion.span>
              )}
            </AnimatePresence>
            {phase.name === "error" && <span className="text-sm text-danger">{phase.message}</span>}
            {state.balance < state.roundCost && phase.name !== "error" && <span className="text-sm text-faint">Deposit tokens to play.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

const STATUS_LABEL = { open: "Waiting for transaction", submitted: "Confirming…", confirmed: "Credited" } as const;

function History({ state }: { state: GameState }) {
  const deposits = state.deposits.filter((deposit) => deposit.status !== "open" || deposit.txHash);
  if (!deposits.length && !state.rounds.length) return null;
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:col-span-2">
      <div className="rounded-3xl border border-line p-6">
        <h3 className="font-semibold">Deposits</h3>
        <ul className="mt-3 divide-y divide-line text-sm">
          {deposits.length === 0 && <li className="py-2 text-faint">No deposits yet.</li>}
          {deposits.map((deposit) => (
            <li key={deposit.reference} className="flex items-center justify-between gap-3 py-2.5">
              <span className="tabular-nums">{formatTokenAmount(BigInt(deposit.received ?? deposit.requested))} tokens</span>
              <span className={deposit.status === "confirmed" ? "text-positive" : "text-muted"}>
                {STATUS_LABEL[deposit.status]}
                {deposit.txHash && (
                  <a className="ml-2 text-faint hover:text-text" href={`https://cardanoscan.io/transaction/${deposit.txHash}`} target="_blank" rel="noreferrer">
                    ↗
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-3xl border border-line p-6">
        <h3 className="font-semibold">Rounds</h3>
        <ul className="mt-3 divide-y divide-line text-sm">
          {state.rounds.length === 0 && <li className="py-2 text-faint">No rounds yet.</li>}
          {state.rounds.map((round) => (
            <li key={round.id} className="flex items-center justify-between gap-3 py-2.5">
              <span>Round #{round.id}</span>
              <span className="tabular-nums text-muted">−{formatTokenAmount(BigInt(round.cost))} tokens</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
