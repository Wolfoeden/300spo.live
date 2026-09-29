"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addressBytesFromWallet, bytesToHex } from "@/lib/cardano/address";
import { assembleSignedTx, buildTransaction, ttlFromNow, minAdaForOutput, parseUtxo, type ProtocolParams, type TxOutput, type Utxo } from "@/lib/cardano/tx";
import { loadProtocolParams, transactionErrorMessage, type TxStage } from "@/lib/chain-client";
import { formatAdaExact, formatTokenAmount } from "@/lib/format";
import { GAME_COPY, LOBBY_LIVE, isKnownGame } from "@/lib/game/catalog";
import { depositMetadata, ownsTreasury } from "@/lib/game/treasury";
import { TOKEN_300 } from "@/lib/site";
import { DripCard, RewardsPanel } from "../drip/drip-card";
import { ArrowUpRight, Check, Close, Shield, Spinner, WalletIcon } from "../icons";
import { InfoBubble } from "../info-bubble";
import { useDelegation } from "../wallet/delegation";
import { useWallet } from "../wallet/wallet-provider";
import { Arena, type ArenaGame, type PlayResult, type RaceTicket } from "./arena";
import type { RacePreview } from "./card-race-stage";
import { FairnessCard, roundSummary, type Fairness } from "./fairness-card";
import { ChickenGame, type ChickenRound, type ChickenState } from "./chicken-game";
import { ModeSwitch } from "./game-frame";
import { Lobby } from "./lobby";
import { QuadRace, type MultiRaceResult, type RaceDeals } from "./quad-race";
import { WalletCard, openTerminalTab } from "./terminal";

const UNIT_300 = TOKEN_300.policyId + TOKEN_300.assetNameHex;
const POLL_MS = 20_000;
// After a click on Delegate, the starting credit is checked again this often, this many times.
const WELCOME_POLL_MS = 30_000;
const WELCOME_POLLS = 10;

type GameState = {
  wallet: string;
  enabled: boolean;
  minDeposit: number;
  treasuryAddress: string | null;
  bets: { min: number; max: number; step: number };
  games: ArenaGame[];
  balance: number;
  welcome?: { enabled: boolean; amount: number; claimed: boolean };
  deposits: {
    reference: string;
    requested: number;
    received: number | null;
    status: "open" | "submitted" | "confirmed" | "rejected";
    note: string | null;
    txHash: string | null;
    createdAt: string;
  }[];
  rounds: {
    id: number;
    game: string;
    bet: number;
    choice: number;
    outcome: number;
    payout: number;
    oddsBps: number | null;
    detail: { hazards: number; lanes: number; steps: number; crashLane: number } | null;
    nonce: number;
    serverSeedHash: string;
    clientSeed: string;
    createdAt: string;
  }[];
};

const API_ERRORS: Record<string, string> = {
  game_disabled: "This game is paused right now.",
  amount_too_small: "That amount is below the minimum deposit.",
  insufficient_balance: "Not enough game balance for this bet. Deposit more 300 first.",
  invalid_bet: "That bet is not allowed. Choose one of the listed amounts.",
  invalid_choice: "Pick one of the listed options.",
  invalid_client_seed: "Client seed: 1–64 letters, digits, - or _.",
  race_changed: "The race was dealt again (another bet or a new seed). Check the new track and odds, then bet.",
  round_open: "A Chicken round is still running. Finish it first — until then the seed cannot be revealed.",
  round_not_open: "This round is already over.",
  too_many_open_deposits: "Too many unfinished deposits. Let the pending ones confirm first.",
  not_configured: "The game is not configured yet.",
  not_signed_in: "Your wallet session expired. Verify your wallet again.",
};

const loadFairness = () => api<Fairness>("/api/game/fairness");
const rotateSeed = (clientSeed: string | null) => api<Fairness>("/api/game/seed", clientSeed ? { clientSeed } : {});
const loadRace = () => api<RacePreview>("/api/game/race");
const loadRaces = (count: number) => api<RaceDeals>(`/api/game/race?count=${count}`);
const placeBet = (game: string, bet: number, choice: number, race?: RaceTicket) =>
  api<PlayResult>("/api/game/play", { game, bet: String(bet), choice, ...race });
