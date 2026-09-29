"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatTokenAmount } from "@/lib/format";
import { DEGEN_COLLECTION_URL } from "@/lib/game/card-art";
import { GAME_COPY, formatMultiplier, type GameId } from "@/lib/game/catalog";
import { InfoBubble } from "../info-bubble";

export type GameToast = { id: string | number; text: string; tone: "win" | "info" | "warn" | "error" };

/**
 * A running game fills the screen: on phones the room between the site header
 * and the docked panel, on desktops a fixed-height shell with the panel on the
 * left and the game on the right. It snaps into place when scrolled near
 * (see the scroll snap on /play); a deliberate swipe scrolls past it.
 */
export function GameFrame({
  gameId,
  payoutBps,
  onBack,
  toolbar,
  info,
  panel,
  toast,
  children,
}: {
  gameId: GameId;
  payoutBps: number;
  onBack(): void;
  toolbar?: React.ReactNode;
  /** Rules for the info bubble when the default "pick and payout" text does not fit. */
  info?: React.ReactNode;
  panel: React.ReactNode;
  /** A message that shows over the game for a moment (result, auto play stopped, error). */
  toast?: GameToast | null;
  children: React.ReactNode;
}) {
  const copy = GAME_COPY[gameId];
  const race = gameId === "card-race";
  return (
    <section
      data-game-shell
      className="relative h-[calc(100svh-6rem-var(--dock,11rem))] min-h-[22rem] snap-start overflow-hidden rounded-3xl border border-line bg-night lg:grid lg:h-[clamp(34rem,calc(100svh-6.5rem),52rem)] lg:grid-cols-[19rem_minmax(0,1fr)]"
      onPointerUp={(event) => {
        // A click with mouse or finger leaves focus on the button, which would swallow Enter and Space.
        if (event.target instanceof Element && event.target.closest("button")) window.setTimeout(() => (document.activeElement as HTMLElement | null)?.blur());
      }}
    >
      {panel}
      <div className="relative flex h-full min-h-0 min-w-0 flex-col">
        <div aria-hidden="true" className="grid-backdrop pointer-events-none absolute inset-0 opacity-50" />
        <div className="relative flex items-center gap-2 border-b border-line px-2 py-1.5 sm:px-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm text-muted transition hover:bg-white/5 hover:text-text"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="hidden sm:inline">All games</span>
          </button>
          <h2 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
            {copy.title}
            <InfoBubble label={`How ${copy.title} works`}>
              {info ?? (
                <>
                  <span className="block">{copy.tagline}</span>
                  <span className="mt-2 block">
                    {race ? "A correct pick pays the odds shown under its ace." : `A correct pick pays ${formatMultiplier(payoutBps)} your bet.`}
                  </span>
                  {race && <span className="mt-2 block">In 4× mode four races run at once, each with its own track and odds and the same bet.</span>}
                  {race && (
                    <span className="mt-2 block text-xs text-faint">
                      Card art:{" "}
                      <a href={DEGEN_COLLECTION_URL} target="_blank" rel="noreferrer" className="text-gold-bright underline-offset-2 hover:underline">
                        300 DEGEN NFTs
                      </a>
                    </span>
                  )}
                </>
              )}
            </InfoBubble>
          </h2>
          <div className="ml-auto">{toolbar}</div>
        </div>
        <div className="relative min-h-0 flex-1 p-2 sm:p-4">
          {children}
          <Toast toast={toast ?? null} />
        </div>
      </div>
    </section>
  );
}

const TOAST_STYLE: Record<GameToast["tone"], string> = {
  win: "border-positive/50 bg-[#0d2418]/95 text-positive",
  info: "border-line-strong bg-ink/95 text-text",
  warn: "border-warning/40 bg-[#2a1f08]/95 text-warning",
  error: "border-danger/40 bg-[#2a0d0f]/95 text-danger",
};

