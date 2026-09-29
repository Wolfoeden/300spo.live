"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatTokenAmount } from "@/lib/format";
import { SUIT_COLORS } from "@/lib/game/card-race";
import { cosmetic, formatMultiplier } from "@/lib/game/catalog";
import { DIFFICULTIES, hitChance } from "@/lib/game/chicken";
import { Spinner } from "../icons";
import type { ArenaGame } from "./arena";
import { WinBurst } from "./arena-effects";
import { BetStepper, GameFrame, Kbd, stepBet, useGameKeys } from "./game-frame";

export type ChickenRound = {
  id: number;
  bet: number;
  hazards: number;
  lanes: number;
  step: number;
  status: "open" | "lost" | "collected";
  payout: number;
  crashLane: number | null;
  multipliers: number[];
  balance?: number;
};
export type ChickenState = { open: ChickenRound | null; difficulties: { hazards: number; lanes: number; multipliers: number[] }[] };

type Props = {
  game: ArenaGame;
  bets: { min: number; max: number; step: number };
  balance: number;
  enabled: boolean;
  load(): Promise<ChickenState>;
  start(bet: number, hazards: number): Promise<ChickenRound>;
  step(round: number): Promise<ChickenRound>;
  collect(round: number): Promise<ChickenRound>;
  onSettled(): void;
  onBack(): void;
};

const COCK = "/game/chicken-cock.jpg";

const subscribeResize = (callback: () => void) => {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
};