const placeRaces = (bet: number, choices: number[], ticket: RaceTicket) =>
  api<MultiRaceResult>("/api/game/play-races", { bet: String(bet), choices, ...ticket });
const loadChicken = () => api<ChickenState>("/api/game/chicken");
const startChicken = (bet: number, hazards: number) => api<ChickenRound>("/api/game/chicken-start", { bet: String(bet), hazards });
const stepChicken = (round: number) => api<ChickenRound>("/api/game/chicken-step", { round });
const collectChicken = (round: number) => api<ChickenRound>("/api/game/chicken-collect", { round });
type WelcomeResult = { status: "granted"; amount: number; balance: number } | { status: "claimed" | "not_eligible" | "disabled" | "not_delegated" };
const claimWelcome = () => api<WelcomeResult>("/api/game/welcome", {});

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

// The lobby and the open game live in the URL hash (#horse-race, #horse-race/4,
// #coin-flip), so links work and the back button returns to the lobby.
const subscribeHash = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
const useHashRoute = () => useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => "");

const goTo = (route: string) => {
  if (route) window.location.hash = route;
  else {
    window.history.pushState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
  document.getElementById("games")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

export function GamePage() {
  const { status, wallet, balance, auth, openDialog, signIn } = useWallet();
  const route = useHashRoute();
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

  const settle = useCallback(() => void refresh(), [refresh]);

  // Starting credit: asked for once per wallet and visit while it is unclaimed.
  // Wallets that do not delegate yet see the offer; the rest see nothing until it lands.
  const [welcome, setWelcome] = useState<{ status: "offer" | "granted"; amount: number } | null>(null);
  const [watching, setWatching] = useState(false);
  const askedFor = useRef<string | null>(null);
  const welcomeOpen = state?.welcome?.enabled === true && !state.welcome.claimed;
  const welcomeAmount = state?.welcome?.amount ?? 0;
  const tryWelcome = useCallback(async () => {
    const result = await claimWelcome().catch(() => null);
    if (result?.status === "granted") {
      setWelcome({ status: "granted", amount: result.amount });
      setWatching(false);
      void refresh();
    } else if (result?.status === "not_delegated") {
      setWelcome({ status: "offer", amount: welcomeAmount });
    } else if (result) {
      setWelcome(null);
      setWatching(false);
    }
  }, [refresh, welcomeAmount]);

  useEffect(() => {
    if (!welcomeOpen || !state || askedFor.current === state.wallet) return;
    askedFor.current = state.wallet;
    void tryWelcome();
  }, [welcomeOpen, state, tryWelcome]);

  useEffect(() => {
    if (!watching) return;
    let polls = 0;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls >= WELCOME_POLLS) setWatching(false);
      void tryWelcome();
    }, WELCOME_POLL_MS);
    return () => window.clearInterval(timer);
  }, [watching, tryWelcome]);
  const [dealVersion, setDealVersion] = useState(0);

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

  const [slug, variant] = route.split("/");
  const tile = LOBBY_LIVE.find((entry) => entry.slug === slug);
  const quad = slug === "horse-race" && variant === "4";

  // What stands between the player and the open game, if anything.
  const gate =
    status !== "connected" || !wallet ? (
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
    ) : null;

  const game = state && tile?.game ? state.games.find((entry) => entry.id === tile.game) : undefined;
  const walletPanels = state && {
    deposit: <DepositPanel state={state} walletTokens={balance?.token300 ?? null} onDeposited={refresh} />,
    rewards: <RewardsPanel />,
  };
  const common = state &&
    walletPanels && {
      bets: state.bets,
      balance: state.balance,
      enabled: state.enabled,
      dealVersion,
      onSettled: settle,
      onBack: () => goTo(""),
      wallet: walletPanels,
    };
  // On phones the game panel is docked to the bottom of the screen; keep the page clear of it.
  const docked = !!tile && !gate && !!common;

  // Magnetic focus: while a game is open the page snaps to it when scrolled near,
  // and a deliberate swipe still scrolls past to the rest of the page.
  useEffect(() => {
    if (!docked) return;
    const root = document.documentElement;
    root.style.scrollSnapType = "y proximity";
    const frame = requestAnimationFrame(() => document.querySelector("[data-game-shell]")?.scrollIntoView({ block: "start" }));
    return () => {
      cancelAnimationFrame(frame);
      root.style.scrollSnapType = "";
    };
  }, [docked, tile?.slug, welcome?.status]);

  return (
    <div className="relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[26rem] overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/300-hero.jpg" alt="" className="size-full object-cover opacity-[0.12] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="absolute -top-40 right-[-10%] h-[30rem] w-[30rem] rounded-full bg-gold/[0.12] blur-[120px]" />
      </div>

      <div className={`container-site relative pt-24 sm:pt-28 ${docked ? "pb-[calc(var(--dock,11rem)+1.5rem)] lg:pb-24" : "pb-24"}`}>
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="kicker">300 Games</p>
            <h1 className="mt-3 text-4xl font-semibold leading-[1.02] tracking-[-0.03em] sm:text-5xl">
              Play with <span className="text-gold-gradient">300.</span>{" "}
              <InfoBubble label="How the 300 games work">
                <span className="block">
                  Deposit 300 tokens as game credit, pick a winner and bet{" "}
                  {state ? `${formatTokenAmount(BigInt(state.bets.min))} to ${formatTokenAmount(BigInt(state.bets.max))}` : "300 to 3,000"}. A correct
                  pick pays out in game credit.
                </span>
                <span className="mt-2 block">Every round is provably fair: the server seed is committed before you play and can be revealed.</span>
                {state?.welcome?.enabled && (
                  <span className="mt-2 block">
                    Wallets delegated to the 300 stake pool get {formatTokenAmount(BigInt(state.welcome.amount))} 300 starting credit once.
                  </span>
                )}
              </InfoBubble>
            </h1>
          </div>
          <AccountBar
            gated={!!gate}
            balance={state?.balance ?? null}
            onConnect={() => openDialog(() => undefined)}
            onVerify={signIn}
            signing={auth.status === "signing"}
            connected={status === "connected" && !!wallet}
          />
        </header>

        {welcome && !gate && (
          <WelcomeNotice
            status={welcome.status}
            amount={welcome.amount}
            watching={watching}
            onDelegate={() => setWatching(true)}
            onDismiss={() => setWelcome(null)}
          />
        )}

        <div id="games" className="mt-10 scroll-mt-24">
          {!tile ? (
            <Lobby onOpen={(target) => goTo(target)} />
          ) : gate ? (
            <div className="flex flex-col gap-4">
              <button type="button" onClick={() => goTo("")} className="self-start text-sm text-muted hover:text-text">
                ← All games
              </button>
              {gate}
            </div>
          ) : !game?.enabled || !common ? (
            <Gate icon={<Shield className="text-warning" />} title={`${tile.title} is paused`} text="This game is switched off right now. Try another one." />
          ) : tile.game === "chicken" ? (
            <ChickenGame
              key="chicken"
              game={game}
              bets={common.bets}
              balance={common.balance}
              enabled={common.enabled}
              onSettled={common.onSettled}
              onBack={common.onBack}
              wallet={common.wallet}
              load={loadChicken}
              start={startChicken}
              step={stepChicken}
              collect={collectChicken}
            />
          ) : quad ? (
            <QuadRace
              key="quad"
              game={game}
              {...common}
              loadRaces={loadRaces}
              playRaces={placeRaces}
              toolbar={<ModeSwitch quad onChange={(value) => goTo(value ? "horse-race/4" : "horse-race")} />}
            />
          ) : (
            <Arena
              key={game.id}
              game={game}
              {...common}
              play={placeBet}
              loadRace={loadRace}
              toolbar={
                game.kind === "race" ? <ModeSwitch quad={false} onChange={(value) => goTo(value ? "horse-race/4" : "horse-race")} /> : undefined
              }
            />
          )}
        </div>

        {state && !gate && (
          <section id="account" aria-labelledby="account-title" className="mt-14 scroll-mt-24">
            <h2 id="account-title" className="kicker">
              Your game account
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.2fr]">
              <BalanceCard state={state} walletTokens={balance?.token300 ?? null} />
              {/* In a game the same tabs live in its terminal. */}
              {!docked && walletPanels && <WalletCard wallet={walletPanels} />}
              <History state={state} />
              <FairnessSection state={state} onRotated={() => setDealVersion((version) => version + 1)} />
            </div>
          </section>
        )}

        <div className="mt-5">
          <DripCard />
        </div>
      </div>
    </div>
  );
}

