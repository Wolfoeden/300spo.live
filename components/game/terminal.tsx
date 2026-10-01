"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";
import { isMuted, setMuted, subscribeMuted } from "@/lib/sound";
import { SoonBadge } from "../coming-soon";
import { Close } from "../icons";
import { RollingBalance } from "./arena-effects";
import { BetStepper, Kbd, stepBet, type Bets } from "./game-frame";

/** Auto play: off, running while the play button is held, or locked on until stopped. */
export type AutoMode = "off" | "hold" | "lock";
/** The account parts of the terminal: the wallet tabs, and the recent bets shown in its free room on desktops. */
export type WalletPanels = { deposit: React.ReactNode; rewards: React.ReactNode; history?: React.ReactNode };
type WalletTab = "deposit" | "withdraw" | "rewards";

/** Other parts of the page open a wallet tab with this event (detail: the tab). */
export const OPEN_TAB_EVENT = "terminal:open";
export const openTerminalTab = (tab: "deposit" | "rewards") => window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: tab }));

const HOLD_MS = 350;
const LOCK_PX = 56;

/** Plays the next round whenever auto play is on and the game is ready for one. */
export function useAutoRun(mode: AutoMode, ready: boolean, run: () => void, delay = 450) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (mode === "off" || !ready) return;
    const id = window.setTimeout(() => latest.current(), delay);
    return () => window.clearTimeout(id);
  }, [mode, ready, delay]);
}

