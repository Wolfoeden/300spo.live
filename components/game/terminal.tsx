"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { SoonBadge } from "../coming-soon";
import { Kbd } from "./game-frame";

/** Auto play: off, running while the play button is held, or locked on until stopped. */
export type AutoMode = "off" | "hold" | "lock";
type Tab = "play" | "deposit" | "withdraw" | "rewards";

/** Other parts of the page open a terminal tab with this event (detail: the tab). */
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

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: "play", label: "Play", path: "M8 5v14l11-7z" },
  { id: "deposit", label: "Deposit", path: "M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" },
  { id: "withdraw", label: "Withdraw", path: "M12 20V8m0 0l-5 5m5-5l5 5M5 4h14" },
  { id: "rewards", label: "Rewards", path: "M12 3c3 4 6 6.5 6 10a6 6 0 01-12 0c0-3.5 3-6 6-10z" },
];

/**
 * The game terminal: play controls and the wallet (deposit, withdraw, rewards)
 * behind one set of tabs. Docked to the bottom of the screen on phones, a
 * column beside the game on desktops; `docked={false}` is a plain card.
 */
export function Terminal({
  play,
  deposit,
  rewards,
  balance,
  docked = true,
}: {
  play?: React.ReactNode;
  deposit: React.ReactNode;
  rewards: React.ReactNode;
  balance?: number;
  docked?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(play ? "play" : "deposit");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<Tab>).detail;
      if (next !== "deposit" && next !== "rewards") return;
      setTab(next);
      // On phones the docked terminal is always on screen; elsewhere bring it into view.
      if (!docked || window.matchMedia("(min-width: 1024px)").matches) root.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
  }, [docked]);
  const tabs = TABS.filter((entry) => entry.id !== "play" || play);
  const panel = tab === "play" ? play : tab === "deposit" ? deposit : rewards;

  const bar = (
    <div role="tablist" aria-label="Terminal" className={`grid gap-1 ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
      {tabs.map((entry) => {
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
            onClick={() => !soon && setTab(entry.id)}
            className={`relative flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[0.68rem] font-semibold transition sm:flex-row sm:gap-1.5 sm:text-xs ${
              soon ? "cursor-not-allowed text-faint/70" : selected ? "bg-gold/15 text-gold-bright" : "text-muted hover:bg-white/5 hover:text-text"
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill={entry.id === "play" ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={entry.path} />
            </svg>
            {entry.label}
            {soon && (
              <span className="absolute -right-0.5 -top-1.5 origin-top-right scale-90 sm:static sm:scale-100">
                <SoonBadge />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (!docked) {
    return (
      <section ref={root} id="terminal" className="glass scroll-mt-24 rounded-3xl p-3 sm:p-4">
        <div className="rounded-2xl border border-line bg-ink/60 p-1">{bar}</div>
        <div className="p-2 pt-4 sm:p-3 sm:pt-5">{panel}</div>
      </section>
    );
  }

  return (
    <div
      ref={root}
      id="terminal"
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col-reverse border-t border-line-strong bg-ink/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl lg:sticky lg:top-24 lg:z-auto lg:flex-col lg:self-start lg:rounded-2xl lg:border lg:border-line lg:bg-ink/70 lg:pb-0 lg:shadow-none lg:backdrop-blur-none"
    >
      <div className="border-t border-line p-1.5 lg:border-b lg:border-t-0">{bar}</div>
      <div className={`overflow-y-auto overscroll-contain p-3 lg:max-h-none lg:p-4 ${tab === "play" ? "" : "max-h-[65vh]"}`}>
        {balance !== undefined && tab === "play" && (
          <p className="mb-2 flex items-center justify-between font-mono text-[0.66rem] uppercase tracking-[0.16em] text-faint lg:hidden">
            Balance <span className="text-sm normal-case tracking-normal text-text tabular-nums">{formatTokenAmount(BigInt(balance))} 300</span>
          </p>
        )}
        {panel}
      </div>
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
            <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${lift > 0.6 ? "border-gold bg-gold/20 text-gold-bright" : "border-line-strong bg-ink/90 text-muted"}`}>
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
        className={`flex min-h-14 w-full touch-none select-none items-center justify-center gap-2 rounded-2xl px-4 text-base font-bold transition [-webkit-touch-callout:none] ${colors} ${
          !playable && auto === "off" ? "opacity-45" : "enabled:hover:brightness-110"
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
      className={`flex min-h-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border px-3 text-[0.7rem] font-semibold uppercase tracking-wide transition disabled:opacity-40 ${
        on ? "border-gold bg-gold/15 text-gold-bright" : "border-line text-muted hover:border-gold/40 hover:text-text"
      }`}
    >
      <span className={`h-3.5 w-6 rounded-full p-0.5 transition ${on ? "bg-gold" : "bg-white/15"}`}>
        <span className={`block size-2.5 rounded-full bg-ink transition ${on ? "translate-x-2.5" : ""}`} />
      </span>
      <span className="flex items-center gap-1">
        Auto <Kbd>A</Kbd>
      </span>
    </button>
  );
}