/** Top-right of /play: connect or verify, or the game balance with a deposit shortcut. */
function AccountBar({
  gated,
  balance,
  connected,
  signing,
  onConnect,
  onVerify,
}: {
  gated: boolean;
  balance: number | null;
  connected: boolean;
  signing: boolean;
  onConnect(): void;
  onVerify(): void;
}) {
  if (gated || balance === null) {
    return connected ? (
      <button className="btn btn-gold" onClick={onVerify} disabled={signing}>
        {signing && <Spinner size={16} />}
        {signing ? "Check your wallet…" : "Verify wallet to play"}
      </button>
    ) : (
      <button className="btn btn-gold" onClick={onConnect}>
        <WalletIcon /> Connect wallet
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.1] to-transparent py-2 pl-4 pr-2">
      <div>
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.16em] text-faint">Game balance</p>
        <p className="text-xl font-semibold tabular-nums">
          {formatTokenAmount(BigInt(balance))} <span className="text-gold-gradient text-sm font-bold">300</span>
        </p>
        <p className="text-[0.62rem] text-faint">Game credit only · no withdrawals</p>
      </div>
      <button type="button" onClick={() => openTerminalTab("deposit")} className="btn btn-ghost !px-4 !py-2 text-sm">
        Deposit
      </button>
    </div>
  );
}