/** Auto play never keeps running in a hidden tab. */
export function useStopWhenHidden(mode: AutoMode, stop: () => void) {
  useEffect(() => {
    if (mode === "off") return;
    const onChange = () => document.hidden && stop();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [mode, stop]);
}

const WALLET_TABS: { id: WalletTab; label: string; path: string }[] = [
  { id: "deposit", label: "Deposit", path: "M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" },
  { id: "withdraw", label: "Withdraw", path: "M12 20V8m0 0l-5 5m5-5l5 5M5 4h14" },
  { id: "rewards", label: "Rewards", path: "M12 3c3 4 6 6.5 6 10a6 6 0 01-12 0c0-3.5 3-6 6-10z" },
];

/** Deposit, withdraw (not open yet) and rewards behind one set of tabs. */
function WalletTabs({ wallet, tab, onTab }: { wallet: WalletPanels; tab: WalletTab; onTab(tab: WalletTab): void }) {
  return (
    <>
      <div role="tablist" aria-label="Wallet" className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-ink/60 p-1">
        {WALLET_TABS.map((entry) => {
          const soon = entry.id === "withdraw";
          const selected = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-disabled={soon}
              title={soon ? "Withdrawals are coming soon" : undefined}
              onClick={() => !soon && onTab(entry.id)}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-xs font-semibold transition ${
                soon ? "cursor-not-allowed text-faint/70" : selected ? "bg-gold/15 text-gold-bright" : "text-muted hover:bg-white/5 hover:text-text"
              }`}
            >
              <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={entry.path} />
              </svg>
              {entry.label}
              {soon && <SoonBadge />}
            </button>
          );
        })}
      </div>
      <div className="pt-4">{tab === "deposit" ? wallet.deposit : wallet.rewards}</div>
    </>
  );
}

/** The wallet in the lobby: the same tabs as a card. */
export function WalletCard({ wallet }: { wallet: WalletPanels }) {
  const [tab, setTab] = useState<WalletTab>("deposit");
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<WalletTab>).detail;
      if (next !== "deposit" && next !== "rewards") return;
      setTab(next);
      root.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
  }, []);
  return (
    <section ref={root} id="terminal" className="glass scroll-mt-24 rounded-3xl p-4 sm:p-5">
      <WalletTabs wallet={wallet} tab={tab} onTab={setTab} />
    </section>
  );
}

export type PanelPlay = {
  /** Small line inside the play button, above the bet. */
  label: React.ReactNode;
  onPlay(): void;
  playable: boolean;
  auto: AutoMode;
  onAuto(mode: AutoMode): void;
  /** Hold-and-swipe lock and the Auto switch; off for games that must not run on their own. */
  lockable?: boolean;
  tone?: "gold" | "green";
  kbd?: React.ReactNode;
  /** The amount in the button when it is not the bet (the horse race shows its chips' total). */
  amount?: number;
};

/**
 * The controls of a running game. On phones a slim dock at the bottom of the
 * screen: the prompt, the bet inside the play button with − and + beside it,
 * then balance, last win and the wallet. On desktops the left column of the game.
 */
export function GamePanel({
  prompt,
  options,
  bet,
  play,
  side,
  lead,
  below,
  extra,
  lastWin,
  balance,
  wallet,
}: {
  prompt: React.ReactNode;
  /** Game choices above the prompt (coin side, difficulty). */
  options?: React.ReactNode;
  bet: { bets: Bets; bet: number; onChange(bet: number): void; disabled: boolean; affordable(amount: number): boolean };
  play: PanelPlay;
  /** Replaces − and + (Chicken's collect button while a round runs). */
  side?: React.ReactNode;
  /** Sits left of the play button instead of − and + (the horse race's replay); the bet is then set in `below`. */
  lead?: React.ReactNode;
  /** A row under the play button that holds the bet controls itself (the horse race's chips and mode). */
  below?: React.ReactNode;
  /** A small action under the play button (skip to the finish). */
  extra?: React.ReactNode;
  lastWin: number | null;
  balance: number;
  wallet: WalletPanels;
}) {
  const [sheet, setSheet] = useState<WalletTab | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<WalletTab>).detail;
      if (next === "deposit" || next === "rewards") setSheet(next);
    };
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
  }, []);

  // The game above sizes itself to the room the dock leaves on phones.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const update = () => document.documentElement.style.setProperty("--dock", desktop.matches ? "0px" : `${element.offsetHeight}px`);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    desktop.addEventListener("change", update);
    update();
    return () => {
      observer.disconnect();
      desktop.removeEventListener("change", update);
      document.documentElement.style.removeProperty("--dock");
    };
  }, []);

  const step = (direction: 1 | -1) => bet.onChange(stepBet(bet.bets, bet.bet, direction));
  const stepButton = (direction: 1 | -1) => (
    <button
      type="button"
      aria-label={direction === 1 ? "Raise bet" : "Lower bet"}
      onClick={() => step(direction)}
      disabled={bet.disabled || (direction === 1 ? bet.bet >= bet.bets.max || !bet.affordable(stepBet(bet.bets, bet.bet, 1)) : bet.bet <= bet.bets.min)}
      className="grid place-items-center rounded-xl border border-line bg-white/[0.03] text-xl leading-none text-text transition enabled:active:scale-95 disabled:opacity-30 lg:hidden"
    >
      {direction === 1 ? "+" : "−"}
    </button>
  );
  const lockable = play.lockable ?? true;

  return (
    <div
      ref={root}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-ink px-3 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-18px_40px_-20px_rgba(0,0,0,0.9)] lg:relative lg:inset-auto lg:z-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:border-t-0 lg:bg-transparent lg:p-5 lg:shadow-none"
    >
      <div className="mx-auto flex max-w-md flex-col gap-1.5 lg:h-full lg:max-w-none lg:gap-4">
        {options}
        {!below && (
          <div className="hidden lg:block">
            <BetStepper bets={bet.bets} bet={bet.bet} onChange={bet.onChange} disabled={bet.disabled} affordable={bet.affordable} />
          </div>
        )}
        {/* With its own bet row (the horse race) the play button says enough on phones. */}
        <p className={`min-h-4 text-center text-[0.7rem] text-muted lg:block lg:text-left lg:text-xs ${below ? "hidden" : ""}`} aria-live="polite">
          {prompt}
        </p>
        <div
          className={`grid gap-2 ${
            side ? "grid-cols-2" : below ? (lead ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1") : "grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] lg:grid-cols-1"
          }`}
        >
          {side ? side : below ? lead : stepButton(-1)}
          <HoldPlayButton onPlay={play.onPlay} auto={play.auto} onAuto={play.onAuto} playable={play.playable} lockable={lockable} tone={play.tone}>
            <span className="flex min-w-0 items-baseline gap-2 leading-tight lg:flex-col lg:items-center lg:gap-0">
              <span className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.1em] opacity-75 lg:text-[0.68rem]">{play.label}</span>
              <span className="text-base font-bold tabular-nums lg:text-xl">
                {formatTokenAmount(BigInt(play.amount ?? bet.bet))} <span className="text-[0.65rem] font-semibold opacity-70">300</span>
              </span>
            </span>
            {play.kbd}
          </HoldPlayButton>
          {!side && !below && stepButton(1)}
        </div>
        {below}
        {lockable && (
          <div className="hidden lg:block">
            <AutoToggle auto={play.auto} onAuto={play.onAuto} disabled={!play.playable} />
          </div>
        )}
        {extra}
        <div className="hidden lg:flex lg:flex-1 lg:flex-col">{wallet.history}</div>
        <div className="flex items-center gap-3 whitespace-nowrap text-[0.7rem] lg:flex-col lg:text-xs lg:items-stretch lg:gap-3 lg:border-t lg:border-line lg:pt-4">
          <p className="flex items-baseline gap-1.5 lg:justify-between">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-faint">Balance</span>
            <span className="font-semibold text-text lg:text-lg">
              <RollingBalance value={balance} />
            </span>
          </p>
          <p className="flex items-baseline gap-1.5 lg:justify-between">
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-faint">Last win</span>
            <span className={`font-semibold tabular-nums ${lastWin ? "text-positive" : "text-faint"}`}>
              {lastWin ? `+${formatTokenAmount(BigInt(lastWin))}` : "—"}
            </span>
          </p>
          <SoundToggle />
          <button
            type="button"
            onClick={() => setSheet("deposit")}
            aria-label="Wallet"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-semibold text-muted transition hover:border-gold/40 hover:text-text lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="6" width="18" height="13" rx="2" />
              <path d="M16 12h2M3 10h18" />
            </svg>
            <span className="hidden min-[380px]:inline">Wallet</span>
          </button>
          <div className="hidden grid-cols-3 gap-1.5 lg:grid">
            {WALLET_TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => entry.id !== "withdraw" && setSheet(entry.id)}
                aria-disabled={entry.id === "withdraw"}
                title={entry.id === "withdraw" ? "Withdrawals are coming soon" : undefined}
                className={`relative rounded-xl border border-line px-1 py-2 text-xs font-semibold transition ${
                  entry.id === "withdraw" ? "cursor-not-allowed text-faint/70" : "text-muted hover:border-gold/40 hover:text-text"
                }`}
              >
                {entry.label}
                {entry.id === "withdraw" && (
                  <span className="absolute -right-1 -top-2">
                    <SoonBadge />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <p className="-mt-0.5 text-center text-[0.58rem] leading-none text-faint lg:mt-0 lg:text-left lg:text-[0.65rem]">Game credit only · no withdrawals</p>
      </div>

      <AnimatePresence>
        {sheet && (
          <>
            <motion.button
              type="button"
              aria-label="Close wallet"
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheet(null)}
            />
            <motion.div
              role="dialog"
              aria-label="Wallet"
              className="fixed inset-x-0 bottom-0 z-50 max-h-[78vh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-line-strong bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:absolute lg:inset-0 lg:max-h-none lg:rounded-none lg:border-0 lg:p-5"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold">Wallet</p>
                <button
                  type="button"
                  onClick={() => setSheet(null)}
                  aria-label="Close wallet"
                  className="grid size-9 place-items-center rounded-full border border-line text-muted hover:text-text"
                >
                  <Close size={16} />
                </button>
              </div>
              <WalletTabs wallet={wallet} tab={sheet} onTab={setSheet} />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The main play button. A tap plays one round; holding it plays rounds until it
 * is released; holding and swiping up locks auto play until the next tap.
 */
export function HoldPlayButton({
  children,
  onPlay,
  auto,
  onAuto,
  playable,
  lockable = true,
  tone = "gold",
  className = "",
}: {
  children: React.ReactNode;
  onPlay(): void;
  auto: AutoMode;
  onAuto(mode: AutoMode): void;
  /** Whether a round can start now; the button stays pressable so auto play can be stopped. */
  playable: boolean;
  lockable?: boolean;
  tone?: "gold" | "green";
  className?: string;
}) {
  const press = useRef<{ y: number; timer: number; held: boolean } | null>(null);
  const [lift, setLift] = useState(0);

  const release = (play: boolean) => {
    const current = press.current;
    press.current = null;
    setLift(0);
    if (!current) return;
    window.clearTimeout(current.timer);
    if (current.held) onAuto("off");
    else if (play && playable) onPlay();
  };

  const colors =
    tone === "green"
      ? "bg-[linear-gradient(135deg,#5ee39b,#1f9d5c)] text-[#062915] shadow-[0_10px_30px_-12px_rgba(94,227,155,0.7)]"
      : "bg-[linear-gradient(180deg,var(--color-gold-bright),var(--color-gold))] text-[#1a1204] shadow-[0_10px_30px_-12px_rgba(233,180,76,0.8)]";

  return (
    <div className={`relative ${className}`}>
      <AnimatePresence>
        {auto === "hold" && lockable && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex justify-center"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: -lift * 24 }}
            exit={{ opacity: 0 }}
          >
            <span className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${lift > 0.6 ? "border-gold bg-gold/20 text-gold-bright" : "border-line-strong bg-ink/90 text-muted"}`}>
              <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 018 0v4" />
              </svg>
              Swipe up to lock
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        aria-disabled={!playable && auto === "off"}
        className={`flex min-h-11 w-full touch-none select-none items-center justify-center gap-2 rounded-xl px-3 font-bold transition lg:min-h-14 lg:rounded-2xl [-webkit-touch-callout:none] ${colors} ${
          !playable && auto === "off" ? "opacity-45" : "hover:brightness-110 active:scale-[0.98]"
        } ${auto !== "off" ? "ring-2 ring-white/60 ring-offset-2 ring-offset-ink" : ""}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (auto === "lock") {
            onAuto("off");
            return;
          }
          try {
            // Keeps the swipe on this button even when the finger leaves it.
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // The pointer is already gone; the press still works without capture.
          }
          const timer = window.setTimeout(() => {
            if (!press.current || !playable) return;
            press.current.held = true;
            onAuto("hold");
          }, HOLD_MS);
          press.current = { y: event.clientY, timer, held: false };
        }}
        onPointerMove={(event) => {
          const current = press.current;
          if (!current?.held || !lockable) return;
          const distance = current.y - event.clientY;
          setLift(Math.min(1, Math.max(0, distance / LOCK_PX)));
          if (distance >= LOCK_PX) {
            press.current = null;
            setLift(0);
            onAuto("lock");
          }
        }}
        onPointerUp={() => release(true)}
        onPointerCancel={() => release(false)}
        // Enter or Space on the focused button (detail 0): one round, like a tap.
        onClick={(event) => event.detail === 0 && (auto === "lock" ? onAuto("off") : playable && onPlay())}
      >
        {auto === "lock" ? (
          <>
            <span className="size-2.5 animate-pulse rounded-full bg-current" /> Stop auto
          </>
        ) : auto === "hold" ? (
          "Auto · release to stop"
        ) : (
          children
        )}
      </button>
    </div>
  );
}

/** Switches locked auto play on and off (also key A). */
export function AutoToggle({ auto, onAuto, disabled }: { auto: AutoMode; onAuto(mode: AutoMode): void; disabled: boolean }) {
  const on = auto !== "off";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onAuto(on ? "off" : "lock")}
      disabled={disabled && !on}
      className={`flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-40 ${
        on ? "border-gold bg-gold/10 text-gold-bright" : "border-line text-muted hover:border-gold/40 hover:text-text"
      }`}
    >
      <span className="flex items-center gap-2">
        Auto play <Kbd>A</Kbd>
      </span>
      <span className={`h-5 w-9 rounded-full p-0.5 transition ${on ? "bg-gold" : "bg-white/15"}`}>
        <span className={`block size-4 rounded-full bg-ink transition ${on ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}

/** Sound on or off for all games; remembered in this browser. */
function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      aria-label={muted ? "Sound off, turn it on" : "Sound on, turn it off"}
      title={muted ? "Sound off" : "Sound on"}
      className="ml-auto grid size-7 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:border-gold/40 hover:text-text lg:ml-0 lg:size-8 lg:self-start"
    >
      <svg viewBox="0 0 24 24" className="size-3.5 lg:size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none" />
        {muted ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />}
      </svg>
    </button>
  );
}