/** Chicken: walk the blue cock across the road; collect before a car hits. */
export function ChickenGame({ game, bets, balance, enabled, load, start, step, collect, onSettled, onBack }: Props) {
  const reduce = useReducedMotion();
  const [config, setConfig] = useState<ChickenState | null>(null);
  const [round, setRound] = useState<ChickenRound | null>(null);
  const [hazards, setHazards] = useState<number>(DIFFICULTIES[0].hazards);
  const [bet, setBet] = useState(bets.min);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState<{ id: number; amount: number } | null>(null);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);
  const [seenBalance, setSeenBalance] = useState(balance);
  if (balance !== seenBalance) {
    // A refreshed balance from the page replaces the one from the last response.
    setSeenBalance(balance);
    setLiveBalance(null);
  }

  // Resume an open round after a reload.
  useEffect(() => {
    let active = true;
    load().then(
      (loaded) => {
        if (!active) return;
        setConfig(loaded);
        if (loaded.open) {
          setRound(loaded.open);
          setHazards(loaded.open.hazards);
          setBet(loaded.open.bet);
        }
      },
      () => active && setError("Could not load the game. Reload the page."),
    );
    return () => {
      active = false;
    };
  }, [load]);

  const open = round?.status === "open";
  // A finished round stays on the road until the next GO or a new difficulty.
  const shown = round && (open || round.hazards === hazards) ? round : null;
  const difficulty = config?.difficulties.find((entry) => entry.hazards === hazards);
  const lanes = shown?.lanes ?? difficulty?.lanes ?? 0;
  const multipliers = shown?.multipliers ?? difficulty?.multipliers ?? [];
  const position = shown?.step ?? 0;
  const current = open && position > 0 ? multipliers[position - 1] : 0;
  const collectable = open && position > 0 ? Math.floor((round.bet * current) / 10000) : 0;
  const nextChance = open ? hitChance(round.hazards, position) : hitChance(hazards, 0);
  const shownBalance = liveBalance ?? balance;
  const canGo = enabled && !busy && !!config && (open || bet <= shownBalance);

  const settle = useCallback(
    (result: ChickenRound) => {
      if (result.balance !== undefined) setLiveBalance(result.balance);
      if (result.status === "collected" && result.payout > 0) setBurst({ id: result.id, amount: result.payout });
      if (result.status !== "open") onSettled();
    },
    [onSettled],
  );

  const go = async () => {
    if (!canGo) return;
    setBusy(true);
    setError(null);
    setBurst(null);
    try {
      let active = open ? round : null;
      if (!active) {
        active = await start(bet, hazards);
        setRound(active);
        settle(active);
        // The stake is gone now; the page balance should show it, not only the chip.
        onSettled();
      }
      const next = await step(active.id);
      setRound(next);
      settle(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The cock could not move.");
    } finally {
      setBusy(false);
    }
  };

  const take = async () => {
    if (!open || position < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await collect(round.id);
      setRound(result);
      settle(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not collect.");
    } finally {
      setBusy(false);
    }
  };

  const chooseDifficulty = (value: number) => {
    if (open || busy) return;
    setHazards(value);
    setBurst(null);
  };

  const betLocked = open || busy;
  useGameKeys({
    space: () => canGo && void go(),
    enter: () => canGo && void go(),
    right: () => canGo && void go(),
    c: () => open && position > 0 && !busy && void take(),
    ...Object.fromEntries(DIFFICULTIES.map((entry, index) => [String(index + 1), () => chooseDifficulty(entry.hazards)])),
    up: () => !betLocked && setBet(stepBet(bets, bet, 1)),
    down: () => !betLocked && setBet(stepBet(bets, bet, -1)),
    plus: () => !betLocked && setBet(stepBet(bets, bet, 1)),
    minus: () => !betLocked && setBet(stepBet(bets, bet, -1)),
  });

  const rules = (
    <>
      <span className="block">Each GO moves the blue cock one lane further and raises the multiplier. Collect whenever you like — if a car hits him, the bet is lost.</span>
      <span className="mt-2 block">
        The difficulty hides 1, 3, 5 or 10 cars among 25 cells; the multipliers are the fair price for surviving that many lanes. The last lane collects by
        itself.
      </span>
    </>
  );

  return (
    <GameFrame gameId="chicken" payoutBps={game.payoutBps} balance={shownBalance} onBack={onBack} info={rules}>
      <Road
        lanes={lanes}
        multipliers={multipliers}
        position={position}
        round={shown}
        reduce={!!reduce}
        burst={burst && shown?.id === burst.id ? burst : null}
        onBurstDone={() => setBurst(null)}
      />

      <div className="grid gap-4 border-t border-line p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:items-end">
        <BetStepper bets={bets} bet={bet} onChange={setBet} disabled={betLocked} affordable={(amount) => amount <= shownBalance || open} />
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between gap-2 text-xs text-faint">
            <span className="flex items-center gap-1.5">
              Difficulty
              <Kbd>1</Kbd>–<Kbd>4</Kbd>
            </span>
            <span>
              Chance of a car next lane: <span className="font-semibold text-text">{(nextChance * 100).toFixed(nextChance < 0.1 ? 1 : 0)}%</span>
            </span>
          </legend>
          <div className="grid grid-cols-4 gap-1 rounded-2xl border border-line bg-ink/60 p-1">
            {DIFFICULTIES.map((entry) => (
              <button
                key={entry.hazards}
                type="button"
                onClick={() => chooseDifficulty(entry.hazards)}
                disabled={open || busy}
                aria-pressed={hazards === entry.hazards}
                className={`rounded-xl px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed sm:text-sm ${
                  hazards === entry.hazards ? "bg-gold/20 text-gold-bright" : "text-muted enabled:hover:text-text"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2 lg:w-80">
          <button
            type="button"
            onClick={take}
            disabled={!open || position < 1 || busy}
            className="flex min-h-14 flex-col items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#f4d675,#c98a2b)] px-3 font-bold leading-tight text-[#1a1204] shadow-[0_10px_30px_-12px_rgba(233,180,76,0.8)] transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5 text-sm uppercase tracking-wide">
              Collect <Kbd>C</Kbd>
            </span>
            <span className="text-xs tabular-nums">{collectable > 0 ? `${formatTokenAmount(BigInt(collectable))} · ${formatMultiplier(current)}` : "—"}</span>
          </button>
          <button
            type="button"
            onClick={go}
            disabled={!canGo}
            className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#5ee39b,#1f9d5c)] px-3 text-xl font-black uppercase tracking-wide text-[#062915] shadow-[0_10px_30px_-12px_rgba(94,227,155,0.7)] transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            {busy ? (
              <Spinner size={18} />
            ) : (
              <>
                Go <Kbd>Space</Kbd>
              </>
            )}
          </button>
        </div>
        {!open && bet > balance && <p className="text-sm text-warning lg:col-span-3">Not enough game balance for this bet.</p>}
        <AnimatePresence mode="wait">
          {shown && shown.status !== "open" && (
            <motion.p
              key={shown.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`rounded-2xl border p-3 text-sm lg:col-span-3 ${
                shown.status === "collected" ? "border-positive/40 bg-positive/10 text-positive" : "border-danger/30 bg-danger/10 text-danger"
              }`}
            >
              {shown.status === "collected"
                ? `Collected ${formatTokenAmount(BigInt(shown.payout))} tokens after ${shown.step} lane${shown.step === 1 ? "" : "s"} (${formatMultiplier(multipliers[shown.step - 1])}).`
                : `A car got the cock on lane ${shown.step}. The ${formatTokenAmount(BigInt(shown.bet))} bet is lost — GO starts a new round.`}
            </motion.p>
          )}
        </AnimatePresence>
        {error && <p className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger lg:col-span-3">{error}</p>}
        {!enabled && <p className="text-sm text-warning lg:col-span-3">Games are paused right now.</p>}
      </div>
    </GameFrame>
  );
}

// ---------------------------------------------------------------- the road

function Road({
  lanes,
  multipliers,
  position,
  round,
  reduce,
  burst,
  onBurstDone,
}: {
  lanes: number;
  multipliers: number[];
  position: number;
  round: ChickenRound | null;
  reduce: boolean;
  burst: { id: number; amount: number } | null;
  onBurstDone(): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const narrow = useSyncExternalStore(subscribeResize, () => window.innerWidth < 640, () => false);
  const lane = narrow ? 84 : 124;

  const lost = round?.status === "lost";
  const crashLane = lost ? round.step : null;
  const sidewalk = Math.round(lane * 1.1);
  const centerOf = (index: number) => (index === 0 ? sidewalk / 2 : sidewalk + (index - 0.5) * lane);

  // Keep the cock in view as he walks.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTo({ left: Math.max(0, centerOf(position) - element.clientWidth / 2), behavior: reduce ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, lane]);

  return (
    <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      <div
        className="relative h-72 overflow-hidden bg-[linear-gradient(180deg,#1b1c20,#141518)] sm:h-96"
        style={{ width: sidewalk * 2 + lanes * lane, minWidth: "100%" }}
      >
        {/* start sidewalk with the 300 coin */}
        <div className="absolute inset-y-0 left-0 border-r-4 border-[#2c2d33] bg-[#232429]" style={{ width: sidewalk }}>
          <div className="absolute inset-x-0 top-1/2 mx-auto grid -translate-y-1/2 place-items-center" style={{ width: lane * 0.8, height: lane * 0.8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/300-logo.jpg" alt="" className="size-full rounded-full opacity-90 ring-2 ring-gold/60" />
          </div>
        </div>

        {Array.from({ length: lanes }, (_, index) => {
          const number = index + 1;
          const passed = number < position || (number === position && !lost);
          const next = round?.status !== "lost" && round?.status !== "collected" && number === position + 1;
          const crash = number === crashLane;
          // Decorative traffic on lanes ahead; the crash lane gets its own car.
          const traffic = !crash && number > position + 1 && cosmetic(number, 3) > 0.45;
          const suit = number % 4;
          return (
            <div key={number} className="absolute inset-y-0 border-l-2 border-dashed border-gold/25" style={{ left: sidewalk + index * lane, width: lane }}>
              {traffic && (
                <div
                  aria-hidden="true"
                  className={reduce ? "hidden" : "absolute left-1/2 top-0 -ml-[18px] animate-drive"}
                  style={{ animationDuration: `${2.4 + cosmetic(number, 5) * 2.2}s`, animationDelay: `-${cosmetic(number, 7) * 3}s` }}
                >
                  <Car color={SUIT_COLORS[suit]} />
                </div>
              )}
              {passed && (
                <motion.div
                  className="absolute inset-x-1 top-[18%]"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Barrier />
                </motion.div>
              )}
              <div className="absolute inset-x-0 top-1/2 grid -translate-y-1/2 place-items-center">
                <Plate value={multipliers[index]} size={lane * 0.74} state={crash ? "crash" : passed ? "passed" : next ? "next" : "ahead"} />
              </div>
              {crash && <CrashCar token={lane * 0.62} />}
            </div>
          );
        })}

        {/* finish sidewalk */}
        <div className="absolute inset-y-0 right-0 border-l-4 border-[#2c2d33] bg-[#232429]" style={{ width: sidewalk }}>
          <div className="absolute inset-y-0 left-0 w-2 bg-[repeating-linear-gradient(180deg,#e9b44c_0_8px,#0b0b0c_8px_16px)] opacity-70" />
        </div>

        <motion.div
          className="absolute top-1/2 z-10"
          style={{ width: lane * 0.62, height: lane * 0.62, marginLeft: -(lane * 0.31), marginTop: -(lane * 0.31) }}
          initial={false}
          animate={{
            left: centerOf(position),
            rotate: lost ? 90 : 0,
            scale: lost ? 0.85 : 1,
            opacity: lost ? 0.8 : 1,
            filter: lost ? "grayscale(0.7)" : "grayscale(0)",
          }}
          transition={{ type: "spring", stiffness: 260, damping: 24, delay: lost ? 0.35 : 0 }}
        >
          <motion.div key={position} animate={reduce ? {} : { y: [0, -16, 0] }} transition={{ duration: 0.35 }} className="size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={COCK}
              alt="The blue cock"
              className="size-full rounded-full object-cover shadow-[0_10px_30px_-8px_rgba(0,0,0,0.8)] ring-[3px] ring-gold-bright"
            />
          </motion.div>
          {/* The cock stands on his lane's plate, so its multiplier sits under him. */}
          {position > 0 && !lost && multipliers[position - 1] && (
            <span className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#1f2a44] px-2 py-1 text-xs font-bold tabular-nums text-white shadow-lg ring-1 ring-[#8fb1ff]/60 sm:text-sm">
              {formatMultiplier(multipliers[position - 1])}
            </span>
          )}
        </motion.div>

        <AnimatePresence>{burst && <WinBurst key={burst.id} amount={burst.amount} onDone={onBurstDone} />}</AnimatePresence>
      </div>
    </div>
  );
}

function Plate({ value, size, state }: { value: number | undefined; size: number; state: "ahead" | "next" | "passed" | "crash" }) {
  const styles = {
    ahead: "border-white/10 bg-[radial-gradient(circle_at_40%_35%,#2c2d33,#16171b)] text-faint",
    next: "border-gold-bright bg-[radial-gradient(circle_at_40%_35%,#3a3120,#16171b)] text-gold-bright shadow-[0_0_24px_rgba(233,180,76,0.45)]",
    passed: "border-gold-bright bg-[radial-gradient(circle_at_40%_35%,#ffe7a8,#e9b44c_55%,#a8691c)] text-[#1a1204]",
    crash: "border-danger bg-[radial-gradient(circle_at_40%_35%,#5a1a1f,#1c0b0d)] text-danger",
  }[state];
  return (
    <span
      className={`grid place-items-center rounded-full border-[3px] font-bold tabular-nums tracking-tight ${styles} ${state === "next" ? "animate-pulse" : ""}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.24) }}
    >
      {value ? formatMultiplier(value) : ""}
    </span>
  );
}

function Barrier() {
  return (
    <svg viewBox="0 0 100 34" className="w-full drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]" aria-hidden="true">
      <defs>
        <pattern id="stripes" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="16" fill="#e9b44c" />
          <rect x="8" width="8" height="16" fill="#101114" />
        </pattern>
      </defs>
      <rect x="10" y="20" width="8" height="14" rx="2" fill="#6b6c73" />
      <rect x="82" y="20" width="8" height="14" rx="2" fill="#6b6c73" />
      <rect x="2" y="4" width="96" height="18" rx="4" fill="url(#stripes)" stroke="#f3cf73" strokeWidth="2" />
    </svg>
  );
}

function Car({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 36 64" width="36" height="64" aria-hidden="true">
      <rect x="2" y="2" width="32" height="60" rx="9" fill="#0f1013" stroke={color} strokeWidth="2.5" />
      <rect x="7" y="12" width="22" height="11" rx="3" fill="#8fb1ff" opacity="0.35" />
      <rect x="7" y="40" width="22" height="8" rx="3" fill="#8fb1ff" opacity="0.25" />
      <rect x="15" y="2" width="6" height="60" fill={color} opacity="0.85" />
      <rect x="5" y="56" width="7" height="4" rx="1.5" fill="#ffe7a8" />
      <rect x="24" y="56" width="7" height="4" rx="1.5" fill="#ffe7a8" />
    </svg>
  );
}

/** The car that ends the round: it drives down its lane and stops with its nose on the cock. */
function CrashCar({ token }: { token: number }) {
  // Top edge of the cock token, measured from the middle of the road.
  const impact = `calc(50% - ${token / 2}px)`;
  return (
    <>
      <motion.div
        aria-hidden="true"
        className="absolute left-1/2 z-20 -ml-[18px] -mt-[58px]"
        style={{ top: impact }}
        initial={{ y: -360 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.35, ease: "easeIn" }}
      >
        <Car color="#ff6b6b" />
      </motion.div>
      <motion.span
        aria-hidden="true"
        className="absolute left-1/2 z-30 -ml-7 -mt-7 grid size-14 place-items-center"
        style={{ top: impact }}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.4, 1, 1.1], opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.2, delay: 0.3, times: [0, 0.25, 0.6, 1] }}
      >
        <svg viewBox="0 0 64 64" className="size-full" aria-hidden="true">
          <path d="M32 2l7 17 18-8-9 17 16 7-18 5 6 18-16-10-12 14-2-18-18 2 13-13L4 20l19 1z" fill="#ff6b6b" stroke="#ffe7a8" strokeWidth="2" />
        </svg>
      </motion.span>
    </>
  );
}