/** The starting-credit offer for wallets that do not delegate yet, or the note that it was credited. */
function WelcomeNotice({
  status,
  amount,
  watching,
  onDelegate,
  onDismiss,
}: {
  status: "offer" | "granted";
  amount: number;
  watching: boolean;
  onDelegate(): void;
  onDismiss(): void;
}) {
  const credit = `${formatTokenAmount(BigInt(amount))} 300`;
  const { start } = useDelegation();
  return (
    <div
      className={`mt-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
        status === "granted" ? "border-positive/40 bg-positive/10 text-positive" : "border-gold/30 bg-gold/[0.06] text-text"
      }`}
      role="status"
    >
      {status === "granted" ? (
        <>
          <span className="flex items-center gap-2">
            <Check size={16} /> {credit} starting credit added. Thanks for delegating to 300.
          </span>
          <button onClick={onDismiss} aria-label="Dismiss" className="text-positive/80 hover:text-positive">
            <Close size={14} />
          </button>
        </>
      ) : (
        <>
          <span>
            Delegate and get <strong className="text-gold-bright">{formatTokenAmount(BigInt(amount))}</strong> credit to play.
          </span>
          <span className="flex items-center gap-3">
            {watching && (
              <span className="flex items-center gap-2 text-muted">
                <Spinner size={14} /> Waiting for the delegation on chain…
              </span>
            )}
            <button
              type="button"
              className="btn btn-gold !px-4 !py-2 text-xs"
              onClick={() => {
                // The same dialog as on the landing page; after signing, this page keeps checking for the delegation.
                start("both");
                onDelegate();
              }}
            >
              Delegate
            </button>
          </span>
        </>
      )}
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
        Bets from {formatTokenAmount(BigInt(state.bets.min))} to {formatTokenAmount(BigInt(state.bets.max))} tokens in steps of{" "}
        {formatTokenAmount(BigInt(state.bets.step))}
      </p>
      <div className="mt-6 border-t border-line pt-4 text-sm text-muted">
        In your wallet: {walletTokens === null ? "–" : `${formatTokenAmount(walletTokens)} tokens`}
      </div>
      {!state.enabled && (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">Deposits and games are paused right now.</p>
      )}
    </section>
  );
}