/** Shows each new message for a moment over the top of the game. */
function Toast({ toast }: { toast: GameToast | null }) {
  const [current, setCurrent] = useState<GameToast | null>(toast);
  const [seen, setSeen] = useState(toast?.id ?? null);
  if (toast && toast.id !== seen) {
    setSeen(toast.id);
    setCurrent(toast);
  }
  useEffect(() => {
    if (!current) return;
    const id = window.setTimeout(() => setCurrent(null), current.tone === "error" ? 6000 : 2600);
    return () => window.clearTimeout(id);
  }, [current]);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center px-3" aria-live="polite">
      <AnimatePresence>
        {current && (
          <motion.p
            key={current.id}
            className={`max-w-sm rounded-full border px-4 py-1.5 text-center text-sm font-semibold shadow-lg shadow-black/50 ${TOAST_STYLE[current.tone]}`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {current.text}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Segmented switch between one race and four races at once. */
export function ModeSwitch({ quad, onChange, disabled }: { quad: boolean; onChange(quad: boolean): void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Races at once" className="flex rounded-full border border-line bg-ink/60 p-0.5 text-xs font-semibold">
      {[false, true].map((value) => (
        <button
          key={String(value)}
          type="button"
          role="radio"
          aria-checked={quad === value}
          disabled={disabled}
          onClick={() => onChange(value)}
          className={`rounded-full px-3 py-1 transition disabled:opacity-50 ${quad === value ? "bg-gold/20 text-gold-bright" : "text-muted hover:text-text"}`}
        >
          {value ? "4×" : "1×"}
        </button>
      ))}
    </div>
  );
}

/** A keyboard hint, shown only where there is a mouse (and so, most likely, a keyboard). */
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="hidden min-w-5 items-center justify-center rounded-md border border-current/30 px-1 font-mono text-[0.62rem] font-semibold leading-4 opacity-70 pointer-fine:inline-flex">
      {children}
    </kbd>
  );
}

export type Bets = { min: number; max: number; step: number };

/** The next bet up (+1) or down (-1), kept inside the limits. */
export const stepBet = (bets: Bets, bet: number, direction: 1 | -1) => Math.min(bets.max, Math.max(bets.min, bet + direction * bets.step));

/** The bet as one number with − and +; the keyboard uses the same steps. */
export function BetStepper({
  bets,
  bet,
  onChange,
  disabled,
  affordable,
  label = "Bet",
  compact = false,
}: {
  bets: Bets;
  bet: number;
  onChange(bet: number): void;
  disabled: boolean;
  /** Whether an amount can be paid (4× mode multiplies it by the races picked). */
  affordable(amount: number): boolean;
  label?: string;
  /** Without the label row and a little lower, for the phone dock. */
  compact?: boolean;
}) {
  const lower = stepBet(bets, bet, -1);
  const higher = stepBet(bets, bet, 1);
  const button =
    `grid ${compact ? "size-11" : "size-12"} shrink-0 place-items-center rounded-xl border border-line text-2xl leading-none text-text transition enabled:hover:border-gold/50 enabled:hover:text-gold-bright disabled:opacity-30`;
  return (
    <div>
      <p className={`mb-2 items-center justify-between text-xs text-faint ${compact ? "hidden lg:flex" : "flex"}`}>
        {label}
        <span className="flex gap-1">
          <Kbd>−</Kbd>
          <Kbd>+</Kbd>
        </span>
      </p>
      <div className={`flex items-center gap-2 rounded-2xl border border-line bg-ink/60 ${compact ? "p-1" : "p-1.5"}`} aria-label={label} role="group">
        <button type="button" aria-label="Lower bet" className={button} onClick={() => onChange(lower)} disabled={disabled || bet <= bets.min}>
          −
        </button>
        <p className="min-w-0 flex-1 text-center" aria-live="polite">
          <span className={`${compact ? "text-xl" : "text-2xl"} font-semibold tabular-nums ${affordable(bet) ? "text-text" : "text-danger"}`}>{formatTokenAmount(BigInt(bet))}</span>
          {!compact && <span className="ml-1.5 text-xs text-muted">300</span>}
        </p>
        <button
          type="button"
          aria-label="Raise bet"
          className={button}
          onClick={() => onChange(higher)}
          disabled={disabled || bet >= bets.max || !affordable(higher)}
        >
          +
        </button>
      </div>
    </div>
  );
}

const KEY_NAMES: Record<string, string> = {
  " ": "space",
  Enter: "enter",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  "+": "plus",
  "=": "plus",
  "-": "minus",
  "_": "minus",
};

/**
 * Keyboard control for a running game. Keys are named as in KEY_NAMES or by
 * their lower-case character ("1", "c"). A button that has keyboard focus keeps
 * Enter and Space for itself; typing in a field or an open dialog pauses the game keys.
 */
export function useGameKeys(bindings: Record<string, (() => void) | false | undefined>) {
  const current = useRef(bindings);
  useEffect(() => {
    current.current = bindings;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      const key = KEY_NAMES[event.key] ?? event.key.toLowerCase();
      if ((key === "enter" || key === "space") && target?.closest("button, a")) return;
      const handler = current.current[key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