type DepositPhase =
  | { name: "idle" }
  | { name: "working"; step: string }
  | { name: "submitted"; txHash: string }
  | { name: "error"; message: string };

function DepositPanel({ state, walletTokens, onDeposited }: { state: GameState; walletTokens: bigint | null; onDeposited(): Promise<void> }) {
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
  const isTreasury = !!treasury && !!wallet && ownsTreasury(treasury, wallet);
  const canDeposit = state.enabled && !!treasury && !isTreasury && parsed !== null && !tooSmall && !tooLarge && accepted && !!params && !busy;

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
    <div id="deposit">
      <h3 className="flex items-center gap-2 font-semibold">
        Deposit 300 tokens
        <InfoBubble label="How deposits work">
          Your wallet sends the tokens to the game treasury with a reference. They are credited after about 2–4 minutes, once the transfer is 5
          blocks deep.
        </InfoBubble>
      </h3>

      <label className="mt-4 block text-xs text-faint" htmlFor="deposit-amount">
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
        <span className="text-muted">I understand that game credit, including winnings, can only be used for bets here. It cannot be withdrawn or refunded.</span>
      </label>

      {isTreasury && (
        <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          This wallet holds the game treasury. Tokens sent from it stay in the treasury and are not credited — deposit from another wallet.
        </p>
      )}
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
    </div>
  );
}

const STATUS_LABEL = { open: "Waiting for transaction", submitted: "Confirming…", confirmed: "Credited", rejected: "Not credited" } as const;
const REJECT_REASON: Record<string, string> = { treasury_wallet: "Sent from the treasury wallet itself — the tokens never left it." };

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
              <span className="min-w-0">
                <span className="block tabular-nums">{formatTokenAmount(BigInt(deposit.received ?? deposit.requested))} tokens</span>
                {deposit.status === "rejected" && deposit.note && <span className="block text-xs text-faint">{REJECT_REASON[deposit.note] ?? deposit.note}</span>}
              </span>
              <span className={`shrink-0 ${deposit.status === "confirmed" ? "text-positive" : deposit.status === "rejected" ? "text-warning" : "text-muted"}`}>
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
        <h3 className="font-semibold">Bets</h3>
        <ul className="mt-3 divide-y divide-line text-sm">
          {state.rounds.length === 0 && <li className="py-2 text-faint">No bets yet.</li>}
          {state.rounds.map((round) => (
            <li key={round.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate">{isKnownGame(round.game) ? GAME_COPY[round.game].title : round.game}</span>
                <span className="block truncate text-xs text-faint">{roundSummary(round)}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${round.payout > 0 ? "text-positive" : "text-muted"}`}>
                {round.payout > 0 ? `+${formatTokenAmount(BigInt(round.payout - round.bet))}` : `−${formatTokenAmount(BigInt(round.bet))}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FairnessSection({ state, onRotated }: { state: GameState; onRotated(): void }) {
  const outcomes = useMemo(() => Object.fromEntries(state.games.map((game) => [game.id, game.outcomes])), [state.games]);
  const rotate = useCallback(
    async (clientSeed: string | null) => {
      const fairness = await rotateSeed(clientSeed);
      onRotated();
      return fairness;
    },
    [onRotated],
  );
  return <FairnessCard rounds={state.rounds} outcomes={outcomes} load={loadFairness} rotate={rotate} />;
}
